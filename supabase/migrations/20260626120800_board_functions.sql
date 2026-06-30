-- ── RLS: host can read all responses in their sessions ───────────────────────
create policy "host reads responses in their sessions"
  on responses for select
  using (
    exists (
      select 1
      from session_participants sp
      join quiz_sessions s on s.id = sp.session_id
      where sp.id = responses.participant_id
        and s.host_id = auth.uid()
    )
  );

-- ── resolve_response ──────────────────────────────────────────────────────────
-- Teacher marks an unsure response as pass or fail.
-- On pass the participant is automatically advanced to the next question so
-- their realtime subscription wakes them up without a separate call.
create function public.resolve_response(
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
begin
  select sp.session_id, r.participant_id, r.question_id
  into   _session_id, _participant_id, _question_id
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
    update session_participants
    set    current_position = current_position + 1
    where  id = _participant_id;
  end if;

  insert into teacher_actions (session_id, participant_id, question_id, teacher_id, action)
  values (_session_id, _participant_id, _question_id, auth.uid(), 'resolve');
end;
$$;

grant execute on function public.resolve_response to authenticated;

-- ── push_participant ──────────────────────────────────────────────────────────
-- Forcibly advances a student to the next question regardless of their answer
-- state. Used for the manual-push button on the control board.
create function public.push_participant(_participant_id uuid)
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

  update session_participants
  set    current_position = current_position + 1
  where  id = _participant_id;

  insert into teacher_actions (session_id, participant_id, teacher_id, action)
  values (_session_id, _participant_id, auth.uid(), 'push');
end;
$$;

grant execute on function public.push_participant to authenticated;
