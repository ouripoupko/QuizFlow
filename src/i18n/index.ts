import { he } from "./strings/he";

/**
 * The shape every locale must satisfy. Derived from the Hebrew file so the
 * Hebrew strings ARE the contract; a future `en.ts` typed as `Strings` will
 * fail to compile if it is missing a key.
 */
export type Strings = typeof he;

export type Locale = "he";

const locales: Record<Locale, Strings> = {
  he,
};

// Hebrew is the only shipped locale (spec §11). The indirection exists so adding
// a locale later is a one-line change here, not a sweep through components.
export const activeLocale: Locale = "he";

/** Central accessor for UI strings. Components read text only through this. */
export const t: Strings = locales[activeLocale];

/** Document direction for the active locale. Hebrew is RTL (spec §11). */
export const dir: "rtl" | "ltr" = "rtl";
