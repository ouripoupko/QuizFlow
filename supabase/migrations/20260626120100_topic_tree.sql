-- QuizFlow — the global, shared topic tree (spec §4.1).
-- One tree for everyone; nodes have an optional parent. Teacher-proposed
-- branches start 'pending' (visible only to the proposer) until an admin
-- approves. A permanent system node "Unsorted" holds orphaned quizzes.

create table public.topic_nodes (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.topic_nodes (id) on delete set null,
  name        text not null,
  status      public.topic_status not null default 'pending',
  -- The teacher who proposed a pending branch (null for system/seed nodes).
  proposed_by uuid references auth.users (id) on delete set null,
  -- True for permanent nodes that must never be deleted (e.g. Unsorted).
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index topic_nodes_parent_idx on public.topic_nodes (parent_id);

-- The permanent "Unsorted" node (גלובלית, spec §4.1). Fixed id so the app and
-- the reject/merge logic (step 8) can reference it without a lookup.
insert into public.topic_nodes (id, parent_id, name, status, is_system)
values ('00000000-0000-0000-0000-000000000001', null, 'גלובלית', 'approved', true);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.topic_nodes enable row level security;

-- Approved nodes are public infrastructure; a pending node is visible only to
-- the teacher who proposed it (and to admins reviewing it).
create policy "approved nodes are public; pending only to proposer/admin"
  on public.topic_nodes for select
  to authenticated
  using (
    status = 'approved'
    or proposed_by = auth.uid()
    or public.is_admin()
  );

-- Teachers propose new branches (always 'pending', owned by them).
-- Admins may insert already-approved nodes directly.
create policy "teachers propose pending branches; admins add approved"
  on public.topic_nodes for insert
  to authenticated
  with check (
    (public.has_role('teacher') and status = 'pending' and proposed_by = auth.uid())
    or public.is_admin()
  );

-- Admins approve/reject/merge/rename anything; a proposer may still rename their
-- own pending branch before review.
create policy "admins manage the tree; proposer edits own pending"
  on public.topic_nodes for update
  to authenticated
  using (public.is_admin() or (proposed_by = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (proposed_by = auth.uid() and status = 'pending'));

-- Only admins delete, and never a system node. Rejecting a branch never deletes
-- quizzes — they are reassigned to the merge target or Unsorted (step 8).
create policy "admins delete non-system nodes"
  on public.topic_nodes for delete
  to authenticated
  using (public.is_admin() and is_system = false);
