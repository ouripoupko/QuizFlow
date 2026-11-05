// A question's images, fetched server-side (not via signed URL) so the
// teacher's key never has to leave the server and we don't depend on
// Anthropic being able to reach a Supabase URL. Shared by grade-answer and
// ask-ai, which both send them numbered ("תמונה 1", "תמונה 2"…) in display
// order, so a prompt or a part can refer to a specific image.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

type TextBlock = { type: "text"; text: string };

// Chunked to avoid blowing the call stack on String.fromCharCode(...bytes)
// for larger images (bucket allows up to 10 MB).
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function mediaTypeFor(path: string, blobType: string): string {
  if (blobType.startsWith("image/")) return blobType;
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export async function loadQuestionImageBlocks(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  questionId: string,
): Promise<ImageBlock[]> {
  const { data: images } = await supabase
    .from("question_images")
    .select("storage_path")
    .eq("question_id", questionId)
    .order("position", { ascending: true });

  const blocks: ImageBlock[] = [];
  for (const img of (images ?? []) as { storage_path: string }[]) {
    const block = await loadStorageImageBlock(supabase, "question-images", img.storage_path);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** One stored image as a base64 image block, or null if it can't be downloaded. */
export async function loadStorageImageBlock(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  bucket: string,
  path: string,
): Promise<ImageBlock | null> {
  const { data: blob } = await supabase.storage.from(bucket).download(path);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaTypeFor(path, blob.type),
      data: toBase64(bytes),
    },
  };
}

/**
 * Message content: each question image preceded by its number, then the
 * student's answer image if any (labelled separately, so it can't be
 * mistaken for "image N" of the question), then the prompt text.
 */
export function contentWithNumberedImages(
  images: ImageBlock[],
  text: string,
  studentImage: ImageBlock | null = null,
): string | Array<TextBlock | ImageBlock> {
  if (images.length === 0 && !studentImage) return text;
  return [
    ...images.flatMap((img, i): Array<TextBlock | ImageBlock> => [
      { type: "text", text: `תמונה ${i + 1}:` },
      img,
    ]),
    ...(studentImage
      ? [{ type: "text", text: "תמונת התלמיד (חלק מתשובתו):" } as TextBlock, studentImage]
      : []),
    { type: "text", text },
  ];
}

/** The prompt line telling the AI how the images are numbered (empty when there are none). */
export function imageNumberingNote(imageCount: number): string {
  if (imageCount === 0) return "";
  if (imageCount === 1) return "לשאלה מצורפת תמונה אחת (תמונה 1).";
  return `לשאלה מצורפות ${imageCount} תמונות, ממוספרות לפי הסדר (תמונה 1 עד תמונה ${imageCount}).`;
}

/**
 * Copy of a request body with every image's base64 data replaced by a short
 * placeholder — the stored audit copy (responses.ai_request) would otherwise
 * carry megabytes of image data per answer.
 */
export function redactImageData(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body), (_key, value) => {
    if (
      value && typeof value === "object" && value.type === "base64" &&
      typeof value.data === "string"
    ) {
      return { ...value, data: `[${value.data.length} base64 chars omitted]` };
    }
    return value;
  });
}
