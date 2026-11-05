import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Student answer images (one per answer, optional — see
 * supabase/migrations/20261106120000_student_answer_images.sql). Private
 * bucket; path {participant_id}/{uuid}.jpg, which is what its policies check.
 */
export const ANSWER_IMAGES_BUCKET = "answer-images";

// Anthropic downscales anything larger before the model sees it, so bigger
// uploads would only cost upload time on a phone.
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

/** Shrinks a picked/pasted image to at most MAX_DIMENSION and re-encodes it as JPEG. */
async function downscale(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // JPEG has no transparency — paint white under transparent PNGs/screenshots.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** Downscales and uploads a student's image; returns its storage path. */
export async function uploadAnswerImage(participantId: string, file: Blob): Promise<string> {
  const blob = await downscale(file);
  const path = `${participantId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(ANSWER_IMAGES_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

/** A short-lived URL to show a stored answer image (null while loading or on failure). */
export function useAnswerImageUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let cancelled = false;
    void supabase.storage
      .from(ANSWER_IMAGES_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => { cancelled = true; };
  }, [path]);
  return url;
}
