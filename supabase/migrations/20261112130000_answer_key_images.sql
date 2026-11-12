-- The teacher's correct answer may include one image (e.g. the expected
-- graph or force diagram), on a question or on each part — uploaded by the
-- teacher, or drawn by the AI from "ask the AI for the answer". Grading
-- sends it to the AI alongside the answer text.
--
-- Additive: null for every existing question and part.

-- ── 1. The image on the answer ─────────────────────────────────────────────
alter table public.questions
  add column correct_answer_image_path text;

alter table public.question_parts
  add column correct_answer_image_path text;

-- ── 2. A private bucket for answer-key images ──────────────────────────────
-- Not the question-images bucket: students can read that one (they're shown
-- the question's images), and an answer image there could be found by a
-- determined student. Here only the quiz's creator can read or write;
-- grade-answer/ask-ai read with the service role.
-- Path convention: {quiz_id}/{question_id}/{uuid}.{ext}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'answer-key-images',
  'answer-key-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

create policy "quiz creator uploads answer-key images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'answer-key-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and q.creator_id = auth.uid()
    )
  );

create policy "quiz creator reads answer-key images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'answer-key-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and q.creator_id = auth.uid()
    )
  );

create policy "quiz creator deletes answer-key images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'answer-key-images'
    and exists (
      select 1 from public.quizzes q
      where q.id = (storage.foldername(name))[1]::uuid
        and q.creator_id = auth.uid()
    )
  );

-- ── 3. Saving a question: also the answer images ───────────────────────────
-- Same as 20261106120000_student_answer_images.sql, plus:
--   * question level: `_set_correct_answer_image` + `_correct_answer_image_path`
--     (a plain "null = leave as is" couldn't express "remove the image");
--   * per part: a "correct_answer_image_path" key — present (even null)
--     means set it, absent means leave it as is.
-- So callers that don't know about answer images can't clear them.
drop function public.save_question_with_parts(uuid, text, text, text, jsonb, boolean);

create function public.save_question_with_parts(
  _question_id               uuid,
  _prompt                    text,
  _correct_answer            text,
  _grading_instructions      text,
  _parts                     jsonb,
  _allow_answer_image        boolean default null,
  _set_correct_answer_image  boolean default false,
  _correct_answer_image_path text    default null
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
  set prompt                    = _prompt,
      correct_answer            = _correct_answer,
      grading_instructions      = _grading_instructions,
      allow_answer_image        = coalesce(_allow_answer_image, allow_answer_image),
      correct_answer_image_path = case when _set_correct_answer_image
                                       then _correct_answer_image_path
                                       else correct_answer_image_path end
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
      insert into public.question_parts
        (question_id, prompt, correct_answer, allow_answer_image, correct_answer_image_path)
      values (_question_id, _part ->> 'prompt', _part ->> 'correct_answer',
              coalesce((_part ->> 'allow_answer_image')::boolean, false),
              _part ->> 'correct_answer_image_path')
      returning id into _part_id;
    else
      _part_id := (_part ->> 'id')::uuid;
      update public.question_parts
      set prompt                    = _part ->> 'prompt',
          correct_answer            = _part ->> 'correct_answer',
          allow_answer_image        = coalesce((_part ->> 'allow_answer_image')::boolean, allow_answer_image),
          correct_answer_image_path = case when _part ? 'correct_answer_image_path'
                                           then _part ->> 'correct_answer_image_path'
                                           else correct_answer_image_path end
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

grant execute on function
  public.save_question_with_parts(uuid, text, text, text, jsonb, boolean, boolean, text)
  to authenticated;
