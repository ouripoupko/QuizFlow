import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { DirectionalTextarea } from "@/components/DirectionalTextarea";
import type { Question, QuestionPart } from "@/types/domain";
import { GradingInstructionEditor } from "./GradingInstructionEditor";
import { ImageUploader } from "./ImageUploader";
import styles from "./QuestionEditor.module.scss";

// Known ask-ai reasons (raw English from the Edge Function, see
// supabase/functions/ask-ai/index.ts) mapped to a localized message.
const KNOWN_ASK_AI_ERRORS: Record<string, string> = {
  "No AI provider key configured. Add your key in Settings.": t.questionEditor.aiNoKey,
  "AI provider credit exhausted": t.questionEditor.aiCreditExhausted,
};

/**
 * A part as edited locally. `id` is null until first saved; `key` is a
 * stable React key that survives that (a new part has no id to key on).
 */
interface DraftPart {
  key: string;
  id: string | null;
  prompt: string;
  correctAnswer: string;
  allowImage: boolean;
}

function toDraftParts(parts: QuestionPart[]): DraftPart[] {
  return parts.map((p) => ({
    key: p.id,
    id: p.id,
    prompt: p.prompt,
    correctAnswer: p.correct_answer ?? "",
    allowImage: p.allow_answer_image,
  }));
}

function partsDirty(draft: DraftPart[], saved: QuestionPart[]): boolean {
  if (draft.length !== saved.length) return true;
  return draft.some((d, i) =>
    d.id !== saved[i].id
    || d.prompt !== saved[i].prompt
    || (d.correctAnswer.trim() || null) !== saved[i].correct_answer
    || d.allowImage !== saved[i].allow_answer_image
  );
}

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
  const [allowImage, setAllowImage] = useState(question.allow_answer_image);
  const [parts, setParts] = useState<DraftPart[]>([]);
  // Which ask-ai request is in flight / failed: "question" or a part's key.
  const [askingAiFor, setAskingAiFor] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{ target: string; message: string } | null>(null);

  const partsKey = ["question-parts", question.id];
  const { data: savedParts = [], isSuccess: partsLoaded } = useQuery<QuestionPart[]>({
    queryKey: partsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_parts")
        .select("*")
        .eq("question_id", question.id)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as QuestionPart[];
    },
  });

  // Seed the local draft once, when the saved parts first arrive — later
  // refetches must not clobber edits in progress (save/cancel reset it
  // explicitly instead).
  const partsSeeded = useRef(false);
  useEffect(() => {
    if (partsLoaded && !partsSeeded.current) {
      partsSeeded.current = true;
      setParts(toDraftParts(savedParts));
    }
  }, [partsLoaded, savedParts]);

  const hasParts = parts.length > 0;

  const dirty = prompt !== question.prompt
    || (hasParts ? null : (correctAnswer.trim() || null)) !== question.correct_answer
    || grading !== question.grading_instructions
    || (hasParts ? false : allowImage) !== question.allow_answer_image
    || (partsLoaded && partsDirty(parts, savedParts));

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function resetToSaved() {
    setPrompt(question.prompt);
    setCorrectAnswer(question.correct_answer ?? "");
    setGrading(question.grading_instructions);
    setAllowImage(question.allow_answer_image);
    setParts(toDraftParts(savedParts));
    setAiError(null);
  }

  const questionsKey = ["questions", quizId];

  // Question + parts in one RPC (one transaction) — see
  // supabase/migrations/20261102120000_question_parts.sql.
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("save_question_with_parts", {
        _question_id: question.id,
        _prompt: prompt,
        // A multi-part question's answers live on its parts.
        _correct_answer: hasParts ? null : (correctAnswer.trim() || null),
        _grading_instructions: grading,
        // Like the answer, the "allow an image" choice lives on the parts.
        _allow_answer_image: hasParts ? false : allowImage,
        _parts: parts.map((p) => ({
          id: p.id,
          prompt: p.prompt,
          correct_answer: p.correctAnswer.trim() || null,
          allow_answer_image: p.allowImage,
        })),
      });
      if (error) throw error;
      return data as QuestionPart[];
    },
    onSuccess: (saved) => {
      // New parts now have ids — adopt them, or the next save would insert
      // them a second time.
      qc.setQueryData(partsKey, saved);
      setParts(toDraftParts(saved));
      if (hasParts) {
        setCorrectAnswer("");
        setAllowImage(false);
      }
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

  // `target` is "question" for the question's own answer, or a part's key.
  async function askAi(target: string, body: Record<string, unknown>, onAnswer: (a: string) => void) {
    setAskingAiFor(target);
    setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("ask-ai", {
        body: {
          question_prompt: prompt,
          grading_instructions: grading,
          question_id: question.id,
          ...body,
        },
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (res.error) throw new Error(res.error.message);
      const reason = (res.data as { error?: string }).error;
      if (reason) {
        setAiError({ target, message: KNOWN_ASK_AI_ERRORS[reason] ?? reason });
        return;
      }
      onAnswer((res.data as { correctAnswer: string }).correctAnswer);
    } catch (e) {
      setAiError({ target, message: e instanceof Error ? e.message : t.common.error });
    } finally {
      setAskingAiFor(null);
    }
  }

  function updatePart(key: string, patch: Partial<DraftPart>) {
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addPart() {
    setParts((prev) => {
      // The first part inherits the question's own correct answer and
      // "allow an image" choice — once a question has parts, those live on
      // the parts.
      const first = prev.length === 0;
      return [...prev, {
        key: crypto.randomUUID(),
        id: null,
        prompt: "",
        correctAnswer: first ? correctAnswer : "",
        allowImage: first ? allowImage : false,
      }];
    });
    if (parts.length === 0) {
      setCorrectAnswer("");
      setAllowImage(false);
    }
  }

  function deletePart(key: string) {
    const part = parts.find((p) => p.key === key);
    // A saved part may already have student answers (cascade-deleted on save).
    if (part?.id && !window.confirm(t.questionEditor.deletePartConfirm)) return;
    setParts((prev) => prev.filter((p) => p.key !== key));
  }

  function movePart(idx: number, direction: "up" | "down") {
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    setParts((prev) => {
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }

  const promptPreview = prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt || "…";
  const canSave = !!prompt.trim() && parts.every((p) => p.prompt.trim());

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
          {savedParts.length > 0 && (
            <span className={styles.partsCount}>
              {savedParts.length} {t.questionEditor.partsCount}
            </span>
          )}
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
          {/* Prompt (the shared scenario once there are parts) */}
          <label className={styles.fieldLabel}>
            {hasParts ? t.questionEditor.scenarioLabel : t.questionEditor.promptLabel}
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

          {/* Correct answer — only for a question without parts */}
          {!hasParts && (
            <>
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
                    disabled={!prompt.trim() || askingAiFor !== null}
                    onClick={() => void askAi("question", {}, setCorrectAnswer)}
                  >
                    {askingAiFor === "question" ? t.questionEditor.askingAi : t.questionEditor.askAiButton}
                  </button>
                )}
              </div>
              {aiError?.target === "question" && <p className={styles.error}>{aiError.message}</p>}
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={allowImage}
                  disabled={locked}
                  onChange={(e) => setAllowImage(e.target.checked)}
                />
                {t.questionEditor.allowAnswerImage}
              </label>
            </>
          )}

          {/* Parts */}
          <label className={styles.fieldLabel}>
            {t.questionEditor.partsLabel}{" "}
            {!hasParts && <span className={styles.optional}>{t.questionEditor.partsHint}</span>}
          </label>
          {parts.map((part, idx) => (
            <div key={part.key} className={styles.partCard}>
              <div className={styles.partHeader}>
                <span className={styles.partNum}>{t.questionEditor.partN} {idx + 1}</span>
                {!locked && (
                  <>
                    <button
                      type="button"
                      className={styles.moveBtn}
                      disabled={idx === 0}
                      onClick={() => movePart(idx, "up")}
                      title={t.questionEditor.moveUp}
                    >
                      {t.questionEditor.moveUp}
                    </button>
                    <button
                      type="button"
                      className={styles.moveBtn}
                      disabled={idx === parts.length - 1}
                      onClick={() => movePart(idx, "down")}
                      title={t.questionEditor.moveDown}
                    >
                      {t.questionEditor.moveDown}
                    </button>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => deletePart(part.key)}
                    >
                      {t.questionEditor.deletePart}
                    </button>
                  </>
                )}
              </div>
              <DirectionalTextarea
                className={`${styles.textarea} ${codeMode ? styles.code : ""}`}
                value={part.prompt}
                rows={2}
                placeholder={t.questionEditor.partPromptPlaceholder}
                disabled={locked}
                onChange={(v) => updatePart(part.key, { prompt: v })}
              />
              <label className={styles.fieldLabel}>
                {t.questionEditor.correctAnswerLabel}{" "}
                <span className={styles.optional}>{t.questionEditor.correctAnswerOptional}</span>
              </label>
              <div className={styles.answerRow}>
                <textarea
                  className={styles.textarea}
                  value={part.correctAnswer}
                  rows={2}
                  placeholder={t.questionEditor.correctAnswerPlaceholder}
                  disabled={locked}
                  onChange={(e) => updatePart(part.key, { correctAnswer: e.target.value })}
                />
                {!locked && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!prompt.trim() || !part.prompt.trim() || askingAiFor !== null}
                    onClick={() =>
                      void askAi(
                        part.key,
                        {
                          part_number: idx + 1,
                          part_prompt: part.prompt,
                          previous_part_prompts: parts.slice(0, idx).map((p) => p.prompt),
                        },
                        (answer) => updatePart(part.key, { correctAnswer: answer }),
                      )}
                  >
                    {askingAiFor === part.key ? t.questionEditor.askingAi : t.questionEditor.askAiButton}
                  </button>
                )}
              </div>
              {aiError?.target === part.key && <p className={styles.error}>{aiError.message}</p>}
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={part.allowImage}
                  disabled={locked}
                  onChange={(e) => updatePart(part.key, { allowImage: e.target.checked })}
                />
                {t.questionEditor.allowAnswerImage}
              </label>
            </div>
          ))}
          {!locked && (
            <button
              type="button"
              className={`btn ${styles.addPartBtn}`}
              disabled={!partsLoaded}
              onClick={addPart}
            >
              {t.questionEditor.addPart}
            </button>
          )}

          {/* Grading instructions — one set for the whole question */}
          <label className={styles.fieldLabel}>{t.questionEditor.gradingLabel}</label>
          <GradingInstructionEditor value={grading} onChange={setGrading} locked={locked} />

          {/* Actions */}
          <div className={styles.actions}>
            {!locked && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={save.isPending || !canSave || !dirty}
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
          {save.isError && <p className={styles.error}>{t.common.error}</p>}
        </div>
      )}
    </div>
  );
}
