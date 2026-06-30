import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { Course } from "@/types/domain";
import styles from "./CoursesPage.module.scss";

export function CoursesPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["courses", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("*")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Course[];
    },
    enabled: !!user,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .insert({ owner_id: user!.id, title: "" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["courses", "mine"] });
      navigate(`/teacher/courses/${id}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("courses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", "mine"] }),
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.courses.pageTitle}</h1>
        <button
          type="button"
          className="btn btn--primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t.courses.creating : t.courses.createNew}
        </button>
      </header>

      {isLoading && <p>{t.common.loading}</p>}

      {!isLoading && courses.length === 0 && (
        <p className={styles.empty}>{t.courses.noneYet}</p>
      )}

      <ul className={styles.list}>
        {courses.map((course) => (
          <li key={course.id} className={styles.card}>
            <div className={styles.cardMain}>
              <h2 className={styles.courseName}>
                {course.title || <em className={styles.untitled}>(ללא שם)</em>}
              </h2>
              {course.description && (
                <p className={styles.desc}>{course.description}</p>
              )}
            </div>
            <div className={styles.cardActions}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => navigate(`/teacher/courses/${course.id}`)}
              >
                {t.courses.edit}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (window.confirm(t.courses.deleteConfirm)) {
                    remove.mutate(course.id);
                  }
                }}
              >
                {t.courses.deleteCourse}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
