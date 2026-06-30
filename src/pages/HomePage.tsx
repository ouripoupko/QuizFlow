import { Link } from "react-router-dom";
import { signOut } from "@/auth/auth";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import styles from "./HomePage.module.scss";

export function HomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>{t.app.name}</h1>
        <nav className={styles.nav}>
          <Link to="/teacher/quizzes" className="btn btn--primary">{t.nav.myQuizzes}</Link>
          <Link to="/teacher/courses" className="btn">{t.nav.myCourses}</Link>
          <Link to="/topics" className="btn">{t.nav.topics}</Link>
          <Link to="/admin/topics" className="btn">{t.nav.adminTopics}</Link>
          <Link to="/settings" className="btn">{t.nav.settings}</Link>
          <button type="button" className="btn" onClick={() => void signOut()}>
            {t.nav.signOut}
          </button>
        </nav>
      </header>

      <p className={styles.welcome}>
        {t.auth.signedInAs} <strong>{user?.email}</strong>
      </p>
      <p className={styles.tagline}>{t.app.tagline}</p>
    </main>
  );
}
