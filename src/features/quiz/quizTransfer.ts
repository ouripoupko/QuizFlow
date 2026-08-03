import { supabase } from "@/lib/supabase";
import type { FlowMode, Question, Quiz } from "@/types/domain";

// Portable quiz format — only fields that make sense on a different account
// are included (no ids, ownership, status, timestamps, or topic placement;
// those are either regenerated or reset to their defaults on import).
const EXPORT_FORMAT = "quizflow-quiz";
const EXPORT_FORMAT_VERSION = 1;

interface QuizExportImage {
  position: number;
  media_type: string;
  /** Base64-encoded file contents, no "data:" prefix. */
  data: string;
}

interface QuizExportQuestion {
  position: number;
  prompt: string;
  correct_answer: string | null;
  grading_instructions: string;
  images: QuizExportImage[];
}

interface QuizExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  quiz: {
    title: string;
    description: string;
    flow_mode: FlowMode;
  };
  questions: QuizExportQuestion[];
}

// Chunked to avoid blowing the call stack on String.fromCharCode(...bytes)
// for larger images.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function exportQuizToFile(quiz: Quiz, questions: Question[]): Promise<void> {
  const exportQuestions: QuizExportQuestion[] = await Promise.all(
    questions.map(async (q) => {
      const { data: imageRows } = await supabase
        .from("question_images")
        .select("storage_path, position")
        .eq("question_id", q.id)
        .order("position", { ascending: true });

      const images: QuizExportImage[] = [];
      for (const row of (imageRows ?? []) as { storage_path: string; position: number }[]) {
        const { data: blob } = await supabase.storage
          .from("question-images")
          .download(row.storage_path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        images.push({
          position: row.position,
          media_type: blob.type || "image/jpeg",
          data: bytesToBase64(bytes),
        });
      }

      return {
        position: q.position,
        prompt: q.prompt,
        correct_answer: q.correct_answer,
        grading_instructions: q.grading_instructions,
        images,
      };
    }),
  );

  const file: QuizExportFile = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    quiz: {
      title: quiz.title,
      description: quiz.description,
      flow_mode: quiz.flow_mode,
    },
    questions: exportQuestions,
  };

  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${quiz.title || "quiz"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isValidExportFile(value: unknown): value is QuizExportFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.format !== EXPORT_FORMAT || typeof v.quiz !== "object" || v.quiz === null) return false;
  if (!Array.isArray(v.questions)) return false;
  const quiz = v.quiz as Record<string, unknown>;
  return typeof quiz.title === "string" && typeof quiz.description === "string";
}

/** Parses and validates a picked file; throws with a user-facing-safe message on failure. */
export async function parseQuizExportFile(file: File): Promise<QuizExportFile> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
  if (!isValidExportFile(parsed)) throw new Error("invalid_format");
  return parsed;
}

/** Creates a new quiz (owned by `creatorId`) from a parsed export file. Returns the new quiz id. */
export async function importQuizFromFile(file: QuizExportFile, creatorId: string): Promise<string> {
  const { data: quizRow, error: quizErr } = await supabase
    .from("quizzes")
    .insert({
      creator_id: creatorId,
      title: file.quiz.title,
      description: file.quiz.description,
      flow_mode: file.quiz.flow_mode,
    })
    .select("id")
    .single();
  if (quizErr) throw quizErr;
  const quizId = quizRow.id as string;

  const sortedQuestions = [...file.questions].sort((a, b) => a.position - b.position);

  // Inserted sequentially, in original order — `position` is intentionally
  // omitted, a DB trigger always appends at the end of the quiz (see
  // supabase/migrations/20260803120000_question_position_integrity.sql), so
  // inserting in order reproduces the original sequence.
  for (const q of sortedQuestions) {
    const { data: questionRow, error: qErr } = await supabase
      .from("questions")
      .insert({
        quiz_id: quizId,
        prompt: q.prompt,
        correct_answer: q.correct_answer,
        grading_instructions: q.grading_instructions,
      })
      .select("id")
      .single();
    if (qErr) throw qErr;
    const questionId = questionRow.id as string;

    for (const img of q.images) {
      const ext = EXTENSION_BY_MEDIA_TYPE[img.media_type] ?? "jpg";
      const path = `${quizId}/${questionId}/${crypto.randomUUID()}.${ext}`;
      const bytes = base64ToBytes(img.data);
      const { error: upErr } = await supabase.storage
        .from("question-images")
        .upload(path, bytes, { contentType: img.media_type, upsert: false });
      if (upErr) throw upErr;

      const { error: imgErr } = await supabase.from("question_images").insert({
        question_id: questionId,
        storage_path: path,
        position: img.position,
      });
      if (imgErr) throw imgErr;
    }
  }

  return quizId;
}
