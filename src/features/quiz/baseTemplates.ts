/** The 5 built-in grading-instruction templates (spec §5.1). Hebrew text only. */
export const BASE_TEMPLATES = [
  {
    id: "factual",
    title: "התאמה עובדתית",
    body: "אשר אם התשובה נכונה עובדתית. התעלם מניסוח, איות וסדר מילים.",
  },
  {
    id: "conceptual",
    title: "הבנה רעיונית",
    body: "אשר אם התלמיד הביע את הרעיון הנכון, גם בניסוח שונה. דחה רק אם חסר מרכיב מהותי.",
  },
  {
    id: "reasoning",
    title: "נימוק והוכחה",
    body: "בדוק את דרך ההגעה לתשובה, לא רק את התוצאה הסופית. דרוש צעדים תקפים.",
  },
  {
    id: "code",
    title: "בדיקת קוד",
    body: "בדוק אם הקוד פותר את הבעיה בצורה לוגית נכונה. התעלם מסגנון; ציין מקרי-קצה שנכשלים.",
  },
  {
    id: "free",
    title: "חופשי",
    body: "",
  },
] as const;

export type BaseTemplateId = (typeof BASE_TEMPLATES)[number]["id"];
