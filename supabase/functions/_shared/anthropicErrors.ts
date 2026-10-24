// Anthropic reports an empty credit balance either as a 402 billing_error or
// as a 400 invalid_request_error whose message says "credit balance is too
// low" — match both. Shared by grade-answer and ask-ai.
export function isCreditExhausted(status: number, errBody: string): boolean {
  if (status === 402) return true;
  try {
    const parsed = JSON.parse(errBody) as { error?: { type?: string; message?: string } };
    if (parsed.error?.type === "billing_error") return true;
    if (/credit balance/i.test(parsed.error?.message ?? "")) return true;
  } catch {
    // Non-JSON body — fall back to a plain text match.
  }
  return /credit balance/i.test(errBody);
}
