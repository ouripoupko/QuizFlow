import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useIsAdmin } from "@/auth/useIsAdmin";
import { useIsTeacher } from "@/auth/useIsTeacher";
import { t } from "@/i18n";

/** Gates routes meant for teachers (admins get in too — spec §2 early-deployment overlap). */
export function TeacherRoute({ children }: { children: ReactNode }) {
  const { isTeacher, isLoading: teacherLoading } = useIsTeacher();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  if (teacherLoading || adminLoading) {
    return <p style={{ padding: "var(--space-6)" }}>{t.common.loading}</p>;
  }

  if (!isTeacher && !isAdmin) {
    return <Navigate to="/my-quizzes" replace />;
  }

  return <>{children}</>;
}
