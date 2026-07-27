-- QuizFlow — remember whether the teacher's chosen model supports the
-- `effort` parameter, so grade-answer can stop guessing and just look it up.
--
-- Not every model on the live list supports output_config.effort / adaptive
-- thinking (e.g. Haiku 4.5 predates that system and 400s if you send it) — so
-- unconditionally sending it, as grade-answer did before, breaks for anything
-- older than the Sonnet-5/Opus-5 generation. The flag is captured once, live,
-- from the Models API's own capabilities.effort.supported when the teacher
-- picks a model in Settings (see list-ai-models) — no hardcoded model list.
alter table public.teacher_ai_keys
  add column model_supports_effort boolean not null default true;

-- ── Tidy a latent overload issue ────────────────────────────────────────────
-- The previous migration added a `_model` parameter to upsert_teacher_ai_key
-- via CREATE OR REPLACE, but Postgres treats a changed argument list as a
-- distinct overload rather than a true replacement — the original 2-arg
-- version was still sitting alongside it. Harmless in practice here (the
-- column default covered the gap), but worth cleaning up while this table is
-- already being touched.
drop function if exists public.upsert_teacher_ai_key(text, text);
drop function if exists public.upsert_teacher_ai_key(text, text, text);

create function public.upsert_teacher_ai_key(
  _provider text,
  _api_key  text,
  _model    text default 'claude-sonnet-5'
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _existing_id uuid;
  _secret_name text;
  _new_id      uuid;
begin
  if not public.has_role('teacher') then
    raise exception 'Only teachers can store an API key';
  end if;

  if _provider not in ('anthropic', 'openai', 'gemini') then
    raise exception 'Unsupported provider: %', _provider;
  end if;

  _secret_name := 'teacher_ai_key_' || auth.uid()::text;

  select vault_secret_id into _existing_id
  from public.teacher_ai_keys
  where teacher_id = auth.uid();

  if _existing_id is null then
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    insert into public.teacher_ai_keys (teacher_id, provider, model, vault_secret_id)
    values (auth.uid(), _provider, coalesce(_model, 'claude-sonnet-5'), _new_id);
  else
    delete from vault.secrets where id = _existing_id;
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    update public.teacher_ai_keys
    set provider        = _provider,
        model           = coalesce(_model, 'claude-sonnet-5'),
        vault_secret_id = _new_id,
        updated_at      = now()
    where teacher_id = auth.uid();
  end if;
end;
$$;

-- ── update_teacher_ai_model: now also records the effort-support flag ──────
drop function if exists public.update_teacher_ai_model(text);

create function public.update_teacher_ai_model(_model text, _supports_effort boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('teacher') then
    raise exception 'Only teachers can update their AI model';
  end if;

  update public.teacher_ai_keys
  set model = _model, model_supports_effort = _supports_effort, updated_at = now()
  where teacher_id = auth.uid();

  if not found then
    raise exception 'No AI provider key configured yet — add one first';
  end if;
end;
$$;

grant execute on function public.update_teacher_ai_model(text, boolean) to authenticated;

-- ── get_teacher_api_key_decrypted: return type changes, so drop + recreate ──
drop function public.get_teacher_api_key_decrypted(uuid);

create function public.get_teacher_api_key_decrypted(_teacher_id uuid)
returns table(provider text, api_key text, model text, model_supports_effort boolean)
language sql
security definer
set search_path = public, vault
as $$
  select tk.provider, ds.decrypted_secret, tk.model, tk.model_supports_effort
  from public.teacher_ai_keys tk
  join vault.decrypted_secrets ds on ds.id = tk.vault_secret_id
  where tk.teacher_id = _teacher_id;
$$;

revoke execute on function public.get_teacher_api_key_decrypted(uuid)
  from anon, authenticated;
grant  execute on function public.get_teacher_api_key_decrypted(uuid)
  to service_role;
