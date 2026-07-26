-- QuizFlow — admin listing: lets any authenticated user see who currently
-- holds the admin role. Needed for the Settings → General page, and for
-- bootstrapping (spec §2: "the first admin is seeded out-of-band" — this is
-- how a new deployment can tell whether that has happened yet).
--
-- RLS on user_roles otherwise limits SELECT to your own rows or an admin
-- (roles aren't a general-purpose directory), so this goes through a
-- SECURITY DEFINER function that intentionally exposes only admin identity —
-- not the full user_roles table.
create function public.list_admins()
returns table (
  user_id      uuid,
  display_name text,
  email        text,
  granted_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.email, ur.granted_at
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.role = 'admin'
  order by ur.granted_at asc;
$$;

grant execute on function public.list_admins to authenticated;
