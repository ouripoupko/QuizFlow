import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import styles from "./StudentQuizzesPage.module.scss";

interface JoinedQuiz {
  participantId: string;
  sessionId: string;
  sessionStatus: "active" | "ended";
  quizTitle: string;
  currentPosition: number;
  questionsCount: number;
}

interface ParticipantRow {
  id: string;
  current_position: number;
  joined_at: string;
  quiz_sessions: {
    id: string;
    status: "active" | "ended";
    quiz_id: string;
    quizzes: { id: string; title: string } | null;
  } | null;
}

export function StudentQuizzesPage() {
  const userId = useAuthStore((s) => s.user?.id);

  const { data: quizzes, isLoading, isError } = useQuery<JoinedQuiz[]>({
    queryKey: ["student-quizzes", userId],
    queryFn: async () => {
      const { data: participants, error: pErr } = await supabase
        .from("session_participants")
        .select(
          "id, current_position, joined_at, quiz_sessions ( id, status, quiz_id, quizzes ( id, title ) )",
        )
        .eq("student_id", userId)
        .order("joined_at", { ascending: false });
      if (pErr) throw pErr;

      const rows = (participants ?? []) as unknown as ParticipantRow[];
      const withSession = rows.filter((r) => r.quiz_sessions?.quizzes);

      const quizIds = [...new Set(withSession.map((r) => r.quiz_sessions!.quiz_id))];
      const { data: allQuestions, error: qErr } = await supabase
        .from("questions")
        .select("quiz_id")
        .in("quiz_id", quizIds.length ? quizIds : ["00000000-0000-0000-0000-000000000000"]);
      if (qErr) throw qErr;

      const countByQuiz = new Map<string, number>();
      for (const q of (allQuestions ?? []) as { quiz_id: string }[]) {
        countByQuiz.set(q.quiz_id, (countByQuiz.get(q.quiz_id) ?? 0) + 1);
      }

      return withSession.map((r) => ({
        participantId: r.id,
        sessionId: r.quiz_sessions!.id,
        sessionStatus: r.quiz_sessions!.status,
        quizTitle: r.quiz_sessions!.quizzes!.title,
        currentPosition: r.current_position,
        questionsCount: countByQuiz.get(r.quiz_sessions!.quiz_id) ?? 0,
      }));
    },
    enabled: !!userId,
  });

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t.quizList.pageTitle}</h1>

      {isLoading && <p>{t.common.loading}</p>}
      {isError && <p className={styles.error}>{t.common.error}</p>}

      {!isLoading && !isError && quizzes?.length === 0 && (
        <p className={styles.empty}>{t.studentQuizzes.noneYet}</p>
      )}

      <ul className={styles.list}>
        {quizzes?.map((q) => {
          const finished = q.currentPosition >= q.questionsCount;
          const canContinue = !finished && q.sessionStatus === "active";
          const statusLabel = finished
            ? t.studentQuizzes.statusCompleted
            : q.sessionStatus === "ended"
              ? t.studentQuizzes.statusEnded
              : t.studentQuizzes.statusInProgress;
          const statusClass = finished
            ? styles.badgeCompleted
            : q.sessionStatus === "ended"
              ? styles.badgeEnded
              : styles.badgeInProgress;

          return (
            <li key={q.participantId} className={styles.card}>
              <div className={styles.cardMain}>
                <span className={`${styles.badge} ${statusClass}`}>{statusLabel}</span>
                <h2 className={styles.quizTitle}>{q.quizTitle}</h2>
                <p className={styles.progress}>
                  {t.studentQuizzes.progress}:{" "}
                  {Math.min(q.currentPosition, q.questionsCount)} / {q.questionsCount}{" "}
                  {t.quizList.questionsCount}
                </p>
              </div>
              {canContinue && (
                <div className={styles.cardActions}>
                  <Link to={`/session/${q.sessionId}`} className="btn btn--primary">
                    {t.studentQuizzes.continueBtn}
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
