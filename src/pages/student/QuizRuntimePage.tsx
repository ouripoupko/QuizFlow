import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { activeLocale, t } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { DirectionalTextarea } from "@/components/DirectionalTextarea";
import { AnswerImageThumb } from "@/components/AnswerImageThumb";
import { AnswerImageAttach } from "@/features/student/AnswerImageAttach";
import { useAuthStore } from "@/store/authStore";
import type {
  AiGradingResult,
  FlowMode,
  GradingDecision,
  Question,
  QuestionImage,
  QuestionPart,
  Response as DbResponse,
  SessionParticipant,
} from "@/types/domain";
import styles from "./QuizRuntimePage.module.scss";

interface Attempt {
  attemptNumber: number;
  answerText: string;
  /** Path in the answer-images bucket, when the student attached an image. */
  imagePath: string | null;
  decision: GradingDecision | null;
  studentFeedback: string | null;
}

// Keyed by "step": a part's id on a multi-part question, the question's id
// on a question without parts (part ids and question ids never collide).
type AttemptsByStep = Record<string, Attempt[]>;
type ImagesByQuestion = Record<string, string[]>;
type PartsByQuestion = Record<string, QuestionPart[]>;

function stepKey(questionId: string, partId: string | null | undefined): string {
  return partId ?? questionId;
}

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

async function loadPartsByQuestion(questionIds: string[]): Promise<PartsByQuestion> {
  if (questionIds.length === 0) return {};
  const { data } = await supabase
    .from("question_parts")
    .select("*")
    .in("question_id", questionIds)
    .order("position", { ascending: true });
  const byQuestion: PartsByQuestion = {};
  for (const part of (data ?? []) as QuestionPart[]) {
    (byQuestion[part.question_id] ??= []).push(part);
  }
  return byQuestion;
}

// Known grade-answer error reasons (raw English from the Edge Function, see
// supabase/functions/grade-answer/index.ts) mapped to a localized message.
// Anything unrecognized falls back to the generic error string.
const KNOWN_GRADE_ERRORS: Record<string, string> = {
  "Teacher has no AI provider key configured": t.studentRuntime.noTeacherKey,
  "AI provider credit exhausted": t.studentRuntime.aiCreditExhausted,
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
  const [partsByQuestion, setPartsByQuestion] = useState<PartsByQuestion>({});
  const [participantId, setParticipantId] = useState<string | null>(null);

  // `currentPosition` is the server-tracked frontier: it advances the instant
  // a question is resolved (AI pass, any single_attempt result, or a teacher
  // action), exactly like before — so a student who leaves and comes back
  // resumes at the next question, and the control board sees progress live.
  // `currentPart` is the same frontier within a multi-part question (always 0
  // on a question without parts); parts accumulate on screen as it advances.
  //
  // `viewIndex` is purely local: the question actually on screen. It only
  // ever catches up to `currentPosition` when the student clicks forward —
  // that's the entire "don't advance automatically" behavior. A fresh load
  // starts the two equal (no artificial catch-up screen on resume).
  const [currentPosition, setCurrentPosition] = useState(0);
  const [currentPart, setCurrentPart] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const [attemptsByStep, setAttemptsByStep] = useState<AttemptsByStep>({});
  const [imagesByQuestion, setImagesByQuestion] = useState<ImagesByQuestion>({});
  const [answerText, setAnswerText] = useState("");
  // At most one image per answer, on steps whose teacher allowed it.
  const [answerImagePath, setAnswerImagePath] = useState<string | null>(null);
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
        .select("id, quiz_id, position, prompt, correct_answer, grading_instructions, allow_answer_image, created_at, updated_at")
        .eq("quiz_id", session.quiz_id)
        .order("position");
      const qList = (qs ?? []) as Question[];
      setQuestions(qList);
      void loadImagesByQuestion(qList.map((q) => q.id)).then(setImagesByQuestion);
      // Awaited (unlike images): which step is on screen depends on it.
      setPartsByQuestion(await loadPartsByQuestion(qList.map((q) => q.id)));

      // Participant
      let pid: string | null = null;
      let pos = 0;
      let part = 0;

      const cached = localStorage.getItem(`qf_participant_${sessionId}`);
      if (cached) {
        const { data: p } = await supabase
          .from("session_participants")
          .select("id, current_position, current_part")
          .eq("id", cached)
          .single();
        if (p) { pid = p.id; pos = p.current_position; part = p.current_part; }
      }

      if (!pid) {
        const { data: p } = await supabase
          .from("session_participants")
          .select("id, current_position, current_part")
          .eq("session_id", sessionId)
          .eq("student_id", user.id)
          .maybeSingle();
        if (p) {
          pid = p.id;
          pos = p.current_position;
          part = p.current_part;
          localStorage.setItem(`qf_participant_${sessionId}`, p.id);
        }
      }

      if (!pid) {
        navigate("/my-quizzes", { replace: true });
        return;
      }

      setParticipantId(pid);
      setCurrentPosition(pos);
      setCurrentPart(part);
      setViewIndex(pos);

      // Full answer history, across all questions — lets the student browse
      // back over completed questions without extra round-trips.
      const { data: responses } = await supabase
        .from("responses")
        .select("question_id, part_id, attempt_number, answer_text, answer_image_path, decision, student_feedback")
        .eq("participant_id", pid)
        .order("attempt_number", { ascending: true });

      const byStep: AttemptsByStep = {};
      for (const r of (responses ?? []) as Array<{
        question_id: string;
        part_id: string | null;
        attempt_number: number;
        answer_text: string;
        answer_image_path: string | null;
        decision: GradingDecision | null;
        student_feedback: string | null;
      }>) {
        const key = stepKey(r.question_id, r.part_id);
        const list = byStep[key] ?? [];
        list.push({
          attemptNumber: r.attempt_number,
          answerText: r.answer_text,
          imagePath: r.answer_image_path,
          decision: r.decision,
          studentFeedback: r.student_feedback,
        });
        byStep[key] = list;
      }
      setAttemptsByStep(byStep);
      setLoading(false);
    })();
  }, [sessionId, user?.id]);

  // ── Realtime: teacher actions from outside this tab ─────────────────────────
  useEffect(() => {
    if (!participantId) return;

    const channel = supabase
      .channel(`participant-${participantId}`)
      // Position/part can move from a teacher's "push", or from
      // resolve_response's own auto-advance on pass — either way we just
      // mirror the DB. This never touches viewIndex: the student still clicks
      // forward themselves.
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
          setCurrentPart(updated.current_part ?? 0);
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
      // place — patch it into the matching attempt by step + attempt#.
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
          const key = stepKey(resp.question_id, resp.part_id);
          setAttemptsByStep((prev) => {
            const list = prev[key] ?? [];
            const idx = list.findIndex((a) => a.attemptNumber === resp.attempt_number);
            if (idx === -1) return prev;
            const nextList = [...list];
            nextList[idx] = {
              ...nextList[idx],
              decision: resp.decision,
              studentFeedback: resp.student_feedback,
            };
            return { ...prev, [key]: nextList };
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [participantId]);

  // ── The frontier step (what an answer submitted now would be for) ──────────
  // A multi-part question's frontier is its part at `currentPart`; a question
  // without parts is its own single step.
  const frontierQuestion = questions[currentPosition];
  const frontierParts = frontierQuestion ? (partsByQuestion[frontierQuestion.id] ?? []) : [];
  const frontierPart = frontierParts.length > 0 ? (frontierParts[currentPart] ?? null) : null;
  const frontierKey = frontierQuestion ? stepKey(frontierQuestion.id, frontierPart?.id) : null;
  const frontierAttempts = frontierKey ? attemptsByStep[frontierKey] : undefined;
  const frontierLatest = frontierAttempts?.[frontierAttempts.length - 1] ?? null;

  // ── Submit answer (frontier step only) ─────────────────────────────────────
  const submitAnswer = async () => {
    if (!participantId || (!answerText.trim() && !answerImagePath) || viewIndex !== currentPosition) return;
    const currentQ = frontierQuestion;
    if (!currentQ || !frontierKey) return;
    // A multi-part question whose frontier part is missing has nothing to answer.
    if (frontierParts.length > 0 && !frontierPart) return;
    const key = frontierKey;
    const part = frontierPart;
    const allowsImage = part ? part.allow_answer_image : currentQ.allow_answer_image;
    const imagePath = allowsImage ? answerImagePath : null;

    setGrading(true);
    setGradeError(null);

    const { data, error } = await supabase.functions.invoke("grade-answer", {
      body: {
        participant_id: participantId,
        question_id: currentQ.id,
        answer_text: answerText.trim(),
        // The AI writes the feedback in the language the student is using.
        language: activeLocale,
        ...(part ? { part_id: part.id } : {}),
        ...(imagePath ? { answer_image_path: imagePath } : {}),
      },
    });

    if (error || !data || (data as { error?: string }).error) {
      setGradeError(await resolveGradeErrorMessage(error, data));
      setGrading(false);
      return;
    }

    const result = data as AiGradingResult;
    setAttemptsByStep((prev) => {
      const prior = prev[key] ?? [];
      return {
        ...prev,
        [key]: [
          ...prior,
          {
            attemptNumber: prior.length + 1,
            answerText: answerText.trim(),
            imagePath,
            decision: result.decision,
            studentFeedback: result.studentFeedback,
          },
        ],
      };
    });
    setAnswerText("");
    setAnswerImagePath(null);

    // single_attempt always moves on; infinite_attempts only on a pass. The
    // server decides where to: the next part, or the next question. On the
    // last part (or a question without parts) viewIndex deliberately stays
    // put — the question now renders as "past" (done), with forward enabled,
    // until the student clicks it themselves. On an earlier part the next
    // part simply appears below the answered ones.
    if (flowMode === "single_attempt" || result.decision === "pass") {
      const { data: next, error: advanceErr } = await supabase.rpc("advance_participant", {
        _participant_id: participantId,
        _question_id: currentQ.id,
        _part_id: part?.id ?? null,
      });
      const row = (next as { current_position: number; current_part: number }[] | null)?.[0];
      if (!advanceErr && row) {
        setCurrentPosition(row.current_position);
        setCurrentPart(row.current_part);
      }
    }

    setGrading(false);
  };

  // ── Prefill a retry with the failed answer ──────────────────────────────────
  // After a "fail" (from the AI, or a teacher resolving "unsure"), the student
  // usually needs a small fix, not a rewrite — so start the box from their
  // last answer. Done once per failed attempt (tracked by key) so it never
  // clobbers what they're typing; navigating away resets it.
  const prefilledAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      flowMode !== "infinite_attempts" ||
      grading ||
      viewIndex !== currentPosition ||
      !frontierKey ||
      frontierLatest?.decision !== "fail"
    ) {
      return;
    }
    const key = `${frontierKey}:${frontierLatest.attemptNumber}`;
    if (prefilledAttemptRef.current === key) return;
    prefilledAttemptRef.current = key;
    setAnswerText(frontierLatest.answerText);
    // The image carries over too; the student can remove or replace it.
    setAnswerImagePath(frontierLatest.imagePath);
  }, [flowMode, grading, viewIndex, currentPosition, frontierKey, frontierLatest]);

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
  const parts = question ? (partsByQuestion[question.id] ?? []) : [];
  const isMultiPart = parts.length > 0;
  // Parts already done on screen: all of them on a past question, the ones
  // before the frontier part on the current one. Later parts stay hidden.
  const completedParts = isFrontier ? parts.slice(0, currentPart) : parts;
  const activePart = isMultiPart && isFrontier ? (parts[currentPart] ?? null) : null;
  // The step whose answer box/feedback is shown: the frontier part, or the
  // question itself when it has no parts.
  const activeKey = question
    ? (isMultiPart ? (activePart ? activePart.id : null) : question.id)
    : null;
  const attempts = activeKey ? (attemptsByStep[activeKey] ?? []) : [];
  const activeAllowsImage = activePart
    ? activePart.allow_answer_image
    : !isMultiPart && !!question?.allow_answer_image;
  const latest = attempts[attempts.length - 1] ?? null;

  const phase: "past" | "answering" | "waitingTeacher" = !isFrontier || !activeKey
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
    setAnswerImagePath(null);
    prefilledAttemptRef.current = null;
    setGradeError(null);
  };

  const goForward = () => {
    if (!canGoForward) return;
    setViewIndex((v) => v + 1);
    setAnswerText("");
    setAnswerImagePath(null);
    prefilledAttemptRef.current = null;
    setGradeError(null);
  };

  const latestFor = (key: string): Attempt | null => {
    const list = attemptsByStep[key] ?? [];
    return list[list.length - 1] ?? null;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/my-quizzes" className="btn">{t.nav.home}</Link>
        <LanguageSwitcher />
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
            {activePart && (
              <>
                {" · "}{t.studentRuntime.partN} {currentPart + 1} {t.studentRuntime.of} {parts.length}
              </>
            )}
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
                {imagesByQuestion[question.id].map((url, idx) => (
                  <figure key={url} className={styles.questionFigure}>
                    <img src={url} alt="" className={styles.questionImage} />
                    <figcaption className={styles.imageCaption}>
                      {t.studentRuntime.imageN} {idx + 1}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>

          {/* Answered parts accumulate here, each with its answer and feedback. */}
          {completedParts.map((part) => {
            const done = latestFor(part.id);
            return (
              <div key={part.id} className={styles.pastBox}>
                <p className={styles.partLabel}>{t.studentRuntime.partN} {part.position + 1}</p>
                <pre className={styles.partPrompt}>{part.prompt}</pre>
                {done ? (
                  <>
                    <p className={styles.answerLabel}>{t.studentRuntime.yourAnswerLabel}</p>
                    {done.answerText && <pre className={styles.answerText}>{done.answerText}</pre>}
                    {done.imagePath && (
                      <AnswerImageThumb path={done.imagePath} alt={t.studentRuntime.answerImageAlt} />
                    )}
                    {done.studentFeedback && (
                      <>
                        <p className={styles.answerLabel}>{t.studentRuntime.feedbackLabel}</p>
                        <p className={styles.pastFeedback}>{done.studentFeedback}</p>
                      </>
                    )}
                  </>
                ) : (
                  <p className={styles.pastFeedback}>{t.studentRuntime.noAnswerSubmitted}</p>
                )}
              </div>
            );
          })}

          {activePart && (
            <div className={styles.questionBox}>
              <p className={styles.partLabel}>{t.studentRuntime.partN} {currentPart + 1}</p>
              <pre className={styles.prompt}>{activePart.prompt}</pre>
            </div>
          )}

          {phase === "past" && !isMultiPart && (
            <div className={styles.pastBox}>
              <span className={styles.pastBadge}>{t.studentQuizzes.statusCompleted}</span>
              {latest ? (
                <>
                  <p className={styles.answerLabel}>{t.studentRuntime.yourAnswerLabel}</p>
                  {latest.answerText && <pre className={styles.answerText}>{latest.answerText}</pre>}
                  {latest.imagePath && (
                    <AnswerImageThumb path={latest.imagePath} alt={t.studentRuntime.answerImageAlt} />
                  )}
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

          {phase === "past" && isMultiPart && (
            <span className={styles.pastBadge}>{t.studentQuizzes.statusCompleted}</span>
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
              {activeAllowsImage && participantId && (
                <AnswerImageAttach
                  participantId={participantId}
                  value={answerImagePath}
                  onChange={setAnswerImagePath}
                  disabled={grading}
                />
              )}
              {gradeError && <p className={styles.gradeError}>{gradeError}</p>}
              <button
                type="button"
                className="btn btn--primary"
                disabled={grading || (!answerText.trim() && !(activeAllowsImage && answerImagePath))}
                onClick={() => void submitAnswer()}
              >
                {grading ? t.studentRuntime.submitting : t.studentRuntime.submitAnswer}
              </button>
            </div>
          )}

          {/* Same condition as the header's forward arrow — the question is
              done (answered in single_attempt, passed or teacher-advanced in
              infinite_attempts) — but where the student's eyes already are. */}
          {canGoForward && (
            <button
              type="button"
              className={`btn btn--primary ${styles.nextQuestionBtn}`}
              onClick={goForward}
            >
              {viewIndex + 1 >= questions.length
                ? t.studentRuntime.finishButton
                : t.studentRuntime.nextQuestionButton}
            </button>
          )}
        </>
      )}
    </div>
  );
}
