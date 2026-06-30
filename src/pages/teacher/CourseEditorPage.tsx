import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { Course, Quiz } from "@/types/domain";
import { CourseDashboard } from "@/features/courses/CourseDashboard";
import styles from "./CourseEditorPage.module.scss";

interface CourseQuizRow {
  course_id: string;
  quiz_id: string;
  position: number;
  added_at: string;
  quizzes: { title: string; status: string } | null;
}

export function CourseEditorPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [addingQuizId, setAddingQuizId] = useState("");

  // ── Course ────────────────────────────────────────────────────────────────
  const { data: course } = useQuery<Course>({
    queryKey: ["course", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("*")
        .eq("id", courseId!)
        .single();
      if (error) throw error;
      return data as Course;
    },
    enabled: !!courseId,
  });

  useEffect(() => {
    if (course) {
      setTitle(course.title);
      setDescription(course.description);
    }
  }, [course]);

  // ── Quizzes in this course ────────────────────────────────────────────────
  const { data: courseQuizzes = [] } = useQuery<CourseQuizRow[]>({
    queryKey: ["course-quizzes", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_quizzes")
        .select("*, quizzes(title, status)")
        .eq("course_id", courseId!)
        .order("position");
      if (error) throw error;
      return data as CourseQuizRow[];
    },
    enabled: !!courseId,
  });

  // ── Teacher's own published quizzes (for the add dropdown) ───────────────
  const { data: myQuizzes = [] } = useQuery<Quiz[]>({
    queryKey: ["quizzes", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*")
        .eq("creator_id", user!.id)
        .eq("status", "published")
        .order("title");
      if (error) throw error;
      return data as Quiz[];
    },
    enabled: !!user,
  });

  const inCourseIds = new Set(courseQuizzes.map((cq) => cq.quiz_id));
  const addableQuizzes = myQuizzes.filter((q) => !inCourseIds.has(q.id));

  // ── Auto-save title/description ───────────────────────────────────────────
  function scheduleSave(patch: Partial<Pick<Course, "title" | "description">>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("courses")
        .update(patch)
        .eq("id", courseId!);
      if (!error) {
        void qc.invalidateQueries({ queryKey: ["course", courseId] });
        void qc.invalidateQueries({ queryKey: ["courses", "mine"] });
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    }, 600);
  }

  // ── Add quiz ──────────────────────────────────────────────────────────────
  const addQuiz = useMutation({
    mutationFn: async (quizId: string) => {
      const { error } = await supabase.from("course_quizzes").insert({
        course_id: courseId!,
        quiz_id: quizId,
        position: courseQuizzes.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAddingQuizId("");
      void qc.invalidateQueries({ queryKey: ["course-quizzes", courseId] });
    },
  });

  // ── Remove quiz ───────────────────────────────────────────────────────────
  const removeQuiz = useMutation({
    mutationFn: async (quizId: string) => {
      const { error } = await supabase
        .from("course_quizzes")
        .delete()
        .eq("course_id", courseId!)
        .eq("quiz_id", quizId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["course-quizzes", courseId] }),
  });

  // ── Reorder quizzes ───────────────────────────────────────────────────────
  const moveQuiz = useMutation({
    mutationFn: async ({ idx, direction }: { idx: number; direction: "up" | "down" }) => {
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      const a = courseQuizzes[idx];
      const b = courseQuizzes[swapIdx];
      await Promise.all([
        supabase
          .from("course_quizzes")
          .update({ position: b.position })
          .eq("course_id", courseId!)
          .eq("quiz_id", a.quiz_id),
        supabase
          .from("course_quizzes")
          .update({ position: a.position })
          .eq("course_id", courseId!)
          .eq("quiz_id", b.quiz_id),
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["course-quizzes", courseId] }),
  });

  if (!course) return <p className={styles.loading}>{t.common.loading}</p>;

  return (
    <main className={styles.page}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <Link to="/teacher/courses" className="btn">{t.courseEditor.backToList}</Link>
        {saveState === "saving" && <span className={styles.saveHint}>{t.courseEditor.saving}</span>}
        {saveState === "saved" && <span className={styles.saveHint}>{t.courseEditor.saved}</span>}
      </div>

      {/* ── Metadata ────────────────────────────────────────────────────── */}
      <div className={styles.meta}>
        <input
          type="text"
          className={styles.titleInput}
          placeholder={t.courseEditor.titlePlaceholder}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
        />
        <textarea
          className={styles.descInput}
          placeholder={t.courseEditor.descriptionPlaceholder}
          value={description}
          rows={2}
          onChange={(e) => {
            setDescription(e.target.value);
            scheduleSave({ description: e.target.value });
          }}
        />
      </div>

      {/* ── Quiz list ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t.courseEditor.quizzesSection}</h2>

        {courseQuizzes.length === 0 && (
          <p className={styles.empty}>{t.courseEditor.noQuizzes}</p>
        )}

        <ul className={styles.quizList}>
          {courseQuizzes.map((cq, idx) => (
            <li key={cq.quiz_id} className={styles.quizRow}>
              <span className={styles.quizTitle}>
                {cq.quizzes?.title || "(ללא כותרת)"}
              </span>
              <div className={styles.quizActions}>
                <button
                  type="button"
                  className="btn"
                  disabled={idx === 0 || moveQuiz.isPending}
                  onClick={() => moveQuiz.mutate({ idx, direction: "up" })}
                >
                  {t.courseEditor.moveUp}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={idx === courseQuizzes.length - 1 || moveQuiz.isPending}
                  onClick={() => moveQuiz.mutate({ idx, direction: "down" })}
                >
                  {t.courseEditor.moveDown}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => removeQuiz.mutate(cq.quiz_id)}
                >
                  {t.courseEditor.removeQuiz}
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* Add quiz dropdown */}
        {addableQuizzes.length > 0 && (
          <select
            className={styles.addSelect}
            value={addingQuizId}
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                setAddingQuizId(id);
                addQuiz.mutate(id);
              }
            }}
          >
            <option value="">{t.courseEditor.addQuizPlaceholder}</option>
            {addableQuizzes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title || "(ללא כותרת)"}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* ── Dashboard ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t.courseEditor.dashboardSection}</h2>
        <CourseDashboard courseId={courseId!} />
      </section>
    </main>
  );
}
