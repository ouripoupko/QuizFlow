import type { AiGradingResult } from "../../_shared/aiTypes.ts";

/**
 * What every provider adapter receives from the grading Edge Function.
 * Spec §7.5: the AI gets the full answer sequence, not just the latest answer.
 */
export interface GradingInput {
  questionPrompt: string;
  gradingInstructions: string;
  /** null when the teacher left the correct-answer field empty (spec §5). */
  correctAnswer: string | null;
  /** All answers submitted for this question so far, in order, including the current one. */
  answerSequence: string[];
}

/**
 * The provider adapter interface (spec §8.4). Each AI provider is one
 * implementation of this interface; call sites never reference a concrete
 * provider, only this shape.
 */
export interface ProviderAdapter {
  grade(input: GradingInput, apiKey: string): Promise<AiGradingResult>;
}
