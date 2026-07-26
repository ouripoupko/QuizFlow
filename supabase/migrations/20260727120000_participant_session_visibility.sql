-- QuizFlow — let a student keep seeing a session's metadata after it ends.
--
-- The original policy ("host or active-session visibility") only let a
-- non-host read a quiz_sessions row while status = 'active'. That's fine for
-- joining, but it means a student's own "my quizzes" history goes blind the
-- moment the teacher ends the session — session_participants stays visible
-- (per-row RLS), but the join back to quiz_sessions (for quiz_id/status) does
-- not, so the quiz title can no longer be resolved.
drop policy "host or active-session visibility" on public.quiz_sessions;

create policy "host, active sessions, or a session you participated in"
  on public.quiz_sessions for select
  to authenticated
  using (
    host_id = auth.uid()
    or status = 'active'
    or exists (
      select 1 from public.session_participants sp
      where sp.session_id = quiz_sessions.id and sp.student_id = auth.uid()
    )
  );
