-- Alongside responses.ai_request (the exact body sent to the AI), keep the
-- AI reply's metadata for the admin-only view on the control board:
-- { model, stop_reason, usage }. stop_reason shows whether the reply was cut
-- off ("max_tokens"); usage is the per-answer token cost.
--
-- Additive: null for every existing response.
alter table public.responses
  add column ai_response_meta jsonb;
