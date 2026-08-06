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
  /**
   * "infinite_attempts" quizzes require the student to keep retrying until they
   * pass, so the adapter must never leak the correct answer via studentFeedback
   * for these — general feedback only, never the answer itself.
   */
  flowMode: "infinite_attempts" | "single_attempt";
}

/**
 * The teacher's saved AI configuration (spec §8.1) plus their effort
 * preference. `thinkingFamily` is capability info about `model` itself —
 * which thinking system it uses, if any — captured live from the Models API
 * at selection time (see list-ai-models), not guessed from the model name.
 * Thinking is not independently toggleable: it's sent "on" (in whichever
 * form the family supports) whenever the model supports it at all, and
 * omitted otherwise — never explicitly disabled, which sidesteps Claude
 * Fable 5 / Mythos 5 rejecting `{type: "disabled"}` outright (a restriction
 * the Models API has no way to expose, so there'd be no way to know which
 * specific models to avoid it for).
 *   - "adaptive": Sonnet 5, Opus 5, Fable 5, Opus 4.6+, Sonnet 4.6 → `{type: "adaptive"}`.
 *   - "legacy": Haiku 4.5, Sonnet 4.5, Opus 4.5/4.1 → `{type: "enabled", budget_tokens}`.
 *   - "none": no thinking support detected — `thinking` is omitted.
 */
export interface GradingSettings {
  apiKey: string;
  model: string;
  thinkingFamily: "none" | "adaptive" | "legacy";
  /** One of low/medium/high/xhigh/max, or null to not send `output_config.effort`. */
  effort: string | null;
}

/**
 * The AI's verdict plus the exact request body sent to the provider for this
 * call — captured for the admin-only raw-data view on the control board.
 * Never includes the API key, which travels in a request header, not the body.
 */
export interface GradingOutcome {
  result: AiGradingResult;
  rawRequest: unknown;
}

/**
 * The provider adapter interface (spec §8.4). Each AI provider is one
 * implementation of this interface; call sites never reference a concrete
 * provider, only this shape.
 */
export interface ProviderAdapter {
  grade(input: GradingInput, settings: GradingSettings): Promise<GradingOutcome>;
}
