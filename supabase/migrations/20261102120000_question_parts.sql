-- Multi-part questions: an introductory scenario (the question's own prompt
-- and images) followed by numbered parts ("סעיפים"), each with its own
-- prompt and optional correct answer. Grading instructions stay on the
-- question.
--
-- Strictly additive — existing rows keep their exact meaning:
--   * a question with no parts behaves exactly as before;
--   * responses.part_id is null for every existing (and every no-part) answer;
--   * session_participants.current_part is 0 for everyone, and stays 0 while
--     on a question without parts. current_position keeps meaning "index of
--     the question the student is on".

-- ── 1. Parts table ────────────────────────────────────────────────────────
create table public.question_parts (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions (id) on delete cascade,
  position       int not null default 0,
  prompt         text not null default '',
  -- Optional, as on questions: null means the AI decides correctness itself.
  correct_answer text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Deferred for the same reason as questions_quiz_position_unique: a
  -- reorder passes through a momentary duplicate inside one transaction.
  constraint question_parts_position_unique
    unique (question_id, position) deferrable initially deferred
);

create trigger question_parts_set_updated_at
  before update on public.question_parts
  for each row execute function public.set_updated_at();

-- Same position invariants as questions (see
-- 20260803120000_question_position_integrity.sql): inserts always append,
-- deletes renumber the rest, so positions stay a contiguous 0..n-1.
create function public.question_parts_append_position()
returns trigger
language plpgsql
as $$
begin
  new.position := coalesce(
    (select max(position) + 1 from public.question_parts where question_id = new.question_id),
    0
  );
  return new;
end;
$$;

create trigger question_parts_before_insert_append
  before insert on public.question_parts
  for each row execute function public.question_parts_append_position();

create function public.question_parts_renumber_after_delete()
returns trigger
language plpgsql
as $$
begin
  update public.question_parts
  set position = position - 1
  where question_id = old.question_id and position > old.position;
  return old;
end;
$$;

create trigger question_parts_after_delete_renumber
  after delete on public.question_parts
  for each row execute function public.question_parts_renumber_after_delete();

-- A part edit is a content change to its quiz (relaunch staleness check,
-- see 20260804150000_quiz_content_staleness.sql).
create function public.question_parts_bump_quiz_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.quizzes
  set content_updated_at = now()
  where id = (
    select quiz_id from public.questions
    where id = coalesce(new.question_id, old.question_id)
  );
  return coalesce(new, old);
end;
$$;

create trigger question_parts_bump_quiz_content
  after insert or update or delete on public.question_parts
  for each row execute function public.question_parts_bump_quiz_content_updated_at();

-- ── 2. RLS: inherit visibility from the parent question's quiz ────────────
alter table public.question_parts enable row level security;

create policy "read parts of visible questions"
  on public.question_parts for select
  to authenticated
  using (
    exists (
      select 1 from public.questions qn
      join public.quizzes q on q.id = qn.quiz_id
      where qn.id = question_id
        and (q.creator_id = auth.uid() or q.status = 'published')
    )
  );

create policy "quiz creator writes question parts"
  on public.question_parts for all
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

-- ── 3. Runtime columns ────────────────────────────────────────────────────
-- Cascade matches what deleting a question already does to its responses.
alter table public.responses
  add column part_id uuid references public.question_parts (id) on delete cascade;

create index responses_part_idx on public.responses (part_id);

-- Index into the current question's parts; always 0 on a question without parts.
alter table public.session_participants
  add column current_part int not null default 0;

-- ── 4. Saving a question together with its parts ──────────────────────────
-- One call = one transaction, so the question and its parts can never be
-- half-saved. `_parts` is the full desired list, in order:
-- [{ "id": uuid | null, "prompt": text, "correct_answer": text | null }].
-- Existing parts missing from it are deleted, ids present are updated, null
-- ids are inserted; positions are then set to the list order. Returns the
-- saved parts (with ids for the new ones).
--
-- security invoker (the default) — the existing creator-only RLS policies on
-- questions and question_parts apply to every statement here.
create function public.save_question_with_parts(
  _question_id          uuid,
  _prompt               text,
  _correct_answer       text,
  _grading_instructions text,
  _parts                jsonb
)
returns setof public.question_parts
language plpgsql
as $$
declare
  _part     jsonb;
  _part_id  uuid;
  _ordered  uuid[] := '{}';
  _i        int;
begin
  update public.questions
  set prompt               = _prompt,
      correct_answer       = _correct_answer,
      grading_instructions = _grading_instructions
  where id = _question_id;

  if not found then
    raise exception 'Question not found';
  end if;

  delete from public.question_parts
  where question_id = _question_id
    and id not in (
      select (p ->> 'id')::uuid
      from jsonb_array_elements(_parts) p
      where p ->> 'id' is not null
    );

  for _part in select * from jsonb_array_elements(_parts) loop
    if _part ->> 'id' is null then
      insert into public.question_parts (question_id, prompt, correct_answer)
      values (_question_id, _part ->> 'prompt', _part ->> 'correct_answer')
      returning id into _part_id;
    else
      _part_id := (_part ->> 'id')::uuid;
      update public.question_parts
      set prompt         = _part ->> 'prompt',
          correct_answer = _part ->> 'correct_answer'
      where id = _part_id and question_id = _question_id;
      if not found then
        raise exception 'Part % does not belong to this question', _part_id;
      end if;
    end if;
    _ordered := _ordered || _part_id;
  end loop;

  for _i in 1 .. coalesce(array_length(_ordered, 1), 0) loop
    update public.question_parts
    set position = _i - 1
    where id = _ordered[_i] and position <> _i - 1;
  end loop;

  return query
    select * from public.question_parts
    where question_id = _question_id
    order by position;
end;
$$;

grant execute on function public.save_question_with_parts(uuid, text, text, text, jsonb) to authenticated;

-- ── 5. One place that decides "what's next" for a participant ─────────────
-- Next part of the current question if there is one, otherwise the next
-- question (part reset to 0). On a question without parts this is exactly
-- the old `current_position + 1`.
--
-- When `_from_question_id` is given, it only advances if the participant is
-- still on that question/part — so a stale action (e.g. resolving an answer
-- the student was already pushed past) can't skip them ahead twice.
-- Internal: not callable from the browser (see the revoke below).
create function public.advance_participant_step(
  _participant_id   uuid,
  _from_question_id uuid default null,
  _from_part_id     uuid default null
)
returns table (current_position int, current_part int)
language plpgsql
security definer
set search_path = public
as $$
declare
  _pos         int;
  _part        int;
  _quiz_id     uuid;
  _question_id uuid;
  _part_id     uuid;
  _part_count  int;
begin
  select sp.current_position, sp.current_part, s.quiz_id
  into   _pos, _part, _quiz_id
  from   session_participants sp
  join   quiz_sessions s on s.id = sp.session_id
  where  sp.id = _participant_id
  for update of sp;

  if _pos is null then
    raise exception 'Participant not found';
  end if;

  select qn.id into _question_id
  from questions qn
  where qn.quiz_id = _quiz_id and qn.position = _pos;

  select count(*) into _part_count
  from question_parts qp
  where qp.question_id = _question_id;

  select qp.id into _part_id
  from question_parts qp
  where qp.question_id = _question_id and qp.position = _part;

  if _from_question_id is not null
     and (_question_id is distinct from _from_question_id
          or _part_id is distinct from _from_part_id) then
    -- Stale: report where they are without moving them.
    return query select _pos, _part;
    return;
  end if;

  if _part + 1 < _part_count then
    _part := _part + 1;
  else
    _pos  := _pos + 1;
    _part := 0;
  end if;

  update session_participants sp
  set    current_position = _pos,
         current_part     = _part
  where  sp.id = _participant_id;

  return query select _pos, _part;
end;
$$;

revoke execute on function public.advance_participant_step(uuid, uuid, uuid)
  from public, anon, authenticated;

-- Student-facing: advance after their own answer was resolved (AI pass, or
-- any answer in single_attempt mode). Replaces the browser's direct
-- `current_position + 1` update, which can't know about parts.
create function public.advance_participant(
  _participant_id uuid,
  _question_id    uuid,
  _part_id        uuid default null
)
returns table (current_position int, current_part int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_my_participant(_participant_id) then
    raise exception 'Forbidden: not your participation';
  end if;

  return query
    select * from public.advance_participant_step(_participant_id, _question_id, _part_id);
end;
$$;

grant execute on function public.advance_participant(uuid, uuid, uuid) to authenticated;

-- ── 6. Teacher actions now advance by part ────────────────────────────────
-- Same signatures and checks as 20260626120800_board_functions.sql; only the
-- advance step changed.
create or replace function public.resolve_response(
  _response_id uuid,
  _decision    grading_decision
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _session_id     uuid;
  _participant_id uuid;
  _question_id    uuid;
  _part_id        uuid;
begin
  select sp.session_id, r.participant_id, r.question_id, r.part_id
  into   _session_id, _participant_id, _question_id, _part_id
  from   responses r
  join   session_participants sp on sp.id = r.participant_id
  join   quiz_sessions s         on s.id  = sp.session_id
  where  r.id            = _response_id
    and  s.host_id       = auth.uid()
    and  s.status        = 'active';

  if _session_id is null then
    raise exception 'Forbidden: not the host of this session';
  end if;

  update responses
  set    decision  = _decision,
         graded_by = 'teacher',
         graded_at = now()
  where  id = _response_id;

  if _decision = 'pass' then
    perform public.advance_participant_step(_participant_id, _question_id, _part_id);
  end if;

  insert into teacher_actions (session_id, participant_id, question_id, teacher_id, action)
  values (_session_id, _participant_id, _question_id, auth.uid(), 'resolve');
end;
$$;

-- Push moves to the next part (or the next question from the last part).
create or replace function public.push_participant(_participant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _session_id uuid;
begin
  select s.id
  into   _session_id
  from   session_participants sp
  join   quiz_sessions s on s.id = sp.session_id
  where  sp.id     = _participant_id
    and  s.host_id = auth.uid()
    and  s.status  = 'active';

  if _session_id is null then
    raise exception 'Forbidden: not the host of this session';
  end if;

  perform public.advance_participant_step(_participant_id);

  insert into teacher_actions (session_id, participant_id, teacher_id, action)
  values (_session_id, _participant_id, auth.uid(), 'push');
end;
$$;

-- ── 7. Clone copies parts too ─────────────────────────────────────────────
-- Same as 20260626120900_topics_functions.sql, but question by question so
-- each new question's parts can be attached to it. (Images are still not
-- copied, as before.)
create or replace function public.clone_quiz(_quiz_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  _new_id          uuid;
  _src_question    record;
  _src_part        record;
  _new_question_id uuid;
begin
  if not public.has_role('teacher') then
    raise exception 'Only teachers can clone quizzes';
  end if;

  if not exists (
    select 1 from quizzes where id = _quiz_id and status = 'published'
  ) then
    raise exception 'Quiz not found or not published';
  end if;

  insert into quizzes (
    creator_id, title, description, flow_mode,
    topic_node_id, cloned_from_quiz_id, status
  )
  select
    auth.uid(),
    title || ' (עותק)',
    description,
    flow_mode,
    topic_node_id,
    _quiz_id,
    'draft'
  from quizzes
  where id = _quiz_id
  returning id into _new_id;

  for _src_question in
    select * from questions where quiz_id = _quiz_id order by position
  loop
    insert into questions (quiz_id, prompt, correct_answer, grading_instructions)
    values (_new_id, _src_question.prompt, _src_question.correct_answer,
            _src_question.grading_instructions)
    returning id into _new_question_id;

    -- One row at a time, in order, so the append trigger reproduces the order.
    for _src_part in
      select * from question_parts
      where question_id = _src_question.id
      order by position
    loop
      insert into question_parts (question_id, prompt, correct_answer)
      values (_new_question_id, _src_part.prompt, _src_part.correct_answer);
    end loop;
  end loop;

  return _new_id;
end;
$$;

-- ── 8. Course dashboard: a multi-part question is one question ────────────
-- Passed when every one of its parts has a passing answer from the student
-- (in any session of that quiz). A question without parts is unchanged:
-- passed when it has any passing answer.
create or replace function public.course_dashboard(_course_id uuid)
returns table (
  quiz_id          uuid,
  quiz_title       text,
  quiz_position    int,
  student_id       uuid,
  student_name     text,
  questions_total  bigint,
  questions_passed bigint,
  total_attempts   bigint,
  last_activity    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cq.quiz_id,
    q.title                                                                   as quiz_title,
    cq.position                                                               as quiz_position,
    sp.student_id,
    -- Most-recent display name the student used across sessions
    (array_agg(sp.display_name order by sp.joined_at desc))[1]               as student_name,
    -- Total questions in this quiz (a multi-part question counts once)
    (select count(*) from questions qn where qn.quiz_id = cq.quiz_id)        as questions_total,
    -- Questions the student passed
    (
      select count(*)
      from questions qn
      where qn.quiz_id = cq.quiz_id
        and case
          when exists (select 1 from question_parts qp where qp.question_id = qn.id) then
            not exists (
              select 1 from question_parts qp
              where qp.question_id = qn.id
                and not exists (
                  select 1
                  from responses r2
                  join session_participants sp2 on sp2.id = r2.participant_id
                  join quiz_sessions s2         on s2.id  = sp2.session_id
                  where s2.quiz_id     = cq.quiz_id
                    and sp2.student_id = sp.student_id
                    and r2.part_id     = qp.id
                    and r2.decision    = 'pass'
                )
            )
          else
            exists (
              select 1
              from responses r2
              join session_participants sp2 on sp2.id = r2.participant_id
              join quiz_sessions s2         on s2.id  = sp2.session_id
              where s2.quiz_id     = cq.quiz_id
                and sp2.student_id = sp.student_id
                and r2.question_id = qn.id
                and r2.decision    = 'pass'
            )
        end
    )                                                                         as questions_passed,
    -- Total answer submissions across all attempts
    count(r.id)                                                               as total_attempts,
    max(r.submitted_at)                                                       as last_activity
  from course_quizzes cq
  join quizzes q              on q.id  = cq.quiz_id
  join quiz_sessions s        on s.quiz_id = cq.quiz_id
  join session_participants sp on sp.session_id = s.id
                              and sp.student_id is not null
  left join responses r       on r.participant_id = sp.id
  where cq.course_id = _course_id
    -- Caller must own the course
    and exists (
      select 1 from courses c
      where c.id = _course_id and c.owner_id = auth.uid()
    )
  group by cq.quiz_id, q.title, cq.position, sp.student_id
  order by cq.position, student_name;
$$;

-- ── 9. Image positions: a clean 0..n-1 list per question ──────────────────
-- Images are numbered on screen by their place in the list ("תמונה 1"…), and
-- grading/ask-ai now refer to them by that number, so every view must agree
-- on the order. Uploads used to set `position` to the current image count
-- and deletes never renumbered, so positions could repeat (delete one, upload
-- one). Same fix as for questions and parts: repair once, then let the
-- database keep the list contiguous.

-- Repair: renumber in today's display order (position, ties broken by
-- upload time), so no question's images change order.
with ranked as (
  select
    id,
    row_number() over (
      partition by question_id
      order by position asc, created_at asc, id asc
    ) - 1 as new_position
  from public.question_images
)
update public.question_images qi
set position = ranked.new_position
from ranked
where qi.id = ranked.id and qi.position <> ranked.new_position;

alter table public.question_images
  add constraint question_images_position_unique
  unique (question_id, position) deferrable initially deferred;

-- Every insert appends at the end, whatever position the caller sends.
create function public.question_images_append_position()
returns trigger
language plpgsql
as $$
begin
  new.position := coalesce(
    (select max(position) + 1 from public.question_images where question_id = new.question_id),
    0
  );
  return new;
end;
$$;

create trigger question_images_before_insert_append
  before insert on public.question_images
  for each row execute function public.question_images_append_position();

create function public.question_images_renumber_after_delete()
returns trigger
language plpgsql
as $$
begin
  update public.question_images
  set position = position - 1
  where question_id = old.question_id and position > old.position;
  return old;
end;
$$;

create trigger question_images_after_delete_renumber
  after delete on public.question_images
  for each row execute function public.question_images_renumber_after_delete();
