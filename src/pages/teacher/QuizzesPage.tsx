import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { Quiz } from "@/types/domain";
import styles from "./QuizzesPage.module.scss";

export function QuizzesPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ["quizzes", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*")
        .eq("creator_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Quiz[];
    },
    enabled: !!user,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .insert({ creator_id: user!.id, title: "" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
      navigate(`/teacher/quizzes/${id}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quizzes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quizzes", "mine"] }),
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.quizList.pageTitle}</h1>
        <button
          type="button"
          className="btn btn--primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t.quizList.creating : t.quizList.createNew}
        </button>
      </header>

      {isLoading && <p>{t.common.loading}</p>}

      {!isLoading && quizzes.length === 0 && (
        <p className={styles.empty}>{t.quizList.noneYet}</p>
      )}

      <ul className={styles.list}>
        {quizzes.map((quiz) => (
          <li key={quiz.id} className={styles.card}>
            <div className={styles.cardMain}>
              <span className={`${styles.badge} ${quiz.status === "published" ? styles.badgePublished : styles.badgeDraft}`}>
                {quiz.status === "published" ? t.quizList.published : t.quizList.draft}
              </span>
              <h2 className={styles.quizTitle}>
                {quiz.title || <em className={styles.untitled}>(ללא כותרת)</em>}
              </h2>
              {quiz.description && (
                <p className={styles.description}>{quiz.description}</p>
              )}
            </div>
            <div className={styles.cardActions}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(`/teacher/quizzes/${quiz.id}`)}
              >
                {t.quizList.edit}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (window.confirm(t.quizList.deleteConfirm)) remove.mutate(quiz.id);
                }}
              >
                {t.quizList.deleteQuiz}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
