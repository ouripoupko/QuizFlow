import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import { importQuizFromFile, parseQuizExportFile } from "@/features/quiz/quizTransfer";
import type { Quiz } from "@/types/domain";
import styles from "./QuizzesPage.module.scss";

export function QuizzesPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);

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

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportError(false);
    try {
      const parsed = await parseQuizExportFile(file);
      const newQuizId = await importQuizFromFile(parsed, user!.id);
      void qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
      navigate(`/teacher/quizzes/${newQuizId}`);
    } catch {
      setImportError(true);
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.quizList.pageTitle}</h1>
        <div className={styles.headerActions}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className={styles.hiddenInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            {importing ? t.quizList.importing : t.quizList.importQuiz}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t.quizList.creating : t.quizList.createNew}
          </button>
        </div>
      </header>

      {importError && <p className={styles.importError}>{t.quizList.importError}</p>}

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
