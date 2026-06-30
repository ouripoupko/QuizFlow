# QuizFlow

מבחנים מבוססי בינה מלאכותית בזמן אמת — a web app for running AI-graded quizzes in
class. See [quizflow-spec.md](./quizflow-spec.md) for the full build specification.

The UI ships in **Hebrew** and the layout is **RTL** by default.

## Stack

React + TypeScript · Vite · SCSS (CSS logical properties) · React Router ·
TanStack Query · Zustand · Zod · Supabase (Postgres, Auth, Edge Functions,
Storage, Realtime). Auth is Google OAuth via Supabase.

## Getting started

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a Supabase project at <https://supabase.com> (or run a local stack with
   the Supabase CLI: `supabase start`). Then copy the env template and fill it in:

   ```sh
   cp .env.example .env.local
   ```

   Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
   **Settings → API** in the Supabase dashboard.

3. Configure **Google OAuth** in the Supabase dashboard under
   **Authentication → Providers → Google** (create OAuth credentials in the
   Google Cloud Console, add the Supabase callback URL, and add
   `http://localhost:5173` to the redirect allow-list). For a local stack, set
   `GOOGLE_CLIENT_ID` / `GOOGLE_SECRET` before `supabase start` — see
   `supabase/config.toml`.

4. Run the dev server:

   ```sh
   npm run dev
   ```

## Project layout

```
src/
  auth/        Auth layer — Supabase session wiring + OAuth provider abstraction
  components/  Shared components (route guards, etc.)
  i18n/        Central UI strings (Hebrew). NO hard-coded text in components.
  lib/         Supabase client, TanStack Query client
  pages/       Route screens
  store/       Zustand global client state (current user / UI)
  styles/      Global SCSS + design tokens (logical properties, RTL baseline)
supabase/      Supabase config (migrations & Edge Functions added in later steps)
```

## Conventions

- **No hard-coded UI strings** — add them to `src/i18n/strings/he.ts` and read via
  `import { t } from "@/i18n"`.
- **No physical `left`/`right` in CSS** — use logical properties
  (`margin-inline-start`, `inset-inline-end`, `text-align: start`, …).
- AI provider keys are **server-only** (Supabase Vault + Edge Functions); they
  never reach the browser. See spec §8.

This is build **step 1** (scaffold) of the order in spec §14; later steps add the
data model, key management, authoring, grading, the student runtime, and the
control board.
