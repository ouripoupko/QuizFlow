import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
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
}

export function QuestionEditor({ question, quizId, position, total, onMove }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [correctAnswer, setCorrectAnswer] = useState(question.correct_answer ?? "");
  const [grading, setGrading] = useState(question.grading_instructions);
  const [askingAi, setAskingAi] = useState(false);
  const [aiError, setAiError] = useState("");

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
      setOpen(false);
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
        body: { question_prompt: prompt, grading_instructions: grading },
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
            disabled={position === 0}
            onClick={() => onMove("up")}
            title={t.questionEditor.moveUp}
          >
            {t.questionEditor.moveUp}
          </button>
          <button
            type="button"
            className={styles.moveBtn}
            disabled={position === total - 1}
            onClick={() => onMove("down")}
            title={t.questionEditor.moveDown}
          >
            {t.questionEditor.moveDown}
          </button>
        </div>

        <button type="button" className={styles.titleBtn} onClick={() => setOpen((o) => !o)}>
          <span className={styles.num}>{t.quizEditor.questionN} {position + 1}</span>
          <span className={styles.preview}>{promptPreview}</span>
        </button>

        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => {
            if (window.confirm(t.questionEditor.deleteQuestionConfirm)) remove.mutate();
          }}
        >
          {t.questionEditor.deleteQuestion}
        </button>
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
          <textarea
            className={`${styles.textarea} ${codeMode ? styles.code : ""}`}
            value={prompt}
            rows={4}
            placeholder={t.questionEditor.promptPlaceholder}
            onChange={(e) => setPrompt(e.target.value)}
          />

          {/* Images */}
          <label className={styles.fieldLabel}>{t.questionEditor.imagesLabel}</label>
          <ImageUploader quizId={quizId} questionId={question.id} />

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
              onChange={(e) => setCorrectAnswer(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!prompt.trim() || askingAi}
              onClick={() => void askAi()}
            >
              {askingAi ? t.questionEditor.askingAi : t.questionEditor.askAiButton}
            </button>
          </div>
          {aiError && <p className={styles.error}>{aiError}</p>}

          {/* Grading instructions */}
          <label className={styles.fieldLabel}>{t.questionEditor.gradingLabel}</label>
          <GradingInstructionEditor value={grading} onChange={setGrading} />

          {/* Actions */}
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={save.isPending || !prompt.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t.quizEditor.saving : t.questionEditor.saveQuestion}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
