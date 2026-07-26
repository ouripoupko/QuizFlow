import { TopicApprovals } from "@/features/admin/TopicApprovals";
import { UserRoles } from "@/features/admin/UserRoles";
import { t } from "@/i18n";
import styles from "./AdminPage.module.scss";

export function AdminPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t.admin.pageTitle}</h1>
      <TopicApprovals />
      <UserRoles />
    </main>
  );
}
