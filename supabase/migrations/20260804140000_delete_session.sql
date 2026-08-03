-- Lets a teacher delete an old (ended) session from their quiz's history —
-- cascades to session_participants (on delete cascade), which in turn
-- cascades to responses and teacher_actions, so this fully wipes the record
-- of who participated. Restricted to 'ended' at the RLS level too, not just
-- in the UI, so a live session can never be deleted out from under students
-- mid-lesson.
create policy "host deletes their ended sessions"
  on public.quiz_sessions for delete
  to authenticated
  using (host_id = auth.uid() and status = 'ended');
