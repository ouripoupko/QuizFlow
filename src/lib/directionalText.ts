// Per-line text direction, without any rich-text format: a line marked LTR
// is wrapped in Unicode directional-isolate characters. Browsers already
// render these correctly inside a plain `white-space: pre-wrap` block with
// no extra markup, so this needs no schema change and no new renderer —
// the marked text is still just a plain string wherever it ends up (DB,
// export/import, the AI grading prompt).
const LRI = "\u2066"; // LEFT-TO-RIGHT ISOLATE
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE

export interface LineBounds {
  start: number;
  end: number;
}

/** The line containing `cursorPos` — bounded by the previous/next "\n" (or the string's edges). */
export function getLineBounds(text: string, cursorPos: number): LineBounds {
  const start = text.lastIndexOf("\n", cursorPos - 1) + 1;
  const nextBreak = text.indexOf("\n", cursorPos);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end };
}

export function isLineMarkedLtr(text: string, { start, end }: LineBounds): boolean {
  return end - start >= 2 && text[start] === LRI && text[end - 1] === PDI;
}

/** Sets the line at `cursorPos` to the given direction — a no-op if it's already there. */
export function setLineDirection(
  text: string,
  cursorPos: number,
  dir: "ltr" | "rtl",
): { text: string; cursorPos: number } {
  const alreadyThere = isLineMarkedLtr(text, getLineBounds(text, cursorPos)) === (dir === "ltr");
  return alreadyThere ? { text, cursorPos } : toggleLineDirection(text, cursorPos);
}

/** Wraps/unwraps the line at `cursorPos` in LTR isolate marks. Returns the new text and a cursor
 * position that keeps the same relative offset within the line's own content. */
function toggleLineDirection(text: string, cursorPos: number): { text: string; cursorPos: number } {
  const bounds = getLineBounds(text, cursorPos);
  const { start, end } = bounds;
  const relOffset = Math.min(Math.max(cursorPos, start), end) - start;

  if (isLineMarkedLtr(text, bounds)) {
    const content = text.slice(start + 1, end - 1);
    const newText = text.slice(0, start) + content + text.slice(end);
    const newRel = Math.min(Math.max(0, relOffset - 1), content.length);
    return { text: newText, cursorPos: start + newRel };
  }

  const content = text.slice(start, end);
  const newText = `${text.slice(0, start)}${LRI}${content}${PDI}${text.slice(end)}`;
  const newRel = Math.min(relOffset + 1, content.length + 1);
  return { text: newText, cursorPos: start + newRel };
}
