-- QuizFlow — drop teacher control over thinking on/off.
--
-- Simplification: thinking is now implied by the model itself, not a
-- separate setting — on (in whichever form the model's thinking_family
-- supports) whenever the model supports it at all, never explicitly
-- disabled. This sidesteps Claude Fable 5 / Mythos 5 rejecting
-- `{type: "disabled"}` entirely, without needing to special-case those
-- specific models (which the Models API has no way to identify anyway —
-- see grade-answer/providers/anthropic.ts). The teacher only still
-- controls `effort`, where the model supports it.
alter table public.teacher_ai_keys drop column thinking_enabled;

drop function if exists public.update_teacher_ai_model(text, text, boolean, text);

create function public.update_teacher_ai_model(
  _model           text,
  _thinking_family text default 'adaptive',
  _effort          text default null
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
      effort                = _effort,
      updated_at            = now()
  where teacher_id = auth.uid();

  if not found then
    raise exception 'No AI provider key configured yet — add one first';
  end if;
end;
$$;

grant execute on function public.update_teacher_ai_model(text, text, text) to authenticated;

-- ── get_teacher_api_key_decrypted: return type changes, so drop + recreate ──
drop function public.get_teacher_api_key_decrypted(uuid);

create function public.get_teacher_api_key_decrypted(_teacher_id uuid)
returns table(
  provider        text,
  api_key         text,
  model           text,
  thinking_family text,
  effort          text
)
language sql
security definer
set search_path = public, vault
as $$
  select tk.provider, ds.decrypted_secret, tk.model, tk.model_thinking_family, tk.effort
  from public.teacher_ai_keys tk
  join vault.decrypted_secrets ds on ds.id = tk.vault_secret_id
  where tk.teacher_id = _teacher_id;
$$;

revoke execute on function public.get_teacher_api_key_decrypted(uuid)
  from anon, authenticated;
grant  execute on function public.get_teacher_api_key_decrypted(uuid)
  to service_role;
