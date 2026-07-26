import { useIsTeacher } from "@/auth/useIsTeacher";
import { QuizzesPage } from "@/pages/teacher/QuizzesPage";
import { StudentQuizzesPage } from "@/pages/student/StudentQuizzesPage";
import { t } from "@/i18n";

/**
 * "My Quizzes" means different things per role (spec §2): a teacher's authored
 * quizzes vs. a student's joined sessions. Same nav entry, role-switched content.
 */
export function MyQuizzesPage() {
  const { isTeacher, isLoading } = useIsTeacher();

  if (isLoading) {
    return <p style={{ padding: "var(--space-6)" }}>{t.common.loading}</p>;
  }

  return isTeacher ? <QuizzesPage /> : <StudentQuizzesPage />;
}
