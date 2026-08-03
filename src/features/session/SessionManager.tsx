import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { QuizSession } from "@/types/domain";
import { JoinQrCode } from "./JoinQrCode";
import styles from "./SessionManager.module.scss";

interface Props {
  quizId: string;
  quizPublished: boolean;
}

export function SessionManager({ quizId, quizPublished }: Props) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: session, isLoading } = useQuery<QuizSession | null>({
    queryKey: ["active-session", quizId],
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_sessions")
        .select("*")
        .eq("quiz_id", quizId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as QuizSession | null;
    },
    refetchInterval: 5_000,
  });

  const { data: studentCount = 0 } = useQuery<number>({
    queryKey: ["session-count", session?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("session_participants")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session!.id);
      return count ?? 0;
    },
    enabled: !!session?.id,
    refetchInterval: 5_000,
  });

  const startSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("quiz_sessions")
        .insert({ quiz_id: quizId, host_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-session", quizId] }),
  });

  const endSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("quiz_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", session!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-session", quizId] }),
  });

  const joinUrl = session
    ? `${window.location.origin}${import.meta.env.BASE_URL}join/${session.join_token}`
    : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return null;

  if (!session) {
    return (
      <div className={styles.panel}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!quizPublished || startSession.isPending}
          title={quizPublished ? undefined : t.session.startDisabledHint}
          onClick={() => startSession.mutate()}
        >
          {startSession.isPending ? t.session.starting : t.session.startSession}
        </button>
        {!quizPublished && <p className={styles.hint}>{t.session.startDisabledHint}</p>}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.activeHeader}>
        <span className={styles.activeBadge}>{t.session.sessionActive}</span>
        <span className={styles.count}>
          {studentCount} {t.session.studentsJoined}
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
      </div>
      <JoinQrCode value={joinUrl} />
      <div className={styles.bottomRow}>
        <Link
          to={`/session/${session.id}/board`}
          className="btn btn--primary"
        >
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
