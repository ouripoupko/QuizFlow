/**
 * grade-answer — Edge Function for grading a student answer (spec §7, §8).
 *
 * Called by the student's browser after they submit an answer. The browser
 * NEVER calls the AI provider directly — this function holds the decryption
 * path to the teacher's API key (spec §8.2).
 *
 * Flow:
 *  1. Validate the request.
 *  2. Resolve the session → teacher → API key from Vault.
 *  3. Rate-limit per participant (spec §8.2).
 *  4. Fetch question (and part, with earlier parts' answers as context),
 *     the full prior-answer sequence (spec §7.5) and the question's images.
 *  5. Call the provider adapter; Zod-validate the result (spec §7.2, §8.4).
 *  6. Persist the response row and rate-limit record.
 *  7. Return the AiGradingResult to the client.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";
import { AiGradingResultSchema } from "../_shared/aiTypes.ts";
import {
  type ImageBlock,
  loadQuestionImageBlocks,
  loadStorageImageBlock,
} from "../_shared/questionImages.ts";
import { getProviderAdapter } from "./providers/index.ts";
import { type GradingPart, ProviderCreditExhaustedError } from "./providers/types.ts";

const RequestSchema = z.object({
  participant_id: z.string().uuid(),
  question_id: z.string().uuid(),
  // May be empty when an image is attached (text, an image, or both).
  answer_text: z.string().max(10_000).default(""),
  // Set when answering one part of a multi-part question; absent otherwise
  // (and from clients that predate parts).
  part_id: z.string().uuid().optional(),
  // Path in the answer-images bucket ({participant_id}/...), on questions or
  // parts whose teacher allowed an image.
  answer_image_path: z.string().min(1).max(500).optional(),
  // The student's app language (from the ?lang= link); the AI writes its
  // feedback in it. Absent from older clients — Hebrew, as before.
  language: z.enum(["he", "en", "ar"]).default("he"),
}).refine((r) => r.answer_text.trim().length > 0 || !!r.answer_image_path, {
  message: "An answer needs text or an image",
});

// How an answer appears in the prompt's answer history.
function describeAnswer(text: string, imagePath: string | null): string {
  const body = text.trim() || "(ללא טקסט)";
  return imagePath ? `${body} [צורפה תמונה]` : body;
}

// Max grading calls per participant per 60 s (spec §8.2).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Tracked outside the try block so the catch handler can still report what
  // was attempted (via response headers) even if the failure happened after
  // we resolved it — e.g. Anthropic itself rejecting the request.
  let model: string | undefined;
  let thinkingFamily: "none" | "adaptive" | "legacy" | undefined;
  let effort: string | null | undefined;
  // Untyped schema (no generated types), same as a plain createClient() call.
  let supabase: SupabaseClient | undefined;
  let teacherId: string | undefined;

  try {
    // ── 1. Parse & validate ───────────────────────────────────────────────────
    const body = await req.json();
    const input = RequestSchema.parse(body);

    // ── 2. Service-role client (bypasses RLS; key never leaves the server) ───
    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify the caller's JWT and that they own this participant row.
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return err(401, "Unauthorized");

    // Resolve participant → session → teacher
    const { data: participant, error: pErr } = await supabase
      .from("session_participants")
      .select("session_id, student_id")
      .eq("id", input.participant_id)
      .single();

    // The service role bypasses RLS, so ownership must be checked here.
    // Someone else's participant gets the same answer as a missing one, so
    // the response doesn't reveal which participant ids exist.
    if (pErr || !participant || participant.student_id !== user.id) {
      return err(404, "Participant not found");
    }

    const { data: session, error: sErr } = await supabase
      .from("quiz_sessions")
      .select("host_id, quiz_id")
      .eq("id", participant.session_id)
      .single();

    if (sErr || !session) {
      return err(404, "Session not found");
    }

    const { data: quiz, error: quizErr } = await supabase
      .from("quizzes")
      .select("flow_mode")
      .eq("id", session.quiz_id)
      .single();

    if (quizErr || !quiz) {
      return err(404, "Quiz not found");
    }

    // ── 3. Get the teacher's decrypted API key from Vault ────────────────────
    const { data: keyRows, error: kErr } = await supabase
      .rpc("get_teacher_api_key_decrypted", { _teacher_id: session.host_id });

    if (kErr || !keyRows?.length) {
      return expectedFailure("Teacher has no AI provider key configured");
    }

    const {
      provider,
      api_key,
      model: teacherModel,
      thinking_family,
      effort: teacherEffort,
    } = keyRows[0] as {
      provider: string;
      api_key: string;
      model: string;
      thinking_family: "none" | "adaptive" | "legacy";
      effort: string | null;
    };
    teacherId = session.host_id;
    model = teacherModel;
    thinkingFamily = thinking_family;
    effort = teacherEffort;

    // ── 4. Rate limiting ─────────────────────────────────────────────────────
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await supabase
      .from("grading_rate_calls")
      .select("*", { count: "exact", head: true })
      .eq("participant_id", input.participant_id)
      .gte("called_at", windowStart);

    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return err(429, "Rate limit exceeded — slow down");
    }

    // ── 5. Fetch question (+ part) + full answer sequence ────────────────────
    const { data: question, error: qErr } = await supabase
      .from("questions")
      .select("prompt, correct_answer, grading_instructions, allow_answer_image")
      .eq("id", input.question_id)
      .single();

    if (qErr || !question) {
      return err(404, "Question not found");
    }

    let part: GradingPart | null = null;
    let correctAnswer: string | null = question.correct_answer ?? null;
    let allowAnswerImage: boolean = question.allow_answer_image ?? false;

    if (input.part_id) {
      const { data: parts } = await supabase
        .from("question_parts")
        .select("id, position, prompt, correct_answer, allow_answer_image")
        .eq("question_id", input.question_id)
        .order("position", { ascending: true });
      const partList = (parts ?? []) as {
        id: string;
        position: number;
        prompt: string;
        correct_answer: string | null;
        allow_answer_image: boolean;
      }[];
      const current = partList.find((p) => p.id === input.part_id);
      if (!current) return err(404, "Part not found");

      // The student's final (latest) answer to each earlier part — context
      // for the AI, explicitly marked as already graded.
      const earlier = partList.filter((p) => p.position < current.position);
      const finalAnswerByPart = new Map<string, string>();
      if (earlier.length > 0) {
        const { data: earlierResponses } = await supabase
          .from("responses")
          .select("part_id, answer_text, answer_image_path, attempt_number")
          .eq("participant_id", input.participant_id)
          .in("part_id", earlier.map((p) => p.id))
          .order("attempt_number", { ascending: true });
        for (
          const r of (earlierResponses ?? []) as {
            part_id: string;
            answer_text: string;
            answer_image_path: string | null;
          }[]
        ) {
          finalAnswerByPart.set(r.part_id, describeAnswer(r.answer_text, r.answer_image_path));
        }
      }

      part = {
        number: current.position + 1,
        prompt: current.prompt,
        previousParts: earlier.map((p) => ({
          number: p.position + 1,
          prompt: p.prompt,
          finalAnswer: finalAnswerByPart.get(p.id) ?? null,
        })),
      };
      correctAnswer = current.correct_answer ?? null;
      allowAnswerImage = current.allow_answer_image ?? false;
    }

    // The attached image, if any: only where the teacher allowed one, and
    // only from this participant's own folder (the service role could read
    // anyone's, so the path must be checked here).
    let studentImage: ImageBlock | null = null;
    if (input.answer_image_path) {
      if (!allowAnswerImage) return err(400, "This question does not accept an image");
      if (!input.answer_image_path.startsWith(`${input.participant_id}/`)) {
        return err(403, "Image does not belong to this participant");
      }
      studentImage = await loadStorageImageBlock(supabase, "answer-images", input.answer_image_path);
      if (!studentImage) return err(404, "Answer image not found");
    }

    // Attempts are counted per part on a multi-part question; on a question
    // without parts, part_id is null for every response (including all the
    // ones from before parts existed), so this is the same query as before.
    let priorQuery = supabase
      .from("responses")
      .select("answer_text, answer_image_path")
      .eq("participant_id", input.participant_id)
      .eq("question_id", input.question_id);
    priorQuery = input.part_id
      ? priorQuery.eq("part_id", input.part_id)
      : priorQuery.is("part_id", null);
    const { data: priorResponses } = await priorQuery
      .order("attempt_number", { ascending: true });

    // Only the current attempt's image is sent; earlier ones are noted in
    // the history (sending every image again would multiply the cost).
    const answerSequence = [
      ...(priorResponses ?? []).map((r: { answer_text: string; answer_image_path: string | null }) =>
        describeAnswer(r.answer_text, r.answer_image_path)
      ),
      describeAnswer(input.answer_text, input.answer_image_path ?? null),
    ];

    const images = await loadQuestionImageBlocks(supabase, input.question_id);

    // ── 6. Call the provider adapter; Zod-validate the result ────────────────
    const adapter = getProviderAdapter(provider);
    const outcome = await adapter.grade(
      {
        questionPrompt: question.prompt,
        gradingInstructions: question.grading_instructions,
        correctAnswer,
        answerSequence,
        images,
        studentImage,
        part,
        language: input.language,
        flowMode: quiz.flow_mode as "infinite_attempts" | "single_attempt",
      },
      {
        apiKey: api_key,
        model,
        thinkingFamily: thinking_family,
        effort: teacherEffort,
      },
    );

    const result = AiGradingResultSchema.parse(outcome.result);

    // The call went through, so any earlier out-of-credit flag is stale
    // (the teacher topped up) — clear it off the control board. A no-op
    // unless the flag is actually set.
    await supabase
      .from("teacher_ai_keys")
      .update({ credit_exhausted_at: null })
      .eq("teacher_id", session.host_id)
      .not("credit_exhausted_at", "is", null);

    // ── 7. Persist: rate-limit record + response row ─────────────────────────
    await supabase.from("grading_rate_calls").insert({
      participant_id: input.participant_id,
    });

    await supabase.from("responses").insert({
      participant_id: input.participant_id,
      question_id: input.question_id,
      part_id: input.part_id ?? null,
      attempt_number: (priorResponses?.length ?? 0) + 1,
      answer_text: input.answer_text,
      answer_image_path: input.answer_image_path ?? null,
      decision: result.decision,
      student_feedback: result.studentFeedback,
      ai_request: outcome.rawRequest,
      ai_response_meta: outcome.responseMeta,
      ai_reasoning: outcome.reasoning,
      graded_by: "ai",
      graded_at: new Date().toISOString(),
    });

    // Exposed as response headers (not mixed into the JSON body, which stays
    // exactly AiGradingResult) so the actual AI config used is easy to
    // confirm from the browser's Network tab — see this request's Headers.
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...debugHeaders(model, thinkingFamily, effort),
      },
    });
  } catch (e) {
    if (e instanceof ProviderCreditExhaustedError) {
      console.error("grade-answer:", e.message);
      // Flag it for the teacher's control board; the student just gets a
      // "tell your teacher" message (mapped client-side from this reason).
      if (supabase && teacherId) {
        await supabase
          .from("teacher_ai_keys")
          .update({ credit_exhausted_at: new Date().toISOString() })
          .eq("teacher_id", teacherId);
      }
      return expectedFailure("AI provider credit exhausted", model, thinkingFamily, effort);
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    return err(500, message, model, thinkingFamily, effort);
  }
});

function debugHeaders(
  model?: string,
  thinkingFamily?: "none" | "adaptive" | "legacy",
  effort?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (model) headers["x-model-used"] = model;
  if (thinkingFamily) headers["x-thinking-used"] = thinkingFamily;
  if (effort) headers["x-effort-used"] = effort;
  return headers;
}

// For outcomes that are the teacher's setup, not a server fault (no key, out
// of credit): returned as 200 with `{ error }` so the browser doesn't log a
// failed request on every student submission. The client maps the reason to
// a "tell your teacher" message, same as it would for an error status.
function expectedFailure(
  message: string,
  model?: string,
  thinkingFamily?: "none" | "adaptive" | "legacy",
  effort?: string | null,
): Response {
  return err(200, message, model, thinkingFamily, effort);
}

function err(
  status: number,
  message: string,
  model?: string,
  thinkingFamily?: "none" | "adaptive" | "legacy",
  effort?: string | null,
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    ...debugHeaders(model, thinkingFamily, effort),
  };
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
