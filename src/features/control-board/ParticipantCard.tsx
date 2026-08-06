import { Fragment, useState } from "react";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { Question, Response as DbResponse, SessionParticipant } from "@/types/domain";
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
  isAdmin: boolean;
}

function decisionLabel(decision: DbResponse["decision"]): string {
  if (decision === "pass") return t.controlBoard.decisionPass;
  if (decision === "fail") return t.controlBoard.decisionFail;
  return t.controlBoard.decisionUnsure;
}

export function ParticipantCard({ display, questions, isAdmin }: Props) {
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

  // Every question the student has answered, in quiz order, each with its
  // own attempt history (attempt_number ascending).
  const byQuestion = new Map<string, DbResponse[]>();
  for (const a of answers) {
    const list = byQuestion.get(a.question_id);
    if (list) list.push(a);
    else byQuestion.set(a.question_id, [a]);
  }
  const answerGroups = questions
    .filter((q) => byQuestion.has(q.id))
    .map((q) => ({
      question: q,
      attempts: [...byQuestion.get(q.id)!].sort((a, b) => a.attempt_number - b.attempt_number),
    }));

  return (
    <div className={`${styles.card} ${styles[`status--${status}`]}`}>
      <div className={styles.top}>
        <span className={styles.name}>{participant.display_name}</span>
        <span className={`${styles.badge} ${styles[`badge--${status}`]}`}>
          {status === "answering" && t.controlBoard.statusAnswering}
          {status === "waiting" && t.controlBoard.statusWaiting}
          {status === "done" && t.controlBoard.statusDone}
        </span>
      </div>

      <div className={styles.progress}>
        {status !== "done" && currentQ ? (
          <span>
            {t.controlBoard.questionN} {pos + 1} {t.controlBoard.of} {total}
          </span>
        ) : (
          <span>{total} / {total}</span>
        )}
      </div>

      {status === "waiting" && latestResponse && (
        <div className={styles.answerBox}>
          <span className={styles.answerLabel}>{t.controlBoard.answerLabel}</span>
          <pre className={styles.answerText}>{latestResponse.answer_text}</pre>
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
            {answerGroups.map(({ question, attempts }) => (
              <div key={question.id} className={styles.questionGroup}>
                <span className={styles.questionGroupLabel}>
                  {t.controlBoard.questionN} {question.position + 1}
                </span>
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
                              <pre className={styles.attemptText}>{a.answer_text}</pre>
                            </td>
                            <td>
                              <pre className={styles.attemptText}>{a.student_feedback}</pre>
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
                                  onClick={() => toggleAiRequest(a.id)}
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
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
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
  );
}
