# QuizFlow — Build Specification

> This document is a build prompt for an AI coding assistant. Build the application described below. Where a decision is marked **DECISION**, it is final — do not deviate. Where something is marked **DEFER**, scaffold for it but do not implement it in this version.

---

## 1. What we are building

QuizFlow is a web application that helps a teacher run **AI-graded quizzes** in class, in real time.

The core loop:

1. A teacher authors a quiz (a sequence of questions).
2. In class, the teacher distributes a link to the quiz.
3. Each student opens the link and answers the questions one at a time.
4. Every student answer is sent to an LLM, which decides whether it passes.
5. Depending on the quiz's flow mode, the student is either blocked on a question until the AI (or the teacher) approves, or always advances.
6. The teacher watches a **live control board** showing where every student is and what mistakes they made.
7. Quizzes live in a shared, hierarchical topic tree. Teachers can group quizzes into **courses** that run across a semester, with a longitudinal tracking dashboard.

The app UI language is **Hebrew**. The layout is therefore **RTL** by default.

---

## 2. Roles

There are exactly three roles:

- **Student** — joins a quiz via link, answers questions.
- **Teacher** — authors quizzes, runs them in class, owns an AI provider key, watches the control board, manages courses.
- **Admin** — approves proposed topic-tree branches. Initially this is one person (the app owner), but treat "admin" as a **role**, not a fixed identity, so it can be delegated later.

A single authenticated user may hold more than one role (a teacher is also an admin in early deployment).

---

## 3. Technology stack

**DECISION — do not substitute without strong reason.**

Frontend:
- React + TypeScript
- Vite (build tool)
- SCSS (styling — use CSS **logical properties** throughout, e.g. `margin-inline-start`, never `margin-left`; see §11)
- React Router (routing)
- TanStack Query (server state: fetching, caching, realtime sync)
- Zustand (the small amount of truly-global client state: current user, UI state)
- Zod (runtime validation of data shapes — **especially the AI's output**, see §8)

> Note: We are deliberately **not** using Redux. Almost all state in this app is server state living in Supabase; TanStack Query handles it with far less boilerplate, and Zustand covers the small global-client remainder.

Backend / infrastructure:
- **Supabase** — Postgres (database), Auth, Edge Functions, Storage, Realtime.

Auth:
- **Google OAuth** (one-click sign-in) as the only provider in this version. Structure the auth layer so additional providers can be added later without rework.

---

## 4. Data model

The central design principle: **separate "what a quiz is about" from "who owns it."** These are two independent axes.

### Axis 1 — Topic tree (global, shared)

A single global tree of subjects, shared across all teachers. Example path: `Computer Science → Digital Systems → Binary Representation`. This tree belongs to no teacher; it is shared infrastructure, like a library catalog.

- Every **published** quiz is tagged to one node in this tree.
- The tree is hierarchical (each node has an optional parent; the roots have no parent).
- There is one special, permanent system node: **"Unsorted"** (גלובלית), which holds quizzes that have lost their branch (see §4.4). Quizzes here are still visible and usable; they simply have no topic.

#### Teacher-proposed branches (admin-approved)

Teachers may propose new branches so the tree can grow without an admin bottleneck, while staying clean:

- A teacher who needs a non-existent branch proposes it (name + parent location in the tree).
- The proposed branch enters **`pending`** state: the proposing teacher can tag their own quizzes to it and see it, but it does **not** appear to other teachers until approved.
- An **admin** reviews:
  - **Approve** → the branch becomes a permanent part of the public tree.
  - **Reject** → the admin may **merge** the proposal into an existing branch ("did you mean the existing 'Data Structures'?"), to avoid orphans.
- **Rejecting a branch must never delete quizzes.** Any quiz tagged to a rejected branch moves to the branch it was merged into, or, failing that, to **"Unsorted."**

### Axis 2 — Ownership (per teacher)

- Every quiz has a **creator** (the teacher who made it).
- A teacher always sees their own quizzes.
- A teacher can browse the **entire public quiz repository** through the topic tree, with filters: *"only mine"* / *"all public"* / *"by a specific teacher."*
- A teacher can **clone** any public quiz into their own account (the clone starts as a `draft`, owned by them, and uses **their** AI key). This is the network effect: good quizzes spread.

### 4.3 Quiz lifecycle (state)

Visibility is tied to **maturity**, not a boolean flag. A quiz is not "hidden" — it is simply "not yet ready."

- **`draft`** — only the creator can see it; cannot be distributed to students; not in the public tree.
- **`published`** — in the public tree; can be distributed to students; can be cloned by others.

When the creator finishes a draft and publishes it, it enters the public tree. **All finished quizzes are public.** (There is no "finished but hidden" state. Paid private quizzes are **DEFER** — see §13.)

### 4.4 Editing & "fixing = the data stays"

**DECISION:** There is **no version management**.

- In-line editing of a quiz is **always allowed**, including after publication and after students have answered.
- When a teacher edits a quiz that already has student responses, show a **warning to the creator**: *"Some students have already answered this. If you change the substance of a question, consider cloning the quiz instead."*
- A fix **overwrites** the previous content. All response data from students who already answered is **retained** (responses are not deleted by an edit).
- Cloning is the mechanism for a substantively different quiz: clone → new `draft` → edit → publish. The original remains intact with its data. (Each "version" is therefore just a separate quiz.)

> Rationale: this gives us frozen history without a versioning system — the original quiz is never mutated out from under the students who took it, because anyone wanting real change clones instead. The in-line edit path exists for typo fixes.

### 4.5 Courses / series

A **course** (a.k.a. series) is a **separate entity** from the topic tree:

- A course is owned by a teacher and represents a teaching context across a semester.
- A course **references** quizzes pulled from the repository (it does not contain them and is not part of the topic tree).
- Quizzes can be **added to a course over time**, throughout the semester.
- The course carries the **longitudinal tracking dashboard** (§7.2): aggregate student progress across all the course's quizzes.

> Keep three concepts distinct and never collapse them into one tree: **topic** (what it's about), **course** (a teacher's active teaching context), and **quiz lifecycle** (draft/published).

---

## 5. Question model

A quiz is an ordered sequence of **questions**. Each question has:

- **Prompt** — the question text shown to the student. Supports **text and code** (see §6).
- **Correct answer** — an **optional** free-text field.
  - If filled: the AI checks the student against this known answer, subject to the grading instructions.
  - If empty: the AI is free to determine what the correct answer is on its own, from the prompt + grading instructions, and judge accordingly.
- **Grading instructions** — a free-text field telling the AI **how** to judge. The teacher picks from base templates (§5.1) or writes their own. (Note the separation: *correct answer* is **content** — what is right; *grading instructions* are **policy** — how to judge.)
- **Flow mode** (per question or per quiz — see §7.1): `infinite_attempts` or `single_attempt`.

### 5.1 Grading-instruction templates

Provide these as **simple, plain-text** templates the teacher can select and then edit as a paragraph. They contain **no fill-in fields** (the correct answer lives in its own field, so instructions stay clean). Text is in Hebrew:

1. **התאמה עובדתית** — "אשר אם התשובה נכונה עובדתית. התעלם מניסוח, איות וסדר מילים."
2. **הבנה רעיונית** — "אשר אם התלמיד הביע את הרעיון הנכון, גם בניסוח שונה. דחה רק אם חסר מרכיב מהותי."
3. **נימוק והוכחה** — "בדוק את דרך ההגעה לתשובה, לא רק את התוצאה הסופית. דרוש צעדים תקפים."
4. **בדיקת קוד** — "בדוק אם הקוד פותר את הבעיה בצורה לוגית נכונה. התעלם מסגנון; ציין מקרי-קצה שנכשלים."
5. **חופשי** — empty field; the teacher writes their own instructions.

The teacher can **save their own instruction text as a personal template** that appears in their selection list for future questions.

### 5.2 "Ask the AI for the correct answer" button

In the question editor, provide a button **"שאל את ה-AI מה התשובה הנכונה."** When pressed, the AI generates a proposed correct answer from the prompt + grading instructions, and **fills the correct-answer field**. The teacher can then edit it. This bridges the optional-answer design: a teacher who doesn't want to write the answer can have one generated, while keeping human control.

---

## 6. Student input

**DECISION:** Student input is **text + code**.

- Free-text answers.
- Code input: monospace font, indentation preserved. (We have a "code checking" grading template, so code answers are first-class.)
- **No image attachments.** (Students cannot attach photos. DEFER if ever needed.)

Images **are** supported in **question authoring** (the teacher can include an image in a question prompt — see §9), but the AI does not generate them and students do not submit them.

---

## 7. The grading & flow engine

This is the heart of the app. Keep the AI **simple and pure** (it only judges) and put all flow control in the application.

### 7.1 Two flow modes (per quiz)

**DECISION — binary configuration per quiz:**

- **`infinite_attempts`** — the student is **stuck** on a question until they get an approval to advance. They may retry indefinitely.
- **`single_attempt`** — the student **always advances** after one answer, even if it was wrong.

### 7.2 The AI always returns the same structured output

**DECISION:** Regardless of flow mode, the AI **always** returns a structured object with three parts:

```ts
// Validate this with Zod before trusting it.
type AiGradingResult = {
  decision: "pass" | "fail" | "unsure";   // "unsure" = "אני (ה-AI) לא בטוח"
  studentFeedback: string;                 // may be empty ("") for simple cases
  teacherReport: string;                   // mistake report for the teacher; may be empty
};
```

- `decision: "unsure"` literally means **"I (the AI) am not sure."** The AI only reports its own epistemic state. **The application** — not the AI — decides what "unsure" means in context (block-for-teacher-judgment vs. record-only), based on the flow mode.

### 7.3 How the application interprets the AI output

The AI's output is **identical in every mode**; only the **flow engine** interprets it differently. This separation is mandatory.

**`infinite_attempts` mode:**
- `pass` → student advances.
- `fail` → student is stuck; retries.
- `unsure` → student **waits** for teacher judgment (the teacher resolves it on the control board).

**`single_attempt` mode:**
- The student **always advances** after one answer.
- But the AI's verdict is **recorded**: the control board and the teacher report show whether the answer was wrong.
- `unsure` in this mode does **not** block the student (single-attempt never blocks); it simply becomes a **"flag for teacher attention"** on the control board.

> Restating the rule precisely: in `single_attempt`, "always advances" governs **flow**, not **score**. The student is never blocked, but the verdict (including a wrong answer) is logged and surfaced.

### 7.4 Teacher overrides on the control board

- In `infinite_attempts` mode, the teacher can **manually approve** a student's advance to the next question.
- This manual push is available **at any time**, for any student — it is a teacher super-power on the control board, **not** conditioned on the student being stuck. (A teacher who sees the class is out of time can push everyone forward.)

### 7.5 What the AI receives as input

The AI receives, for each judgment:

- The full **question prompt**.
- The teacher's **grading instructions**.
- The **correct answer** (if provided; otherwise omitted, and the AI determines it itself).
- The student's **full sequence of answers** for this question — **not just the latest one**. This lets the AI conduct a dialogue with the student and recognize an answer that was completed across several messages ("you already said X; now try a different direction").

---

## 8. AI provider integration

### 8.1 Keys belong to teachers, encrypted, server-only

**DECISION:**

- Each teacher supplies **their own** AI provider key. There is **no fallback key.** No key → the teacher cannot run a quiz.
- One provider + one key per teacher (keep it simple — no per-use routing in this version).
- The key is stored **encrypted at rest** in Supabase (use Supabase Vault / pgsodium). It is **never** returned to the browser.

### 8.2 The key must never reach the client

All LLM calls go through a Supabase **Edge Function** (server-side):

1. The student's browser sends the answer to **your Edge Function** — never to the AI provider directly.
2. The Edge Function (server-side) looks up the relevant teacher's key, calls the LLM, and returns to the client **only the result** (`AiGradingResult`).
3. The key lives only between the database and the Edge Function. The browser never sees it.

> Reason this is non-negotiable: any key sent to the browser is exposed — anyone can open DevTools → Network and read it. With a teacher's key, a leak could run up hundreds of dollars on their account. There is no obfuscation that fixes this; the call must originate server-side.

Additional benefits to implement: log every call, and **rate-limit per student** so a student cannot hammer a teacher's API.

### 8.3 Two AI use-cases (both text only)

1. **Grading student answers** (§7) — runs frequently, during class.
2. **Authoring assistant for the teacher** — help phrase, brainstorm, and propose questions/answers during quiz creation (includes the "ask for the correct answer" button, §5.2).

There is **no image generation.** (The teacher may generate images manually outside the app and paste/upload them into a question — see §9.)

### 8.4 Provider support

- Support the three popular providers: **Anthropic, OpenAI, Gemini.**
- **Start with Anthropic only**, and structure the provider layer (a clean interface behind which each provider is an adapter) so OpenAI and Gemini can be added later without touching call sites.
- Validate every provider's response into the common `AiGradingResult` shape with **Zod** before use.

---

## 9. Images in question authoring

- A teacher may include an image in a question prompt.
- Images are added by the teacher manually: **paste** into the editor, or **file upload** (attachment).
- Store images in **Supabase Storage**; reference them from the question.
- The AI does **not** generate images. Students do **not** submit images.

---

## 10. The teacher control board (real-time) & dashboards

### 10.1 Live control board (during a running quiz)

A real-time view (Supabase Realtime) showing, for the running quiz:

- Where each student currently is (which question).
- Each student's status per question: passed / stuck / waiting-for-judgment / wrong-but-advanced.
- The **mistakes** each student made (from `teacherReport`).
- Teacher actions: resolve an `unsure` judgment; **manually push** any student to the next question (§7.4).

### 10.2 Course dashboard (longitudinal)

For a course (§4.5), an aggregate dashboard across all the course's quizzes over the semester: per-student progress, which questions are hardest, success rates, etc.

> Implementation note: these aggregate queries (e.g. "how many students failed question 3 across every quiz in the course") are exactly what SQL is built for. Lean on Postgres aggregate queries / views rather than client-side computation.

---

## 11. Language & layout (i18n posture)

**DECISION on posture — "prepare the infrastructure, do not actually translate":**

- The app ships **in Hebrew only**. Do not produce an English translation.
- **But**: keep all UI strings in a **central strings file** (do not hard-code Hebrew text inside JSX/components), so an English strings file could be dropped in later. This is near-zero cost now and very painful to retrofit.
- The layout is **RTL** because Hebrew is RTL — RTL is the baseline, not an add-on. Use **CSS logical properties** everywhere (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, etc.) instead of physical `left`/`right`, so a future LTR locale doesn't break the layout.
- **Do not translate user content.** Quizzes, questions, and feedback are written by the teacher in whatever language they choose; that content is not part of app i18n.

---

## 12. Summary of locked decisions

- **Roles:** student, teacher, admin (admin is a role, not a fixed person).
- **Auth:** Google OAuth, one-click; structured for more providers later.
- **Stack:** React + TS + Vite + SCSS + React Router + TanStack Query + Zustand + Zod; Supabase (Postgres + Auth + Edge Functions + Storage + Realtime); web frontend.
- **AI:** one provider + one encrypted key per teacher, server-only via Edge Function, no fallback. Two use-cases: grading + authoring assistant. No image generation. Start with Anthropic; adapter layer for OpenAI/Gemini.
- **Two axes:** global topic tree (with admin-approved branch proposals + an "Unsorted" node) + per-teacher ownership with clone-to-own.
- **Quiz lifecycle:** draft → published. All finished quizzes are public.
- **No version management:** in-line edit always allowed (with a warning when responses exist); fixes overwrite but retain response data; substantive change = clone.
- **Course/series:** separate entity that references repository quizzes and carries the longitudinal dashboard.
- **Question:** prompt (text + code), optional correct-answer field, separate grading-instructions field (templates + personal templates), "ask AI for the correct answer" button.
- **Grading engine:** binary flow mode per quiz (`infinite_attempts` / `single_attempt`); AI always returns `{decision: pass|fail|unsure, studentFeedback, teacherReport}`; the **app**, not the AI, interprets `unsure` per flow mode; AI receives the full answer sequence; teacher can manually push any student at any time.
- **Student input:** text + code, no images.
- **Language:** Hebrew + RTL baseline; centralized strings + CSS logical properties; no actual translation; user content never translated.

---

## 13. Explicitly deferred (do NOT build now; leave room for later)

- **Payments / paid private quizzes.** No payment anything in this version. The quiz lifecycle has no `private-paid` state. Scaffold nothing user-facing; just don't make decisions that block it later.
- **Multiple AI providers active** (start Anthropic-only behind an adapter interface).
- **Per-use provider routing** (one provider per teacher for now).
- **Image generation** and **student image submission.**
- **Additional auth providers** beyond Google.

---

## 14. Suggested build order

1. Project scaffold: Vite + React + TS + SCSS (RTL baseline, logical properties, central strings file); Supabase project; Google OAuth.
2. Data model & migrations: users/roles, topic tree (+ Unsorted node + pending branches), quizzes (lifecycle), questions, courses, student responses. Set up Row Level Security.
3. Teacher key management: encrypted storage (Vault/pgsodium) + the Edge Function skeleton that reads it server-side.
4. Quiz authoring: question editor (text + code, image upload to Storage), correct-answer + grading-instructions fields, templates + personal templates, "ask AI for the correct answer."
5. The Edge Function grading path: provider adapter (Anthropic first), full-answer-sequence input, Zod-validated `AiGradingResult` output.
6. Student runtime: join via link, answer flow, the two flow modes, blocking/advancing logic.
7. Live control board (Supabase Realtime): student positions, statuses, mistakes, teacher resolve/push actions.
8. Topic tree browse/filter + clone-to-own + branch proposal/admin approval.
9. Courses + longitudinal dashboard (Postgres aggregate queries/views).
