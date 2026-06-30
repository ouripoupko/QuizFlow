---
name: project-control-board
description: QuizFlow teacher control board (real-time) and course dashboard
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# Teacher Control Board & Dashboards (§10)

## Live Control Board (§10.1) — during a running quiz
Powered by **Supabase Realtime**. Shows for the running quiz:
- Where each student is (current question)
- Each student's status per question: passed / stuck / waiting-for-judgment / wrong-but-advanced
- **Mistakes** each student made (sourced from `teacherReport` field of `AiGradingResult`)
- Teacher actions:
  - Resolve an `unsure` judgment
  - **Manually push** any student to the next question (§7.4) — available at any time, unconditionally

## Course Dashboard (§10.2) — longitudinal
Aggregate view across all quizzes in a course over the semester:
- Per-student progress
- Which questions are hardest
- Success rates, etc.

Implementation: use **Postgres aggregate queries / views** for these aggregations — do NOT compute them client-side.
Examples: "how many students failed question 3 across every quiz in the course."

**How to apply:** Live board = Supabase Realtime subscriptions. Course dashboard = server-side Postgres views/aggregates, not client-side JS array manipulation.
