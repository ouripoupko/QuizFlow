---
name: project-ai-integration
description: "QuizFlow AI provider integration — key storage, server-only calls, provider adapter pattern, rate limiting"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# QuizFlow AI Provider Integration (§8)

## Key Ownership & Storage (§8.1) — DECISION
- Each teacher supplies **their own** AI provider key. No fallback key. No key = cannot run a quiz.
- One provider + one key per teacher (no per-use routing in v1).
- Key stored **encrypted at rest** in Supabase Vault / pgsodium. **Never returned to the browser.**

## Key Must Never Reach the Client (§8.2) — DECISION
All LLM calls go through a Supabase **Edge Function** (server-side):
1. Student's browser sends answer → **Edge Function** (never to AI provider directly)
2. Edge Function looks up teacher's key server-side, calls LLM, returns only `AiGradingResult` to client
3. Key lives only between the DB and the Edge Function — browser never sees it

Additional requirements:
- **Log every LLM call**
- **Rate-limit per student** — prevent a student from hammering a teacher's API

## Two AI Use-Cases (§8.3) — both text only
1. **Grading student answers** (§7) — runs frequently during class
2. **Authoring assistant for teacher** — help phrase/brainstorm questions and answers during quiz creation (includes "ask for correct answer" button §5.2)

No image generation. Teacher may upload manually-created images into question prompts (§9).

## Provider Support (§8.4)
- Target providers: **Anthropic, OpenAI, Gemini**
- **Start with Anthropic only**
- Build a clean provider interface (adapter pattern): each provider is an adapter behind a common interface; call sites never reference a specific provider
- Validate every provider response into `AiGradingResult` with **Zod** before use

**Why:** Key security is non-negotiable — any key sent to the browser is exposed via DevTools Network. Server-side calls are the only safe path.
**How to apply:** Never call an AI provider API from React/frontend code. All AI calls go through Edge Functions. The provider adapter lives in Edge Function code only.
