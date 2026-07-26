import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { AiGradingResult, FlowMode, Question, SessionParticipant } from "@/types/domain";
import styles from "./QuizRuntimePage.module.scss";

type PageState = "loading" | "answering" | "grading" | "fail" | "waiting" | "done";

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
  const [quizTitle, setQuizTitle] = useState("");
  const [flowMode, setFlowMode] = useState<FlowMode>("infinite_attempts");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);

  // Runtime state
  const [currentPosition, setCurrentPosition] = useState(0);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [answerText, setAnswerText] = useState("");
  const [lastResult, setLastResult] = useState<AiGradingResult | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);

  // Refs to avoid stale closure in async handlers
  const questionsRef = useRef<Question[]>([]);
  const positionRef = useRef(0);
  const flowModeRef = useRef<FlowMode>("infinite_attempts");
  const participantIdRef = useRef<string | null>(null);

  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { positionRef.current = currentPosition; }, [currentPosition]);
  useEffect(() => { flowModeRef.current = flowMode; }, [flowMode]);
  useEffect(() => { participantIdRef.current = participantId; }, [participantId]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    void (async () => {
      // Session
      const { data: session } = await supabase
        .from("quiz_sessions")
        .select("quiz_id, status")
        .eq("id", sessionId)
        .single();

      if (!session || session.status !== "active") {
        navigate("/", { replace: true });
        return;
      }

      // Quiz
      const { data: quiz } = await supabase
        .from("quizzes")
        .select("flow_mode, title")
        .eq("id", session.quiz_id)
        .single();

      if (!quiz) return;
      setQuizTitle(quiz.title);
      setFlowMode(quiz.flow_mode as FlowMode);
      flowModeRef.current = quiz.flow_mode as FlowMode;

      // Questions
      const { data: qs } = await supabase
        .from("questions")
        .select("id, quiz_id, position, prompt, correct_answer, grading_instructions, created_at, updated_at")
        .eq("quiz_id", session.quiz_id)
        .order("position");

      const qList = (qs ?? []) as Question[];
      setQuestions(qList);
      questionsRef.current = qList;

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
        navigate("/", { replace: true });
        return;
      }

      setParticipantId(pid);
      participantIdRef.current = pid;
      setCurrentPosition(pos);
      positionRef.current = pos;

      await initQuestionState(pid, pos, qList, quiz.flow_mode as FlowMode);
    })();
  }, [sessionId, user?.id]);

  // ── Determine state for a given question (used on load + after position change) ─
  const initQuestionState = async (
    pid: string,
    pos: number,
    qList: Question[],
    mode: FlowMode,
  ) => {
    if (pos >= qList.length) {
      setPageState("done");
      return;
    }

    const q = qList[pos];
    const { data: lastResp } = await supabase
      .from("responses")
      .select("decision, student_feedback, teacher_report")
      .eq("participant_id", pid)
      .eq("question_id", q.id)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastResp) {
      setAnswerText("");
      setLastResult(null);
      setPageState("answering");
      return;
    }

    // Recovery after refresh
    if (mode === "single_attempt" || lastResp.decision === "pass") {
      const newPos = pos + 1;
      await supabase
        .from("session_participants")
        .update({ current_position: newPos })
        .eq("id", pid);
      setCurrentPosition(newPos);
      positionRef.current = newPos;
      setAnswerText("");
      setLastResult(null);
      setPageState(newPos >= qList.length ? "done" : "answering");
    } else if (lastResp.decision === "fail") {
      setLastResult({
        decision: "fail",
        studentFeedback: lastResp.student_feedback ?? "",
        teacherReport: lastResp.teacher_report ?? "",
      });
      setAnswerText("");
      setPageState("fail");
    } else {
      setPageState("waiting");
    }
  };

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!participantId) return;

    const channel = supabase
      .channel(`participant-${participantId}`)
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
          const newPos = updated.current_position;
          setCurrentPosition(newPos);
          positionRef.current = newPos;
          setAnswerText("");
          setLastResult(null);
          setGradeError(null);
          void initQuestionState(
            participantIdRef.current!,
            newPos,
            questionsRef.current,
            flowModeRef.current,
          );
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [participantId]);

  // ── Advance to next question ──────────────────────────────────────────────
  const advance = async () => {
    const pid = participantIdRef.current;
    const pos = positionRef.current;
    const qList = questionsRef.current;
    if (!pid) return;

    const newPos = pos + 1;
    await supabase
      .from("session_participants")
      .update({ current_position: newPos })
      .eq("id", pid);

    setCurrentPosition(newPos);
    positionRef.current = newPos;
    setAnswerText("");
    setLastResult(null);
    setGradeError(null);
    setPageState(newPos >= qList.length ? "done" : "answering");
  };

  // ── Submit answer ─────────────────────────────────────────────────────────
  const submitAnswer = async () => {
    const pid = participantIdRef.current;
    const pos = positionRef.current;
    const qList = questionsRef.current;
    const mode = flowModeRef.current;

    if (!pid || !answerText.trim() || qList.length === 0) return;

    setPageState("grading");
    setGradeError(null);

    const currentQ = qList[pos];
    const { data, error } = await supabase.functions.invoke("grade-answer", {
      body: {
        participant_id: pid,
        question_id: currentQ.id,
        answer_text: answerText.trim(),
      },
    });

    if (error || !data || (data as { error?: string }).error) {
      setGradeError(await resolveGradeErrorMessage(error, data));
      setPageState("answering");
      return;
    }

    const result = data as AiGradingResult;
    setLastResult(result);

    if (mode === "single_attempt") {
      await advance();
    } else {
      if (result.decision === "pass") {
        await advance();
      } else if (result.decision === "fail") {
        setPageState("fail");
      } else {
        setPageState("waiting");
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>{t.common.loading}</p>
      </div>
    );
  }

  if (pageState === "done") {
    return (
      <div className={styles.page}>
        <div className={styles.done}>
          <p className={styles.doneTitle}>{t.studentRuntime.completed}</p>
          <p className={styles.doneQuiz}>{quizTitle}</p>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentPosition];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.quizTitle}>{quizTitle}</h1>
        <span className={styles.progress}>
          {t.studentRuntime.questionN} {currentPosition + 1} {t.studentRuntime.of}{" "}
          {questions.length}
        </span>
      </header>

      <div className={styles.questionBox}>
        <pre className={styles.prompt}>{currentQ?.prompt}</pre>
      </div>

      {pageState === "waiting" && (
        <div className={styles.waitingBox}>
          <span className={styles.waitingSpinner} />
          <p>{t.studentRuntime.waitingForTeacher}</p>
        </div>
      )}

      {pageState === "fail" && lastResult && (
        <div className={styles.feedbackBox}>
          <p className={styles.feedbackText}>{lastResult.studentFeedback}</p>
        </div>
      )}

      {(pageState === "answering" ||
        pageState === "fail" ||
        pageState === "grading") && (
        <div className={styles.answerSection}>
          {pageState === "fail" && (
            <p className={styles.retryHint}>{t.studentRuntime.tryAgain}</p>
          )}
          <textarea
            className={styles.answerInput}
            placeholder={t.studentRuntime.answerPlaceholder}
            value={answerText}
            rows={6}
            disabled={pageState === "grading"}
            onChange={(e) => setAnswerText(e.target.value)}
          />
          {gradeError && <p className={styles.gradeError}>{gradeError}</p>}
          <button
            type="button"
            className="btn btn--primary"
            disabled={pageState === "grading" || !answerText.trim()}
            onClick={() => void submitAnswer()}
          >
            {pageState === "grading"
              ? t.studentRuntime.submitting
              : t.studentRuntime.submitAnswer}
          </button>
        </div>
      )}
    </div>
  );
}
