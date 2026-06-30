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
