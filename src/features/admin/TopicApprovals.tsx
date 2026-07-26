import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { TopicNode } from "@/types/domain";
import styles from "./TopicApprovals.module.scss";

interface PendingNode extends TopicNode {
  profiles: { display_name: string | null } | null;
}

export function TopicApprovals() {
  const qc = useQueryClient();

  const { data: pending = [], isLoading } = useQuery<PendingNode[]>({
    queryKey: ["admin-pending-topics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_nodes")
        .select("*, profiles(display_name)")
        .eq("status", "pending")
        .order("created_at");
      if (error) throw error;
      return data as PendingNode[];
    },
  });

  const { data: allNodes = [] } = useQuery<TopicNode[]>({
    queryKey: ["topic-nodes"],
    queryFn: async () => {
      const { data } = await supabase.from("topic_nodes").select("*");
      return (data ?? []) as TopicNode[];
    },
  });

  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("topic_nodes")
        .update({ status: "approved" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-pending-topics"] });
      void qc.invalidateQueries({ queryKey: ["topic-nodes"] });
    },
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reject_topic", { _topic_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-pending-topics"] });
      void qc.invalidateQueries({ queryKey: ["topic-nodes"] });
    },
  });

  const isBusy = (id: string) =>
    (approve.isPending && approve.variables === id) ||
    (reject.isPending && reject.variables === id);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t.adminTopics.pageTitle}</h2>

      {isLoading && <p>{t.common.loading}</p>}

      {!isLoading && pending.length === 0 && (
        <p className={styles.empty}>{t.adminTopics.noProposals}</p>
      )}

      <ul className={styles.list}>
        {pending.map((node) => {
          const parent = node.parent_id ? nodeMap.get(node.parent_id) : null;
          return (
            <li key={node.id} className={styles.card}>
              <div className={styles.info}>
                <span className={styles.name}>{node.name}</span>
                <span className={styles.meta}>
                  {t.adminTopics.parent}:{" "}
                  <strong>{parent?.name ?? t.adminTopics.rootLevel}</strong>
                </span>
                {node.profiles?.display_name && (
                  <span className={styles.meta}>
                    {t.adminTopics.proposedBy}:{" "}
                    <strong>{node.profiles.display_name}</strong>
                  </span>
                )}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`btn btn--primary ${styles.approveBtn}`}
                  disabled={isBusy(node.id)}
                  onClick={() => approve.mutate(node.id)}
                >
                  {approve.isPending && approve.variables === node.id
                    ? t.adminTopics.approving
                    : t.adminTopics.approve}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={isBusy(node.id)}
                  onClick={() => {
                    if (window.confirm(`למחוק את הנושא "${node.name}"? שאלונים יועברו לגלובלית.`)) {
                      reject.mutate(node.id);
                    }
                  }}
                >
                  {reject.isPending && reject.variables === node.id
                    ? t.adminTopics.rejecting
                    : t.adminTopics.reject}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
