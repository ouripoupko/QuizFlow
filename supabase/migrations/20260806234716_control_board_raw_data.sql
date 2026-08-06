-- The control board now shows the student's raw answer and the AI's raw
-- reply to them directly, instead of a separate AI-authored explanation for
-- the teacher — drop the now-unused column.
--
-- In its place, store the exact request body sent to the AI provider for
-- that grading call, for an admin-only audit view. This never contains the
-- API key (it travels in a request header, not the body) or any account
-- identifiers (the prompt is only question text and answer history).
alter table public.responses
  drop column teacher_report,
  add column ai_request jsonb;
