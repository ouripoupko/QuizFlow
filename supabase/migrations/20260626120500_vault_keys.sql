-- QuizFlow — teacher AI key storage in Supabase Vault (spec §8.1–§8.2).
--
-- PREREQUISITES: Vault must be enabled in this project.
-- Dashboard → Database → Extensions → search "vault" → Enable.
--
-- The browser NEVER sees a decrypted key. The call chain is:
--   browser → upsert_teacher_ai_key() SECURITY DEFINER
--            → vault.create_secret() [encrypted at rest]
--
-- The Edge Function uses the service role to call get_teacher_api_key_decrypted(),
-- which is revoked from anon/authenticated so the browser cannot call it.

-- ── Teacher API key metadata ──────────────────────────────────────────────────
create table public.teacher_ai_keys (
  teacher_id      uuid primary key references auth.users(id) on delete cascade,
  -- Adapter to route to (spec §8.4: Anthropic first; structure for more later).
  provider        text not null default 'anthropic'
                  check (provider in ('anthropic', 'openai', 'gemini')),
  -- UUID returned by vault.create_secret(). Useless to the browser — Vault
  -- decryption requires the service role, which the browser never has.
  vault_secret_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger teacher_ai_keys_set_updated_at
  before update on public.teacher_ai_keys
  for each row execute function public.set_updated_at();

-- ── Rate-limit call log (spec §8.2) ──────────────────────────────────────────
-- One row per grading Edge Function call. Written by the Edge Function
-- (service role); no browser policies — service_role bypasses RLS.
create table public.grading_rate_calls (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  called_at      timestamptz not null default now()
);

create index grading_rate_calls_lookup_idx
  on public.grading_rate_calls (participant_id, called_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.teacher_ai_keys     enable row level security;
alter table public.grading_rate_calls  enable row level security;

-- Teacher can read their own metadata (provider + timestamps, NOT the raw key).
-- No INSERT/UPDATE/DELETE policies: teachers must go through the SECURITY DEFINER
-- functions below, which touch Vault atomically. grading_rate_calls has no
-- policies at all; only the service-role Edge Function writes to it.
create policy "teacher reads own key metadata"
  on public.teacher_ai_keys for select
  to authenticated
  using (teacher_id = auth.uid());

-- ── Browser-callable SECURITY DEFINER helpers ────────────────────────────────

-- Store or replace a teacher's AI provider key in Vault.
create or replace function public.upsert_teacher_ai_key(
  _provider text,
  _api_key  text
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
    -- First time: create a new Vault secret and record the id.
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    insert into public.teacher_ai_keys (teacher_id, provider, vault_secret_id)
    values (auth.uid(), _provider, _new_id);
  else
    -- Replace: delete old Vault entry, create a new one, update metadata.
    delete from vault.secrets where id = _existing_id;
    _new_id := vault.create_secret(_api_key, _secret_name, 'QuizFlow AI provider key');
    update public.teacher_ai_keys
    set provider        = _provider,
        vault_secret_id = _new_id,
        updated_at      = now()
    where teacher_id = auth.uid();
  end if;
end;
$$;

-- Remove a teacher's API key from Vault and from the metadata table.
create or replace function public.delete_teacher_ai_key()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _secret_id uuid;
begin
  select vault_secret_id into _secret_id
  from public.teacher_ai_keys
  where teacher_id = auth.uid();

  if _secret_id is not null then
    delete from vault.secrets where id = _secret_id;
    delete from public.teacher_ai_keys where teacher_id = auth.uid();
  end if;
end;
$$;

-- ── Service-role-only: called from Edge Functions ─────────────────────────────

-- Returns the decrypted API key for a teacher. REVOKED from browser roles so
-- only the Edge Function (service role) can call it (spec §8.2).
create or replace function public.get_teacher_api_key_decrypted(_teacher_id uuid)
returns table(provider text, api_key text)
language sql
security definer
set search_path = public, vault
as $$
  select tk.provider, ds.decrypted_secret
  from public.teacher_ai_keys tk
  join vault.decrypted_secrets ds on ds.id = tk.vault_secret_id
  where tk.teacher_id = _teacher_id;
$$;

revoke execute on function public.get_teacher_api_key_decrypted(uuid)
  from anon, authenticated;
grant  execute on function public.get_teacher_api_key_decrypted(uuid)
  to service_role;
