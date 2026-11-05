import { he } from "./strings/he";
import { en } from "./strings/en";
import { ar } from "./strings/ar";

/** Deep-widens the Hebrew literals to `string`, so other locales can say something else. */
type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };

/**
 * The shape every locale must satisfy. Derived from the Hebrew file so the
 * Hebrew strings ARE the contract; a locale file typed as `Strings` fails to
 * compile if it is missing a key.
 */
export type Strings = Widen<typeof he>;

export const LOCALES = ["he", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

const locales: Record<Locale, Strings> = { he, en, ar };

/** Each language's name in itself, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  he: "עברית",
  en: "English",
  ar: "العربية",
};

const STORAGE_KEY = "qf_lang";
/** URL query parameter carrying the language, e.g. …/join/abc?lang=ar. */
export const LANG_PARAM = "lang";

export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

// Resolved once at startup: the URL wins (so a shared link opens in its
// language), then the last choice on this device, then Hebrew. Switching
// language reloads the page (see switchLocale), which keeps `t` a plain
// constant everywhere instead of re-rendering the whole app.
function resolveLocale(): Locale {
  const fromUrl = new URLSearchParams(window.location.search).get(LANG_PARAM);
  if (isLocale(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage blocked (private mode etc.) — fall through to the default.
  }
  return "he";
}

export const activeLocale: Locale = resolveLocale();
try {
  localStorage.setItem(STORAGE_KEY, activeLocale);
} catch {
  // Not remembered across visits; the URL still carries it.
}

/** Central accessor for UI strings. Components read text only through this. */
export const t: Strings = locales[activeLocale];

/** Document direction for the active locale: Hebrew and Arabic are RTL. */
export const dir: "rtl" | "ltr" = activeLocale === "en" ? "ltr" : "rtl";

/** Reloads the current page in another language. */
export function switchLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The URL below still carries it.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(LANG_PARAM, locale);
  window.location.assign(url.toString());
}

/** `url` with the active language added, for links meant to be shared (join links). */
export function withLang(url: string): string {
  const u = new URL(url);
  u.searchParams.set(LANG_PARAM, activeLocale);
  return u.toString();
}

/** Fills `{name}`-style placeholders in a string. */
export function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}
