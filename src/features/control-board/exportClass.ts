import { zipSync } from "fflate";
import { supabase } from "@/lib/supabase";
import { ANSWER_IMAGES_BUCKET } from "@/lib/answerImages";
import { activeLocale, t } from "@/i18n";
import type { Question, QuestionPart, Response as DbResponse } from "@/types/domain";
import type { ParticipantDisplay } from "./ParticipantCard";

/**
 * The whole class as a CSV — or, when students attached images, a ZIP with
 * the CSV and an images/ folder.
 *
 * Layout: one column per question (per part, on a multi-part question);
 * a student's row N holds the Nth attempt at each one, so a student with
 * retries gets extra rows where only the retried cells are filled. Name is
 * repeated on every row (sorting keeps them together); the per-student
 * totals are on the first row only.
 */

interface Step {
  key: string; // part id, or question id for a question without parts
  header: string;
  /** For image file names: "שאלה 2 סעיף 1". */
  fileLabel: string;
}

function stepsOf(questions: Question[], partsByQuestion: Record<string, QuestionPart[]>): Step[] {
  return questions.flatMap((q) => {
    const parts = partsByQuestion[q.id] ?? [];
    const qLabel = `${t.controlBoard.questionN} ${q.position + 1}`;
    if (parts.length === 0) return [{ key: q.id, header: qLabel, fileLabel: qLabel }];
    return parts.map((p) => {
      const pLabel = `${t.controlBoard.partN} ${p.position + 1}`;
      return { key: p.id, header: `${qLabel} · ${pLabel}`, fileLabel: `${qLabel} ${pLabel}` };
    });
  });
}

const stepKeyOf = (r: DbResponse) => r.part_id ?? r.question_id;

/** Answered / passed per question: a multi-part question counts once, when every part qualifies. */
function countQuestions(
  answers: DbResponse[],
  questions: Question[],
  partsByQuestion: Record<string, QuestionPart[]>,
  qualifies: (r: DbResponse) => boolean,
): number {
  const keys = new Set(answers.filter(qualifies).map(stepKeyOf));
  return questions.filter((q) => {
    const parts = partsByQuestion[q.id] ?? [];
    return parts.length === 0 ? keys.has(q.id) : parts.every((p) => keys.has(p.id));
  }).length;
}

function statusLabel(status: ParticipantDisplay["status"]): string {
  if (status === "waiting") return t.controlBoard.statusWaiting;
  if (status === "done") return t.controlBoard.statusDone;
  return t.controlBoard.statusAnswering;
}

// RFC 4180: quote every field, double any quote inside.
function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Characters Windows/macOS don't allow in file names.
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "-";
}

function timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportClass(
  quizTitle: string,
  displays: ParticipantDisplay[],
  questions: Question[],
  partsByQuestion: Record<string, QuestionPart[]>,
): Promise<void> {
  const steps = stepsOf(questions, partsByQuestion);
  const students = [...displays].sort((a, b) =>
    a.participant.display_name.localeCompare(b.participant.display_name, activeLocale)
  );

  // Image file per storage path (a retry that kept its image shares the path).
  const imageFiles = new Map<string, string>();
  const usedNames = new Set<string>();
  function imageFileFor(path: string, student: string, step: Step, attempt: number, attemptsAtStep: number) {
    const existing = imageFiles.get(path);
    if (existing) return existing;
    const base = safeFileName(
      `${student} - ${step.fileLabel}${attemptsAtStep > 1 ? ` (${t.controlBoard.exportAttempt} ${attempt})` : ""}`,
    );
    let name = `${base}.jpg`;
    // Two students with the same name, say.
    for (let i = 2; usedNames.has(name); i++) name = `${base} (${i}).jpg`;
    usedNames.add(name);
    const file = `images/${name}`;
    imageFiles.set(path, file);
    return file;
  }

  const header = [
    t.controlBoard.exportStudent,
    t.controlBoard.exportAnswered,
    t.controlBoard.exportPassed,
    t.controlBoard.exportAttempts,
    t.controlBoard.statusColumnHeader,
    ...steps.map((s) => s.header),
  ];
  const rows: (string | number)[][] = [header];

  for (const d of students) {
    const name = d.participant.display_name;
    const byStep = new Map<string, DbResponse[]>();
    for (const a of d.answers) {
      const list = byStep.get(stepKeyOf(a)) ?? [];
      list.push(a);
      byStep.set(stepKeyOf(a), list);
    }
    for (const list of byStep.values()) list.sort((a, b) => a.attempt_number - b.attempt_number);

    const rowCount = Math.max(1, ...[...byStep.values()].map((l) => l.length));
    for (let i = 0; i < rowCount; i++) {
      const first = i === 0;
      rows.push([
        name,
        first ? countQuestions(d.answers, questions, partsByQuestion, () => true) : "",
        first ? countQuestions(d.answers, questions, partsByQuestion, (r) => r.decision === "pass") : "",
        first ? d.answers.length : "",
        first ? statusLabel(d.status) : "",
        ...steps.map((step) => {
          const attempts = byStep.get(step.key) ?? [];
          const a = attempts[i];
          if (!a) return "";
          if (!a.answer_image_path) return a.answer_text;
          const file = imageFileFor(a.answer_image_path, name, step, a.attempt_number, attempts.length);
          const marker = `[${t.controlBoard.exportImage}: ${file}]`;
          return a.answer_text ? `${a.answer_text}\n${marker}` : marker;
        }),
      ]);
    }
  }

  // BOM so Excel reads the file as UTF-8 (Hebrew), CRLF line ends.
  const csv = "﻿" + rows.map((r) => r.map(csvField).join(",")).join("\r\n");
  const baseName = safeFileName(`${quizTitle || "quiz"} ${timestamp(new Date())}`);

  if (imageFiles.size === 0) {
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
    return;
  }

  const entries: Record<string, Uint8Array> = {
    [`${baseName}.csv`]: new TextEncoder().encode(csv),
  };
  await Promise.all(
    [...imageFiles].map(async ([path, file]) => {
      const { data } = await supabase.storage.from(ANSWER_IMAGES_BUCKET).download(path);
      if (data) entries[file] = new Uint8Array(await data.arrayBuffer());
    }),
  );
  // JPEGs are already compressed; level 0 just stores them (fast).
  const zip = zipSync(entries, { level: 0 });
  download(new Blob([zip], { type: "application/zip" }), `${baseName}.zip`);
}
