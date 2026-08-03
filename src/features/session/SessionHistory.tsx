import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { QuizSession } from "@/types/domain";
import styles from "./SessionHistory.module.scss";

interface Props {
  quizId: string;
  quizPublished: boolean;
  /** Quiz's `content_updated_at` — a session created before this is stale. */
  quizContentUpdatedAt: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

export function SessionHistory({ quizId, quizPublished, quizContentUpdatedAt }: Props) {
  const { data: sessions = [], isLoading } = useQuery<QuizSession[]>({
    queryKey: ["session-history", quizId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_sessions")
        .select("*")
        .eq("quiz_id", quizId)
        .eq("status", "ended")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as QuizSession[];
    },
  });

  if (isLoading) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>{t.session.historyTitle}</h3>
      {sessions.length === 0 ? (
        <p className={styles.empty}>{t.session.historyEmpty}</p>
      ) : (
        <>
          {!quizPublished && <p className={styles.hint}>{t.session.relaunchDisabledHint}</p>}
          <ul className={styles.list}>
            {sessions.map((s) => (
              <SessionHistoryRow
                key={s.id}
                session={s}
                quizId={quizId}
                quizPublished={quizPublished}
                stale={new Date(s.created_at) < new Date(quizContentUpdatedAt)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SessionHistoryRow({
  session,
  quizId,
  quizPublished,
  stale,
}: {
  session: QuizSession;
  quizId: string;
  quizPublished: boolean;
  stale: boolean;
}) {
  const qc = useQueryClient();

  const { data: count = 0 } = useQuery<number>({
    queryKey: ["session-count", session.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("session_participants")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session.id);
      return count ?? 0;
    },
  });

  // Relaunching reuses the same session row (same join link, same roster,
  // same progress) rather than starting fresh — resuming a lesson that was
  // ended by mistake, or picking a paused one back up. Blocked if another
  // session for this quiz is already active, since only one join link
  // should ever be "the" live one at a time.
  const relaunch = useMutation({
    mutationFn: async () => {
      const { data: active } = await supabase
        .from("quiz_sessions")
        .select("id")
        .eq("quiz_id", quizId)
        .eq("status", "active")
        .maybeSingle();
      if (active) throw new Error("already_active");

      const { error } = await supabase
        .from("quiz_sessions")
        .update({ status: "active", ended_at: null })
        .eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["active-session", quizId] });
      void qc.invalidateQueries({ queryKey: ["session-history", quizId] });
    },
  });

  // Cascades to session_participants → responses/teacher_actions (see
  // supabase/migrations/20260804140000_delete_session.sql), so this fully
  // wipes the record of who participated in this lesson.
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("quiz_sessions").delete().eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session-history", quizId] }),
  });

  const relaunchDisabled = relaunch.isPending || !quizPublished || stale;
  const relaunchHint = !quizPublished
    ? t.session.relaunchDisabledHint
    : stale
      ? t.session.relaunchDisabledStaleHint
      : undefined;

  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <span className={styles.dates}>
          {t.session.historyStarted} {formatDateTime(session.created_at)}
          {session.ended_at && (
            <> · {t.session.historyEnded} {formatDateTime(session.ended_at)}</>
          )}
        </span>
        <span className={styles.count}>{count} {t.session.historyParticipants}</span>
        {stale && <span className={styles.staleBadge}>{t.session.staleBadge}</span>}
      </div>
      <div className={styles.actions}>
        <Link to={`/session/${session.id}/board`} className="btn">
          {t.controlBoard.openBoard}
        </Link>
        <button
          type="button"
          className="btn"
          disabled={relaunchDisabled}
          title={relaunchHint}
          onClick={() => relaunch.mutate()}
        >
          {relaunch.isPending ? t.session.relaunching : t.session.relaunch}
        </button>
        <button
          type="button"
          className="btn"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(t.session.deleteSessionConfirm)) remove.mutate();
          }}
        >
          {remove.isPending ? t.session.deletingSession : t.session.deleteSession}
        </button>
      </div>
      {relaunch.isError && <p className={styles.error}>{t.session.relaunchBlocked}</p>}
    </li>
  );
}
