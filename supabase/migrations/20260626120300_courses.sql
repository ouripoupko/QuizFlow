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
