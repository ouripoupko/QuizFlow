---
name: project-data-model
description: "QuizFlow data model — topic tree, ownership, quiz lifecycle, editing rules, courses"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# QuizFlow Data Model (§4)

Central design principle: **separate "what a quiz is about" from "who owns it."** Two independent axes.

## Axis 1 — Topic Tree (global, shared)
- Single global tree of subjects, shared across all teachers. No teacher owns it.
- Every **published** quiz is tagged to exactly one node.
- Nodes: hierarchical (optional parent; roots have no parent).
- Special permanent system node: **"Unsorted"** (גלובלית) — holds quizzes whose branch was rejected/deleted. Still visible and usable.

### Teacher-Proposed Branches
- Teacher proposes a new branch (name + parent location).
- Branch enters **`pending`** state: proposing teacher can tag their own quizzes to it and see it, but it does NOT appear to other teachers until approved.
- Admin review options:
  - **Approve** → branch becomes permanent public tree node
  - **Reject + Merge** → admin merges proposal into an existing branch; quizzes on rejected branch move to the merged-into branch, or to "Unsorted" if no merge target
- **Rejecting a branch must NEVER delete quizzes.**

## Axis 2 — Ownership (per teacher)
- Every quiz has a **creator** (the teacher who made it).
- Teachers always see their own quizzes.
- Teachers can browse the entire public repository through the topic tree with filters: "only mine" / "all public" / "by a specific teacher."
- Teachers can **clone** any public quiz: clone starts as a `draft`, owned by cloner, uses cloner's AI key. This is the network-effect mechanism.

## Quiz Lifecycle (§4.3)
States: **`draft`** → **`published`**
- `draft`: only creator can see; cannot be distributed; not in public tree
- `published`: in public tree; can be distributed; can be cloned by others
- **All finished quizzes are public.** No "finished but hidden" state. (Paid private quizzes: DEFER §13)

## Editing Rules (§4.4) — DECISION: No version management
- Inline editing always allowed, including post-publication and after student responses exist.
- If students already answered: **show a warning** to the creator ("Some students have already answered this. If you change the substance, consider cloning instead.")
- Edit **overwrites** previous content. Student response data is **retained** (never deleted by an edit).
- Cloning is the mechanism for a substantively different quiz. Original remains intact with its data.

## Courses / Series (§4.5)
- A **course** is a separate entity from the topic tree.
- Owned by a teacher; represents a teaching context across a semester.
- **References** quizzes from the repository (does not contain them, not part of the topic tree).
- Quizzes can be added to a course over time (throughout the semester).
- Carries the longitudinal tracking dashboard (§7.2): aggregate student progress across all course quizzes.

## Three Distinct Concepts — Never Collapse
1. **Topic** — what the quiz is about (topic tree)
2. **Course** — a teacher's active teaching context (semester-level container)
3. **Quiz lifecycle** — draft/published state

**Why:** These are orthogonal axes. Collapsing them causes design errors (e.g. a quiz's subject ≠ which course it's in ≠ whether it's public).
**How to apply:** DB schema must keep topic_nodes, courses, and quizzes as separate tables with reference relationships, not nested ownership.
