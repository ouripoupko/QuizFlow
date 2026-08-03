-- Fixes a data-integrity bug: deleting a question never renumbered its
-- siblings, so `position` could develop gaps and — once a later insert
-- computed its position from `count(*)` instead of `max(position)` — actual
-- duplicates. Duplicate positions make `order by position` unstable, which
-- is why reordering some questions stopped working.
--
-- Rather than relying on every call site to keep `position` correct (the
-- root cause), the invariant is moved into the database: a unique
-- constraint makes a duplicate impossible to commit, and triggers keep
-- `position` contiguous automatically on insert/delete regardless of which
-- code path touches the table.

-- ── 1. Repair existing data ───────────────────────────────────────────────
-- Renumber each quiz's questions to a contiguous 0..n-1 sequence, preserving
-- relative order (ties broken by created_at, then id, for determinism).
with ranked as (
  select
    id,
    row_number() over (
      partition by quiz_id
      order by position asc, created_at asc, id asc
    ) - 1 as new_position
  from public.questions
)
update public.questions q
set position = ranked.new_position
from ranked
where q.id = ranked.id;

-- ── 2. Make duplicates impossible ─────────────────────────────────────────
-- Deferred so a swap (two updates in one transaction, see the RPC below) can
-- pass through a momentary duplicate state without tripping the check.
drop index if exists public.questions_quiz_idx;

alter table public.questions
  add constraint questions_quiz_position_unique
  unique (quiz_id, position) deferrable initially deferred;

-- ── 3. Auto-append on insert ──────────────────────────────────────────────
-- Whatever `position` the caller sends is ignored — every insert becomes
-- "last in this quiz". The only two insert paths (add question, import) both
-- already want append semantics, so this can't silently drift again.
create function public.questions_append_position()
returns trigger
language plpgsql
as $$
begin
  new.position := coalesce(
    (select max(position) + 1 from public.questions where quiz_id = new.quiz_id),
    0
  );
  return new;
end;
$$;

create trigger questions_before_insert_append
  before insert on public.questions
  for each row execute function public.questions_append_position();

-- ── 4. Auto-renumber on delete ────────────────────────────────────────────
create function public.questions_renumber_after_delete()
returns trigger
language plpgsql
as $$
begin
  update public.questions
  set position = position - 1
  where quiz_id = old.quiz_id and position > old.position;
  return old;
end;
$$;

create trigger questions_after_delete_renumber
  after delete on public.questions
  for each row execute function public.questions_renumber_after_delete();

-- ── 5. Atomic swap for reordering ─────────────────────────────────────────
-- The client used to issue two independent UPDATEs (two separate
-- transactions via PostgREST) to swap positions — with the constraint
-- above, the first one to commit would find a genuine duplicate against the
-- not-yet-updated sibling and fail. A single function call is one
-- transaction, so the deferred check only runs once both rows are correct.
-- security invoker (the default) — runs as the caller, so the existing
-- "quiz creator writes questions" RLS policy still applies.
create function public.swap_question_positions(_question_id_a uuid, _question_id_b uuid)
returns void
language plpgsql
as $$
declare
  pos_a int;
  pos_b int;
  quiz_a uuid;
  quiz_b uuid;
begin
  select position, quiz_id into pos_a, quiz_a from public.questions where id = _question_id_a;
  select position, quiz_id into pos_b, quiz_b from public.questions where id = _question_id_b;

  if quiz_a is null or quiz_b is null or quiz_a <> quiz_b then
    raise exception 'Both questions must exist and belong to the same quiz';
  end if;

  update public.questions set position = pos_b where id = _question_id_a;
  update public.questions set position = pos_a where id = _question_id_b;
end;
$$;

grant execute on function public.swap_question_positions(uuid, uuid) to authenticated;
