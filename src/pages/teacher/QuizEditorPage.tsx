import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { FlowMode, Question, Quiz } from "@/types/domain";
import { UNSORTED_TOPIC_ID } from "@/types/domain";
import { QuestionEditor } from "@/features/quiz/QuestionEditor";
import { exportQuizToFile } from "@/features/quiz/quizTransfer";
import { SessionHistory } from "@/features/session/SessionHistory";
import { SessionManager } from "@/features/session/SessionManager";
import styles from "./QuizEditorPage.module.scss";

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const qc = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  // At most one question expanded at a time (spec: avoid clutter, and
  // pasting an image would otherwise land in every open ImageUploader).
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  // Only the open question is ever editable, so this tracks its dirty state —
  // used to block Publish/Export while there's an unsaved edit in progress.
  const [openQuestionDirty, setOpenQuestionDirty] = useState(false);

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
  // Editing and running are mutually exclusive: a published quiz is locked
  // for edits (see `isPublished` below), so unpublishing is the only way back
  // to an editable draft — and it must not silently cut off a live session.
  const togglePublish = useMutation({
    mutationFn: async () => {
      const nextStatus = quiz?.status === "published" ? "draft" : "published";

      if (nextStatus === "draft") {
        const { data: active } = await supabase
          .from("quiz_sessions")
          .select("id")
          .eq("quiz_id", quizId!)
          .eq("status", "active")
          .maybeSingle();

        if (active) {
          if (!window.confirm(t.quizEditor.unpublishActiveSessionConfirm)) return;
          const { error: endErr } = await supabase
            .from("quiz_sessions")
            .update({ status: "ended", ended_at: new Date().toISOString() })
            .eq("id", active.id);
          if (endErr) throw endErr;
          void qc.invalidateQueries({ queryKey: ["active-session", quizId] });
        }
      }

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
  // `position` is intentionally omitted — a DB trigger always appends the
  // new row at the end of the quiz (see supabase/migrations/
  // 20260803120000_question_position_integrity.sql).
  const addQuestion = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .insert({
          quiz_id: quizId!,
          prompt: "",
          grading_instructions: "",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      setOpenQuestionId(id);
      setOpenQuestionDirty(false);
      void qc.invalidateQueries({ queryKey: ["questions", quizId] });
    },
  });

  // ── Reorder questions ────────────────────────────────────────────────────
  // A single RPC call so the swap is one transaction — two independent
  // updates could momentarily leave both rows at the same position, which
  // the DB's uniqueness constraint would otherwise reject.
  const moveQuestion = useMutation({
    mutationFn: async ({ idx, direction }: { idx: number; direction: "up" | "down" }) => {
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      const a = questions[idx];
      const b = questions[swapIdx];
      const { error } = await supabase.rpc("swap_question_positions", {
        _question_id_a: a.id,
        _question_id_b: b.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions", quizId] }),
  });

  async function handleExport() {
    if (!quiz) return;
    setExporting(true);
    setExportError(false);
    try {
      await exportQuizToFile(quiz, questions);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  if (quizLoading || qLoading) return <p className={styles.loading}>{t.common.loading}</p>;
  if (!quiz) return <p>{t.common.error}</p>;

  const isPublished = quiz.status === "published";

  return (
    <main className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <Link to="/my-quizzes" className="btn">{t.quizEditor.backToList}</Link>
        <span className={`${styles.badge} ${isPublished ? styles.publishedBadge : styles.draftBadge}`}>
          {isPublished ? t.quizEditor.publishedBadge : t.quizEditor.draftBadge}
        </span>
        {saveState === "saving" && <span className={styles.saveHint}>{t.quizEditor.saving}</span>}
        {saveState === "saved" && <span className={styles.saveHint}>{t.quizEditor.saved}</span>}
        <div className={styles.spacer} />
        <button
          type="button"
          className="btn"
          disabled={exporting || openQuestionDirty}
          title={openQuestionDirty ? t.quizEditor.unsavedChangesBlockHint : undefined}
          onClick={() => void handleExport()}
        >
          {exporting ? t.quizEditor.exporting : t.quizEditor.exportQuiz}
        </button>
        <button
          type="button"
          className={`btn ${isPublished ? "" : "btn--primary"}`}
          disabled={togglePublish.isPending || openQuestionDirty}
          title={openQuestionDirty ? t.quizEditor.unsavedChangesBlockHint : undefined}
          onClick={() => togglePublish.mutate()}
        >
          {isPublished ? t.quizEditor.unpublish : t.quizEditor.publish}
        </button>
      </div>

      {exportError && <p className={styles.exportError}>{t.quizEditor.exportError}</p>}
      {isPublished && <p className={styles.lockedHint}>{t.quizEditor.lockedHint}</p>}

      {/* ── Quiz metadata ───────────────────────────────────────────────── */}
      <div className={styles.meta}>
        <input
          type="text"
          className={styles.titleInput}
          placeholder={t.quizEditor.titlePlaceholder}
          value={title}
          disabled={isPublished}
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
          disabled={isPublished}
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
            disabled={isPublished}
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
            locked={isPublished}
            open={q.id === openQuestionId}
            onToggle={() => {
              setOpenQuestionId((cur) => (cur === q.id ? null : q.id));
              setOpenQuestionDirty(false);
            }}
            onDirtyChange={(dirty) => {
              if (q.id === openQuestionId) setOpenQuestionDirty(dirty);
            }}
          />
        ))}
        {!isPublished && (
          <button
            type="button"
            className="btn"
            disabled={addQuestion.isPending}
            onClick={() => addQuestion.mutate()}
          >
            {t.quizEditor.addQuestion}
          </button>
        )}
      </section>

      {/* ── Session management ───────────────────────────────────────────── */}
      <SessionManager quizId={quizId!} quizPublished={isPublished} />
      <SessionHistory
        quizId={quizId!}
        quizPublished={isPublished}
        quizContentUpdatedAt={quiz.content_updated_at}
      />
    </main>
  );
}
