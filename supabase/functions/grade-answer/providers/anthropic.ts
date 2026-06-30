import type { AiGradingResult } from "../../_shared/aiTypes.ts";
import { AiGradingResultSchema } from "../../_shared/aiTypes.ts";
import type { GradingInput, ProviderAdapter } from "./types.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

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

  lines.push(`
החזר אובייקט JSON בדיוק בצורה הבאה, ללא טקסט נוסף:
{
  "decision": "pass" | "fail" | "unsure",
  "studentFeedback": "<משוב קצר לתלמיד, יכול להיות ריק>",
  "teacherReport": "<דיווח על שגיאות למורה, יכול להיות ריק>"
}
השתמש ב-"unsure" רק אם אינך בטוח.`);

  return lines.join("\n\n");
}

export const anthropicAdapter: ProviderAdapter = {
  async grade(input: GradingInput, apiKey: string): Promise<AiGradingResult> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content.find((c) => c.type === "text")?.text ?? "";

    // Strip any markdown code fences the model may add.
    const json = text.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();

    // Zod validates the shape before we trust it (spec §8.4).
    return AiGradingResultSchema.parse(JSON.parse(json));
  },
};
