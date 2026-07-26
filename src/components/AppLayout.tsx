import { NavLink, Outlet } from "react-router-dom";
import { signOut } from "@/auth/auth";
import { t } from "@/i18n";
import styles from "./AppLayout.module.scss";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.link} ${styles.linkActive}` : styles.link;

export function AppLayout() {
  return (
    <>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand}>
          {t.app.name}
        </NavLink>
        <nav className={styles.nav}>
          <NavLink to="/teacher/quizzes" className={navLinkClass}>{t.nav.myQuizzes}</NavLink>
          <NavLink to="/teacher/courses" className={navLinkClass}>{t.nav.myCourses}</NavLink>
          <NavLink to="/topics" className={navLinkClass}>{t.nav.topics}</NavLink>
          <NavLink to="/admin/topics" className={navLinkClass}>{t.nav.adminTopics}</NavLink>
          <NavLink to="/settings" className={navLinkClass}>{t.nav.settings}</NavLink>
          <button type="button" className="btn" onClick={() => void signOut()}>
            {t.nav.signOut}
          </button>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
