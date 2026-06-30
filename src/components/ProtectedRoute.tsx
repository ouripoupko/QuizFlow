import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";

/**
 * Gates routes that require a signed-in user. While the initial session check is
 * still running we show a neutral loading state rather than flashing the sign-in
 * page for an already-authenticated user.
 *
 * Saves the intended path so that after Google OAuth the user lands back on
 * the page they were trying to reach (e.g. a /join/:token link).
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "loading") {
    return <p style={{ padding: "var(--space-6)" }}>{t.common.loading}</p>;
  }

  if (status === "anonymous") {
    sessionStorage.setItem("returnTo", location.pathname + location.search);
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
}
