import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatDateTime, t, withLang } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { QuizSession } from "@/types/domain";
import { JoinQrCode } from "./JoinQrCode";
import styles from "./SessionManager.module.scss";

interface Props {
  quizId: string;
  quizPublished: boolean;
}

// A quiz can run several lessons at once (e.g. one per class), each with its
// own join link, roster and control board. Each gets an optional name so the
// teacher can tell them apart.
export function SessionManager({ quizId, quizPublished }: Props) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: sessions = [], isLoading } = useQuery<QuizSession[]>({
    queryKey: ["active-sessions", quizId],
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_sessions")
        .select("*")
        .eq("quiz_id", quizId)
        .eq("status", "active")
        .order("created_at", { ascending: true });
      return (data ?? []) as QuizSession[];
    },
    refetchInterval: 5_000,
  });

  const startSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("quiz_sessions")
        .insert({ quiz_id: quizId, host_id: user!.id, name: newName.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName("");
      void qc.invalidateQueries({ queryKey: ["active-sessions", quizId] });
    },
  });

  if (isLoading) return null;

  return (
    <div className={styles.wrapper}>
      {sessions.map((s) => (
        <ActiveSessionCard key={s.id} session={s} quizId={quizId} />
      ))}

      <div className={styles.startRow}>
        <input
          type="text"
          className={styles.nameInput}
          placeholder={t.session.namePlaceholder}
          aria-label={t.session.nameLabel}
          value={newName}
          disabled={!quizPublished}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={!quizPublished || startSession.isPending}
          title={quizPublished ? undefined : t.session.startDisabledHint}
          onClick={() => startSession.mutate()}
        >
          {startSession.isPending
            ? t.session.starting
            : sessions.length > 0
              ? t.session.startAnotherSession
              : t.session.startSession}
        </button>
      </div>
      {!quizPublished && <p className={styles.hint}>{t.session.startDisabledHint}</p>}
    </div>
  );
}

function ActiveSessionCard({ session, quizId }: { session: QuizSession; quizId: string }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [name, setName] = useState(session.name ?? "");

  const { data: studentCount = 0 } = useQuery<number>({
    queryKey: ["session-count", session.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("session_participants")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session.id);
      return count ?? 0;
    },
    refetchInterval: 5_000,
  });

  const rename = useMutation({
    mutationFn: async (value: string | null) => {
      const { error } = await supabase.from("quiz_sessions").update({ name: value }).eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-sessions", quizId] }),
  });

  const saveName = () => {
    const value = name.trim() || null;
    if (value !== (session.name ?? null)) rename.mutate(value);
  };

  const endSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("quiz_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["active-sessions", quizId] });
      void qc.invalidateQueries({ queryKey: ["session-history", quizId] });
    },
  });

  // Carries the teacher's current language (?lang=…), so students open the
  // quiz in it — and the AI writes their feedback in it.
  const joinUrl = withLang(`${window.location.origin}${import.meta.env.BASE_URL}join/${session.join_token}`);

  const copyLink = async () => {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.activeHeader}>
        <span className={styles.activeBadge}>{t.session.sessionActive}</span>
        <input
          type="text"
          className={styles.nameInput}
          placeholder={t.session.namePlaceholder}
          aria-label={t.session.nameLabel}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        <span className={styles.count}>
          {t.session.historyStarted} {formatDateTime(session.created_at)} · {studentCount} {t.session.studentsJoined}
        </span>
      </div>
      <div className={styles.linkRow}>
        <label className={styles.linkLabel}>{t.session.joinLink}</label>
        <input
          type="text"
          readOnly
          className={styles.linkInput}
          value={joinUrl}
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button type="button" className="btn" onClick={copyLink}>
          {copied ? t.session.linkCopied : t.session.copyLink}
        </button>
        <button type="button" className="btn" onClick={() => setShowQr((v) => !v)}>
          {showQr ? t.session.hideQr : t.session.showQr}
        </button>
      </div>
      {showQr && <JoinQrCode value={joinUrl} />}
      <div className={styles.bottomRow}>
        <Link to={`/session/${session.id}/board`} className="btn btn--primary">
          {t.controlBoard.openBoard}
        </Link>
        <button
          type="button"
          className="btn"
          disabled={endSession.isPending}
          onClick={() => endSession.mutate()}
        >
          {t.session.endSession}
        </button>
      </div>
    </div>
  );
}
