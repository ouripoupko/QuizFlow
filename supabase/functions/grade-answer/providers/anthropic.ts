import { AiGradingResultSchema } from "../../_shared/aiTypes.ts";
import { isCreditExhausted } from "../../_shared/anthropicErrors.ts";
import {
  contentWithNumberedImages,
  imageNumberingNote,
  redactImageData,
} from "../../_shared/questionImages.ts";
import {
  type GradingInput,
  type GradingOutcome,
  type GradingSettings,
  ProviderCreditExhaustedError,
  type ProviderAdapter,
} from "./types.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Fallback only — in practice `model` always comes from the teacher's saved
// choice (teacher_ai_keys.model has a NOT NULL default, see the migration).
const DEFAULT_MODEL = "claude-sonnet-5";

// Thinking tokens count against max_tokens, so a thinking model at the bare
// 1024 has almost no room to reason before it must answer — which showed up
// as careless verdicts. Any model that thinks gets a much higher ceiling.
// Only tokens actually used are billed, so the ceiling itself costs nothing.
// (legacy budget_tokens must also stay below max_tokens, and be >= 1024.)
const BASE_MAX_TOKENS = 1024;
const THINKING_MAX_TOKENS = 8192;
const LEGACY_THINKING_BUDGET_TOKENS = 2048;

// Structured outputs: the API guarantees the reply is valid JSON matching
// this schema, escaping included. Without it, a Hebrew abbreviation typed
// with a plain quote (סה"כ, ע"י) inside a string broke the JSON, and the
// answer silently fell back to "unsure" with no feedback or reasoning.
// Property order is the order the model writes them: reasoning first.
const GRADING_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    decision: { type: "string", enum: ["pass", "fail", "unsure"] },
    studentFeedback: { type: "string" },
  },
  required: ["reasoning", "decision", "studentFeedback"],
  additionalProperties: false,
};

// The language names as they appear inside the (Hebrew) prompt.
const LANGUAGE_IN_PROMPT: Record<GradingInput["language"], string> = {
  he: "בעברית",
  en: "באנגלית",
  ar: "בערבית",
};

function buildPrompt(input: GradingInput): string {
  const lines: string[] = [];
  const part = input.part;

  if (!part) {
    lines.push(`שאלה:\n${input.questionPrompt}`);
  } else {
    lines.push(`שאלה (תרחיש פתיחה משותף לכל הסעיפים):\n${input.questionPrompt}`);
  }

  const imagesNote = imageNumberingNote(input.images.length);
  if (imagesNote) lines.push(imagesNote);

  if (part && part.previousParts.length > 0) {
    lines.push(
      `סעיפים קודמים — כבר נענו ונבדקו. הם מובאים להקשר בלבד: אין לבדוק אותם שוב ואין ` +
        `להתייחס אליהם במשוב, אלא אם הם נחוצים כדי להבין את התשובה לסעיף הנוכחי.\n\n` +
        part.previousParts.map((p) =>
          `סעיף ${p.number}:\n${p.prompt}\nהתשובה הסופית של התלמיד:\n${p.finalAnswer ?? "(לא נענה)"}`
        ).join("\n\n"),
    );
  }

  if (part) {
    lines.push(
      `הסעיף הנוכחי לבדיקה — סעיף ${part.number}:\n${part.prompt}\n\n` +
        `בדוק רק את התשובה לסעיף ${part.number}.`,
    );
  }

  if (input.answerKeyImage) {
    lines.push(
      `לתשובה הנכונה מצורפת תמונה (מסומנת "תמונת התשובה הנכונה"), למשל השרטוט או הגרף הצפויים. ` +
        `היא חלק מהתשובה הנכונה: השווה אליה את תשובת התלמיד.`,
    );
  }

  if (input.correctAnswer) {
    lines.push(
      part
        ? `תשובה נכונה (לסעיף ${part.number}):\n${input.correctAnswer}`
        : `תשובה נכונה:\n${input.correctAnswer}`,
    );
  } else {
    // Without a reference answer the model has to solve it itself — say so
    // explicitly, so it doesn't jump straight to judging the student. The
    // solving happens in the "reasoning" field (see the format below), which
    // exists even when adaptive thinking decides not to think.
    lines.push(
      `לא סופקה תשובה נכונה. לפני שאתה בודק את תשובת התלמיד, פתור בעצמך ` +
        (part ? `את סעיף ${part.number}, בהקשר של תרחיש הפתיחה,` : `את השאלה`) +
        ` (בשדה "reasoning"), ורק אז השווה את תשובת התלמיד לפתרון שלך.`,
    );
  }

  lines.push(`הנחיות ציון:\n${input.gradingInstructions}`);

  if (input.studentImage) {
    lines.push(
      `התלמיד צירף לתשובתו הנוכחית תמונה (מסומנת "תמונת התלמיד", אחרי תמונות השאלה). ` +
        `בדוק את הטקסט ואת התמונה יחד, כתשובה אחת: התמונה היא חלק מהתשובה ולא חלק מהשאלה.`,
    );
  }

  lines.push(
    `${part ? `רצף תשובות התלמיד לסעיף ${part.number}` : "רצף תשובות התלמיד"} (בסדר כרונולוגי):\n${
      input.answerSequence.map((a, i) => `${i + 1}. ${a}`).join("\n")
    }`,
  );

  if (input.flowMode === "infinite_attempts") {
    lines.push(
      `הערה חשובה: זהו שאלון "נסה שוב" — אם התשובה שגויה, התלמיד ינסה שוב על סמך ה-"studentFeedback" שלך. ` +
        `לכן ה-"studentFeedback" לא יחשוף את התשובה הנכונה, לא יצטט אותה ולא ינוסח כך שניתן להסיק ממנו ` +
        `את התשובה המדויקת. אם אפשר להצביע למה שגוי בתשובת התלמיד מבלי לרמוז על הפתרון — עשה זאת; אחרת ` +
        `די במשוב כללי בלבד (למשל "התשובה אינה נכונה, נסה שוב"), בלי לגלות את התשובה — זה תמיד אפשרי, גם ` +
        `לשאלות עם תשובה קצרה או עובדתית. חובה להחזיר JSON תקין לפי הפורמט למטה בכל מקרה — גם אם אתה ` +
        `מתלבט, בחר "unsure" ולא טקסט חופשי.`,
    );
  }

  lines.push(`
החזר אובייקט JSON בדיוק בצורה הבאה, ללא טקסט נוסף לפני או אחרי:
{
  "reasoning": "<נימוק למורה>",
  "decision": "pass" | "fail" | "unsure",
  "studentFeedback": "<משוב קצר לתלמיד, יכול להיות ריק>"
}
כתוב את "reasoning" ראשון, לפני שאתה מחליט: ${LANGUAGE_IN_PROMPT[input.language]} פשוטה, ב-2–4 משפטים, למורה ולא לתלמיד — ` +
    `מה הפתרון הנכון, ואיך תשובת התלמיד משתווה אליו. אם בחרת "unsure", הסבר במפורש מה גרם לספק. ` +
    `שדה זה מוצג למורה בלבד ולעולם לא לתלמיד, ולכן מותר לציין בו את התשובה הנכונה.
השתמש ב-"unsure" אם אינך בטוח, או אם אינך יכול לעמוד בהנחיות אלה מכל סיבה שהיא.`);

  // Hebrew is the default and needs no extra line (keeps its prompt as before).
  if (input.language !== "he") {
    lines.push(
      `שפת התלמיד: כתוב את "studentFeedback" ואת "reasoning" ${LANGUAGE_IN_PROMPT[input.language]}, ` +
        `גם אם השאלה כתובה בשפה אחרת.`,
    );
  }

  return lines.join("\n\n");
}

// Builds the `thinking` field, if any, purely from the model's own thinking
// system — on (in whichever form the family supports) whenever it supports
// thinking at all, omitted otherwise. Never explicitly disabled.
function buildThinking(thinkingFamily: GradingSettings["thinkingFamily"]): Record<string, unknown> | null {
  if (thinkingFamily === "adaptive") return { type: "adaptive" };
  if (thinkingFamily === "legacy") {
    return { type: "enabled", budget_tokens: LEGACY_THINKING_BUDGET_TOKENS };
  }
  return null;
}

export const anthropicAdapter: ProviderAdapter = {
  async grade(input: GradingInput, settings: GradingSettings): Promise<GradingOutcome> {
    const thinking = buildThinking(settings.thinkingFamily);

    const body: Record<string, unknown> = {
      model: settings.model || DEFAULT_MODEL,
      max_tokens: thinking ? THINKING_MAX_TOKENS : BASE_MAX_TOKENS,
      messages: [{
        role: "user",
        content: contentWithNumberedImages(
          input.images,
          buildPrompt(input),
          input.studentImage,
          input.answerKeyImage,
        ),
      }],
    };

    if (thinking) body.thinking = thinking;

    // Effort only exists alongside adaptive-family thinking; sending it to a
    // legacy/none model 400s the same way effort on Haiku 4.5 did before.
    const outputConfig: Record<string, unknown> = {
      format: { type: "json_schema", schema: GRADING_SCHEMA },
    };
    if (settings.effort && settings.thinkingFamily === "adaptive") {
      outputConfig.effort = settings.effort;
    }
    body.output_config = outputConfig;

    const send = () =>
      fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

    let response = await send();
    let structuredOutput = true;

    // Not every model supports structured outputs (e.g. Opus 4.6/4.7, Sonnet
    // 4.6). Rather than keep a model list that goes stale, retry once
    // without the format and rely on the prompt + lenient parse below.
    if (response.status === 400) {
      const errBody = await response.clone().text();
      if (/output_config|format|json_schema|structured/i.test(errBody) && !isCreditExhausted(400, errBody)) {
        console.error("grade-answer: structured outputs rejected, retrying without:", errBody.slice(0, 500));
        delete outputConfig.format;
        if (Object.keys(outputConfig).length === 0) delete body.output_config;
        structuredOutput = false;
        response = await send();
      }
    }

    if (!response.ok) {
      const errBody = await response.text();
      if (isCreditExhausted(response.status, errBody)) {
        throw new ProviderCreditExhaustedError(`Anthropic credit exhausted: ${errBody}`);
      }
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      model?: string;
      stop_reason?: string | null;
      usage?: Record<string, unknown>;
    };

    // Kept for the admin view: why the model stopped (e.g. "max_tokens" =
    // cut off) and what the call actually used — the per-answer cost.
    const responseMeta: Record<string, unknown> = {
      model: data.model ?? null,
      stop_reason: data.stop_reason ?? null,
      structured_output: structuredOutput,
      usage: data.usage ?? null,
    };

    const text = data.content.find((c) => c.type === "text")?.text ?? "";

    // Strip any markdown code fences the model may add.
    const json = text.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();

    // Zod validates the shape before we trust it (spec §8.4).
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      // Only decision + studentFeedback go back to the student's browser;
      // the reasoning (which may state the correct answer) is teacher-only.
      const result = AiGradingResultSchema.parse({
        decision: parsed.decision,
        studentFeedback: parsed.studentFeedback,
      });
      const reasoning = typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : null;
      return { result, reasoning, rawRequest: redactImageData(body), responseMeta };
    } catch {
      // The model broke format (e.g. replied in prose instead of JSON) —
      // log it and fall back to a low-confidence verdict rather than
      // failing the request outright.
      console.error("grade-answer: AI reply was not valid JSON:", text.slice(0, 2000));
      // Flag it for the control board (the teacher is told to judge this
      // one themselves), and keep what the AI wrote for the admin view.
      responseMeta.reply_broken = true;
      responseMeta.unparsed_reply = text.slice(0, 4000);
      return {
        result: { decision: "unsure", studentFeedback: "" },
        reasoning: null,
        rawRequest: redactImageData(body),
        responseMeta,
      };
    }
  },
};
