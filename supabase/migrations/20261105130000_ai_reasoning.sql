-- The AI's explanation of its verdict, written for the teacher (what the
-- correct solution is, how the student's answer compares, and — on
-- "unsure" — what caused the doubt). Shown on the control board next to an
-- answer awaiting approval; never returned to the student by grade-answer.
--
-- Additive: null for every existing response.
alter table public.responses
  add column ai_reasoning text;
