# Memory Index

- [QuizFlow Build Spec](project-quizflow-spec.md) — App overview, roles, tech stack decisions (React/Vite/SCSS/TanStack/Zustand/Zod/Supabase), RTL Hebrew UI
- [Data Model](project-data-model.md) — Topic tree (global/shared), ownership axes, quiz lifecycle (draft/published), no versioning, editing rules, courses as separate entities
- [Question Model](project-question-model.md) — Fields (prompt/correct answer/grading instructions/flow mode), Hebrew grading templates, personal templates, "ask AI" button
- [Grading & Flow Engine](project-grading-engine.md) — AiGradingResult contract (Zod-validated), two flow modes, application-side interpretation, teacher overrides, full answer sequence to AI
- [AI Provider Integration](project-ai-integration.md) — Teacher-owned keys in Supabase Vault, Edge Function-only calls, provider adapter pattern (Anthropic first), rate limiting per student
- [Control Board & Dashboards](project-control-board.md) — Real-time live board (Supabase Realtime), teacher push/resolve actions, course longitudinal dashboard via Postgres aggregates
