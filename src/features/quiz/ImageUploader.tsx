import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { QuestionImage } from "@/types/domain";
import styles from "./ImageUploader.module.scss";

const ZOOM_GAP_PX = 8;

interface ZoomPreview {
  url: string;
  left: number;
  // Anchored above the thumbnail by default; flipped below it when there
  // isn't enough room above (thumbnail sits in the top half of the screen).
  top: number;
  placement: "above" | "below";
}

interface Props {
  quizId: string;
  questionId: string;
  locked?: boolean;
}

interface SignedImage {
  id: string;
  storage_path: string;
  position: number;
  signedUrl: string;
}

async function getSignedUrls(images: QuestionImage[]): Promise<SignedImage[]> {
  return Promise.all(
    images.map(async (img) => {
      const { data } = await supabase.storage
        .from("question-images")
        .createSignedUrl(img.storage_path, 3600);
      return { ...img, signedUrl: data?.signedUrl ?? "" };
    }),
  );
}

export function ImageUploader({ quizId, questionId, locked = false }: Props) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState<ZoomPreview | null>(null);

  const imagesKey = ["question-images", questionId];

  const { data: images = [] } = useQuery<SignedImage[]>({
    queryKey: imagesKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_images")
        .select("*")
        .eq("question_id", questionId)
        .order("position", { ascending: true });
      if (error) throw error;
      return getSignedUrls(data as QuestionImage[]);
    },
    enabled: !!questionId,
  });

  const uploadFile = useCallback(
    async (file: File) => {
      if (locked || !file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${quizId}/${questionId}/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from("question-images")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;

        const { count } = await supabase
          .from("question_images")
          .select("*", { count: "exact", head: true })
          .eq("question_id", questionId);

        const { error: dbErr } = await supabase.from("question_images").insert({
          question_id: questionId,
          storage_path: path,
          position: count ?? 0,
        });
        if (dbErr) throw dbErr;

        await qc.invalidateQueries({ queryKey: imagesKey });
      } finally {
        setUploading(false);
      }
    },
    [quizId, questionId, qc, imagesKey, locked],
  );

  // Paste handler — captures Ctrl+V anywhere while the component is mounted.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find(
        (i) => i.type.startsWith("image/"),
      );
      if (!item) return;
      const file = item.getAsFile();
      if (file) await uploadFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadFile]);

  const deleteImage = useMutation({
    mutationFn: async (img: SignedImage) => {
      await supabase.storage.from("question-images").remove([img.storage_path]);
      await supabase.from("question_images").delete().eq("id", img.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: imagesKey }),
  });

  // Rendered via a portal to <body> (position: fixed) so it isn't clipped by
  // the question card's `overflow: hidden`, and can use the full viewport
  // rather than being confined to the card.
  function showZoom(url: string, thumb: HTMLElement) {
    const rect = thumb.getBoundingClientRect();
    const inTopHalf = rect.top < window.innerHeight / 2;
    setZoom({
      url,
      left: rect.left + rect.width / 2,
      top: inTopHalf ? rect.bottom + ZOOM_GAP_PX : rect.top - ZOOM_GAP_PX,
      placement: inTopHalf ? "below" : "above",
    });
  }

  return (
    <div className={styles.root}>
      {images.map((img) => (
        <div
          key={img.id}
          className={styles.thumb}
          onMouseEnter={(e) => showZoom(img.signedUrl, e.currentTarget)}
          onMouseLeave={() => setZoom(null)}
        >
          <div className={styles.imgWrap}>
            <img src={img.signedUrl} alt="" className={styles.img} />
          </div>
          {!locked && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => deleteImage.mutate(img)}
            >
              {t.imageUploader.deleteImage}
            </button>
          )}
        </div>
      ))}

      {!locked && (
        <label className={styles.uploadZone}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.hiddenInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <span>{t.imageUploader.uploading}</span>
          ) : (
            <span>
              {t.imageUploader.prompt}{" "}
              <span className={styles.link}>{t.imageUploader.chooseFile}</span>
            </span>
          )}
        </label>
      )}

      {zoom && createPortal(
        <img
          src={zoom.url}
          alt=""
          className={styles.zoomPreview}
          style={{
            left: zoom.left,
            top: zoom.top,
            transform: `translate(-50%, ${zoom.placement === "above" ? "-100%" : "0"})`,
          }}
        />,
        document.body,
      )}
    </div>
  );
}
