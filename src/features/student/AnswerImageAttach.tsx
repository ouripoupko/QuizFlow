import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { AnswerImageThumb } from "@/components/AnswerImageThumb";
import { uploadAnswerImage } from "@/lib/answerImages";
import styles from "./AnswerImageAttach.module.scss";

interface Props {
  participantId: string;
  /** Storage path of the attached image, or null. At most one per answer. */
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}

// Attach one image to an answer: paste (Ctrl+V), choose a file, or — on a
// phone — take a photo. Uploads immediately (downscaled, see
// src/lib/answerImages.ts); the answer then just carries the path.
export function AnswerImageAttach({ participantId, value, onChange, disabled = false }: Props) {
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function attach(file: File) {
    if (disabled || !file.type.startsWith("image/")) return;
    setUploading(true);
    setFailed(false);
    try {
      onChange(await uploadAnswerImage(participantId, file));
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }

  // Window-level: there's a single answer box on the page, and pasting a
  // screenshot shouldn't depend on where the focus happens to be. Text
  // pastes are left alone (only image items are taken).
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void attachRef.current(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className={styles.root}>
      {value ? (
        <div className={styles.attached}>
          <AnswerImageThumb path={value} alt={t.studentRuntime.answerImageAlt} />
          {!disabled && (
            <div className={styles.attachedActions}>
              <button type="button" className={styles.linkBtn} onClick={() => inputRef.current?.click()}>
                {t.studentRuntime.replaceImage}
              </button>
              <button type="button" className={styles.linkBtn} onClick={() => onChange(null)}>
                {t.studentRuntime.removeImage}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className={styles.zone}
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? t.studentRuntime.imageUploading : t.studentRuntime.attachImageHint}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void attach(file);
          e.target.value = "";
        }}
      />
      {failed && <p className={styles.error}>{t.studentRuntime.imageUploadFailed}</p>}
    </div>
  );
}
