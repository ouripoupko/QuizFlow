-- delete_participant originally required the session to be 'active' — a
-- leftover from before ended sessions were browsable (session history +
-- relaunch). A host managing a past session's roster now hits this and gets
-- a misleading "Forbidden: not the host of this session" error even though
-- they are the host; the real blocker was the status check. Ownership is
-- still enforced — status no longer is.
drop function public.delete_participant(uuid);

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
  ) then
    raise exception 'Forbidden: not the host of this session';
  end if;

  delete from session_participants where id = _participant_id;
end;
$$;

grant execute on function public.delete_participant to authenticated;
