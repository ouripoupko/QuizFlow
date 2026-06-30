import { useState } from "react";
import { t } from "@/i18n";
import type { TopicNode } from "@/types/domain";
import { UNSORTED_TOPIC_ID } from "@/types/domain";
import styles from "./TopicTree.module.scss";

interface TreeNode extends TopicNode {
  children: TreeNode[];
}

function buildTree(nodes: TopicNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const n of nodes) map.set(n.id, { ...n, children: [] });

  const roots: TreeNode[] = [];
  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  // Sort children alphabetically; Unsorted always last at root level
  const sort = (arr: TreeNode[]) =>
    arr.sort((a, b) => {
      if (a.id === UNSORTED_TOPIC_ID) return 1;
      if (b.id === UNSORTED_TOPIC_ID) return -1;
      return a.name.localeCompare(b.name, "he");
    });

  const sortRecursive = (nodes: TreeNode[]) => {
    sort(nodes);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);
  return roots;
}

interface Props {
  nodes: TopicNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TopicTree({ nodes, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => !n.parent_id).map((n) => n.id)),
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tree = buildTree(nodes);

  function renderNode(node: TreeNode, depth: number) {
    const isExpanded = expanded.has(node.id);
    const isSelected = selectedId === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <li key={node.id} className={styles.item}>
        <div
          className={styles.row}
          style={{ paddingInlineStart: `${depth * 18}px` }}
        >
          <button
            type="button"
            className={styles.chevron}
            disabled={!hasChildren}
            onClick={() => toggle(node.id)}
            aria-label={isExpanded ? "כווץ" : "הרחב"}
          >
            {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
          </button>
          <button
            type="button"
            className={`${styles.label} ${isSelected ? styles.selected : ""}`}
            onClick={() => onSelect(node.id)}
          >
            {node.name}
            {node.status === "pending" && (
              <span className={styles.pending}>{t.topicTree.pendingTag}</span>
            )}
          </button>
        </div>
        {isExpanded && hasChildren && (
          <ul className={styles.children}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav className={styles.tree} aria-label={t.topicTree.pageTitle}>
      <ul className={styles.root}>
        {tree.map((node) => renderNode(node, 0))}
      </ul>
    </nav>
  );
}
