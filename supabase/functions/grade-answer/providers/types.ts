import type { AiGradingResult } from "../../_shared/aiTypes.ts";
import type { ImageBlock } from "../../_shared/questionImages.ts";

/** An earlier part of the same question, already answered — context only. */
export interface PreviousPart {
  number: number;
  prompt: string;
  /**
   * The student's final answer to it (with a note if it had an image), or
   * null if they never answered (e.g. pushed past).
   */
  finalAnswer: string | null;
}

/** Set when grading one part of a multi-part question. */
export interface GradingPart {
  /** 1-based, as shown to the student ("סעיף 2"). */
  number: number;
  prompt: string;
  previousParts: PreviousPart[];
}

/**
 * What every provider adapter receives from the grading Edge Function.
 * Spec §7.5: the AI gets the full answer sequence, not just the latest answer.
 */
export interface GradingInput {
  /** The question's prompt — on a multi-part question, the shared scenario. */
  questionPrompt: string;
  gradingInstructions: string;
  /**
   * null when the teacher left the correct-answer field empty (spec §5). On a
   * multi-part question, the correct answer of the part being graded.
   */
  correctAnswer: string | null;
  /**
   * All answers submitted for this question (or this part) so far, in order,
   * including the current one.
   */
  answerSequence: string[];
  /** The question's images, in display order (numbered from 1 in the prompt). */
  images: ImageBlock[];
  /**
   * The image the student attached to the current answer, graded together
   * with its text — null when there is none (or images aren't allowed).
   */
  studentImage: ImageBlock | null;
  /**
   * The teacher's correct-answer image (of the question, or of the part
   * being graded) — compared against like the answer text; null if none.
   */
  answerKeyImage: ImageBlock | null;
  /** null for a question without parts. */
  part: GradingPart | null;
  /**
   * The student's app language: studentFeedback (and the teacher-facing
   * reasoning) are written in it. "he" when the client didn't say.
   */
  language: "he" | "en" | "ar";
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
  /** Exactly what is returned to the student's browser. */
  result: AiGradingResult;
  /**
   * The AI's explanation for the teacher (may state the correct answer) —
   * stored on the response, never sent to the student. null if missing.
   */
  reasoning: string | null;
  rawRequest: unknown;
  /** The provider's reply metadata (model, stop reason, token usage) — admin-only. */
  responseMeta: unknown;
}

/**
 * The provider adapter interface (spec §8.4). Each AI provider is one
 * implementation of this interface; call sites never reference a concrete
 * provider, only this shape.
 */
export interface ProviderAdapter {
  grade(input: GradingInput, settings: GradingSettings): Promise<GradingOutcome>;
}

/**
 * Thrown by an adapter when the provider rejects the call because the
 * teacher's account has run out of credit. Distinct from other provider
 * errors so grade-answer can tell the student to notify the teacher and
 * flag it on the teacher's control board, instead of a generic failure.
 */
export class ProviderCreditExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCreditExhaustedError";
  }
}
