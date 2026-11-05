import { Fragment, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AnswerImageThumb } from "@/components/AnswerImageThumb";
import { ZoomableThumb } from "@/components/ZoomableThumb";
import { dir, t } from "@/i18n";
import type {
  Question,
  QuestionPart,
  Response as DbResponse,
  SessionParticipant,
} from "@/types/domain";
import styles from "./ParticipantCard.module.scss";

type ParticipantStatus = "answering" | "waiting" | "done";

export interface ParticipantDisplay {
  participant: SessionParticipant;
  latestResponse: DbResponse | null;
  /** Every response this participant has submitted, across all questions. */
  answers: DbResponse[];
  status: ParticipantStatus;
}

interface Props {
  display: ParticipantDisplay;
  questions: Question[];
  /** Parts of multi-part questions; a question without parts has no entry. */
  partsByQuestion: Record<string, QuestionPart[]>;
  /** Signed URLs of each question's own images, in display order. */
  imagesByQuestion: Record<string, string[]>;
  isAdmin: boolean;
  /** Collapsed = one summary row; expanded = the full card below it. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The AI's reply couldn't be read, so grade-answer fell back to "unsure"
 * with no feedback (flagged in ai_response_meta, see providers/anthropic.ts).
 * Answers graded before that flag existed can't be told apart.
 */
function isBrokenReply(r: DbResponse): boolean {
  return r.ai_response_meta?.reply_broken === true;
}

function decisionLabel(decision: DbResponse["decision"]): string {
  if (decision === "pass") return t.controlBoard.decisionPass;
  if (decision === "fail") return t.controlBoard.decisionFail;
  return t.controlBoard.decisionUnsure;
}

/** One row group of attempts (a question, or one part of it), oldest first. */
interface AttemptGroup {
  key: string;
  /** Shown above the table on a multi-part question ("סעיף 2"). */
  partLabel: string | null;
  /** That part's text, so the teacher sees what the student answered. */
  partPrompt: string | null;
  attempts: DbResponse[];
}

export function ParticipantCard({
  display,
  questions,
  partsByQuestion,
  imagesByQuestion,
  isAdmin,
  expanded,
  onToggle,
}: Props) {
  const { participant, latestResponse, answers, status } = display;
  const [pushing, setPushing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [expandedAiRequests, setExpandedAiRequests] = useState<Set<string>>(new Set());

  const toggleAiRequest = (id: string) => {
    setExpandedAiRequests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const push = async () => {
    setPushing(true);
    await supabase.rpc("push_participant", { _participant_id: participant.id });
    setPushing(false);
  };

  const resolve = async (decision: "pass" | "fail") => {
    if (!latestResponse) return;
    setResolving(true);
    await supabase.rpc("resolve_response", {
      _response_id: latestResponse.id,
      _decision: decision,
    });
    setResolving(false);
  };

  const remove = async () => {
    if (!window.confirm(t.controlBoard.removeConfirm)) return;
    setRemoving(true);
    // The card itself disappears via the control board's realtime DELETE
    // handler; this just guards the button for the round-trip.
    await supabase.rpc("delete_participant", { _participant_id: participant.id });
    setRemoving(false);
  };

  const pos = participant.current_position;
  const total = questions.length;
  const currentQ = questions[pos] ?? null;
  const currentParts = currentQ ? (partsByQuestion[currentQ.id] ?? []) : [];

  // Every question the student has answered, in quiz order, each with its
  // own attempt history (attempt_number ascending).
  const byQuestion = new Map<string, DbResponse[]>();
  for (const a of answers) {
    const list = byQuestion.get(a.question_id);
    if (list) list.push(a);
    else byQuestion.set(a.question_id, [a]);
  }
  const byAttempt = (a: DbResponse, b: DbResponse) => a.attempt_number - b.attempt_number;
  const answerGroups = questions
    .filter((q) => byQuestion.has(q.id))
    .map((q) => {
      const responses = byQuestion.get(q.id)!;
      const parts = partsByQuestion[q.id] ?? [];
      // A question without parts is one group, exactly as before; a
      // multi-part question gets one group per answered part, in part order.
      const groups: AttemptGroup[] = parts.length === 0
        ? [{ key: q.id, partLabel: null, partPrompt: null, attempts: [...responses].sort(byAttempt) }]
        : parts
          .map((part) => ({
            key: part.id,
            partLabel: `${t.controlBoard.partN} ${part.position + 1}`,
            partPrompt: part.prompt,
            attempts: responses.filter((r) => r.part_id === part.id).sort(byAttempt),
          }))
          .filter((g) => g.attempts.length > 0);
      return { question: q, groups };
    });

  return (
    <div className={`${styles.card} ${styles[`status--${status}`]}`}>
      {/* Summary row — the whole class fits on screen when every row is
          collapsed; its columns line up with the board's header row. */}
      <button
        type="button"
        className={styles.row}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={styles.chevron} aria-hidden="true">{expanded ? "▾" : dir === "rtl" ? "◂" : "▸"}</span>
        <span className={styles.name}>{participant.display_name}</span>
        <span className={styles.progress}>
          {status !== "done" && currentQ ? (
            <>
              {t.controlBoard.questionN} {pos + 1} {t.controlBoard.of} {total}
              {currentParts.length > 0 && (
                <>
                  {" · "}{t.controlBoard.partN} {participant.current_part + 1}{" "}
                  {t.controlBoard.of} {currentParts.length}
                </>
              )}
            </>
          ) : (
            <>{total} / {total}</>
          )}
        </span>
        <span className={`${styles.badge} ${styles[`badge--${status}`]}`}>
          {status === "answering" && t.controlBoard.statusAnswering}
          {status === "waiting" && t.controlBoard.statusWaiting}
          {status === "done" && t.controlBoard.statusDone}
        </span>
      </button>

      {expanded && (
        <div className={styles.body}>
          {status === "waiting" && latestResponse && (
            <div className={styles.answerBox}>
              <AnsweredQuestion
                response={latestResponse}
                questions={questions}
                partsByQuestion={partsByQuestion}
                imagesByQuestion={imagesByQuestion}
              />
              <span className={styles.answerLabel}>{t.controlBoard.answerLabel}</span>
              {latestResponse.answer_text && (
              <pre className={styles.answerText}>{latestResponse.answer_text}</pre>
            )}
            {latestResponse.answer_image_path && (
              <AnswerImageThumb path={latestResponse.answer_image_path} alt={t.controlBoard.answerImageAlt} />
            )}
              {isBrokenReply(latestResponse) ? (
                <p className={styles.aiReplyBroken}>{t.controlBoard.aiReplyBroken}</p>
              ) : latestResponse.ai_reasoning && (
                <>
                  <span className={styles.answerLabel}>{t.controlBoard.aiReasoningLabel}</span>
                  <p className={styles.aiReasoning}>{latestResponse.ai_reasoning}</p>
                </>
              )}
              <div className={styles.resolveActions}>
                <button
                  type="button"
                  className={`btn btn--primary ${styles.approveBtn}`}
                  disabled={resolving}
                  onClick={() => void resolve("pass")}
                >
                  {resolving ? t.controlBoard.resolving : t.controlBoard.approve}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={resolving}
                  onClick={() => void resolve("fail")}
                >
                  {resolving ? t.controlBoard.resolving : t.controlBoard.reject}
                </button>
              </div>
            </div>
          )}

          {answerGroups.length > 0 && (
            <div className={styles.answersBox}>
              <span className={styles.answersLabel}>{t.controlBoard.answersLabel}</span>
              <div className={styles.answersList}>
                {answerGroups.map(({ question, groups }) => (
                  <div key={question.id} className={styles.questionGroup}>
                    <span className={styles.questionGroupLabel}>
                      {t.controlBoard.questionN} {question.position + 1}
                    </span>
                    <QuestionText prompt={question.prompt} images={imagesByQuestion[question.id] ?? []} />
                    {groups.map((group) => (
                      <Fragment key={group.key}>
                        {group.partLabel && (
                          <span className={styles.partGroupLabel}>{group.partLabel}</span>
                        )}
                        {group.partPrompt && <QuestionText prompt={group.partPrompt} images={[]} />}
                        <AttemptsTable
                          attempts={group.attempts}
                          isAdmin={isAdmin}
                          expandedAiRequests={expandedAiRequests}
                          onToggleAiRequest={toggleAiRequest}
                        />
                      </Fragment>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.bottomActions}>
            <button
              type="button"
              className={styles.removeBtn}
              disabled={removing}
              onClick={() => void remove()}
            >
              {removing ? t.controlBoard.removing : t.controlBoard.remove}
            </button>
            {status !== "done" && (
              <button
                type="button"
                className={`btn ${styles.pushBtn}`}
                disabled={pushing}
                onClick={() => void push()}
              >
                {pushing ? t.controlBoard.pushing : t.controlBoard.push}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface AttemptsTableProps {
  attempts: DbResponse[];
  isAdmin: boolean;
  expandedAiRequests: Set<string>;
  onToggleAiRequest: (id: string) => void;
}

function AttemptsTable({ attempts, isAdmin, expandedAiRequests, onToggleAiRequest }: AttemptsTableProps) {
  return (
    <table className={styles.answersTable}>
      <colgroup>
        <col className={styles.answerCol} />
        <col className={styles.aiReplyCol} />
        <col className={styles.statusCol} />
      </colgroup>
      <thead>
        <tr>
          <th>{t.controlBoard.answerColumnHeader}</th>
          <th>{t.controlBoard.aiReplyColumnHeader}</th>
          <th className={styles.statusColumn}>{t.controlBoard.statusColumnHeader}</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((a) => {
          const decision = a.decision ?? "unsure";
          const hasAdminData = isAdmin && !!a.ai_request;
          const expanded = expandedAiRequests.has(a.id);
          return (
            <Fragment key={a.id}>
              <tr className={styles[`attemptRow--${decision}`]}>
                <td>
                  {a.answer_text && <pre className={styles.attemptText}>{a.answer_text}</pre>}
                  {a.answer_image_path && (
                    <AnswerImageThumb path={a.answer_image_path} alt={t.controlBoard.answerImageAlt} />
                  )}
                </td>
                <td>
                  {isBrokenReply(a) ? (
                    <span className={styles.aiReplyBrokenShort}>{t.controlBoard.aiReplyBrokenShort}</span>
                  ) : (
                    <pre className={styles.attemptText}>{a.student_feedback}</pre>
                  )}
                </td>
                <td className={styles.statusColumn}>
                  <span
                    className={`${styles.attemptDecision} ${styles[`attemptDecision--${decision}`]}`}
                  >
                    {decisionLabel(a.decision)}
                  </span>
                  {hasAdminData && (
                    <button
                      type="button"
                      className={styles.adminToggle}
                      aria-label={t.controlBoard.adminRawDataLabel}
                      aria-expanded={expanded}
                      onClick={() => onToggleAiRequest(a.id)}
                    >
                      {expanded ? "▲" : "▼"}
                    </button>
                  )}
                </td>
              </tr>
              {hasAdminData && expanded && (
                <tr className={styles.adminRow}>
                  <td colSpan={3}>
                    <div className={styles.adminRowLabel}>
                      {t.controlBoard.adminRawDataLabel}
                    </div>
                    <pre className={styles.adminRawData}>
                      {JSON.stringify(a.ai_request, null, 2)}
                    </pre>
                    {a.ai_response_meta && (
                      <>
                        <div className={styles.adminRowLabel}>
                          {t.controlBoard.adminResponseMetaLabel}
                        </div>
                        <pre className={styles.adminRawData}>
                          {JSON.stringify(a.ai_response_meta, null, 2)}
                        </pre>
                      </>
                    )}
                    {a.ai_reasoning && (
                      <>
                        <div className={styles.adminRowLabel}>
                          {t.controlBoard.adminReasoningLabel}
                        </div>
                        <p className={styles.aiReasoning}>{a.ai_reasoning}</p>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** A question's (or part's) text, with its images as numbered thumbnails. */
function QuestionText({ prompt, images }: { prompt: string; images: string[] }) {
  return (
    <div className={styles.questionText}>
      <pre className={styles.questionPrompt}>{prompt}</pre>
      {images.length > 0 && (
        <div className={styles.questionImages}>
          {images.map((url, i) => (
            <ZoomableThumb
              key={url}
              url={url}
              alt=""
              caption={`${t.controlBoard.imageN} ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AnsweredQuestionProps {
  response: DbResponse;
  questions: Question[];
  partsByQuestion: Record<string, QuestionPart[]>;
  imagesByQuestion: Record<string, string[]>;
}

/** The question (and part) an answer awaiting approval was given to. */
function AnsweredQuestion({ response, questions, partsByQuestion, imagesByQuestion }: AnsweredQuestionProps) {
  const question = questions.find((q) => q.id === response.question_id);
  if (!question) return null;
  const part = response.part_id
    ? (partsByQuestion[question.id] ?? []).find((p) => p.id === response.part_id) ?? null
    : null;
  return (
    <>
      <span className={styles.answerLabel}>
        {t.controlBoard.questionN} {question.position + 1}
        {part && <> · {t.controlBoard.partN} {part.position + 1}</>}
      </span>
      <QuestionText prompt={question.prompt} images={imagesByQuestion[question.id] ?? []} />
      {part && <QuestionText prompt={part.prompt} images={[]} />}
    </>
  );
}
