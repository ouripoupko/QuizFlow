-- ── delete_participant ────────────────────────────────────────────────────────
-- Removes a student's participation from a session entirely — their
-- session_participants row, and (via on-delete-cascade) every response and
-- teacher_action tied to it. Used by the control board's "remove" action so a
-- teacher can reset a student back to "hasn't joined yet".
create function public.delete_participant(_participant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1
    from   session_participants sp
    join   quiz_sessions s on s.id = sp.session_id
    where  sp.id     = _participant_id
      and  s.host_id = auth.uid()
      and  s.status  = 'active'
  ) then
    raise exception 'Forbidden: not the host of this session';
  end if;

  delete from session_participants where id = _participant_id;
end;
$$;

grant execute on function public.delete_participant to authenticated;
