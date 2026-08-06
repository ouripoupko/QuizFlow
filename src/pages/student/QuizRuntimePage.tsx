import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { DirectionalTextarea } from "@/components/DirectionalTextarea";
import { useAuthStore } from "@/store/authStore";
import type {
  AiGradingResult,
  FlowMode,
  GradingDecision,
  Question,
  QuestionImage,
  Response as DbResponse,
  SessionParticipant,
} from "@/types/domain";
import styles from "./QuizRuntimePage.module.scss";

interface Attempt {
  attemptNumber: number;
  answerText: string;
  decision: GradingDecision | null;
  studentFeedback: string | null;
}

type AttemptsByQuestion = Record<string, Attempt[]>;
type ImagesByQuestion = Record<string, string[]>;

// Signed URLs (bucket is private — see supabase/migrations/..._storage.sql)
// fetched once per quiz load; batched into a single storage call rather than
// one per image.
async function loadImagesByQuestion(questionIds: string[]): Promise<ImagesByQuestion> {
  if (questionIds.length === 0) return {};

  const { data: rows } = await supabase
    .from("question_images")
    .select("question_id, storage_path, position")
    .in("question_id", questionIds)
    .order("position", { ascending: true });
  const images = (rows ?? []) as Pick<QuestionImage, "question_id" | "storage_path" | "position">[];
  if (images.length === 0) return {};

  const { data: signed } = await supabase.storage
    .from("question-images")
    .createSignedUrls(images.map((img) => img.storage_path), 3600);

  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const byQuestion: ImagesByQuestion = {};
  for (const img of images) {
    const url = img.storage_path ? byPath.get(img.storage_path) : undefined;
    if (!url) continue;
    (byQuestion[img.question_id] ??= []).push(url);
  }
  return byQuestion;
}

// Known grade-answer error reasons (raw English from the Edge Function, see
// supabase/functions/grade-answer/index.ts) mapped to a localized message.
// Anything unrecognized falls back to the generic error string.
const KNOWN_GRADE_ERRORS: Record<string, string> = {
  "Teacher has no AI provider key configured": t.studentRuntime.noTeacherKey,
};

// Edge Function failures surface here as a FunctionsHttpError with the JSON
// error body tucked away in `error.context` — supabase-js does not parse it
// into `data` for us, so we have to read the response ourselves.
async function resolveGradeErrorMessage(error: unknown, data: unknown): Promise<string> {
  let reason: string | undefined;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === "string") reason = body.error;
    } catch {
      // Non-JSON response body — fall through to the generic message.
    }
  } else {
    reason = (data as { error?: string } | null)?.error;
  }
  return (reason && KNOWN_GRADE_ERRORS[reason]) ?? t.common.error;
}

export function QuizRuntimePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  // Loaded from DB once
  const [loading, setLoading] = useState(true);
  const [quizTitle, setQuizTitle] = useState("");
  const [flowMode, setFlowMode] = useState<FlowMode>("infinite_attempts");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);

  // `currentPosition` is the server-tracked frontier: it advances the instant
  // a question is resolved (AI pass, any single_attempt result, or a teacher
  // action), exactly like before — so a student who leaves and comes back
  // resumes at the next question, and the control board sees progress live.
  //
  // `viewIndex` is purely local: the question actually on screen. It only
  // ever catches up to `currentPosition` when the student clicks forward —
  // that's the entire "don't advance automatically" behavior. A fresh load
  // starts the two equal (no artificial catch-up screen on resume).
  const [currentPosition, setCurrentPosition] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const [attemptsByQuestion, setAttemptsByQuestion] = useState<AttemptsByQuestion>({});
  const [imagesByQuestion, setImagesByQuestion] = useState<ImagesByQuestion>({});
  const [answerText, setAnswerText] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    void (async () => {
      const { data: session } = await supabase
        .from("quiz_sessions")
        .select("quiz_id, status")
        .eq("id", sessionId)
        .single();

      if (!session) {
        navigate("/my-quizzes", { replace: true });
        return;
      }

      if (session.status !== "active") {
        setSessionEnded(true);
        setTimeout(() => navigate("/my-quizzes", { replace: true }), 2500);
        return;
      }

      const { data: quiz } = await supabase
        .from("quizzes")
        .select("flow_mode, title")
        .eq("id", session.quiz_id)
        .single();

      if (!quiz) return;
      setQuizTitle(quiz.title);
      setFlowMode(quiz.flow_mode as FlowMode);

      const { data: qs } = await supabase
        .from("questions")
        .select("id, quiz_id, position, prompt, correct_answer, grading_instructions, created_at, updated_at")
        .eq("quiz_id", session.quiz_id)
        .order("position");
      const qList = (qs ?? []) as Question[];
      setQuestions(qList);
      void loadImagesByQuestion(qList.map((q) => q.id)).then(setImagesByQuestion);

      // Participant
      let pid: string | null = null;
      let pos = 0;

      const cached = localStorage.getItem(`qf_participant_${sessionId}`);
      if (cached) {
        const { data: p } = await supabase
          .from("session_participants")
          .select("id, current_position")
          .eq("id", cached)
          .single();
        if (p) { pid = p.id; pos = p.current_position; }
      }

      if (!pid) {
        const { data: p } = await supabase
          .from("session_participants")
          .select("id, current_position")
          .eq("session_id", sessionId)
          .eq("student_id", user.id)
          .maybeSingle();
        if (p) {
          pid = p.id;
          pos = p.current_position;
          localStorage.setItem(`qf_participant_${sessionId}`, p.id);
        }
      }

      if (!pid) {
        navigate("/my-quizzes", { replace: true });
        return;
      }

      setParticipantId(pid);
      setCurrentPosition(pos);
      setViewIndex(pos);

      // Full answer history, across all questions — lets the student browse
      // back over completed questions without extra round-trips.
      const { data: responses } = await supabase
        .from("responses")
        .select("question_id, attempt_number, answer_text, decision, student_feedback")
        .eq("participant_id", pid)
        .order("attempt_number", { ascending: true });

      const byQuestion: AttemptsByQuestion = {};
      for (const r of (responses ?? []) as Array<{
        question_id: string;
        attempt_number: number;
        answer_text: string;
        decision: GradingDecision | null;
        student_feedback: string | null;
      }>) {
        const list = byQuestion[r.question_id] ?? [];
        list.push({
          attemptNumber: r.attempt_number,
          answerText: r.answer_text,
          decision: r.decision,
          studentFeedback: r.student_feedback,
        });
        byQuestion[r.question_id] = list;
      }
      setAttemptsByQuestion(byQuestion);
      setLoading(false);
    })();
  }, [sessionId, user?.id]);

  // ── Realtime: teacher actions from outside this tab ─────────────────────────
  useEffect(() => {
    if (!participantId) return;

    const channel = supabase
      .channel(`participant-${participantId}`)
      // Position can move from a teacher's "push", or from resolve_response's
      // own auto-advance on pass — either way we just mirror the DB. This
      // never touches viewIndex: the student still clicks forward themselves.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "session_participants",
          filter: `id=eq.${participantId}`,
        },
        (payload) => {
          const updated = payload.new as SessionParticipant;
          setCurrentPosition(updated.current_position);
        },
      )
      // The teacher removed this student (control board "remove"), or the
      // whole quiz was deleted out from under an active session (cascades
      // down to this row too) — either way, this participation is gone.
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "session_participants",
          filter: `id=eq.${participantId}`,
        },
        () => {
          if (sessionId) localStorage.removeItem(`qf_participant_${sessionId}`);
          navigate("/my-quizzes", { replace: true });
        },
      )
      // The teacher ended the lesson — let the student know and send them
      // back, rather than leaving them stuck answering into the void. Not
      // cleared from localStorage: unlike a removed participant, this row
      // still exists and rejoining is meant to work if the session is
      // relaunched later.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "quiz_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const updated = payload.new as { status: string };
          if (updated.status !== "active") {
            setSessionEnded(true);
            setTimeout(() => navigate("/my-quizzes", { replace: true }), 2500);
          }
        },
      )
      // A teacher resolving an "unsure" response (pass or fail) updates it in
      // place — patch it into the matching attempt by question + attempt#.
      // Required for "fail": that resolution never touches session_participants,
      // so without this the student's "waiting" screen would never clear.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "responses",
          filter: `participant_id=eq.${participantId}`,
        },
        (payload) => {
          const resp = payload.new as DbResponse;
          setAttemptsByQuestion((prev) => {
            const list = prev[resp.question_id] ?? [];
            const idx = list.findIndex((a) => a.attemptNumber === resp.attempt_number);
            if (idx === -1) return prev;
            const nextList = [...list];
            nextList[idx] = {
              ...nextList[idx],
              decision: resp.decision,
              studentFeedback: resp.student_feedback,
            };
            return { ...prev, [resp.question_id]: nextList };
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [participantId]);

  // ── Submit answer (frontier question only) ──────────────────────────────────
  const submitAnswer = async () => {
    if (!participantId || !answerText.trim() || viewIndex !== currentPosition) return;
    const currentQ = questions[viewIndex];
    if (!currentQ) return;

    setGrading(true);
    setGradeError(null);

    const { data, error } = await supabase.functions.invoke("grade-answer", {
      body: {
        participant_id: participantId,
        question_id: currentQ.id,
        answer_text: answerText.trim(),
      },
    });

    if (error || !data || (data as { error?: string }).error) {
      setGradeError(await resolveGradeErrorMessage(error, data));
      setGrading(false);
      return;
    }

    const result = data as AiGradingResult;
    setAttemptsByQuestion((prev) => {
      const prior = prev[currentQ.id] ?? [];
      return {
        ...prev,
        [currentQ.id]: [
          ...prior,
          {
            attemptNumber: prior.length + 1,
            answerText: answerText.trim(),
            decision: result.decision,
            studentFeedback: result.studentFeedback,
          },
        ],
      };
    });
    setAnswerText("");

    // single_attempt always moves on; infinite_attempts only on a pass.
    // viewIndex deliberately stays put — the question now renders as "past"
    // (done), with forward enabled, until the student clicks it themselves.
    if (flowMode === "single_attempt" || result.decision === "pass") {
      const newPos = currentPosition + 1;
      const { error: advanceErr } = await supabase
        .from("session_participants")
        .update({ current_position: newPos })
        .eq("id", participantId);
      if (!advanceErr) setCurrentPosition(newPos);
    }

    setGrading(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (sessionEnded) {
    return (
      <div className={styles.page}>
        <div className={styles.done}>
          <p className={styles.doneTitle}>{t.studentRuntime.sessionEnded}</p>
          <p className={styles.doneQuiz}>{t.studentRuntime.sessionEndedRedirect}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>{t.common.loading}</p>
      </div>
    );
  }

  const atSummary = viewIndex >= questions.length;
  const isFrontier = viewIndex === currentPosition;
  const question = atSummary ? null : questions[viewIndex];
  const attempts = question ? (attemptsByQuestion[question.id] ?? []) : [];
  const latest = attempts[attempts.length - 1] ?? null;

  const phase: "past" | "answering" | "waitingTeacher" = !isFrontier
    ? "past"
    : grading || !latest
      ? "answering"
      : flowMode === "infinite_attempts" && latest.decision === "unsure"
        ? "waitingTeacher"
        : "answering";

  const canGoBack = viewIndex > 0;
  const canGoForward = !atSummary && viewIndex < currentPosition;

  const goBack = () => {
    if (viewIndex <= 0) return;
    setViewIndex((v) => v - 1);
    setAnswerText("");
    setGradeError(null);
  };

  const goForward = () => {
    if (!canGoForward) return;
    setViewIndex((v) => v + 1);
    setAnswerText("");
    setGradeError(null);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/my-quizzes" className="btn">{t.nav.home}</Link>
        <h1 className={styles.quizTitle}>{quizTitle}</h1>
        <div className={styles.navControls}>
          <button
            type="button"
            className={styles.navBtn}
            disabled={!canGoBack}
            aria-label={t.studentRuntime.previousQuestion}
            onClick={goBack}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
          <span className={styles.progress}>
            {t.studentRuntime.questionN} {Math.min(viewIndex, questions.length - 1) + 1}{" "}
            {t.studentRuntime.of} {questions.length}
          </span>
          <button
            type="button"
            className={styles.navBtn}
            disabled={!canGoForward}
            aria-label={t.studentRuntime.nextQuestion}
            onClick={goForward}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>
      </header>

      {atSummary ? (
        <div className={styles.done}>
          <p className={styles.doneTitle}>{t.studentRuntime.completed}</p>
          <p className={styles.doneQuiz}>{quizTitle}</p>
        </div>
      ) : (
        <>
          <div className={styles.questionBox}>
            <pre className={styles.prompt}>{question?.prompt}</pre>
            {question && (imagesByQuestion[question.id]?.length ?? 0) > 0 && (
              <div className={styles.questionImages}>
                {imagesByQuestion[question.id].map((url) => (
                  <img key={url} src={url} alt="" className={styles.questionImage} />
                ))}
              </div>
            )}
          </div>

          {phase === "past" && (
            <div className={styles.pastBox}>
              <span className={styles.pastBadge}>{t.studentQuizzes.statusCompleted}</span>
              {latest ? (
                <>
                  <p className={styles.answerLabel}>{t.studentRuntime.yourAnswerLabel}</p>
                  <pre className={styles.answerText}>{latest.answerText}</pre>
                  {latest.studentFeedback && (
                    <>
                      <p className={styles.answerLabel}>{t.studentRuntime.feedbackLabel}</p>
                      <p className={styles.pastFeedback}>{latest.studentFeedback}</p>
                    </>
                  )}
                </>
              ) : (
                <p className={styles.pastFeedback}>{t.studentRuntime.noAnswerSubmitted}</p>
              )}
            </div>
          )}

          {phase === "waitingTeacher" && (
            <div className={styles.waitingBox}>
              <span className={styles.waitingSpinner} />
              <p>{t.studentRuntime.waitingForTeacher}</p>
            </div>
          )}

          {phase === "answering" && latest?.decision === "fail" && (
            <div className={styles.feedbackBox}>
              <p className={styles.feedbackText}>{latest.studentFeedback}</p>
            </div>
          )}

          {phase === "answering" && (
            <div className={styles.answerSection}>
              {latest?.decision === "fail" && (
                <p className={styles.retryHint}>{t.studentRuntime.tryAgain}</p>
              )}
              <DirectionalTextarea
                className={styles.answerInput}
                placeholder={t.studentRuntime.answerPlaceholder}
                value={answerText}
                rows={6}
                disabled={grading}
                onChange={setAnswerText}
              />
              {gradeError && <p className={styles.gradeError}>{gradeError}</p>}
              <button
                type="button"
                className="btn btn--primary"
                disabled={grading || !answerText.trim()}
                onClick={() => void submitAnswer()}
              >
                {grading ? t.studentRuntime.submitting : t.studentRuntime.submitAnswer}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
