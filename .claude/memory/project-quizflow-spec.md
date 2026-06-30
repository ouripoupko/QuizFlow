---
name: project-quizflow-spec
description: "QuizFlow build specification — app overview, roles, and tech stack decisions"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# QuizFlow Build Specification

QuizFlow is a web app for teachers to run AI-graded quizzes in real time in class.

## Core Loop
1. Teacher authors a quiz (sequence of questions)
2. Teacher distributes a link in class
3. Students answer questions one at a time
4. Each answer is sent to an LLM for pass/fail grading
5. Student either blocked until approved (strict mode) or always advances (free mode)
6. Teacher watches a live control board (student positions + mistakes)
7. Quizzes live in a shared hierarchical topic tree; teachers can group into courses

## Roles
- **Student**: joins via link, answers questions
- **Teacher**: authors quizzes, runs them, owns AI provider key, watches board, manages courses
- **Admin**: approves proposed topic-tree branches (delegatable role, not fixed identity)
- A single user may hold multiple roles

## Tech Stack (DECISIONS — do not deviate)
**Frontend:**
- React + TypeScript
- Vite (build tool)
- SCSS — CSS logical properties throughout (`margin-inline-start`, never `margin-left`)
- React Router
- TanStack Query (server state, caching, realtime sync)
- Zustand (minimal global client state: current user, UI state)
- Zod (runtime validation, especially AI output)
- NO Redux

**Backend:**
- Supabase — Postgres, Auth, Edge Functions, Storage, Realtime

**Auth:**
- Google OAuth only (one-click). Structure so additional providers can be added later.

## UI & i18n Posture (§11) — DECISION
- App ships **Hebrew only**. No English translation.
- All UI strings in a **central strings file** — no Hebrew text hard-coded inside JSX/components. This makes a future locale drop-in possible at near-zero cost.
- Layout is **RTL** as the baseline (not an add-on). Use **CSS logical properties** everywhere: `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, etc. Never use physical `left`/`right`.
- Do **not** translate user content (quizzes, questions, feedback) — that is teacher/student content, not app i18n.

## Explicitly Deferred — Do NOT Build (§13)
- **Payments / paid private quizzes** — no `private-paid` lifecycle state, no payment UI; just don't block it architecturally
- **Multiple AI providers active** — adapter interface yes, but only Anthropic implemented
- **Per-use provider routing** — one provider per teacher only
- **Image generation** and **student image submission**
- **Additional auth providers** beyond Google

## Build Order (§14)
1. Project scaffold: Vite + React + TS + SCSS (RTL baseline, logical properties, central strings file); Supabase project; Google OAuth
2. Data model & migrations: users/roles, topic tree (+Unsorted node + pending branches), quizzes (lifecycle), questions, courses, student responses; Row Level Security
3. Teacher key management: encrypted storage (Vault/pgsodium) + Edge Function skeleton that reads it server-side
4. Quiz authoring: question editor (text + code, image upload to Storage), correct-answer + grading-instructions fields, templates + personal templates, "ask AI for the correct answer"
5. Edge Function grading path: provider adapter (Anthropic first), full-answer-sequence input, Zod-validated `AiGradingResult` output
6. Student runtime: join via link, answer flow, the two flow modes, blocking/advancing logic
7. Live control board (Supabase Realtime): student positions, statuses, mistakes, teacher resolve/push actions
8. Topic tree browse/filter + clone-to-own + branch proposal/admin approval
9. Courses + longitudinal dashboard (Postgres aggregate queries/views)

**Why:** Spec defines this order to sequence dependencies correctly (auth before data model, data model before features).
**How to apply:** Follow this order when scaffolding. Don't skip ahead to later steps without completing earlier ones.
