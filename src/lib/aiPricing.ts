/**
 * Anthropic list prices (direct API, USD per million tokens), for the
 * control board's per-lesson cost estimate. The Models API doesn't expose
 * prices, so they live here — check https://www.anthropic.com/pricing and
 * update when they change — together with PRICES_DATE below, which the
 * board shows next to the estimate so a stale table is visible.
 */
export const PRICES_DATE = "11/2026";

interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Prompt-caching multipliers on the input price.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Price for a model id, also matching dated ids ("claude-x-4-5-20251001"); null if unknown. */
export function modelPrice(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  // Longest id first, so "claude-opus-5-5-…" doesn't match "claude-opus-5".
  const id = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(`${k}-`));
  return id ? PRICES[id] : null;
}

/** The `usage` object Anthropic returns (stored in responses.ai_response_meta). */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface UsageTotals {
  /** Answers that had usage data (graded after it started being recorded). */
  gradings: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function sumUsage(usages: Array<TokenUsage | null | undefined>): UsageTotals {
  const totals: UsageTotals = {
    gradings: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  for (const u of usages) {
    if (!u) continue;
    totals.gradings += 1;
    totals.inputTokens += u.input_tokens ?? 0;
    totals.outputTokens += u.output_tokens ?? 0;
    totals.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    totals.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  }
  return totals;
}

/** Estimated cost in USD of these totals at `price`. Output includes thinking tokens. */
export function estimateCost(totals: UsageTotals, price: ModelPrice): number {
  const inputCost = (totals.inputTokens
    + totals.cacheWriteTokens * CACHE_WRITE_MULTIPLIER
    + totals.cacheReadTokens * CACHE_READ_MULTIPLIER) * price.input;
  return (inputCost + totals.outputTokens * price.output) / 1_000_000;
}
