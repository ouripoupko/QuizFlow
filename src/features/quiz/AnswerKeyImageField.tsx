import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { ZoomableThumb } from "@/components/ZoomableThumb";
import { useSignedImageUrl } from "@/lib/answerImages";
import { ANSWER_KEY_IMAGES_BUCKET, uploadAnswerKeyImage } from "@/lib/answerKeyImages";
import styles from "./AnswerKeyImageField.module.scss";

interface Props {
  quizId: string;
  questionId: string;
  /** Storage path of the answer image (saved or still a draft), or null. */
  value: string | null;
  onChange: (path: string | null) => void;
  locked?: boolean;
}

// The correct answer's one image (e.g. the expected graph or diagram):
// upload, paste (Ctrl+V while hovering — the editor has several image
// fields, same rule as ImageUploader), replace or remove. Part of the
// question's draft: it's stored on the question/part only on "save".
export function AnswerKeyImageField({ quizId, questionId, value, onChange, locked = false }: Props) {
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoveredRef = useRef(false);
  const url = useSignedImageUrl(ANSWER_KEY_IMAGES_BUCKET, value);

  async function attach(file: File) {
    if (locked || !file.type.startsWith("image/")) return;
    setUploading(true);
    setFailed(false);
    try {
      onChange(await uploadAnswerKeyImage(quizId, questionId, file));
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }

  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!hoveredRef.current) return;
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
    <div
      className={styles.root}
      onMouseEnter={() => { hoveredRef.current = true; }}
      onMouseLeave={() => { hoveredRef.current = false; }}
    >
      {value ? (
        <div className={styles.attached}>
          {url ? <ZoomableThumb url={url} alt={t.questionEditor.answerImageAlt} /> : <span className={styles.placeholder} />}
          {!locked && (
            <div className={styles.actions}>
              <button type="button" className={styles.linkBtn} onClick={() => inputRef.current?.click()}>
                {t.questionEditor.replaceAnswerImage}
              </button>
              <button type="button" className={styles.linkBtn} onClick={() => onChange(null)}>
                {t.questionEditor.removeAnswerImage}
              </button>
            </div>
          )}
        </div>
      ) : (
        !locked && (
          <button
            type="button"
            className={styles.zone}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? t.imageUploader.uploading : t.questionEditor.addAnswerImage}
          </button>
        )
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
      {failed && <p className={styles.error}>{t.questionEditor.answerImageFailed}</p>}
    </div>
  );
}
