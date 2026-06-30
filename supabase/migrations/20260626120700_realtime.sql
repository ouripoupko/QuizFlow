-- Enable Supabase Realtime for tables the student runtime and control board
-- subscribe to (spec §7.3 blocking/advancing, §10.1 live board).
alter publication supabase_realtime add table public.session_participants;
alter publication supabase_realtime add table public.responses;
