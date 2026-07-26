import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import styles from "./AdminsList.module.scss";

interface AdminRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  granted_at: string;
}

export function AdminsList() {
  const { data: admins, isLoading, isError } = useQuery<AdminRow[]>({
    queryKey: ["admins"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admins");
      if (error) throw error;
      return (data ?? []) as AdminRow[];
    },
  });

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t.settings.adminsListTitle}</h3>

      {isLoading ? (
        <p>{t.common.loading}</p>
      ) : isError ? (
        <p className={styles.error}>{t.common.error}</p>
      ) : !admins?.length ? (
        <p className={styles.empty}>{t.settings.adminsEmpty}</p>
      ) : (
        <ul className={styles.list}>
          {admins.map((admin) => (
            <li key={admin.user_id} className={styles.item}>
              <span className={styles.name}>
                {admin.display_name ?? admin.email ?? admin.user_id}
              </span>
              {admin.email && admin.display_name && (
                <span className={styles.muted}>{admin.email}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
