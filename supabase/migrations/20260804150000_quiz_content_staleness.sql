-- Tracks when a quiz's actual content last changed, separately from the
-- generic `updated_at` (which also bumps on publish/unpublish and topic
-- moves — noise for this purpose). Used to detect a real gap in the earlier
-- "published ⇒ safe to relaunch" rule: unpublish → edit → republish leaves
-- `status` back at 'published' with no memory that the content underneath
-- actually changed. This gives relaunch an exact signal instead.
--
-- No quiz versioning is introduced (spec §4.4 is explicit: none) — this is
-- just a freshness marker, not a snapshot of old content.
alter table public.quizzes
  add column content_updated_at timestamptz not null default now();

-- Bump on substantive quiz-level edits only — not status or topic_node_id,
-- which aren't "content" a student would see differently.
create function public.quizzes_bump_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.flow_mode is distinct from old.flow_mode
  then
    new.content_updated_at := now();
  end if;
  return new;
end;
$$;

create trigger quizzes_content_updated_at
  before update on public.quizzes
  for each row execute function public.quizzes_bump_content_updated_at();

-- Any question add/edit/delete/reorder is a content change to its quiz.
create function public.questions_bump_quiz_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.quizzes
  set content_updated_at = now()
  where id = coalesce(new.quiz_id, old.quiz_id);
  return coalesce(new, old);
end;
$$;

create trigger questions_bump_quiz_content
  after insert or update or delete on public.questions
  for each row execute function public.questions_bump_quiz_content_updated_at();

-- Adding/removing an image is also something a student would see differently.
create function public.question_images_bump_quiz_content_updated_at()
returns trigger
language plpgsql
as $$
declare
  target_question_id uuid := coalesce(new.question_id, old.question_id);
begin
  update public.quizzes
  set content_updated_at = now()
  where id = (select quiz_id from public.questions where id = target_question_id);
  return coalesce(new, old);
end;
$$;

create trigger question_images_bump_quiz_content
  after insert or delete on public.question_images
  for each row execute function public.question_images_bump_quiz_content_updated_at();
