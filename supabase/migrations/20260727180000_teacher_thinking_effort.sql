-- QuizFlow — let the teacher control thinking + effort per model, instead of
-- grade-answer hardcoding "thinking disabled, effort medium" for everyone.
--
-- `model_thinking_family` is capability info about the model itself (which
-- thinking system it uses, if any) — captured live from the Models API at
-- selection time, same principle as the old model_supports_effort flag it
-- replaces, just detailed enough to build a correct request either way
-- (thinking on OR off). `thinking_enabled` and `effort` are the teacher's
-- actual preference.
alter table public.teacher_ai_keys drop column model_supports_effort;

alter table public.teacher_ai_keys
  add column model_thinking_family text not null default 'adaptive'
    check (model_thinking_family in ('none', 'adaptive', 'legacy')),
  add column thinking_enabled boolean not null default false,
  add column effort text
    check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'));

-- ── update_teacher_ai_model: now carries thinking + effort too ─────────────
drop function if exists public.update_teacher_ai_model(text, boolean);

create function public.update_teacher_ai_model(
  _model            text,
  _thinking_family  text default 'adaptive',
  _thinking_enabled boolean default false,
  _effort           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('teacher') then
    raise exception 'Only teachers can update their AI model';
  end if;

  if _thinking_family not in ('none', 'adaptive', 'legacy') then
    raise exception 'Invalid thinking family: %', _thinking_family;
  end if;

  if _effort is not null and _effort not in ('low', 'medium', 'high', 'xhigh', 'max') then
    raise exception 'Invalid effort level: %', _effort;
  end if;

  update public.teacher_ai_keys
  set model                 = _model,
      model_thinking_family = _thinking_family,
      thinking_enabled      = _thinking_enabled,
      effort                = _effort,
      updated_at            = now()
  where teacher_id = auth.uid();

  if not found then
    raise exception 'No AI provider key configured yet — add one first';
  end if;
end;
$$;

grant execute on function public.update_teacher_ai_model(text, text, boolean, text) to authenticated;

-- ── get_teacher_api_key_decrypted: return type changes, so drop + recreate ──
drop function public.get_teacher_api_key_decrypted(uuid);

create function public.get_teacher_api_key_decrypted(_teacher_id uuid)
returns table(
  provider         text,
  api_key          text,
  model            text,
  thinking_family  text,
  thinking_enabled boolean,
  effort           text
)
language sql
security definer
set search_path = public, vault
as $$
  select tk.provider, ds.decrypted_secret, tk.model,
         tk.model_thinking_family, tk.thinking_enabled, tk.effort
  from public.teacher_ai_keys tk
  join vault.decrypted_secrets ds on ds.id = tk.vault_secret_id
  where tk.teacher_id = _teacher_id;
$$;

revoke execute on function public.get_teacher_api_key_decrypted(uuid)
  from anon, authenticated;
grant  execute on function public.get_teacher_api_key_decrypted(uuid)
  to service_role;
