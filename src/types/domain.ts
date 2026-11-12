/**
 * Domain types mirroring the database schema (supabase/migrations).
 *
 * Hand-written for now; once the Supabase project exists these can be replaced
 * or augmented by `supabase gen types typescript`. Kept in sync with the
 * migrations by hand until then.
 */

export type AppRole = "student" | "teacher" | "admin";
export type QuizStatus = "draft" | "published";
export type FlowMode = "infinite_attempts" | "single_attempt";
export type TopicStatus = "approved" | "pending";
export type GradingDecision = "pass" | "fail" | "unsure";
export type SessionStatus = "active" | "ended";
export type GradingSource = "ai" | "teacher";

/** Fixed id of the permanent "Unsorted" (גלובלית) node (spec §4.1). */
export const UNSORTED_TOPIC_ID = "00000000-0000-0000-0000-000000000001";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  user_id: string;
  role: AppRole;
  granted_at: string;
}

export interface TopicNode {
  id: string;
  parent_id: string | null;
  name: string;
  status: TopicStatus;
  proposed_by: string | null;
  is_system: boolean;
  created_at: string;
}

export interface Quiz {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  status: QuizStatus;
  flow_mode: FlowMode;
  topic_node_id: string | null;
  cloned_from_quiz_id: string | null;
  created_at: string;
  updated_at: string;
  /** Bumped only on substantive content edits (title/description/flow_mode,
   * questions, images) — not status or topic moves. See supabase/migrations/
   * 20260804150000_quiz_content_staleness.sql. */
  content_updated_at: string;
}

export interface Question {
  id: string;
  quiz_id: string;
  position: number;
  prompt: string;
  /** Optional — null means the AI determines correctness itself (spec §5). */
  correct_answer: string | null;
  grading_instructions: string;
  /** The teacher lets students attach one image to their answer (ignored once the question has parts). */
  allow_answer_image: boolean;
  /** The correct answer's image (answer-key-images bucket); null if none. Ignored once the question has parts. */
  correct_answer_image_path: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One numbered part ("סעיף") of a multi-part question. The question's own
 * prompt and images are the shared scenario; a question with no parts is an
 * ordinary single question. See supabase/migrations/20261102120000_question_parts.sql.
 */
export interface QuestionPart {
  id: string;
  question_id: string;
  position: number;
  prompt: string;
  /** Optional — null means the AI determines correctness itself. */
  correct_answer: string | null;
  /** The teacher lets students attach one image to their answer to this part. */
  allow_answer_image: boolean;
  /** This part's correct-answer image (answer-key-images bucket); null if none. */
  correct_answer_image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionImage {
  id: string;
  question_id: string;
  storage_path: string;
  position: number;
  created_at: string;
}

export interface GradingTemplate {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  created_at: string;
}

export interface Course {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface CourseQuiz {
  course_id: string;
  quiz_id: string;
  position: number;
  added_at: string;
}

export interface QuizSession {
  id: string;
  quiz_id: string;
  host_id: string;
  join_token: string;
  /** Optional teacher-set name (e.g. the class), to tell parallel lessons apart. */
  name: string | null;
  status: SessionStatus;
  created_at: string;
  ended_at: string | null;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  student_id: string | null;
  display_name: string;
  current_position: number;
  /** Index into the current question's parts; always 0 on a question without parts. */
  current_part: number;
  status: string;
  joined_at: string;
}

export interface Response {
  id: string;
  participant_id: string;
  question_id: string;
  /** Set on answers to a part of a multi-part question; null otherwise. */
  part_id: string | null;
  attempt_number: number;
  answer_text: string;
  /** Path in the answer-images bucket when the student attached an image; null otherwise. */
  answer_image_path: string | null;
  submitted_at: string;
  /** AiGradingResult fields (spec §7.2); null until graded. */
  decision: GradingDecision | null;
  student_feedback: string | null;
  /** Exact request body sent to the AI provider for this grading call — admin-only, never contains the API key. */
  ai_request: Record<string, unknown> | null;
  /** The AI's reply metadata for that call (model, stop_reason, token usage) — admin-only. Null before it was recorded. */
  ai_response_meta: Record<string, unknown> | null;
  /** The AI's explanation of its verdict, for the teacher. Null before it was recorded. */
  ai_reasoning: string | null;
  graded_by: GradingSource | null;
  graded_at: string | null;
}

export interface AiGradingResult {
  decision: GradingDecision;
  studentFeedback: string;
}

export interface TeacherAction {
  id: string;
  session_id: string;
  participant_id: string | null;
  question_id: string | null;
  teacher_id: string;
  action: "push" | "resolve";
  created_at: string;
}
