import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import styles from "./ApiKeyForm.module.scss";

type Provider = "anthropic" | "openai" | "gemini";

interface KeyMetadata {
  provider: Provider;
  updated_at: string;
}

function useKeyMetadata() {
  return useQuery<KeyMetadata | null>({
    queryKey: ["teacher-ai-key"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_ai_keys")
        .select("provider, updated_at")
        .maybeSingle();
      if (error) throw error;
      return data as KeyMetadata | null;
    },
  });
}

export function ApiKeyForm() {
  const qc = useQueryClient();
  const { data: existing, isLoading } = useKeyMetadata();

  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("upsert_teacher_ai_key", {
        _provider: provider,
        _api_key: apiKey,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setApiKey("");
      setFeedback({ ok: true, msg: t.teacherSettings.saveSuccess });
      void qc.invalidateQueries({ queryKey: ["teacher-ai-key"] });
    },
    onError: () => setFeedback({ ok: false, msg: t.teacherSettings.saveError }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_teacher_ai_key");
      if (error) throw error;
    },
    onSuccess: () => {
      setFeedback({ ok: true, msg: t.teacherSettings.deleteSuccess });
      void qc.invalidateQueries({ queryKey: ["teacher-ai-key"] });
    },
    onError: () => setFeedback({ ok: false, msg: t.teacherSettings.deleteError }),
  });

  if (isLoading) return <p>{t.common.loading}</p>;

  const busy = save.isPending || remove.isPending;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t.teacherSettings.apiKeySection}</h2>

      {existing ? (
        <div className={styles.existingBadge}>
          <span className={styles.dot} />
          {t.teacherSettings.hasKey} — {t.teacherSettings.providers[existing.provider]}
          <span className={styles.muted}>
            {" · "}{t.teacherSettings.lastUpdated}{" "}
            {new Date(existing.updated_at).toLocaleDateString("he-IL")}
          </span>
        </div>
      ) : (
        <p className={styles.noKey}>{t.teacherSettings.noKey}</p>
      )}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          setFeedback(null);
          save.mutate();
        }}
      >
        <label className={styles.label}>
          {t.teacherSettings.providerLabel}
          <select
            className={styles.select}
            value={provider}
            disabled={busy}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            <option value="anthropic">{t.teacherSettings.providers.anthropic}</option>
            <option value="openai">{t.teacherSettings.providers.openai}</option>
            <option value="gemini">{t.teacherSettings.providers.gemini}</option>
          </select>
        </label>

        <label className={styles.label}>
          {t.teacherSettings.apiKeyLabel}
          <input
            type="password"
            className={styles.input}
            placeholder={t.teacherSettings.apiKeyPlaceholder}
            value={apiKey}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className={styles.hint}>{t.teacherSettings.apiKeyHint}</span>
        </label>

        <div className={styles.actions}>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !apiKey.trim()}
          >
            {t.teacherSettings.saveKey}
          </button>

          {existing && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t.teacherSettings.deleteConfirm)) {
                  setFeedback(null);
                  remove.mutate();
                }
              }}
            >
              {t.teacherSettings.deleteKey}
            </button>
          )}
        </div>

        {feedback && (
          <p className={feedback.ok ? styles.success : styles.error}>
            {feedback.msg}
          </p>
        )}
      </form>
    </section>
  );
}
