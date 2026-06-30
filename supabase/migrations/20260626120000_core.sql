-- QuizFlow — core: extensions, enums, profiles, roles, shared helpers.
-- Build step 2 (spec §14). See quizflow-spec.md for the data-model rules.

create extension if not exists pgcrypto;  -- gen_random_uuid / gen_random_bytes

-- ── Enums ──────────────────────────────────────────────────────────────────
-- A user may hold more than one role (spec §2): teacher is also admin early on.
create type public.app_role         as enum ('student', 'teacher', 'admin');
-- Quiz lifecycle (spec §4.3): visibility is maturity, not a hidden flag.
create type public.quiz_status       as enum ('draft', 'published');
-- Flow mode is a binary, per-quiz decision (spec §7.1).
create type public.flow_mode         as enum ('infinite_attempts', 'single_attempt');
-- Topic-tree branch state (spec §4.1): pending proposals vs the public tree.
create type public.topic_status      as enum ('approved', 'pending');
-- The AI's epistemic verdict (spec §7.2). The APP interprets it per flow mode.
create type public.grading_decision  as enum ('pass', 'fail', 'unsure');
create type public.session_status    as enum ('active', 'ended');
-- Who produced a grading row: the AI, or a teacher override (spec §7.4).
create type public.grading_source    as enum ('ai', 'teacher');

-- ── updated_at helper ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per auth user, auto-created on signup. Public-readable so teacher
-- names and the control board can show who is who.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.email
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Roles ───────────────────────────────────────────────────────────────────
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- SECURITY DEFINER so RLS policies can call these without recursing into
-- user_roles' own policies.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = _role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

-- ── RLS: profiles ────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "users insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- ── RLS: user_roles ──────────────────────────────────────────────────────────
alter table public.user_roles enable row level security;

create policy "users read their own roles, admins read all"
  on public.user_roles for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Self-service onboarding for student/teacher; admin grants only by an admin.
-- The first admin is seeded out-of-band with the service-role key.
create policy "users claim non-admin roles, admins grant any"
  on public.user_roles for insert
  to authenticated
  with check (
    (auth.uid() = user_id and role <> 'admin')
    or public.is_admin()
  );

create policy "admins revoke roles"
  on public.user_roles for delete
  to authenticated
  using (public.is_admin());
