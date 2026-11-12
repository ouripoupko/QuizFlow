import { supabase } from "@/lib/supabase";
import { downscaleToJpeg } from "@/lib/answerImages";

/**
 * The teacher's correct-answer images (one per question or part — see
 * supabase/migrations/20261112130000_answer_key_images.sql). Private bucket,
 * readable only by the quiz's creator (and the Edge Functions), so students
 * can't reach them. Path: {quiz_id}/{question_id}/{uuid}.jpg.
 */
export const ANSWER_KEY_IMAGES_BUCKET = "answer-key-images";

/** Downscales and uploads an answer-key image; returns its storage path. */
export async function uploadAnswerKeyImage(quizId: string, questionId: string, file: Blob): Promise<string> {
  const blob = await downscaleToJpeg(file);
  const path = `${quizId}/${questionId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(ANSWER_KEY_IMAGES_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

// Rendered size of an AI-drawn diagram (long side), before downscaling.
const SVG_RENDER_SIZE = 1200;

/**
 * Turns the SVG text the AI drew into a PNG blob. The SVG is only ever
 * drawn through an <img> (browsers sandbox SVG there: no scripts, no
 * external loads) and never inserted into the page.
 */
export async function svgToPng(svg: string): Promise<Blob> {
  // Size from the viewBox (or width/height), scaled so the long side is
  // SVG_RENDER_SIZE — an SVG with no intrinsic size would otherwise draw at 0×0.
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const viewBox = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  let w = viewBox?.[2] || parseFloat(root.getAttribute("width") ?? "") || 800;
  let h = viewBox?.[3] || parseFloat(root.getAttribute("height") ?? "") || 600;
  const scale = SVG_RENDER_SIZE / Math.max(w, h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  const sized = new XMLSerializer().serializeToString(root);

  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("svg render failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
