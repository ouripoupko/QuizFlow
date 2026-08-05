import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { DirectionalTextarea } from "@/components/DirectionalTextarea";
import type { Question } from "@/types/domain";
import { GradingInstructionEditor } from "./GradingInstructionEditor";
import { ImageUploader } from "./ImageUploader";
import styles from "./QuestionEditor.module.scss";

interface Props {
  question: Question;
  quizId: string;
  position: number;
  total: number;
  onMove: (direction: "up" | "down") => void;
  locked?: boolean;
  /** Lifted to the parent so only one question can be expanded at a time. */
  open: boolean;
  onToggle: () => void;
  /** Reports live whether this question has unsaved edits (only meaningful while open). */
  onDirtyChange: (dirty: boolean) => void;
}

export function QuestionEditor({
  question,
  quizId,
  position,
  total,
  onMove,
  locked = false,
  open,
  onToggle,
  onDirtyChange,
}: Props) {
  const qc = useQueryClient();
  const [codeMode, setCodeMode] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [correctAnswer, setCorrectAnswer] = useState(question.correct_answer ?? "");
  const [grading, setGrading] = useState(question.grading_instructions);
  const [askingAi, setAskingAi] = useState(false);
  const [aiError, setAiError] = useState("");

  const dirty = prompt !== question.prompt
    || (correctAnswer.trim() || null) !== question.correct_answer
    || grading !== question.grading_instructions;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function resetToSaved() {
    setPrompt(question.prompt);
    setCorrectAnswer(question.correct_answer ?? "");
    setGrading(question.grading_instructions);
  }

  const questionsKey = ["questions", quizId];

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("questions")
        .update({
          prompt,
          correct_answer: correctAnswer.trim() || null,
          grading_instructions: grading,
        })
        .eq("id", question.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: questionsKey });
      // Only reachable while open (the save button lives inside the
      // expanded body), so this always means "collapse".
      onToggle();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("questions").delete().eq("id", question.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: questionsKey }),
  });

  async function askAi() {
    setAskingAi(true);
    setAiError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("ask-ai", {
        body: { question_prompt: prompt, grading_instructions: grading, question_id: question.id },
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (res.error) throw new Error(res.error.message);
      setCorrectAnswer((res.data as { correctAnswer: string }).correctAnswer);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t.common.error);
    } finally {
      setAskingAi(false);
    }
  }

  const promptPreview = prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt || "…";

  return (
    <div className={styles.card}>
      {/* ── Collapsed header ───────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.orderBtns}>
          <button
            type="button"
            className={styles.moveBtn}
            disabled={locked || position === 0}
            onClick={() => onMove("up")}
            title={t.questionEditor.moveUp}
          >
            {t.questionEditor.moveUp}
          </button>
          <button
            type="button"
            className={styles.moveBtn}
            disabled={locked || position === total - 1}
            onClick={() => onMove("down")}
            title={t.questionEditor.moveDown}
          >
            {t.questionEditor.moveDown}
          </button>
        </div>

        <button type="button" className={styles.titleBtn} onClick={onToggle}>
          <span className={styles.num}>{t.quizEditor.questionN} {position + 1}</span>
          <span className={styles.preview}>{promptPreview}</span>
          {dirty && <span className={styles.unsavedDot} title={t.questionEditor.unsavedChanges} />}
        </button>

        {!locked && (
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={() => {
              if (window.confirm(t.questionEditor.deleteQuestionConfirm)) remove.mutate();
            }}
          >
            {t.questionEditor.deleteQuestion}
          </button>
        )}
      </div>

      {/* ── Expanded editor ────────────────────────────────────────────── */}
      {open && (
        <div className={styles.body}>
          {/* Prompt */}
          <label className={styles.fieldLabel}>
            {t.questionEditor.promptLabel}
            <div className={styles.modeBtns}>
              <button
                type="button"
                className={`${styles.modeBtn} ${!codeMode ? styles.modeBtnActive : ""}`}
                onClick={() => setCodeMode(false)}
              >
                {t.questionEditor.textMode}
              </button>
              <button
                type="button"
                className={`${styles.modeBtn} ${codeMode ? styles.modeBtnActive : ""}`}
                onClick={() => setCodeMode(true)}
              >
                {t.questionEditor.codeMode}
              </button>
            </div>
          </label>
          <DirectionalTextarea
            className={`${styles.textarea} ${codeMode ? styles.code : ""}`}
            value={prompt}
            rows={4}
            placeholder={t.questionEditor.promptPlaceholder}
            disabled={locked}
            onChange={setPrompt}
          />

          {/* Images */}
          <label className={styles.fieldLabel}>{t.questionEditor.imagesLabel}</label>
          <ImageUploader quizId={quizId} questionId={question.id} locked={locked} />

          {/* Correct answer */}
          <label className={styles.fieldLabel}>
            {t.questionEditor.correctAnswerLabel}{" "}
            <span className={styles.optional}>{t.questionEditor.correctAnswerOptional}</span>
          </label>
          <div className={styles.answerRow}>
            <textarea
              className={styles.textarea}
              value={correctAnswer}
              rows={3}
              placeholder={t.questionEditor.correctAnswerPlaceholder}
              disabled={locked}
              onChange={(e) => setCorrectAnswer(e.target.value)}
            />
            {!locked && (
              <button
                type="button"
                className="btn"
                disabled={!prompt.trim() || askingAi}
                onClick={() => void askAi()}
              >
                {askingAi ? t.questionEditor.askingAi : t.questionEditor.askAiButton}
              </button>
            )}
          </div>
          {aiError && <p className={styles.error}>{aiError}</p>}

          {/* Grading instructions */}
          <label className={styles.fieldLabel}>{t.questionEditor.gradingLabel}</label>
          <GradingInstructionEditor value={grading} onChange={setGrading} locked={locked} />

          {/* Actions */}
          <div className={styles.actions}>
            {!locked && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={save.isPending || !prompt.trim() || !dirty}
                onClick={() => save.mutate()}
              >
                {save.isPending ? t.quizEditor.saving : t.questionEditor.saveQuestion}
              </button>
            )}
            {!locked && dirty && (
              <span className={styles.unsavedHint}>{t.questionEditor.unsavedChanges}</span>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                resetToSaved();
                onToggle();
              }}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
