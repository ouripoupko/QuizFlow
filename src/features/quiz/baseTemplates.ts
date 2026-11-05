import { t } from "@/i18n";

/** The 5 built-in grading-instruction templates (spec §5.1), in the active language. */
const IDS = ["factual", "conceptual", "reasoning", "code", "free"] as const;

export const BASE_TEMPLATES = IDS.map((id) => ({
  id,
  title: t.gradingTemplates.base[id].title,
  body: t.gradingTemplates.base[id].body,
}));

export type BaseTemplateId = (typeof IDS)[number];
