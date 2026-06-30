import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { FlowMode, Question, Quiz } from "@/types/domain";
import { UNSORTED_TOPIC_ID } from "@/types/domain";
import { QuestionEditor } from "@/features/quiz/QuestionEditor";
import { SessionManager } from "@/features/session/SessionManager";
import styles from "./QuizEditorPage.module.scss";

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const qc = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // ── Quiz data ────────────────────────────────────────────────────────────
  const { data: quiz, isLoading: quizLoading } = useQuery<Quiz>({
    queryKey: ["quiz", quizId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*")
        .eq("id", quizId!)
        .single();
      if (error) throw error;
      return data as Quiz;
    },
    enabled: !!quizId,
  });

  // ── Questions ────────────────────────────────────────────────────────────
  const { data: questions = [], isLoading: qLoading } = useQuery<Question[]>({
    queryKey: ["questions", quizId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .eq("quiz_id", quizId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as Question[];
    },
    enabled: !!quizId,
  });

  // ── Local editable state (title, description, flow_mode) ────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [flowMode, setFlowMode] = useState<FlowMode>("infinite_attempts");

  useEffect(() => {
    if (quiz) {
      setTitle(quiz.title);
      setDescription(quiz.description);
      setFlowMode(quiz.flow_mode);
    }
  }, [quiz]);

  // ── Auto-save quiz metadata ──────────────────────────────────────────────
  function scheduleMetaSave(patch: Partial<Pick<Quiz, "title" | "description" | "flow_mode">>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("quizzes")
        .update(patch)
        .eq("id", quizId!);
      if (!error) {
        void qc.invalidateQueries({ queryKey: ["quiz", quizId] });
        void qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    }, 600);
  }

  // ── Publish / unpublish ──────────────────────────────────────────────────
  const togglePublish = useMutation({
    mutationFn: async () => {
      const nextStatus = quiz?.status === "published" ? "draft" : "published";
      const patch: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "published" && !quiz?.topic_node_id) {
        patch.topic_node_id = UNSORTED_TOPIC_ID;
      }
      const { error } = await supabase
        .from("quizzes")
        .update(patch)
        .eq("id", quizId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quiz", quizId] });
      void qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
    },
  });

  // ── Add question ─────────────────────────────────────────────────────────
  const addQuestion = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("questions").insert({
        quiz_id: quizId!,
        position: questions.length,
        prompt: "",
        grading_instructions: "",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions", quizId] }),
  });

  // ── Reorder questions ────────────────────────────────────────────────────
  const moveQuestion = useMutation({
    mutationFn: async ({ idx, direction }: { idx: number; direction: "up" | "down" }) => {
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      const a = questions[idx];
      const b = questions[swapIdx];
      await Promise.all([
        supabase.from("questions").update({ position: b.position }).eq("id", a.id),
        supabase.from("questions").update({ position: a.position }).eq("id", b.id),
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions", quizId] }),
  });

  if (quizLoading || qLoading) return <p className={styles.loading}>{t.common.loading}</p>;
  if (!quiz) return <p>{t.common.error}</p>;

  const isPublished = quiz.status === "published";

  return (
    <main className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <Link to="/teacher/quizzes" className="btn">{t.quizEditor.backToList}</Link>
        <span className={`${styles.badge} ${isPublished ? styles.publishedBadge : styles.draftBadge}`}>
          {isPublished ? t.quizEditor.publishedBadge : t.quizEditor.draftBadge}
        </span>
        {saveState === "saving" && <span className={styles.saveHint}>{t.quizEditor.saving}</span>}
        {saveState === "saved" && <span className={styles.saveHint}>{t.quizEditor.saved}</span>}
        <div className={styles.spacer} />
        <button
          type="button"
          className={`btn ${isPublished ? "" : "btn--primary"}`}
          disabled={togglePublish.isPending}
          onClick={() => togglePublish.mutate()}
        >
          {isPublished ? t.quizEditor.unpublish : t.quizEditor.publish}
        </button>
      </div>

      {/* ── Quiz metadata ───────────────────────────────────────────────── */}
      <div className={styles.meta}>
        <input
          type="text"
          className={styles.titleInput}
          placeholder={t.quizEditor.titlePlaceholder}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleMetaSave({ title: e.target.value });
          }}
        />
        <textarea
          className={styles.descInput}
          placeholder={t.quizEditor.descriptionPlaceholder}
          value={description}
          rows={2}
          onChange={(e) => {
            setDescription(e.target.value);
            scheduleMetaSave({ description: e.target.value });
          }}
        />
        <div className={styles.flowRow}>
          <label className={styles.flowLabel}>{t.quizEditor.flowModeLabel}</label>
          <select
            className={styles.flowSelect}
            value={flowMode}
            onChange={(e) => {
              const v = e.target.value as FlowMode;
              setFlowMode(v);
              void supabase.from("quizzes").update({ flow_mode: v }).eq("id", quizId!);
            }}
          >
            <option value="infinite_attempts">{t.quizEditor.flowModes.infinite_attempts}</option>
            <option value="single_attempt">{t.quizEditor.flowModes.single_attempt}</option>
          </select>
        </div>
      </div>

      {/* ── Questions ───────────────────────────────────────────────────── */}
      <section className={styles.questions}>
        {questions.length === 0 && (
          <p className={styles.empty}>{t.quizEditor.noQuestions}</p>
        )}
        {questions.map((q, idx) => (
          <QuestionEditor
            key={q.id}
            question={q}
            quizId={quizId!}
            position={idx}
            total={questions.length}
            onMove={(dir) => moveQuestion.mutate({ idx, direction: dir })}
          />
        ))}
        <button
          type="button"
          className="btn"
          disabled={addQuestion.isPending}
          onClick={() => addQuestion.mutate()}
        >
          {t.quizEditor.addQuestion}
        </button>
      </section>

      {/* ── Session management ───────────────────────────────────────────── */}
      <SessionManager quizId={quizId!} />
    </main>
  );
}
