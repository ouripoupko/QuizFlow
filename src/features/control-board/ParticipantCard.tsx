import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { Question, Response as DbResponse, SessionParticipant } from "@/types/domain";
import styles from "./ParticipantCard.module.scss";

type ParticipantStatus = "answering" | "waiting" | "done";

export interface ParticipantDisplay {
  participant: SessionParticipant;
  latestResponse: DbResponse | null;
  status: ParticipantStatus;
}

interface Props {
  display: ParticipantDisplay;
  questions: Question[];
}

export function ParticipantCard({ display, questions }: Props) {
  const { participant, latestResponse, status } = display;
  const [pushing, setPushing] = useState(false);
  const [resolving, setResolving] = useState(false);

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

  const pos = participant.current_position;
  const total = questions.length;
  const currentQ = questions[pos] ?? null;

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
  );
}
