import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import type { QuestionImage } from "@/types/domain";
import styles from "./ImageUploader.module.scss";

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

  return (
    <div className={styles.root}>
      {images.map((img) => (
        <div key={img.id} className={styles.thumb}>
          <img src={img.signedUrl} alt="" className={styles.img} />
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
    </div>
  );
}
