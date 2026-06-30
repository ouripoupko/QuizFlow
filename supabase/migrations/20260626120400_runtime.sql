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
