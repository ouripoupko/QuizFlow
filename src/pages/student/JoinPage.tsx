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

    const goToExisting = (participantId: string) => {
      localStorage.setItem(`qf_participant_${session.id}`, participantId);
      navigate(`/session/${session.id}`, { replace: true });
    };

    // Already joined this session? Check by identity (session_id +
    // student_id), not the locally cached participant id — the cache can be
    // missing (different device/browser, cleared storage) even though a
    // participant row already exists, which would otherwise hit the DB's
    // uniqueness constraint on the insert below and surface as a raw error.
    const { data: existing } = await supabase
      .from("session_participants")
      .select("id")
      .eq("session_id", session.id)
      .eq("student_id", user.id)
      .maybeSingle();

    if (existing) {
      goToExisting(existing.id);
      return;
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

    if (error) {
      // Lost a race with another tab/click doing the same insert — still
      // means "already joined," not a real failure.
      if (error.code === "23505") {
        const { data: raceWinner } = await supabase
          .from("session_participants")
          .select("id")
          .eq("session_id", session.id)
          .eq("student_id", user.id)
          .single();
        if (raceWinner) {
          goToExisting(raceWinner.id);
          return;
        }
      }
      setJoinError(error.message);
      setJoining(false);
      return;
    }

    if (!data) {
      setJoinError(t.common.error);
      setJoining(false);
      return;
    }

    goToExisting(data.id);
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
