import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useIsAdmin } from "@/auth/useIsAdmin";
import { useAuthStore } from "@/store/authStore";
import { estimateCost, modelPrice, PRICES_DATE, sumUsage, type TokenUsage } from "@/lib/aiPricing";
import { exportClass } from "@/features/control-board/exportClass";
import type {
  FlowMode,
  Question,
  QuestionPart,
  Response as DbResponse,
  SessionParticipant,
} from "@/types/domain";
import {
  ParticipantCard,
  type ParticipantDisplay,
} from "@/features/control-board/ParticipantCard";
import styles from "./ControlBoardPage.module.scss";

type PartsByQuestion = Record<string, QuestionPart[]>;
type ImagesByQuestion = Record<string, string[]>;

// Signed URLs for the questions' own images (private bucket), in display
// order, in one storage call — shown next to the answers so the teacher sees
// what the students were looking at.
async function loadImagesByQuestion(questionIds: string[]): Promise<ImagesByQuestion> {
  if (questionIds.length === 0) return {};
  const { data: rows } = await supabase
    .from("question_images")
    .select("question_id, storage_path")
    .in("question_id", questionIds)
    .order("position", { ascending: true });
  const images = (rows ?? []) as { question_id: string; storage_path: string }[];
  if (images.length === 0) return {};
  const { data: signed } = await supabase.storage
    .from("question-images")
    .createSignedUrls(images.map((img) => img.storage_path), 3600);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const byQuestion: ImagesByQuestion = {};
  for (const img of images) {
    const url = byPath.get(img.storage_path);
    if (url) (byQuestion[img.question_id] ??= []).push(url);
  }
  return byQuestion;
}

/**
 * The (question, part) a participant is currently on — part is null on a
 * question without parts. A response belongs to the current step only if it
 * matches both.
 */
function currentStep(
  participant: SessionParticipant,
  questions: Question[],
  partsByQuestion: PartsByQuestion,
): { questionId: string | null; partId: string | null } {
  const q = questions[participant.current_position];
  if (!q) return { questionId: null, partId: null };
  const parts = partsByQuestion[q.id] ?? [];
  return {
    questionId: q.id,
    partId: parts.length > 0 ? (parts[participant.current_part]?.id ?? null) : null,
  };
}

function isCurrentStep(
  resp: DbResponse,
  step: { questionId: string | null; partId: string | null },
): boolean {
  return resp.question_id === step.questionId && (resp.part_id ?? null) === step.partId;
}

function deriveStatus(
  participant: SessionParticipant,
  latestResponse: DbResponse | null,
  questionsLen: number,
  flowMode: FlowMode,
): ParticipantDisplay["status"] {
  if (participant.current_position >= questionsLen) return "done";
  if (
    flowMode === "infinite_attempts" &&
    latestResponse?.decision === "unsure"
  ) {
    return "waiting";
  }
  return "answering";
}

export function ControlBoardPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { isAdmin } = useIsAdmin();
  const userId = useAuthStore((s) => s.user?.id);

  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  // Tells parallel lessons of the same quiz apart (e.g. the class name).
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [flowMode, setFlowMode] = useState<FlowMode>("infinite_attempts");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [partsByQuestion, setPartsByQuestion] = useState<PartsByQuestion>({});
  const [imagesByQuestion, setImagesByQuestion] = useState<ImagesByQuestion>({});
  const [displays, setDisplays] = useState<ParticipantDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  // Rows start collapsed (one line per student, whole class on screen).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  // Set by grade-answer when the teacher's AI provider account runs out of
  // credit, cleared on the next successful grading call.
  const [creditExhausted, setCreditExhausted] = useState(false);
  // The model selected in the teacher's settings — prices the cost estimate.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Refs for use inside realtime callbacks (avoid stale closures)
  const questionsRef = useRef<Question[]>([]);
  const partsRef = useRef<PartsByQuestion>({});
  const flowModeRef = useRef<FlowMode>("infinite_attempts");
  const displaysRef = useRef<ParticipantDisplay[]>([]);

  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { flowModeRef.current = flowMode; }, [flowMode]);
  useEffect(() => { displaysRef.current = displays; }, [displays]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    void (async () => {
      // Session
      const { data: session } = await supabase
        .from("quiz_sessions")
        .select("quiz_id, status, name")
        .eq("id", sessionId)
        .single();

      if (!session) { setLoading(false); return; }
      setQuizId(session.quiz_id);
      setSessionName(session.name ?? null);

      // Quiz
      const { data: quiz } = await supabase
        .from("quizzes")
        .select("title, flow_mode")
        .eq("id", session.quiz_id)
        .single();

      if (quiz) {
        setQuizTitle(quiz.title);
        setFlowMode(quiz.flow_mode as FlowMode);
        flowModeRef.current = quiz.flow_mode as FlowMode;
      }

      // Questions
      const { data: qs } = await supabase
        .from("questions")
        .select("id, quiz_id, position, prompt, correct_answer, grading_instructions, created_at, updated_at")
        .eq("quiz_id", session.quiz_id)
        .order("position");

      const qList = (qs ?? []) as Question[];
      setQuestions(qList);
      void loadImagesByQuestion(qList.map((q) => q.id)).then(setImagesByQuestion);
      questionsRef.current = qList;

      // Parts of multi-part questions
      const { data: partRows } = qList.length > 0
        ? await supabase
          .from("question_parts")
          .select("*")
          .in("question_id", qList.map((q) => q.id))
          .order("position")
        : { data: [] };
      const pByQ: PartsByQuestion = {};
      for (const part of (partRows ?? []) as QuestionPart[]) {
        (pByQ[part.question_id] ??= []).push(part);
      }
      setPartsByQuestion(pByQ);
      partsRef.current = pByQ;

      // Participants
      const { data: parts } = await supabase
        .from("session_participants")
        .select("*")
        .eq("session_id", sessionId)
        .order("joined_at");

      const partList = (parts ?? []) as SessionParticipant[];
      if (partList.length === 0) { setLoading(false); return; }

      // Latest responses for each participant's current question
      const ids = partList.map((p) => p.id);
      const { data: responses } = await supabase
        .from("responses")
        .select("*")
        .in("participant_id", ids)
        .order("attempt_number", { ascending: false });

      const respList = (responses ?? []) as DbResponse[];

      const built = partList.map((p) => {
        const step = currentStep(p, qList, pByQ);
        const ownResponses = respList.filter((r) => r.participant_id === p.id);
        const latestResponse =
          ownResponses.find((r) => isCurrentStep(r, step)) ?? null;
        return {
          participant: p,
          latestResponse,
          answers: ownResponses,
          status: deriveStatus(
            p,
            latestResponse,
            qList.length,
            quiz?.flow_mode as FlowMode ?? "infinite_attempts",
          ),
        } satisfies ParticipantDisplay;
      });

      setDisplays(built);
      displaysRef.current = built;
      setLoading(false);
    })();
  }, [sessionId]);

  // ── AI credit status (own key row; RLS limits it to this teacher) ────────
  useEffect(() => {
    if (!userId) return;

    void supabase
      .from("teacher_ai_keys")
      .select("credit_exhausted_at, model")
      .eq("teacher_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        setCreditExhausted(!!data?.credit_exhausted_at);
        setSelectedModel(data?.model ?? null);
      });

    const channel = supabase
      .channel(`ai-credit-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teacher_ai_keys",
          filter: `teacher_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { credit_exhausted_at?: string | null; model?: string };
          setCreditExhausted(!!row?.credit_exhausted_at);
          if (row?.model) setSelectedModel(row.model);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    const updateDisplay = (
      participantId: string,
      patch: Partial<ParticipantDisplay>,
    ) => {
      setDisplays((prev) => {
        const next = prev.map((d) =>
          d.participant.id === participantId ? { ...d, ...patch } : d,
        );
        displaysRef.current = next;
        return next;
      });
    };

    const channel = supabase
      .channel(`board-${sessionId}`)
      // Participant position changes
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const qList = questionsRef.current;
          const fm = flowModeRef.current;

          if (payload.eventType === "INSERT") {
            const p = payload.new as SessionParticipant;
            const entry: ParticipantDisplay = {
              participant: p,
              latestResponse: null,
              answers: [],
              status: deriveStatus(p, null, qList.length, fm),
            };
            setDisplays((prev) => {
              const next = [...prev, entry];
              displaysRef.current = next;
              return next;
            });
            return;
          }

          if (payload.eventType === "UPDATE") {
            const p = payload.new as SessionParticipant;
            const existing = displaysRef.current.find(
              (d) => d.participant.id === p.id,
            );
            // Position (or part) changed → clear stale response
            const posChanged =
              existing?.participant.current_position !== p.current_position
              || existing?.participant.current_part !== p.current_part;
            const latestResponse = posChanged
              ? null
              : (existing?.latestResponse ?? null);
            updateDisplay(p.id, {
              participant: p,
              latestResponse,
              status: deriveStatus(p, latestResponse, qList.length, fm),
            });
            return;
          }

          if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id: string }).id;
            setDisplays((prev) => {
              const next = prev.filter((d) => d.participant.id !== removedId);
              displaysRef.current = next;
              return next;
            });
          }
        },
      )
      // Response inserts/updates (new submissions + teacher resolutions)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "responses",
        },
        (payload) => {
          const resp = payload.new as DbResponse;
          const qList = questionsRef.current;
          const fm = flowModeRef.current;
          const display = displaysRef.current.find(
            (d) => d.participant.id === resp.participant_id,
          );
          if (!display) return;

          const answers = [...display.answers, resp];

          // A response can arrive after the student's already been pushed past
          // this question/part (race with the async AI round-trip) — still
          // record it, just don't treat it as the current answer box.
          const step = currentStep(display.participant, qList, partsRef.current);
          if (!isCurrentStep(resp, step)) {
            updateDisplay(resp.participant_id, { answers });
            return;
          }

          updateDisplay(resp.participant_id, {
            latestResponse: resp,
            answers,
            status: deriveStatus(display.participant, resp, qList.length, fm),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "responses",
        },
        (payload) => {
          const resp = payload.new as DbResponse;
          const qList = questionsRef.current;
          const fm = flowModeRef.current;
          const display = displaysRef.current.find(
            (d) => d.participant.id === resp.participant_id,
          );
          if (!display) return;

          // Teacher-resolved "unsure" responses land here — replace the stale
          // copy already in `answers` from the initial load/insert.
          const answers = display.answers.map((a) => (a.id === resp.id ? resp : a));

          const step = currentStep(display.participant, qList, partsRef.current);
          if (!isCurrentStep(resp, step)) {
            updateDisplay(resp.participant_id, { answers });
            return;
          }
          updateDisplay(resp.participant_id, {
            latestResponse: resp,
            answers,
            status: deriveStatus(display.participant, resp, qList.length, fm),
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [sessionId]);

  // ── Sort: waiting first, then answering, then done ────────────────────────
  const sorted = [...displays].sort((a, b) => {
    const order = { waiting: 0, answering: 1, done: 2 };
    return order[a.status] - order[b.status];
  });

  const handleExport = async () => {
    setExporting(true);
    setExportFailed(false);
    try {
      await exportClass(quizTitle, displays, questions, partsByQuestion);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Lesson totals: every graded answer in this session that recorded token
  // usage (answers graded before that was recorded aren't counted).
  const usage = sumUsage(
    displays.flatMap((d) =>
      d.answers.map((a) => (a.ai_response_meta?.usage ?? null) as TokenUsage | null)
    ),
  );
  const totalTokens = usage.inputTokens + usage.outputTokens
    + usage.cacheWriteTokens + usage.cacheReadTokens;
  const price = modelPrice(selectedModel);
  const cost = price ? estimateCost(usage, price) : null;
  const formattedCost = cost === null
    ? t.controlBoard.costUnknownModel
    : cost > 0 && cost < 0.01
      ? "< $0.01"
      : `$${cost.toFixed(2)}`;
  const usageDetails = [
    `${t.controlBoard.usageTooltip} ${usage.gradings}`,
    `${t.controlBoard.usageInput} ${usage.inputTokens.toLocaleString()}`,
    `${t.controlBoard.usageOutput} ${usage.outputTokens.toLocaleString()}`,
    selectedModel ?? "",
  ].filter(Boolean).join(" · ");

  const waitingCount = displays.filter((d) => d.status === "waiting").length;
  const doneCount = displays.filter((d) => d.status === "done").length;

  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <Link
          to={`/teacher/quizzes/${quizId ?? ""}`}
          className="btn"
        >
          {t.controlBoard.backToEditor}
        </Link>
        <h1 className={styles.title}>
          {quizTitle}
          {sessionName && <span className={styles.sessionName}> · {sessionName}</span>}
        </h1>
        <LanguageSwitcher />
        <div className={styles.stats}>
          {waitingCount > 0 && (
            <span className={styles.statWaiting}>
              {waitingCount} {t.controlBoard.statusWaiting}
            </span>
          )}
          <span className={styles.statDone}>
            {doneCount} / {displays.length} {t.controlBoard.statusDone}
          </span>
          <span className={styles.statUsage} title={usageDetails}>
            {totalTokens.toLocaleString()} {t.controlBoard.tokens}
            {" · "}{t.controlBoard.estimatedCost} {formattedCost}
            {cost !== null && (
              <span className={styles.priceListDate}>
                {" "}({t.controlBoard.priceListDate} {PRICES_DATE})
              </span>
            )}
          </span>
        </div>
      </div>

      {creditExhausted && (
        <p className={styles.creditAlert} role="alert">
          {t.controlBoard.aiCreditExhausted}
        </p>
      )}

      {loading && <p className={styles.hint}>{t.common.loading}</p>}

      {!loading && displays.length === 0 && (
        <p className={styles.hint}>{t.controlBoard.noParticipants}</p>
      )}

      {displays.length > 0 && (
        <div className={styles.listToolbar}>
          {exportFailed && <span className={styles.exportError}>{t.controlBoard.exportFailed}</span>}
          <button
            type="button"
            className="btn"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? t.controlBoard.exporting : t.controlBoard.exportClass}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setExpandedIds(new Set(displays.map((d) => d.participant.id)))}
          >
            {t.controlBoard.expandAll}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setExpandedIds(new Set())}
          >
            {t.controlBoard.collapseAll}
          </button>
        </div>
      )}

      {displays.length > 0 && (
        <div className={styles.listHeader} aria-hidden="true">
          <span />
          <span>{t.controlBoard.columnStudent}</span>
          <span>{t.controlBoard.columnProgress}</span>
          <span>{t.controlBoard.statusColumnHeader}</span>
        </div>
      )}

      <div className={styles.grid}>
        {sorted.map((d) => (
          <ParticipantCard
            key={d.participant.id}
            display={d}
            questions={questions}
            partsByQuestion={partsByQuestion}
            imagesByQuestion={imagesByQuestion}
            isAdmin={isAdmin}
            expanded={expandedIds.has(d.participant.id)}
            onToggle={() => toggleExpanded(d.participant.id)}
          />
        ))}
      </div>
    </main>
  );
}
