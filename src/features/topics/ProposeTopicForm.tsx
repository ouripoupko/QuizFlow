import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import type { TopicNode } from "@/types/domain";
import styles from "./ProposeTopicForm.module.scss";

interface Props {
  approvedNodes: TopicNode[];
  onClose: () => void;
}

export function ProposeTopicForm({ approvedNodes, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");

  const propose = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("topic_nodes").insert({
        name: name.trim(),
        parent_id: parentId || null,
        status: "pending",
        proposed_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["topic-nodes"] });
      onClose();
    },
  });

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label}>{t.topicTree.proposeName}</label>
        <input
          type="text"
          className={styles.input}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>{t.topicTree.proposeParent}</label>
        <select
          className={styles.input}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">{t.topicTree.proposeRoot}</option>
          {approvedNodes
            .filter((n) => !n.is_system)
            .sort((a, b) => a.name.localeCompare(b.name, "he"))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </select>
      </div>
      {propose.isError && (
        <p className={styles.error}>{t.common.error}</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={propose.isPending || !name.trim()}
          onClick={() => propose.mutate()}
        >
          {propose.isPending ? t.topicTree.proposing : t.topicTree.proposeSubmit}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t.topicTree.cancel}
        </button>
      </div>
    </div>
  );
}
