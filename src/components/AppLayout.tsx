import { NavLink, Outlet } from "react-router-dom";
import { signOut } from "@/auth/auth";
import { useIsAdmin } from "@/auth/useIsAdmin";
import { useIsTeacher } from "@/auth/useIsTeacher";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import styles from "./AppLayout.module.scss";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.link} ${styles.linkActive}` : styles.link;

export function AppLayout() {
  const { isAdmin } = useIsAdmin();
  const { isTeacher } = useIsTeacher();
  const user = useAuthStore((s) => s.user);
  const showTeacherNav = isTeacher || isAdmin;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.identity}>
          <NavLink to="/my-quizzes" className={styles.brand}>
            {t.app.name}
          </NavLink>
          <span className={styles.signedInAs}>
            {t.auth.signedInAs} <strong>{user?.email}</strong>
          </span>
          <button
            type="button"
            className={styles.logoutBtn}
            title={t.nav.signOut}
            aria-label={t.nav.signOut}
            onClick={() => void signOut()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/my-quizzes" className={navLinkClass}>{t.nav.myQuizzes}</NavLink>
          <NavLink to="/teacher/courses" className={navLinkClass}>{t.nav.myCourses}</NavLink>
          {showTeacherNav && (
            <NavLink to="/topics" className={navLinkClass}>{t.nav.topics}</NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={navLinkClass}>{t.nav.admin}</NavLink>
          )}
          {showTeacherNav && (
            <NavLink to="/settings" className={navLinkClass}>{t.nav.settings}</NavLink>
          )}
        </nav>
      </header>
      <Outlet />
    </>
  );
}
