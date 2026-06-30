import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";

/** Where the initial session check stands. */
export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Called by the auth listener whenever Supabase reports a session change. */
  setSession: (session: Session | null) => void;
}

/**
 * The small slice of truly-global client state (spec §3): who is signed in.
 * Everything else is server state in TanStack Query.
 */
export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  session: null,
  user: null,
  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
      status: session ? "authenticated" : "anonymous",
    }),
}));
