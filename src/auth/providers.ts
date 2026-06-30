import type { Provider } from "@supabase/supabase-js";

/**
 * OAuth providers the auth layer knows how to start.
 *
 * Spec §3 / §12: Google is the ONLY provider in this version, but the auth layer
 * is structured so more can be added later without reworking call sites — adding
 * a provider here (plus a button) is the whole change.
 */
export interface OAuthProviderConfig {
  /** Supabase provider id passed to signInWithOAuth. */
  id: Provider;
  /** Key into the i18n strings for this provider's button label. */
  labelKey: "signInWithGoogle";
}

export const oauthProviders: readonly OAuthProviderConfig[] = [
  { id: "google", labelKey: "signInWithGoogle" },
] as const;
