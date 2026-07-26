import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useIsAdmin } from "@/auth/useIsAdmin";
import { t } from "@/i18n";

/** Gates routes that require the admin role (spec §2). */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return <p style={{ padding: "var(--space-6)" }}>{t.common.loading}</p>;
  }

  if (!isAdmin) {
    return <Navigate to="/my-quizzes" replace />;
  }

  return <>{children}</>;
}
