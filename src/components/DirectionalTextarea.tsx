import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { getLineBounds, isLineMarkedLtr, setLineDirection } from "@/lib/directionalText";
import styles from "./DirectionalTextarea.module.scss";

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

// A plain <textarea> plus a two-way direction switch for the line the cursor
// is on: RTL (default) or LTR (for a formula or number embedded in Hebrew
// prose). No rich-text format — the marker is a pair of Unicode directional-
// isolate characters (see src/lib/directionalText.ts), so `value` stays an
// ordinary string everywhere else (DB, export/import, the AI prompt).
export function DirectionalTextarea({ value, onChange, className, placeholder, rows, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const pendingCursorPos = useRef<number | null>(null);

  // Restores focus + cursor position after a direction-driven value change —
  // `value` is controlled by the parent, so we can't set it directly.
  useEffect(() => {
    if (pendingCursorPos.current === null) return;
    const pos = pendingCursorPos.current;
    pendingCursorPos.current = null;
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(pos, pos);
    setCursorPos(pos);
  }, [value]);

  // Tracks the cursor via the native `selectionchange` event rather than the
  // textarea's own onSelect/onClick/onKeyUp — those fire inconsistently for
  // a click that both focuses an unfocused textarea AND repositions the
  // caret in the same gesture (e.g. clicking straight into a different
  // paragraph of an already-written question), so the buttons would read a
  // stale line right after such a click. selectionchange always reflects
  // the settled position.
  useEffect(() => {
    function handleSelectionChange() {
      const el = textareaRef.current;
      if (!el || document.activeElement !== el) return;
      setCursorPos(el.selectionStart);
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  function handleSetDirection(dir: "ltr" | "rtl") {
    const result = setLineDirection(value, cursorPos, dir);
    pendingCursorPos.current = result.cursorPos;
    onChange(result.text);
  }

  const lineIsLtr = isLineMarkedLtr(value, getLineBounds(value, cursorPos));

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.dirBtn} ${!lineIsLtr ? styles.dirBtnActive : ""}`}
          title={t.directionalText.rtlLabel}
          aria-label={t.directionalText.rtlLabel}
          aria-pressed={!lineIsLtr}
          disabled={disabled}
          onClick={() => handleSetDirection("rtl")}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="8" y1="15" x2="17" y2="15" />
            <polyline points="10,12.5 7,15 10,17.5" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.dirBtn} ${lineIsLtr ? styles.dirBtnActive : ""}`}
          title={t.directionalText.ltrLabel}
          aria-label={t.directionalText.ltrLabel}
          aria-pressed={lineIsLtr}
          disabled={disabled}
          onClick={() => handleSetDirection("ltr")}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="12" y2="15" />
            <polyline points="10,12.5 13,15 10,17.5" />
          </svg>
        </button>
        <span className={styles.keyboardHint}>{t.directionalText.keyboardHint}</span>
      </div>
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
