import { activeLocale, LOCALE_NAMES, LOCALES, switchLocale, t, type Locale } from "@/i18n";
import styles from "./LanguageSwitcher.module.scss";

// Reloads the page in the chosen language (the URL then carries ?lang=…,
// so the current address can be shared as-is).
export function LanguageSwitcher() {
  return (
    <select
      className={styles.select}
      value={activeLocale}
      aria-label={t.common.languageLabel}
      title={t.common.languageLabel}
      onChange={(e) => switchLocale(e.target.value as Locale)}
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {LOCALE_NAMES[locale]}
        </option>
      ))}
    </select>
  );
}
