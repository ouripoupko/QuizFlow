import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly in dev so a missing .env.local is obvious immediately.
  throw new Error(
    "Missing Supabase environment variables. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

/**
 * The single browser-side Supabase client.
 *
 * It only ever uses the public anon key; Row Level Security (spec §14.2) is what
 * actually protects the data. AI provider keys never touch this client — those
 * are server-only, called through Edge Functions (spec §8).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
