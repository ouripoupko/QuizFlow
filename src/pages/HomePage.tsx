import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import styles from "./HomePage.module.scss";

export function HomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <main className={styles.page}>
      <p className={styles.welcome}>
        {t.auth.signedInAs} <strong>{user?.email}</strong>
      </p>
      <p className={styles.tagline}>{t.app.tagline}</p>
    </main>
  );
}
