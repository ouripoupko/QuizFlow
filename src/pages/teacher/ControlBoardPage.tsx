import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type {
  FlowMode,
  Question,
  Response as DbResponse,
  SessionParticipant,
} from "@/types/domain";
import {
  ParticipantCard,
  type ParticipantDisplay,
} from "@/features/control-board/ParticipantCard";
import styles from "./ControlBoardPage.module.scss";

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

  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  const [flowMode, setFlowMode] = useState<FlowMode>("infinite_attempts");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [displays, setDisplays] = useState<ParticipantDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  // Refs for use inside realtime callbacks (avoid stale closures)
  const questionsRef = useRef<Question[]>([]);
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
        .select("quiz_id, status")
        .eq("id", sessionId)
        .single();

      if (!session) { setLoading(false); return; }
      setQuizId(session.quiz_id);

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
      questionsRef.current = qList;

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
        const currentQId = qList[p.current_position]?.id ?? null;
        const latestResponse =
          respList.find(
            (r) => r.participant_id === p.id && r.question_id === currentQId,
          ) ?? null;
        return {
          participant: p,
          latestResponse,
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
            // Position changed → clear stale response
            const posChanged =
              existing?.participant.current_position !== p.current_position;
            const latestResponse = posChanged
              ? null
              : (existing?.latestResponse ?? null);
            updateDisplay(p.id, {
              participant: p,
              latestResponse,
              status: deriveStatus(p, latestResponse, qList.length, fm),
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
          const currentQId =
            qList[display.participant.current_position]?.id ?? null;
          if (resp.question_id !== currentQId) return;
          const newStatus = deriveStatus(
            display.participant,
            resp,
            qList.length,
            fm,
          );
          updateDisplay(resp.participant_id, {
            latestResponse: resp,
            status: newStatus,
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
          const currentQId =
            qList[display.participant.current_position]?.id ?? null;
          if (resp.question_id !== currentQId) return;
          updateDisplay(resp.participant_id, {
            latestResponse: resp,
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
        <h1 className={styles.title}>{quizTitle}</h1>
        <div className={styles.stats}>
          {waitingCount > 0 && (
            <span className={styles.statWaiting}>
              {waitingCount} {t.controlBoard.statusWaiting}
            </span>
          )}
          <span className={styles.statDone}>
            {doneCount} / {displays.length} {t.controlBoard.statusDone}
          </span>
        </div>
      </div>

      {loading && <p className={styles.hint}>{t.common.loading}</p>}

      {!loading && displays.length === 0 && (
        <p className={styles.hint}>{t.controlBoard.noParticipants}</p>
      )}

      <div className={styles.grid}>
        {sorted.map((d) => (
          <ParticipantCard
            key={d.participant.id}
            display={d}
            questions={questions}
          />
        ))}
      </div>
    </main>
  );
}
