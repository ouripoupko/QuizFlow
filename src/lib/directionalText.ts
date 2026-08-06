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

/** Whether `cursorPos` currently sits inside an LRI…PDI isolate on its line. Walks the
 * line's marks up to the cursor and tracks isolate depth, rather than assuming the whole
 * line is exactly one wrapped span — a plain start/end boundary check breaks as soon as
 * you type past the closing PDI (still the same paragraph to the user) or a line ends up
 * with more than one marked run in it. */
export function isLineMarkedLtr(text: string, cursorPos: number): boolean {
  const { start, end } = getLineBounds(text, cursorPos);
  const relPos = Math.min(Math.max(cursorPos, start), end) - start;
  const parts = text.slice(start, end).split(/([\u2066\u2069])/);

  let depth = 0;
  let offset = 0;
  for (const part of parts) {
    if (offset >= relPos) break;
    if (part === LRI) depth++;
    else if (part === PDI) depth = Math.max(0, depth - 1);
    offset += part.length;
  }
  return depth > 0;
}

const MARKS = /[\u2066\u2069]/g;

/** Sets the line at `cursorPos` to the given direction — a no-op if it's already there.
 * Always normalizes: strips every isolate mark already on the line, then re-wraps only
 * if the target is LTR. This is self-healing against a line left in an inconsistent
 * state by a previous edit (e.g. typing past a closing PDI, or a stray extra pair),
 * rather than trying to detect and patch one specific expected prior shape. */
export function setLineDirection(
  text: string,
  cursorPos: number,
  dir: "ltr" | "rtl",
): { text: string; cursorPos: number } {
  if (isLineMarkedLtr(text, cursorPos) === (dir === "ltr")) return { text, cursorPos };

  const { start, end } = getLineBounds(text, cursorPos);
  const relOffset = Math.min(Math.max(cursorPos, start), end) - start;
  const line = text.slice(start, end);

  const marksBeforeCursor = (line.slice(0, relOffset).match(MARKS) ?? []).length;
  const clean = line.replace(MARKS, "");
  const cleanRel = relOffset - marksBeforeCursor;

  const newLine = dir === "ltr" ? `${LRI}${clean}${PDI}` : clean;
  const newRel = dir === "ltr" ? cleanRel + 1 : cleanRel;

  return { text: text.slice(0, start) + newLine + text.slice(end), cursorPos: start + newRel };
}
