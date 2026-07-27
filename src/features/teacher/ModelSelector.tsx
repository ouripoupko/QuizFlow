import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import styles from "./ModelSelector.module.scss";

type ThinkingFamily = "none" | "adaptive" | "legacy";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface ModelOption {
  id: string;
  displayName: string;
  effortLevels: Effort[];
  thinkingFamily: ThinkingFamily;
}

interface CurrentSettings {
  model: string;
  model_thinking_family: ThinkingFamily;
  effort: Effort | null;
}

function useCurrentSettings() {
  return useQuery<CurrentSettings | null>({
    queryKey: ["teacher-ai-key-model"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_ai_keys")
        .select("model, model_thinking_family, effort")
        .maybeSingle();
      if (error) throw error;
      return data as CurrentSettings | null;
    },
  });
}

// Only callable once a key exists — the Edge Function authenticates to
// Anthropic with the teacher's own key to fetch the live model list.
function useModelOptions(enabled: boolean) {
  return useQuery<ModelOption[]>({
    queryKey: ["ai-model-options"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-ai-models");
      if (error) throw error;
      return (data as { models: ModelOption[] }).models;
    },
    enabled,
  });
}

export function ModelSelector() {
  const qc = useQueryClient();
  const { data: current, isLoading: currentLoading } = useCurrentSettings();
  const hasKey = !!current;

  const { data: options, isLoading: optionsLoading, isError: optionsError } =
    useModelOptions(hasKey);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort | "">("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!current) return;
    setSelectedModel(current.model);
    setEffort(current.effort ?? "");
  }, [current]);

  const selectedOption = options?.find((m) => m.id === selectedModel);
  const thinkingFamily: ThinkingFamily = selectedOption?.thinkingFamily
    ?? current?.model_thinking_family
    ?? "none";
  const effortLevels = selectedOption?.effortLevels ?? [];

  function handleModelChange(id: string) {
    setSelectedModel(id);
    // A different model can support a different effort range entirely —
    // drop a choice that no longer applies rather than silently sending
    // something the new model will reject.
    const next = options?.find((m) => m.id === id);
    if (next && !next.effortLevels.includes(effort as Effort)) setEffort("");
  }

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_teacher_ai_model", {
        _model: selectedModel,
        _thinking_family: thinkingFamily,
        _effort: effort || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFeedback({ ok: true, msg: t.teacherSettings.modelSaveSuccess });
      void qc.invalidateQueries({ queryKey: ["teacher-ai-key-model"] });
    },
    onError: () => setFeedback({ ok: false, msg: t.teacherSettings.modelSaveError }),
  });

  if (currentLoading) return null;

  const unchanged = !!current
    && selectedModel === current.model
    && (effort || null) === current.effort;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t.teacherSettings.modelSection}</h3>

      {!hasKey && <p className={styles.hint}>{t.teacherSettings.modelHintNoKey}</p>}

      {hasKey && optionsLoading && <p>{t.teacherSettings.loadingModels}</p>}
      {hasKey && optionsError && (
        <p className={styles.error}>{t.teacherSettings.modelsLoadError}</p>
      )}

      {hasKey && options && (
        <>
          <label className={styles.label}>
            {t.teacherSettings.modelLabel}
            <select
              className={styles.select}
              value={selectedModel ?? ""}
              disabled={save.isPending}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {options.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </label>

          {effortLevels.length > 0 && (
            <label className={styles.label}>
              {t.teacherSettings.effortLabel}
              <select
                className={styles.select}
                value={effort}
                disabled={save.isPending}
                onChange={(e) => setEffort(e.target.value as Effort | "")}
              >
                <option value="">{t.teacherSettings.effortNone}</option>
                {effortLevels.map((lvl) => (
                  <option key={lvl} value={lvl}>{t.teacherSettings.effortLevels[lvl]}</option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn btn--primary"
            disabled={save.isPending || !selectedModel || unchanged}
            onClick={() => {
              setFeedback(null);
              save.mutate();
            }}
          >
            {save.isPending ? t.common.save : t.teacherSettings.saveModel}
          </button>
        </>
      )}

      {feedback && (
        <p className={feedback.ok ? styles.success : styles.error}>{feedback.msg}</p>
      )}
    </section>
  );
}
