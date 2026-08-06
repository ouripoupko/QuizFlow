import { z } from "npm:zod@3";

/**
 * The AI's grading output (spec §7.2). Validated with Zod before the app
 * trusts or persists it (spec §8.4).
 *
 * The AI ONLY reports its verdict. The application — not the AI — decides
 * what "unsure" means per flow mode (spec §7.3).
 */
export const AiGradingResultSchema = z.object({
  decision: z.enum(["pass", "fail", "unsure"]),
  studentFeedback: z.string(),
});

export type AiGradingResult = z.infer<typeof AiGradingResultSchema>;
