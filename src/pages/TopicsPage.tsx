import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { Quiz, TopicNode } from "@/types/domain";
import { TopicTree } from "@/features/topics/TopicTree";
import { ProposeTopicForm } from "@/features/topics/ProposeTopicForm";
import styles from "./TopicsPage.module.scss";

interface QuizWithAuthor extends Quiz {
  profiles: { display_name: string | null } | null;
}

export function TopicsPage() {
  const navigate = useNavigate();
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [showProposeForm, setShowProposeForm] = useState(false);

  // All nodes visible to this user (approved + own pending)
  const { data: nodes = [] } = useQuery<TopicNode[]>({
    queryKey: ["topic-nodes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_nodes")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as TopicNode[];
    },
  });

  const approvedNodes = nodes.filter((n) => n.status === "approved");

  // Quizzes for the selected topic
  const { data: quizzes = [], isLoading: quizzesLoading } = useQuery<QuizWithAuthor[]>({
    queryKey: ["topic-quizzes", selectedTopicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*, profiles(display_name)")
        .eq("topic_node_id", selectedTopicId!)
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as QuizWithAuthor[];
    },
    enabled: !!selectedTopicId,
  });

  // Question counts for each quiz
  const { data: questionCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["topic-quiz-qcounts", quizzes.map((q) => q.id).join(",")],
    queryFn: async () => {
      if (quizzes.length === 0) return {};
      const counts: Record<string, number> = {};
      await Promise.all(
        quizzes.map(async (quiz) => {
          const { count } = await supabase
            .from("questions")
            .select("*", { count: "exact", head: true })
            .eq("quiz_id", quiz.id);
          counts[quiz.id] = count ?? 0;
        }),
      );
      return counts;
    },
    enabled: quizzes.length > 0,
  });

  const clone = useMutation({
    mutationFn: async (quizId: string) => {
      const { data, error } = await supabase.rpc("clone_quiz", {
        _quiz_id: quizId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newId) => {
      navigate(`/teacher/quizzes/${newId}`);
    },
  });

  const selectedNode = nodes.find((n) => n.id === selectedTopicId);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>{t.topicTree.pageTitle}</h1>
        <button
          type="button"
          className="btn"
          onClick={() => setShowProposeForm((v) => !v)}
        >
          {t.topicTree.proposeNewTopic}
        </button>
      </header>

      {showProposeForm && (
        <div className={styles.proposeSection}>
          <ProposeTopicForm
            approvedNodes={approvedNodes}
            onClose={() => setShowProposeForm(false)}
          />
        </div>
      )}

      <div className={styles.layout}>
        {/* ── Topic tree ─────────────────────────────────────────────────── */}
        <aside className={styles.treePanel}>
          <TopicTree
            nodes={nodes}
            selectedId={selectedTopicId}
            onSelect={setSelectedTopicId}
          />
        </aside>

        {/* ── Quiz list ──────────────────────────────────────────────────── */}
        <section className={styles.quizPanel}>
          {!selectedTopicId && (
            <p className={styles.hint}>{t.topicTree.selectTopic}</p>
          )}

          {selectedTopicId && selectedNode && (
            <h2 className={styles.topicHeading}>{selectedNode.name}</h2>
          )}

          {quizzesLoading && <p className={styles.hint}>{t.common.loading}</p>}

          {!quizzesLoading && selectedTopicId && quizzes.length === 0 && (
            <p className={styles.hint}>{t.topicTree.noQuizzes}</p>
          )}

          <ul className={styles.quizList}>
            {quizzes.map((quiz) => (
              <li key={quiz.id} className={styles.quizCard}>
                <div className={styles.quizMeta}>
                  <h3 className={styles.quizTitle}>{quiz.title}</h3>
                  {quiz.description && (
                    <p className={styles.quizDesc}>{quiz.description}</p>
                  )}
                  <p className={styles.quizInfo}>
                    {quiz.profiles?.display_name && (
                      <span>
                        {t.topicTree.by} {quiz.profiles.display_name}
                      </span>
                    )}
                    {questionCounts[quiz.id] !== undefined && (
                      <span>
                        {questionCounts[quiz.id]} {t.topicTree.questionsCount}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={clone.isPending && clone.variables === quiz.id}
                  onClick={() => clone.mutate(quiz.id)}
                >
                  {clone.isPending && clone.variables === quiz.id
                    ? t.topicTree.cloning
                    : t.topicTree.cloneQuiz}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
