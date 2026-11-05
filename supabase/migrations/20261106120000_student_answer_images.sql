-- A student's answer may include one image, on questions (or parts) where
-- the teacher allows it. The image is optional; text or an image (or both)
-- makes an answer. Grading sends it to the AI with the text.
--
-- Additive: both flags default to false, so every existing question and
-- part behaves exactly as before; answer_image_path is null for every
-- existing answer.

-- ── 1. The teacher's "allow an image" flags ───────────────────────────────
alter table public.questions
  add column allow_answer_image boolean not null default false;

alter table public.question_parts
  add column allow_answer_image boolean not null default false;

-- ── 2. The image attached to an answer ────────────────────────────────────
-- Path inside the answer-images bucket. On a retry the previous image can
-- carry over, so two attempts may point at the same object.
alter table public.responses
  add column answer_image_path text;

-- ── 3. Storage for student answer images ──────────────────────────────────
-- Path convention: {participant_id}/{uuid}.{ext}. The first folder ties the
-- object to one participation, which is all the policies need.
-- 5 MB is Anthropic's per-image limit; the browser downscales before
-- uploading, so real files are far smaller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'answer-images',
  'answer-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- A student uploads only into their own participation's folder.
create policy "student uploads own answer images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'answer-images'
    and public.is_my_participant((storage.foldername(name))[1]::uuid)
  );

-- The student and the session's host can view them. (grade-answer reads
-- them with the service role.)
create policy "student or host reads answer images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'answer-images'
    and (
      public.is_my_participant((storage.foldername(name))[1]::uuid)
      or exists (
        select 1 from public.session_participants p
        where p.id = (storage.foldername(name))[1]::uuid
          and public.is_session_host(p.session_id)
      )
    )
  );

-- ── 4. Saving a question: now also its flag and its parts' flags ──────────
-- Same as 20261102120000_question_parts.sql, plus `_allow_answer_image`
-- and an optional "allow_answer_image" key per part. Both are "leave as is"
-- when absent (null / missing key), so a caller that doesn't know about
-- the flags can't reset them. Dropped and recreated rather than overloaded:
-- two versions differing only by a defaulted argument would be ambiguous.
drop function public.save_question_with_parts(uuid, text, text, text, jsonb);

create function public.save_question_with_parts(
  _question_id          uuid,
  _prompt               text,
  _correct_answer       text,
  _grading_instructions text,
  _parts                jsonb,
  _allow_answer_image   boolean default null
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
      grading_instructions = _grading_instructions,
      allow_answer_image   = coalesce(_allow_answer_image, allow_answer_image)
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
      insert into public.question_parts (question_id, prompt, correct_answer, allow_answer_image)
      values (_question_id, _part ->> 'prompt', _part ->> 'correct_answer',
              coalesce((_part ->> 'allow_answer_image')::boolean, false))
      returning id into _part_id;
    else
      _part_id := (_part ->> 'id')::uuid;
      update public.question_parts
      set prompt             = _part ->> 'prompt',
          correct_answer     = _part ->> 'correct_answer',
          allow_answer_image = coalesce((_part ->> 'allow_answer_image')::boolean, allow_answer_image)
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

grant execute on function public.save_question_with_parts(uuid, text, text, text, jsonb, boolean) to authenticated;

-- ── 5. Clone carries the flags over ───────────────────────────────────────
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
    insert into questions (quiz_id, prompt, correct_answer, grading_instructions, allow_answer_image)
    values (_new_id, _src_question.prompt, _src_question.correct_answer,
            _src_question.grading_instructions, _src_question.allow_answer_image)
    returning id into _new_question_id;

    -- One row at a time, in order, so the append trigger reproduces the order.
    for _src_part in
      select * from question_parts
      where question_id = _src_question.id
      order by position
    loop
      insert into question_parts (question_id, prompt, correct_answer, allow_answer_image)
      values (_new_question_id, _src_part.prompt, _src_part.correct_answer,
              _src_part.allow_answer_image);
    end loop;
  end loop;

  return _new_id;
end;
$$;
