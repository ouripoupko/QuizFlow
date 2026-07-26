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
        <NavLink to="/my-quizzes" className={styles.brand}>
          {t.app.name}
        </NavLink>
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
          <span className={styles.signedInAs}>
            {t.auth.signedInAs} <strong>{user?.email}</strong>
          </span>
          <button type="button" className="btn" onClick={() => void signOut()}>
            {t.nav.signOut}
          </button>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
