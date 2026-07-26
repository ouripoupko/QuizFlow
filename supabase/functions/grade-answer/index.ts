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
 *  4. Fetch question + full prior-answer sequence (spec §7.5).
 *  5. Call the provider adapter; Zod-validate the result (spec §7.2, §8.4).
 *  6. Persist the response row and rate-limit record.
 *  7. Return the AiGradingResult to the client.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";
import { AiGradingResultSchema } from "../_shared/aiTypes.ts";
import { getProviderAdapter } from "./providers/index.ts";

const RequestSchema = z.object({
  participant_id: z.string().uuid(),
  question_id: z.string().uuid(),
  answer_text: z.string().min(1).max(10_000),
});

// Max grading calls per participant per 60 s (spec §8.2).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 1. Parse & validate ───────────────────────────────────────────────────
    const body = await req.json();
    const input = RequestSchema.parse(body);

    // ── 2. Service-role client (bypasses RLS; key never leaves the server) ───
    const supabase = createClient(
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

    if (pErr || !participant) {
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
      return err(400, "Teacher has no AI provider key configured");
    }

    const { provider, api_key } = keyRows[0] as {
      provider: string;
      api_key: string;
    };

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

    // ── 5. Fetch question + full answer sequence ──────────────────────────────
    const { data: question, error: qErr } = await supabase
      .from("questions")
      .select("prompt, correct_answer, grading_instructions")
      .eq("id", input.question_id)
      .single();

    if (qErr || !question) {
      return err(404, "Question not found");
    }

    const { data: priorResponses } = await supabase
      .from("responses")
      .select("answer_text")
      .eq("participant_id", input.participant_id)
      .eq("question_id", input.question_id)
      .order("attempt_number", { ascending: true });

    const answerSequence = [
      ...(priorResponses ?? []).map((r: { answer_text: string }) => r.answer_text),
      input.answer_text,
    ];

    // ── 6. Call the provider adapter; Zod-validate the result ────────────────
    const adapter = getProviderAdapter(provider);
    const raw = await adapter.grade(
      {
        questionPrompt: question.prompt,
        gradingInstructions: question.grading_instructions,
        correctAnswer: question.correct_answer ?? null,
        answerSequence,
        flowMode: quiz.flow_mode as "infinite_attempts" | "single_attempt",
      },
      api_key,
    );

    const result = AiGradingResultSchema.parse(raw);

    // ── 7. Persist: rate-limit record + response row ─────────────────────────
    await supabase.from("grading_rate_calls").insert({
      participant_id: input.participant_id,
    });

    await supabase.from("responses").insert({
      participant_id: input.participant_id,
      question_id: input.question_id,
      attempt_number: (priorResponses?.length ?? 0) + 1,
      answer_text: input.answer_text,
      decision: result.decision,
      student_feedback: result.studentFeedback,
      teacher_report: result.teacherReport,
      graded_by: "ai",
      graded_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return err(500, message);
  }
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
