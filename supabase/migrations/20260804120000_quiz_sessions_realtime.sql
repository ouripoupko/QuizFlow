-- quiz_sessions was never added to the realtime publication, so students
-- never received the UPDATE event when a teacher ended (or relaunched) a
-- session — only session_participants and responses were registered
-- (see 20260626120700_realtime.sql). RLS already allows a participating
-- student to read this row regardless of status (see
-- 20260727120000_participant_session_visibility.sql); the table was just
-- never streaming changes to Realtime in the first place.
alter publication supabase_realtime add table public.quiz_sessions;
