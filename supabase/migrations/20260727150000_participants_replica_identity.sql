-- QuizFlow — fix the control board never seeing DELETE events.
--
-- The board's realtime subscription filters session_participants changes by
-- session_id=eq.<id>, but session_id isn't the primary key. Postgres's
-- default REPLICA IDENTITY only puts the primary key into a DELETE's "old
-- row" WAL data, so Realtime has nothing to filter on for that column and
-- silently drops the event — INSERT/UPDATE were unaffected since the new row
-- is always sent in full. REPLICA IDENTITY FULL includes every column.
alter table public.session_participants replica identity full;
