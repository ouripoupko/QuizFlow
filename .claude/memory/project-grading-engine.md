---
name: project-grading-engine
description: "QuizFlow grading and flow engine — AI output contract, flow modes, application interpretation, teacher overrides"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# QuizFlow Grading & Flow Engine (§7)

Design principle: **AI is simple and pure (only judges). All flow control is in the application.**

## Two Flow Modes (§7.1) — DECISION: binary per quiz
- **`infinite_attempts`** — student is stuck on a question until approved to advance; may retry indefinitely
- **`single_attempt`** — student always advances after one answer, even if wrong

## AI Output Contract (§7.2) — DECISION: always the same structure
```ts
// Always validate with Zod before trusting
type AiGradingResult = {
  decision: "pass" | "fail" | "unsure"; // "unsure" = AI's own epistemic uncertainty
  studentFeedback: string;              // may be "" for simple cases
  teacherReport: string;                // mistake report for teacher; may be ""
};
```
- `decision: "unsure"` = "I (the AI) am not sure." The AI only reports its epistemic state.
- The **application**, not the AI, decides what "unsure" means in context.

## Application Interpretation of AI Output (§7.3) — separation is mandatory
The AI output is **identical in every mode**. Only the flow engine interprets it differently.

**`infinite_attempts` mode:**
- `pass` → student advances
- `fail` → student is stuck; retries
- `unsure` → student **waits** for teacher judgment (teacher resolves on control board)

**`single_attempt` mode:**
- Student **always advances** after one answer (never blocked)
- AI verdict is **recorded** — control board and teacher report show whether answer was wrong
- `unsure` → NOT a block; becomes a **"flag for teacher attention"** on the control board

> Rule: in `single_attempt`, "always advances" governs **flow**, not **score**. Wrong answers are logged and surfaced.

## Teacher Overrides (§7.4)
- In `infinite_attempts` mode, teacher can **manually approve** a student's advance at any time
- Available for any student, not conditioned on the student being stuck
- Teacher super-power: can push everyone forward if class is running out of time

## What the AI Receives (§7.5)
For each judgment, the AI receives:
- Full **question prompt**
- Teacher's **grading instructions**
- **Correct answer** (if provided; omitted if empty — AI determines it itself)
- Student's **full sequence of answers** for this question (NOT just the latest one)
  - Enables dialogue: AI can recognize an answer completed across several messages

**Why:** Full answer sequence allows the AI to treat multi-attempt interaction as a conversation and give credit for progressive refinement, not just the final answer.
**How to apply:** Store each student answer as a separate row with sequence order. Always pass all rows for a given (student, question) pair to the AI, not just the last one.
