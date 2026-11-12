import { supabase } from "@/lib/supabase";
import { ANSWER_KEY_IMAGES_BUCKET } from "@/lib/answerKeyImages";
import type { FlowMode, Question, QuestionPart, Quiz } from "@/types/domain";

// Portable quiz format — only fields that make sense on a different account
// are included (no ids, ownership, status, timestamps, or topic placement;
// those are either regenerated or reset to their defaults on import).
//
// Version history — every older version must keep importing unchanged:
//   1: original format.
//   2: adds the optional `parts` array per question (multi-part questions).
//      A version-1 file simply has no `parts`, i.e. every question is a
//      question without parts.
//   3: adds the optional `allow_answer_image` flag on questions and parts.
//      Absent in older files, meaning "no".
//   4: adds the optional `correct_answer_image` on questions and parts (the
//      correct answer's image). Absent in older files, meaning none.
const EXPORT_FORMAT = "quizflow-quiz";
const EXPORT_FORMAT_VERSION = 4;

interface QuizExportImage {
  position: number;
  media_type: string;
  /** Base64-encoded file contents, no "data:" prefix. */
  data: string;
}

interface QuizExportPart {
  position: number;
  prompt: string;
  correct_answer: string | null;
  /** Absent before version 3. */
  allow_answer_image?: boolean;
  /** Absent before version 4; null when the answer has no image. */
  correct_answer_image?: QuizExportAnswerImage | null;
}

/** An answer-key image, embedded like question images. */
interface QuizExportAnswerImage {
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
  /** Absent before version 3. */
  allow_answer_image?: boolean;
  /** Absent before version 4; null when the answer has no image. */
  correct_answer_image?: QuizExportAnswerImage | null;
  /** Absent in version-1 files; empty for a question without parts. */
  parts?: QuizExportPart[];
}

interface QuizExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: 1 | 2 | 3 | typeof EXPORT_FORMAT_VERSION;
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

async function exportAnswerKeyImage(path: string | null): Promise<QuizExportAnswerImage | null> {
  if (!path) return null;
  const { data: blob } = await supabase.storage.from(ANSWER_KEY_IMAGES_BUCKET).download(path);
  if (!blob) return null;
  return {
    media_type: blob.type || "image/jpeg",
    data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
  };
}

async function importAnswerKeyImage(
  quizId: string,
  questionId: string,
  image: QuizExportAnswerImage | null | undefined,
): Promise<string | null> {
  if (!image) return null;
  const ext = EXTENSION_BY_MEDIA_TYPE[image.media_type] ?? "jpg";
  const path = `${quizId}/${questionId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(ANSWER_KEY_IMAGES_BUCKET)
    .upload(path, base64ToBytes(image.data), { contentType: image.media_type, upsert: false });
  if (error) throw error;
  return path;
}

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

      const { data: partRows } = await supabase
        .from("question_parts")
        .select("position, prompt, correct_answer, allow_answer_image, correct_answer_image_path")
        .eq("question_id", q.id)
        .order("position", { ascending: true });
      const parts: QuizExportPart[] = await Promise.all(((partRows ?? []) as Pick<
        QuestionPart,
        "position" | "prompt" | "correct_answer" | "allow_answer_image" | "correct_answer_image_path"
      >[]).map(async (p) => ({
        position: p.position,
        prompt: p.prompt,
        correct_answer: p.correct_answer,
        allow_answer_image: p.allow_answer_image,
        correct_answer_image: await exportAnswerKeyImage(p.correct_answer_image_path),
      })));

      return {
        position: q.position,
        prompt: q.prompt,
        correct_answer: q.correct_answer,
        grading_instructions: q.grading_instructions,
        images,
        allow_answer_image: q.allow_answer_image,
        correct_answer_image: await exportAnswerKeyImage(q.correct_answer_image_path),
        parts,
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
  // `parts` is optional (absent before version 2), but must be a list if present.
  if (v.questions.some((q) =>
    typeof q === "object" && q !== null && "parts" in q
    && !Array.isArray((q as Record<string, unknown>).parts)
  )) return false;
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
        allow_answer_image: q.allow_answer_image ?? false,
      })
      .select("id")
      .single();
    if (qErr) throw qErr;
    const questionId = questionRow.id as string;

    // The answer image's path includes the new question's id, so it's
    // uploaded after the insert and attached with an update.
    const answerImagePath = await importAnswerKeyImage(quizId, questionId, q.correct_answer_image);
    if (answerImagePath) {
      const { error: aiErr } = await supabase
        .from("questions")
        .update({ correct_answer_image_path: answerImagePath })
        .eq("id", questionId);
      if (aiErr) throw aiErr;
    }

    // Same as questions: inserted one by one in original order, `position`
    // omitted — the append trigger reproduces the sequence.
    const sortedParts = [...(q.parts ?? [])].sort((a, b) => a.position - b.position);
    for (const part of sortedParts) {
      const { error: partErr } = await supabase.from("question_parts").insert({
        question_id: questionId,
        prompt: part.prompt,
        correct_answer: part.correct_answer,
        allow_answer_image: part.allow_answer_image ?? false,
        correct_answer_image_path: await importAnswerKeyImage(quizId, questionId, part.correct_answer_image),
      });
      if (partErr) throw partErr;
    }

    // In original order, `position` omitted — the append trigger reproduces it.
    const sortedImages = [...q.images].sort((a, b) => a.position - b.position);
    for (const img of sortedImages) {
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
      });
      if (imgErr) throw imgErr;
    }
  }

  return quizId;
}
