import { AiGradingResultSchema } from "../../_shared/aiTypes.ts";
import type { GradingInput, GradingOutcome, GradingSettings, ProviderAdapter } from "./types.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Fallback only — in practice `model` always comes from the teacher's saved
// choice (teacher_ai_keys.model has a NOT NULL default, see the migration).
const DEFAULT_MODEL = "claude-sonnet-5";

// budget_tokens must be strictly less than max_tokens (and Anthropic requires
// it be at least 1024) — the base 1024 max_tokens grading normally runs with
// isn't enough headroom once "legacy"-family thinking is turned on, so bump
// both together in that one case.
const BASE_MAX_TOKENS = 1024;
const LEGACY_THINKING_MAX_TOKENS = 4096;
const LEGACY_THINKING_BUDGET_TOKENS = 2048;

function buildPrompt(input: GradingInput): string {
  const lines: string[] = [];

  lines.push(`שאלה:\n${input.questionPrompt}`);

  if (input.correctAnswer) {
    lines.push(`תשובה נכונה:\n${input.correctAnswer}`);
  }

  lines.push(`הנחיות ציון:\n${input.gradingInstructions}`);

  lines.push(
    `רצף תשובות התלמיד (בסדר כרונולוגי):\n${
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
  "decision": "pass" | "fail" | "unsure",
  "studentFeedback": "<משוב קצר לתלמיד, יכול להיות ריק>"
}
השתמש ב-"unsure" אם אינך בטוח, או אם אינך יכול לעמוד בהנחיות אלה מכל סיבה שהיא.`);

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
      max_tokens: settings.thinkingFamily === "legacy" ? LEGACY_THINKING_MAX_TOKENS : BASE_MAX_TOKENS,
      messages: [{ role: "user", content: buildPrompt(input) }],
    };

    if (thinking) body.thinking = thinking;

    // Effort only exists alongside adaptive-family thinking; sending it to a
    // legacy/none model 400s the same way effort on Haiku 4.5 did before.
    if (settings.effort && settings.thinkingFamily === "adaptive") {
      body.output_config = { effort: settings.effort };
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content.find((c) => c.type === "text")?.text ?? "";

    // Strip any markdown code fences the model may add.
    const json = text.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();

    // Zod validates the shape before we trust it (spec §8.4).
    try {
      const result = AiGradingResultSchema.parse(JSON.parse(json));
      return { result, rawRequest: body };
    } catch {
      // The model broke format (e.g. replied in prose instead of JSON) —
      // log it and fall back to a low-confidence verdict rather than
      // failing the request outright.
      console.error("grade-answer: AI reply was not valid JSON:", text.slice(0, 2000));
      return {
        result: { decision: "unsure", studentFeedback: "" },
        rawRequest: body,
      };
    }
  },
};
