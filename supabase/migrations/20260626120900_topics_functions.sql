-- ── clone_quiz ────────────────────────────────────────────────────────────────
-- Atomically duplicates a published quiz + its questions into a new draft owned
-- by the caller. Images are not copied (teacher re-uploads to the new quiz).
-- Returns the new quiz id so the client can navigate straight to the editor.
create function public.clone_quiz(_quiz_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  _new_id uuid;
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

  insert into questions (quiz_id, position, prompt, correct_answer, grading_instructions)
  select _new_id, position, prompt, correct_answer, grading_instructions
  from questions
  where quiz_id = _quiz_id
  order by position;

  return _new_id;
end;
$$;

grant execute on function public.clone_quiz to authenticated;

-- ── reject_topic ──────────────────────────────────────────────────────────────
-- Moves any quizzes tagged to the rejected node to the Unsorted node, then
-- deletes the node. Only admins may call this.
create function public.reject_topic(_topic_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if not exists (
    select 1 from topic_nodes where id = _topic_id and is_system = false
  ) then
    raise exception 'Topic not found or is a system node';
  end if;

  -- Reassign quizzes to Unsorted so they are not orphaned.
  update quizzes
  set topic_node_id = '00000000-0000-0000-0000-000000000001'
  where topic_node_id = _topic_id;

  delete from topic_nodes where id = _topic_id;
end;
$$;

grant execute on function public.reject_topic to authenticated;
