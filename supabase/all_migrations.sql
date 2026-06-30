-- QuizFlow — all step-2 migrations concatenated for the Supabase SQL Editor.
-- Apply against a fresh project. (For repeat use, prefer 'supabase db push'.)


-- ============================================================
-- 20260626120000_core.sql
-- ============================================================
-- QuizFlow — core: extensions, enums, profiles, roles, shared helpers.
-- Build step 2 (spec §14). See quizflow-spec.md for the data-model rules.

create extension if not exists pgcrypto;  -- gen_random_uuid / gen_random_bytes

-- ── Enums ──────────────────────────────────────────────────────────────────
-- A user may hold more than one role (spec §2): teacher is also admin early on.
create type public.app_role         as enum ('student', 'teacher', 'admin');
-- Quiz lifecycle (spec §4.3): visibility is maturity, not a hidden flag.
create type public.quiz_status       as enum ('draft', 'published');
-- Flow mode is a binary, per-quiz decision (spec §7.1).
create type public.flow_mode         as enum ('infinite_attempts', 'single_attempt');
-- Topic-tree branch state (spec §4.1): pending proposals vs the public tree.
create type public.topic_status      as enum ('approved', 'pending');
-- The AI's epistemic verdict (spec §7.2). The APP interprets it per flow mode.
create type public.grading_decision  as enum ('pass', 'fail', 'unsure');
create type public.session_status    as enum ('active', 'ended');
-- Who produced a grading row: the AI, or a teacher override (spec §7.4).
create type public.grading_source    as enum ('ai', 'teacher');

-- ── updated_at helper ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per auth user, auto-created on signup. Public-readable so teacher
-- names and the control board can show who is who.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.email
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Roles ───────────────────────────────────────────────────────────────────
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- SECURITY DEFINER so RLS policies can call these without recursing into
-- user_roles' own policies.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = _role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

-- ── RLS: profiles ────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "users insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- ── RLS: user_roles ──────────────────────────────────────────────────────────
alter table public.user_roles enable row level security;

create policy "users read their own roles, admins read all"
  on public.user_roles for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Self-service onboarding for student/teacher; admin grants only by an admin.
-- The first admin is seeded out-of-band with the service-role key.
create policy "users claim non-admin roles, admins grant any"
  on public.user_roles for insert
  to authenticated
  with check (
    (auth.uid() = user_id and role <> 'admin')
    or public.is_admin()
  );

create policy "admins revoke roles"
  on public.user_roles for delete
  to authenticated
  using (public.is_admin());


-- ============================================================
-- 20260626120100_topic_tree.sql
-- ============================================================
-- QuizFlow — the global, shared topic tree (spec §4.1).
-- One tree for everyone; nodes have an optional parent. Teacher-proposed
-- branches start 'pending' (visible only to the proposer) until an admin
-- approves. A permanent system node "Unsorted" holds orphaned quizzes.

create table public.topic_nodes (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.topic_nodes (id) on delete set null,
  name        text not null,
  status      public.topic_status not null default 'pending',
  -- The teacher who proposed a pending branch (null for system/seed nodes).
  proposed_by uuid references auth.users (id) on delete set null,
  -- True for permanent nodes that must never be deleted (e.g. Unsorted).
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index topic_nodes_parent_idx on public.topic_nodes (parent_id);

-- The permanent "Unsorted" node (גלובלית, spec §4.1). Fixed id so the app and
-- the reject/merge logic (step 8) can reference it without a lookup.
insert into public.topic_nodes (id, parent_id, name, status, is_system)
values ('00000000-0000-0000-0000-000000000001', null, 'גלובלית', 'approved', true);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.topic_nodes enable row level security;

-- Approved nodes are public infrastructure; a pending node is visible only to
-- the teacher who proposed it (and to admins reviewing it).
create policy "approved nodes are public; pending only to proposer/admin"
  on public.topic_nodes for select
  to authenticated
  using (
    status = 'approved'
    or proposed_by = auth.uid()
    or public.is_admin()
  );

-- Teachers propose new branches (always 'pending', owned by them).
-- Admins may insert already-approved nodes directly.
create policy "teachers propose pending branches; admins add approved"
  on public.topic_nodes for insert
  to authenticated
  with check (
    (public.has_role('teacher') and status = 'pending' and proposed_by = auth.uid())
    or public.is_admin()
  );

-- Admins approve/reject/merge/rename anything; a proposer may still rename their
-- own pending branch before review.
create policy "admins manage the tree; proposer edits own pending"
  on public.topic_nodes for update
  to authenticated
  using (public.is_admin() or (proposed_by = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (proposed_by = auth.uid() and status = 'pending'));

-- Only admins delete, and never a system node. Rejecting a branch never deletes
-- quizzes — they are reassigned to the merge target or Unsorted (step 8).
create policy "admins delete non-system nodes"
  on public.topic_nodes for delete
  to authenticated
  using (public.is_admin() and is_system = false);


-- ============================================================
-- 20260626120200_quizzes.sql
-- ============================================================
-- QuizFlow — quizzes, questions, question images, personal grading templates.
-- Spec §4 (ownership + lifecycle), §5 (question model), §9 (images).

-- ── Quizzes ──────────────────────────────────────────────────────────────────
create table public.quizzes (
  id                  uuid primary key default gen_random_uuid(),
  creator_id          uuid not null references auth.users (id) on delete cascade,
  title               text not null default '',
  description         text not null default '',
  status              public.quiz_status not null default 'draft',
  -- Binary, per-quiz flow mode (spec §7.1).
  flow_mode           public.flow_mode not null default 'infinite_attempts',
  -- Tagged to exactly one tree node when published (spec §4.1); nullable while
  -- a draft, and set to null if its branch is rejected (app moves it to Unsorted).
  topic_node_id       uuid references public.topic_nodes (id) on delete set null,
  -- Clone-to-own provenance (spec §4.2). A clone starts as a fresh draft.
  cloned_from_quiz_id uuid references public.quizzes (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index quizzes_creator_idx on public.quizzes (creator_id);
create index quizzes_topic_idx   on public.quizzes (topic_node_id);
create index quizzes_status_idx  on public.quizzes (status);

create trigger quizzes_set_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

-- ── Questions ────────────────────────────────────────────────────────────────
-- Prompt supports text + code (spec §5/§6). correct_answer is OPTIONAL: when
-- null the AI determines correctness itself (spec §5). grading_instructions is
-- the "how to judge" policy, separate from the correct-answer content.
create table public.questions (
  id                   uuid primary key default gen_random_uuid(),
  quiz_id              uuid not null references public.quizzes (id) on delete cascade,
  position             int not null default 0,
  prompt               text not null default '',
  correct_answer       text,
  grading_instructions text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index questions_quiz_idx on public.questions (quiz_id, position);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- ── Question images (spec §9) ────────────────────────────────────────────────
-- Teacher-authored only; stored in Supabase Storage, referenced by path here.
create table public.question_images (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions (id) on delete cascade,
  storage_path text not null,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create index question_images_question_idx on public.question_images (question_id);

-- ── Personal grading-instruction templates (spec §5.1) ───────────────────────
-- The 5 base templates are app constants; these are a teacher's saved custom
-- instruction texts that appear in their own selection list.
create table public.grading_templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index grading_templates_owner_idx on public.grading_templates (owner_id);

-- ── RLS: quizzes ─────────────────────────────────────────────────────────────
alter table public.quizzes enable row level security;

-- The creator always sees their own; everyone sees published quizzes (spec §4.2).
create policy "creator sees own quizzes; everyone sees published"
  on public.quizzes for select
  to authenticated
  using (creator_id = auth.uid() or status = 'published');

create policy "teachers create their own quizzes"
  on public.quizzes for insert
  to authenticated
  with check (public.has_role('teacher') and creator_id = auth.uid());

create policy "creator edits their own quiz"
  on public.quizzes for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy "creator deletes their own quiz"
  on public.quizzes for delete
  to authenticated
  using (creator_id = auth.uid());

-- ── RLS: questions (inherit visibility from the parent quiz) ─────────────────
alter table public.questions enable row level security;

create policy "read questions of visible quizzes"
  on public.questions for select
  to authenticated
  using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and (q.creator_id = auth.uid() or q.status = 'published')
    )
  );

create policy "quiz creator writes questions"
  on public.questions for all
  to authenticated
  using (
    exists (select 1 from public.quizzes q where q.id = quiz_id and q.creator_id = auth.uid())
  )
  with check (
    exists (select 1 from public.quizzes q where q.id = quiz_id and q.creator_id = auth.uid())
  );

-- ── RLS: question_images (inherit from the question's quiz) ───────────────────
alter table public.question_images enable row level security;

create policy "read images of visible questions"
  on public.question_images for select
  to authenticated
  using (
    exists (
      select 1 from public.questions qn
      join public.quizzes q on q.id = qn.quiz_id
      where qn.id = question_id
        and (q.creator_id = auth.uid() or q.status = 'published')
    )
  );

create policy "quiz creator writes question images"
  on public.question_images for all
  to authenticated
  using (
    exists (
      select 1 from public.questions qn
      join public.quizzes q on q.id = qn.quiz_id
      where qn.id = question_id and q.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.questions qn
      join public.quizzes q on q.id = qn.quiz_id
      where qn.id = question_id and q.creator_id = auth.uid()
    )
  );

-- ── RLS: grading_templates (private to the owner) ────────────────────────────
alter table public.grading_templates enable row level security;

create policy "owner manages their grading templates"
  on public.grading_templates for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());


-- ============================================================
-- 20260626120300_courses.sql
-- ============================================================
-- QuizFlow — courses / series (spec §4.5).
-- A course is a SEPARATE entity from the topic tree: owned by a teacher, it
-- *references* repository quizzes (added over the semester) and carries the
-- longitudinal dashboard (step 9).

create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null default '',
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index courses_owner_idx on public.courses (owner_id);

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

-- A course references quizzes; it does not contain them.
create table public.course_quizzes (
  course_id uuid not null references public.courses (id) on delete cascade,
  quiz_id   uuid not null references public.quizzes (id) on delete cascade,
  position  int not null default 0,
  added_at  timestamptz not null default now(),
  primary key (course_id, quiz_id)
);

create index course_quizzes_quiz_idx on public.course_quizzes (quiz_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.courses enable row level security;

create policy "owner manages their courses"
  on public.courses for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

alter table public.course_quizzes enable row level security;

create policy "course owner manages course membership"
  on public.course_quizzes for all
  to authenticated
  using (
    exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid())
  );


-- ============================================================
-- 20260626120400_runtime.sql
-- ============================================================
-- QuizFlow — in-class runtime: sessions, participants, responses, teacher actions.
-- Spec §7 (grading & flow), §10 (control board).
--
-- A quiz "session" is one in-class run of a quiz, distributed by a join link.
-- Students join as participants and submit one or more answers per question
-- (the full sequence is kept — spec §7.5). Each response carries the
-- AiGradingResult (spec §7.2), written server-side by the grading Edge Function
-- (which uses the service role and bypasses RLS) or by a teacher override.

-- ── Sessions ─────────────────────────────────────────────────────────────────
create table public.quiz_sessions (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.quizzes (id) on delete cascade,
  host_id    uuid not null references auth.users (id) on delete cascade,
  -- URL-safe token embedded in the student join link.
  join_token text not null unique default encode(gen_random_bytes(9), 'hex'),
  status     public.session_status not null default 'active',
  created_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index quiz_sessions_quiz_idx on public.quiz_sessions (quiz_id);
create index quiz_sessions_host_idx on public.quiz_sessions (host_id);

-- ── Participants ─────────────────────────────────────────────────────────────
create table public.session_participants (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.quiz_sessions (id) on delete cascade,
  student_id       uuid references auth.users (id) on delete set null,
  display_name     text not null default '',
  -- Index of the question the student is currently on (drives the control board).
  current_position int not null default 0,
  status           text not null default 'active',
  joined_at        timestamptz not null default now(),
  unique (session_id, student_id)
);

create index session_participants_session_idx on public.session_participants (session_id);

-- ── Responses (the full answer sequence + its grading) ───────────────────────
create table public.responses (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references public.session_participants (id) on delete cascade,
  question_id     uuid not null references public.questions (id) on delete cascade,
  attempt_number  int not null default 1,
  answer_text     text not null default '',
  submitted_at    timestamptz not null default now(),
  -- AiGradingResult (spec §7.2), filled after judging. graded_by separates an
  -- AI verdict from a teacher override (spec §7.4). Null until graded.
  decision        public.grading_decision,
  student_feedback text,
  teacher_report  text,
  graded_by       public.grading_source,
  graded_at       timestamptz
);

create index responses_participant_idx on public.responses (participant_id);
create index responses_question_idx    on public.responses (question_id);

-- ── Teacher actions on the control board (spec §7.4 / §10.1) ─────────────────
create table public.teacher_actions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.quiz_sessions (id) on delete cascade,
  participant_id uuid references public.session_participants (id) on delete cascade,
  question_id    uuid references public.questions (id) on delete set null,
  teacher_id     uuid not null references auth.users (id) on delete cascade,
  action         text not null,  -- 'push' (manual advance) | 'resolve' (unsure)
  created_at     timestamptz not null default now()
);

create index teacher_actions_session_idx on public.teacher_actions (session_id);

-- ── RLS helpers ──────────────────────────────────────────────────────────────
create or replace function public.is_session_host(_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quiz_sessions s
    where s.id = _session_id and s.host_id = auth.uid()
  );
$$;

create or replace function public.is_my_participant(_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_participants p
    where p.id = _participant_id and p.student_id = auth.uid()
  );
$$;

-- ── RLS: quiz_sessions ───────────────────────────────────────────────────────
alter table public.quiz_sessions enable row level security;

-- Host sees their sessions; a student can look up an active session (they must
-- already know the secret join token to do anything with it).
create policy "host or active-session visibility"
  on public.quiz_sessions for select
  to authenticated
  using (host_id = auth.uid() or status = 'active');

create policy "teachers host their own sessions"
  on public.quiz_sessions for insert
  to authenticated
  with check (public.has_role('teacher') and host_id = auth.uid());

create policy "host updates their session"
  on public.quiz_sessions for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- ── RLS: session_participants ────────────────────────────────────────────────
alter table public.session_participants enable row level security;

create policy "student sees self; host sees the roster"
  on public.session_participants for select
  to authenticated
  using (student_id = auth.uid() or public.is_session_host(session_id));

create policy "student joins an active session as themselves"
  on public.session_participants for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.quiz_sessions s
      where s.id = session_id and s.status = 'active'
    )
  );

-- Student advances themselves; host can push any participant (spec §7.4).
create policy "student or host updates a participant"
  on public.session_participants for update
  to authenticated
  using (student_id = auth.uid() or public.is_session_host(session_id))
  with check (student_id = auth.uid() or public.is_session_host(session_id));

-- ── RLS: responses ───────────────────────────────────────────────────────────
alter table public.responses enable row level security;

create policy "student sees own responses; host sees all in session"
  on public.responses for select
  to authenticated
  using (
    public.is_my_participant(participant_id)
    or exists (
      select 1 from public.session_participants p
      where p.id = participant_id and public.is_session_host(p.session_id)
    )
  );

-- A student submits their own answer but may NOT pre-fill any grading column;
-- the verdict is written server-side. (The grading Edge Function uses the
-- service role and bypasses RLS entirely.)
create policy "student submits own answer, ungraded"
  on public.responses for insert
  to authenticated
  with check (
    public.is_my_participant(participant_id)
    and decision is null
    and graded_by is null
    and graded_at is null
  );

-- Teacher override of a verdict (spec §7.4): only the session host.
create policy "host overrides grading"
  on public.responses for update
  to authenticated
  using (
    exists (
      select 1 from public.session_participants p
      where p.id = participant_id and public.is_session_host(p.session_id)
    )
  )
  with check (
    exists (
      select 1 from public.session_participants p
      where p.id = participant_id and public.is_session_host(p.session_id)
    )
  );

-- ── RLS: teacher_actions ─────────────────────────────────────────────────────
alter table public.teacher_actions enable row level security;

create policy "host reads their session actions"
  on public.teacher_actions for select
  to authenticated
  using (public.is_session_host(session_id));

create policy "host records their own actions"
  on public.teacher_actions for insert
  to authenticated
  with check (teacher_id = auth.uid() and public.is_session_host(session_id));


-- ============================================================
-- 20260626120500_vault_keys.sql
-- ============================================================
-- QuizFlow — teacher AI key storage in Supabase Vault (spec §8.1–§8.2).
--
-- PREREQUISITES: Vault must be enabled in this project.
-- Dashboard → Database → Extensions → search "vault" → Enable.
--
-- The browser NEVER sees a decrypted key. The call chain is:
--   browser → upsert_teacher_ai_key() SECURITY DEFINER
--            → vault.create_secret() [encrypted at rest]
--
-- The Edge Function uses the service role to call get_teacher_api_key_decrypted(),
-- which is revoked from anon/authenticated so the browser cannot call it.

-- ── Teacher API key metadata ──────────────────────────────────────────────────
create table public.teacher_ai_keys (
  teacher_id      uuid primary key references auth.users(id) on delete cascade,
  -- Adapter to route to (spec §8.4: Anthropic first; structure for more later).
  provider        text not null default 'anthropic'
                  check (provider in ('anthropic', 'openai', 'gemini')),
  -- UUID returned by vault.create_secret(). Useless to the browser — Vault
  -- decryption requires the service role, which the browser never has.
  vault_secret_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger teacher_ai_keys_set_updated_at
  before update on public.teacher_ai_keys
  for each row execute function public.set_updated_at();

-- ── Rate-limit call log (spec §8.2) ──────────────────────────────────────────
-- One row per grading Edge Function call. Written by the Edge Function
-- (service role); no browser policies — service_role bypasses RLS.
create table public.grading_rate_calls (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  called_at      timestamptz not null default now()
);

create index grading_rate_calls_lookup_idx
  on public.grading_rate_calls (participant_id, called_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.teacher_ai_keys     enable row level security;
alter table public.grading_rate_calls  enable row level security;

-- Teacher can read their own metadata (provider + timestamps, NOT the raw key).
-- No INSERT/UPDATE/DELETE policies: teachers must go through the SECURITY DEFINER
-- functions below, which touch Vault atomically. grading_rate_calls has no
-- policies at all; only the service-role Edge Function writes to it.
create policy "teacher reads own key metadata"
  on public.teacher_ai_keys for select
  to authenticated
  using (teacher_id = auth.uid());

-- ── Browser-callable SECURITY DEFINER helpers ────────────────────────────────

-- Store or replace a teacher's AI provider key in Vault.
create or replace function public.upsert_teacher_ai_key(
  _provider text,
  _api_key  text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _existing_id uuid;
  _secret_name text;
  _new_id      uuid;
begin
  if not public.has_role('teacher') then
    raise exception 'Only teachers can store an API key';
  end if;

  if _provider not in ('anthropic', 'openai', 'gemini') then
    raise exception 'Unsupported provider: %', _provider;
  end if;

  _secret_name := 'teacher_ai_key_' || auth.uid()::text;

  select vault_secret_id into _existing_id
  from public.teacher_ai_keys
  where teacher_id = auth.uid();

  if _existing_id is null then
    -- First time: create a new Vault secret and record the id.
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    insert into public.teacher_ai_keys (teacher_id, provider, vault_secret_id)
    values (auth.uid(), _provider, _new_id);
  else
    -- Replace: delete old Vault entry, create a new one, update metadata.
    delete from vault.secrets where id = _existing_id;
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    update public.teacher_ai_keys
    set provider        = _provider,
        vault_secret_id = _new_id,
        updated_at      = now()
    where teacher_id = auth.uid();
  end if;
end;
$$;

-- Remove a teacher's API key from Vault and from the metadata table.
create or replace function public.delete_teacher_ai_key()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _secret_id uuid;
begin
  select vault_secret_id into _secret_id
  from public.teacher_ai_keys
  where teacher_id = auth.uid();

  if _secret_id is not null then
    delete from vault.secrets where id = _secret_id;
    delete from public.teacher_ai_keys where teacher_id = auth.uid();
  end if;
end;
$$;

-- ── Service-role-only: called from Edge Functions ─────────────────────────────

-- Returns the decrypted API key for a teacher. REVOKED from browser roles so
-- only the Edge Function (service role) can call it (spec §8.2).
create or replace function public.get_teacher_api_key_decrypted(_teacher_id uuid)
returns table(provider text, api_key text)
language sql
security definer
set search_path = public, vault
as $$
  select tk.provider, ds.decrypted_secret
  from public.teacher_ai_keys tk
  join vault.decrypted_secrets ds on ds.id = tk.vault_secret_id
  where tk.teacher_id = _teacher_id;
$$;

revoke execute on function public.get_teacher_api_key_decrypted(uuid)
  from anon, authenticated;
grant  execute on function public.get_teacher_api_key_decrypted(uuid)
  to service_role;
