import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import styles from "./JoinPage.module.scss";

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    const name = user?.user_metadata?.full_name as string | undefined;
    if (name) setDisplayName(name);
  }, [user]);

  const { data: session, isLoading, error: sessionError } = useQuery({
    queryKey: ["join-session", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_sessions")
        .select("id, quiz_id, status, quizzes(title)")
        .eq("join_token", token!)
        .eq("status", "active")
        .single();
      if (error) throw error;
      return data as unknown as {
        id: string;
        quiz_id: string;
        status: string;
        quizzes: { title: string };
      };
    },
    enabled: !!token,
    retry: false,
  });

  const join = async () => {
    if (!session || !displayName.trim() || !user) return;
    setJoining(true);
    setJoinError("");

    // Already joined this session? Confirm the row still exists — a teacher
    // may have removed it (control board "remove student"), in which case we
    // fall through and rejoin fresh instead of navigating to a dead end.
    const cached = localStorage.getItem(`qf_participant_${session.id}`);
    if (cached) {
      const { data: existing } = await supabase
        .from("session_participants")
        .select("id")
        .eq("id", cached)
        .maybeSingle();
      if (existing) {
        navigate(`/session/${session.id}`, { replace: true });
        return;
      }
      localStorage.removeItem(`qf_participant_${session.id}`);
    }

    const { data, error } = await supabase
      .from("session_participants")
      .insert({
        session_id: session.id,
        student_id: user.id,
        display_name: displayName.trim(),
      })
      .select("id")
      .single();

    if (error || !data) {
      setJoinError(error?.message ?? t.common.error);
      setJoining(false);
      return;
    }

    localStorage.setItem(`qf_participant_${session.id}`, data.id);
    navigate(`/session/${session.id}`, { replace: true });
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <p>{t.common.loading}</p>
      </div>
    );
  }

  if (sessionError || !session) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>{t.studentJoin.sessionNotFound}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.quizTitle}>
          {session.quizzes.title || t.studentJoin.pageTitle}
        </h1>
        <div className={styles.form}>
          <label className={styles.label} htmlFor="display-name">
            {t.studentJoin.nameLabel}
          </label>
          <input
            id="display-name"
            type="text"
            className={styles.nameInput}
            placeholder={t.studentJoin.namePlaceholder}
            value={displayName}
            autoFocus
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void join()}
          />
          {joinError && <p className={styles.error}>{joinError}</p>}
          <button
            type="button"
            className="btn btn--primary"
            disabled={joining || !displayName.trim()}
            onClick={() => void join()}
          >
            {joining ? t.studentJoin.joining : t.studentJoin.joinButton}
          </button>
        </div>
      </div>
    </div>
  );
}
