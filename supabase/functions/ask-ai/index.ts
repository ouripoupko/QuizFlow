/**
 * ask-ai — authoring assistant Edge Function (spec §5.2, §8.3).
 *
 * Called from the question editor when the teacher clicks
 * "שאל את ה-AI מה התשובה הנכונה". Returns a proposed correct answer
 * that the teacher can then edit. The key never leaves the server.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";
import { isCreditExhausted } from "../_shared/anthropicErrors.ts";
import {
  contentWithNumberedImages,
  type ImageBlock,
  imageNumberingNote,
  loadQuestionImageBlocks,
} from "../_shared/questionImages.ts";

const RequestSchema = z.object({
  question_prompt: z.string().min(1).max(10_000),
  grading_instructions: z.string().max(2_000),
  question_id: z.string().uuid().optional(),
  // Set when asking for one part's answer on a multi-part question; then
  // `question_prompt` is the shared scenario. The editor sends its current
  // (possibly unsaved) text, so these come from the request, not the DB.
  part_number: z.number().int().min(1).optional(),
  part_prompt: z.string().min(1).max(10_000).optional(),
  previous_part_prompts: z.array(z.string().max(10_000)).max(50).optional(),
  // The answer has no image yet, so the AI may draw one (as SVG) when the
  // question asks the student for a diagram. Absent from older clients.
  allow_diagram: z.boolean().default(false),
});

// Claude doesn't produce images; it writes SVG (a vector drawing in text),
// which the editor turns into an ordinary image. Structured outputs keep the
// reply parseable: the SVG is a JSON string, escaping handled by the API.
const DIAGRAM_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    svg: { type: "string" },
  },
  required: ["answer", "svg"],
  additionalProperties: false,
};

const DIAGRAM_INSTRUCTIONS =
  `החזר אובייקט JSON עם שני שדות:\n` +
  `- "answer": התשובה הנכונה בטקסט, תמציתית וברורה, ללא הסבר.\n` +
  `- "svg": אם השאלה מבקשת מהתלמיד לשרטט, לסרטט או לצייר משהו (גרף, דיאגרמת כוחות, מעגל ` +
  `חשמלי, סקיצה גאומטרית וכדומה) — שרטוט התשובה הנכונה כקוד SVG שלם; אחרת מחרוזת ריקה.\n` +
  `כללים ל-SVG: אלמנט <svg> יחיד עם xmlns ו-viewBox (עד 800×600), רקע לבן (rect מלא), ` +
  `קווים שחורים ברורים, תוויות בגופן sans-serif בשפת השאלה, חיצים באמצעות marker. ` +
  `ללא תמונות חיצוניות, ללא סקריפטים וללא קישורים. שרטוט סכמטי ונקי — לא אמנותי.`;

// Generous: an SVG can run to a few thousand tokens.
const DIAGRAM_MAX_TOKENS = 8192;
const TEXT_MAX_TOKENS = 512;

function cleanSvg(svg: string): string | null {
  const s = svg.trim();
  if (!s.startsWith("<svg") || !s.endsWith("</svg>") || s.length > 200_000) return null;
  return s;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const input = RequestSchema.parse(body);

    // Resolve caller from the JWT they sent.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );

    if (authErr || !user) return err(401, "Unauthorized");

    // Retrieve the teacher's decrypted API key from Vault.
    const { data: keyRows, error: kErr } = await supabase
      .rpc("get_teacher_api_key_decrypted", { _teacher_id: user.id });

    if (kErr || !keyRows?.length) {
      return expectedFailure("No AI provider key configured. Add your key in Settings.");
    }

    const { provider, api_key } = keyRows[0] as {
      provider: string;
      api_key: string;
    };

    if (provider !== "anthropic") {
      return err(400, `Provider "${provider}" is not yet supported for the authoring assistant.`);
    }

    // Attach the question's own images, if any (numbered, see
    // _shared/questionImages.ts).
    let imageBlocks: ImageBlock[] = [];
    if (input.question_id) {
      const { data: question } = await supabase
        .from("questions")
        .select("id, quizzes!inner(creator_id)")
        .eq("id", input.question_id)
        .single();
      const owned = (question as unknown as { quizzes: { creator_id: string } } | null)
        ?.quizzes.creator_id === user.id;
      if (!owned) return err(403, "You do not own this question");

      imageBlocks = await loadQuestionImageBlocks(supabase, input.question_id);
    }

    const partNumber = input.part_number ?? 1;
    const prompt = (input.part_prompt
      ? [
        `שאלה (תרחיש פתיחה משותף לכל הסעיפים):\n${input.question_prompt}`,
        imageNumberingNote(imageBlocks.length),
        (input.previous_part_prompts ?? []).length > 0
          ? `סעיפים קודמים (להקשר בלבד):\n\n` +
            (input.previous_part_prompts ?? []).map((p, i) => `סעיף ${i + 1}:\n${p}`).join("\n\n")
          : "",
        `סעיף ${partNumber}:\n${input.part_prompt}`,
        input.grading_instructions
          ? `הנחיות ציון:\n${input.grading_instructions}`
          : "",
        input.allow_diagram
          ? `כתוב את התשובה הנכונה לסעיף ${partNumber} בלבד.\n\n${DIAGRAM_INSTRUCTIONS}`
          : `כתוב את התשובה הנכונה לסעיף ${partNumber} בלבד. היה תמציתי וברור. החזר את התשובה בלבד, ללא הסבר.`,
      ]
      : [
        `שאלה:\n${input.question_prompt}`,
        imageNumberingNote(imageBlocks.length),
        input.grading_instructions
          ? `הנחיות ציון:\n${input.grading_instructions}`
          : "",
        input.allow_diagram
          ? `כתוב את התשובה הנכונה לשאלה זו.\n\n${DIAGRAM_INSTRUCTIONS}`
          : "כתוב את התשובה הנכונה לשאלה זו. היה תמציתי וברור. החזר את התשובה בלבד, ללא הסבר.",
      ])
      .filter(Boolean)
      .join("\n\n");

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: input.allow_diagram ? DIAGRAM_MAX_TOKENS : TEXT_MAX_TOKENS,
        messages: [{
          role: "user",
          content: contentWithNumberedImages(imageBlocks, prompt),
        }],
        ...(input.allow_diagram
          ? { output_config: { format: { type: "json_schema", schema: DIAGRAM_SCHEMA } } }
          : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (isCreditExhausted(res.status, text)) {
        console.error("ask-ai: Anthropic credit exhausted:", text);
        // Same flag grade-answer sets, so the control board banner agrees.
        await supabase
          .from("teacher_ai_keys")
          .update({ credit_exhausted_at: new Date().toISOString() })
          .eq("teacher_id", user.id);
        return expectedFailure("AI provider credit exhausted");
      }
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    // The call went through, so any earlier out-of-credit flag is stale.
    await supabase
      .from("teacher_ai_keys")
      .update({ credit_exhausted_at: null })
      .eq("teacher_id", user.id)
      .not("credit_exhausted_at", "is", null);

    const text = data.content.find((c) => c.type === "text")?.text?.trim() ?? "";
    let correctAnswer = text;
    let diagramSvg: string | null = null;
    if (input.allow_diagram) {
      try {
        const parsed = JSON.parse(text) as { answer?: unknown; svg?: unknown };
        correctAnswer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
        diagramSvg = typeof parsed.svg === "string" ? cleanSvg(parsed.svg) : null;
      } catch {
        // Not JSON after all — treat the whole reply as the text answer.
        console.error("ask-ai: diagram reply was not valid JSON:", text.slice(0, 500));
      }
    }

    return new Response(JSON.stringify({ correctAnswer, diagramSvg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Unexpected error");
  }
});

// Teacher-setup outcomes (no key, out of credit) go back as 200 with
// `{ error }`, as in grade-answer, so the browser doesn't log a failed request.
function expectedFailure(message: string): Response {
  return err(200, message);
}

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
