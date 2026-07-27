import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { BASE_TEMPLATES } from "./baseTemplates";
import type { GradingTemplate } from "@/types/domain";
import styles from "./GradingInstructionEditor.module.scss";

interface Props {
  value: string;
  onChange: (v: string) => void;
  locked?: boolean;
}

const CUSTOM_ID = "__custom__";

export function GradingInstructionEditor({ value, onChange, locked = false }: Props) {
  const qc = useQueryClient();
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string>(CUSTOM_ID);

  const { data: personalTemplates = [] } = useQuery<GradingTemplate[]>({
    queryKey: ["grading-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grading_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as GradingTemplate[];
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("grading_templates").insert({
        title: newTitle.trim(),
        body: value,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["grading-templates"] });
      setNewTitle("");
      setShowSaveForm(false);
    },
  });

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSelectedId(id);
    if (id === CUSTOM_ID) return;

    const base = BASE_TEMPLATES.find((t) => t.id === id);
    if (base) { onChange(base.body); return; }

    const personal = personalTemplates.find((t) => t.id === id);
    if (personal) onChange(personal.body);
  }

  return (
    <div className={styles.root}>
      <select
        className={styles.select}
        value={selectedId}
        disabled={locked}
        onChange={handleSelect}
      >
        <option value={CUSTOM_ID}>{t.gradingTemplates.selectPlaceholder}</option>
        <optgroup label={t.gradingTemplates.baseGroup}>
          {BASE_TEMPLATES.map((tmpl) => (
            <option key={tmpl.id} value={tmpl.id}>{tmpl.title}</option>
          ))}
        </optgroup>
        {personalTemplates.length > 0 && (
          <optgroup label={t.gradingTemplates.myGroup}>
            {personalTemplates.map((tmpl) => (
              <option key={tmpl.id} value={tmpl.id}>{tmpl.title}</option>
            ))}
          </optgroup>
        )}
      </select>

      <textarea
        className={styles.textarea}
        value={value}
        rows={4}
        disabled={locked}
        onChange={(e) => {
          setSelectedId(CUSTOM_ID);
          onChange(e.target.value);
        }}
      />

      {locked ? null : !showSaveForm ? (
        <button
          type="button"
          className={styles.saveLink}
          onClick={() => setShowSaveForm(true)}
        >
          {t.gradingTemplates.savePersonal}
        </button>
      ) : (
        <div className={styles.saveForm}>
          <input
            type="text"
            className={styles.titleInput}
            placeholder={t.gradingTemplates.templateTitlePlaceholder}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!newTitle.trim() || saveTemplate.isPending}
            onClick={() => saveTemplate.mutate()}
          >
            {t.gradingTemplates.saveTemplateButton}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowSaveForm(false)}
          >
            {t.gradingTemplates.cancelSave}
          </button>
        </div>
      )}
    </div>
  );
}
