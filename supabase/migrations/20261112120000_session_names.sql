-- Several lessons of the same quiz can now run in parallel (one per class),
-- so each lesson gets an optional name the teacher sets — e.g. the class —
-- to tell their join links and control boards apart.
--
-- Additive: null for every existing lesson (shown by its start time). The
-- existing "host updates their session" policy already lets the host
-- rename it. Nothing in the database ever limited a quiz to one active
-- lesson; that was only an app-side rule, now removed.
alter table public.quiz_sessions
  add column name text;
