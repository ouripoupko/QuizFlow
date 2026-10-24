-- Flag a teacher's AI key as out of credit, so the control board can tell
-- the teacher why grading stopped (students only see "tell your teacher").
--
-- Set by the grade-answer Edge Function (service role) when the provider
-- rejects a call for lack of credit; cleared by it on the next successful
-- grading call. Replacing the key also clears it — a new key is a fresh
-- start, and the next grading call will re-flag it if it's out of credit too.
alter table public.teacher_ai_keys
  add column credit_exhausted_at timestamptz;

-- Named to sort after teacher_ai_keys_set_updated_at (same-event triggers
-- fire alphabetically), so it can undo that trigger's bump when only the
-- flag changed — the settings page's "last updated" is about the key itself.
create or replace function public.track_teacher_ai_credit_flag()
returns trigger
language plpgsql
as $$
begin
  if new.vault_secret_id is distinct from old.vault_secret_id then
    new.credit_exhausted_at := null;
  elsif new.credit_exhausted_at is distinct from old.credit_exhausted_at then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger teacher_ai_keys_track_credit_flag
  before update on public.teacher_ai_keys
  for each row execute function public.track_teacher_ai_credit_flag();

-- Stream changes to the control board. The existing "teacher reads own key
-- metadata" select policy limits each teacher to their own row.
alter publication supabase_realtime add table public.teacher_ai_keys;
