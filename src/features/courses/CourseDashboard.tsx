import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import styles from "./CourseDashboard.module.scss";

interface DashboardRow {
  quiz_id: string;
  quiz_title: string;
  quiz_position: number;
  student_id: string;
  student_name: string;
  questions_total: number;
  questions_passed: number;
  total_attempts: number;
  last_activity: string | null;
}

interface Props {
  courseId: string;
}

function cellClass(passed: number, total: number): string {
  if (total === 0) return styles.cellEmpty;
  if (passed === 0) return styles.cellNone;
  if (passed >= total) return styles.cellFull;
  return styles.cellPartial;
}

export function CourseDashboard({ courseId }: Props) {
  const { data: rows = [], isLoading } = useQuery<DashboardRow[]>({
    queryKey: ["course-dashboard", courseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("course_dashboard", {
        _course_id: courseId,
      });
      if (error) throw error;
      return data as DashboardRow[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className={styles.hint}>{t.common.loading}</p>;
  if (rows.length === 0) {
    return <p className={styles.hint}>{t.courseEditor.noDashboardData}</p>;
  }

  // Build unique ordered quizzes
  const quizzes = [
    ...new Map(
      rows.map((r) => [r.quiz_id, { id: r.quiz_id, title: r.quiz_title, position: r.quiz_position }]),
    ).values(),
  ].sort((a, b) => a.position - b.position);

  // Build unique students (sorted by name)
  const students = [
    ...new Map(
      rows.map((r) => [r.student_id, r.student_name]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "he"));

  // Lookup: `quizId|studentId` → row
  const lookup = new Map(
    rows.map((r) => [`${r.quiz_id}|${r.student_id}`, r]),
  );

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thName}>{/* student column */}</th>
            {quizzes.map((q) => (
              <th key={q.id} className={styles.thQuiz} title={q.title}>
                {q.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map(([studentId, studentName]) => (
            <tr key={studentId}>
              <td className={styles.tdName}>{studentName}</td>
              {quizzes.map((q) => {
                const row = lookup.get(`${q.id}|${studentId}`);
                if (!row) {
                  return (
                    <td key={q.id} className={`${styles.cell} ${styles.cellEmpty}`}>
                      {t.courseEditor.noActivity}
                    </td>
                  );
                }
                return (
                  <td
                    key={q.id}
                    className={`${styles.cell} ${cellClass(row.questions_passed, row.questions_total)}`}
                    title={`${row.total_attempts} ${t.courseEditor.attemptsLabel}`}
                  >
                    {row.questions_passed}
                    {t.courseEditor.questionsOf}
                    {row.questions_total}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
