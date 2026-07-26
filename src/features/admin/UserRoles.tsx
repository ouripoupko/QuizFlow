import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { AppRole } from "@/types/domain";
import styles from "./UserRoles.module.scss";

const ALL_ROLES: AppRole[] = ["student", "teacher", "admin"];

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
}

export function UserRoles() {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { data: users, isLoading, isError } = useQuery<UserRow[]>({
    queryKey: ["management-users"],
    queryFn: async () => {
      const [{ data: profiles, error: pErr }, { data: roleRows, error: rErr }] =
        await Promise.all([
          supabase.from("profiles").select("id, email, display_name").order("display_name"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;

      const rolesByUser = new Map<string, AppRole[]>();
      for (const r of (roleRows ?? []) as { user_id: string; role: AppRole }[]) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(r.role);
        rolesByUser.set(r.user_id, list);
      }

      return (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        roles: rolesByUser.get(p.id) ?? [],
      }));
    },
  });

  const toggleRole = useMutation({
    mutationFn: async ({
      userId,
      role,
      grant,
    }: {
      userId: string;
      role: AppRole;
      grant: boolean;
    }) => {
      if (grant) {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role);
        if (error) throw error;
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["management-users"] }),
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t.management.pageTitle}</h2>

      {isLoading ? (
        <p>{t.common.loading}</p>
      ) : isError ? (
        <p className={styles.error}>{t.management.loadError}</p>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>{t.management.nameColumn}</th>
                <th className={styles.th}>{t.management.emailColumn}</th>
                <th className={styles.th}>{t.management.rolesColumn}</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => (
                <tr key={user.id}>
                  <td className={styles.td}>{user.display_name ?? t.management.noName}</td>
                  <td className={styles.td}>{user.email}</td>
                  <td className={styles.td}>
                    <div className={styles.roleChips}>
                      {ALL_ROLES.map((role) => {
                        const granted = user.roles.includes(role);
                        const isSelf = user.id === currentUserId;
                        const lockedSelfAdmin = role === "admin" && isSelf;
                        return (
                          <button
                            key={role}
                            type="button"
                            className={granted ? styles.chipActive : styles.chip}
                            disabled={toggleRole.isPending || lockedSelfAdmin}
                            title={lockedSelfAdmin ? t.management.cannotRemoveOwnAdmin : undefined}
                            onClick={() =>
                              toggleRole.mutate({ userId: user.id, role, grant: !granted })
                            }
                          >
                            {t.roles[role]}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {toggleRole.isError && <p className={styles.error}>{t.management.updateError}</p>}
        </div>
      )}
    </section>
  );
}
