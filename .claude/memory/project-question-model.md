---
name: project-question-model
description: "QuizFlow question model — fields, grading templates, \"ask AI\" button"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73c5fdce-a06f-4bc5-9de9-2496983d9a59
---

# QuizFlow Question Model (§5)

A quiz is an ordered sequence of questions. Each question has:

## Fields
- **Prompt** — question text shown to student; supports text and code (§6)
- **Correct answer** — optional free-text
  - If filled: AI checks student answer against this, subject to grading instructions
  - If empty: AI determines correct answer itself from prompt + grading instructions
- **Grading instructions** — free-text; how to judge (policy). Teacher picks from base templates or writes their own.
  - Distinction: correct answer = **content** (what is right); grading instructions = **policy** (how to judge)
- **Flow mode** — `infinite_attempts` or `single_attempt` (per question or per quiz — see §7.1)

## Grading Instruction Templates (§5.1)
Plain text, no fill-in fields. Text is in Hebrew:

1. **התאמה עובדתית** — "אשר אם התשובה נכונה עובדתית. התעלם מניסוח, איות וסדר מילים."
2. **הבנה רעיונית** — "אשר אם התלמיד הביע את הרעיון הנכון, גם בניסוח שונה. דחה רק אם חסר מרכיב מהותי."
3. **נימוק והוכחה** — "בדוק את דרך ההגעה לתשובה, לא רק את התוצאה הסופית. דרוש צעדים תקפים."
4. **בדיקת קוד** — "בדוק אם הקוד פותר את הבעיה בצורה לוגית נכונה. התעלם מסגנון; ציין מקרי-קצה שנכשלים."
5. **חופשי** — empty field; teacher writes their own

Teachers can **save their own instruction text as a personal template** appearing in their selection list for future questions.

## "Ask AI for Correct Answer" Button (§5.2)
- Button label: **"שאל את ה-AI מה התשובה הנכונה."**
- On press: AI generates proposed correct answer from prompt + grading instructions → fills the correct-answer field
- Teacher can then edit the filled value
- Purpose: bridges the optional-answer design — teachers who don't want to write an answer can get one generated while retaining human control

**How to apply:** Correct-answer field is always optional in the DB schema. Grading instructions must be stored as free text (not enum). Personal templates are per-teacher records in the DB.

## Images in Question Authoring (§9)
- Teacher may include an image in a question prompt.
- Input methods: **paste** into editor, or **file upload**.
- Images stored in **Supabase Storage**; referenced by URL from the question record.
- AI does NOT generate images. Students do NOT submit images.

## Student Input (§6) — DECISION
- **Text + code only.** No image attachments from students (DEFER if ever needed).
- Free-text answers supported.
- Code input: monospace font, indentation preserved. Code answers are first-class (backed by the "בדיקת קוד" grading template).
- Images ARE supported in **question prompts** (teacher-authored), but students cannot submit images and AI does not generate them.
