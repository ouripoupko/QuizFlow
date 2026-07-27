import type { Provider } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

/**
 * Wire Supabase auth into the global store. Call once at app startup.
 * Returns an unsubscribe function.
 */
export function initAuth(): () => void {
  const { setSession } = useAuthStore.getState();

  // Seed from any persisted session, then keep in sync with auth events.
  void supabase.auth.getSession().then(({ data }) => setSession(data.session));

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
  });

  return () => subscription.unsubscribe();
}

/**
 * Start an OAuth sign-in. Provider-agnostic on purpose (spec §3): the UI passes
 * a provider id and never hard-codes Google-specific logic.
 */
export async function signInWithProvider(provider: Provider): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // BASE_URL carries the "/QuizFlow/" prefix on GitHub Pages (see
      // vite.config.ts) — without it the post-login redirect would land on
      // the bare domain root, which has no app mounted there.
      redirectTo: window.location.origin + import.meta.env.BASE_URL,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
