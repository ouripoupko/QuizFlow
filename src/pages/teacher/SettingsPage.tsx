import { ApiKeyForm } from "@/features/teacher/ApiKeyForm";
import { t } from "@/i18n";
import styles from "./SettingsPage.module.scss";

export function SettingsPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t.teacherSettings.pageTitle}</h1>
      <ApiKeyForm />
    </main>
  );
}
