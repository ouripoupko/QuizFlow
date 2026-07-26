import { AdminsList } from "@/features/settings/AdminsList";
import { ApiKeyForm } from "@/features/teacher/ApiKeyForm";
import { t } from "@/i18n";
import styles from "./SettingsPage.module.scss";

export function SettingsPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t.settings.pageTitle}</h1>

      <section className={styles.pageSection}>
        <h2 className={styles.pageSectionTitle}>{t.settings.generalSection}</h2>
        <AdminsList />
      </section>

      <section className={styles.pageSection}>
        <h2 className={styles.pageSectionTitle}>{t.teacherSettings.pageTitle}</h2>
        <ApiKeyForm />
      </section>
    </main>
  );
}
