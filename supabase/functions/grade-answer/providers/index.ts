import { anthropicAdapter } from "./anthropic.ts";
import type { ProviderAdapter } from "./types.ts";

const adapters: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  // openai: openaiAdapter,   // step 8.4 — add when un-deferred
  // gemini: geminiAdapter,
};

export function getProviderAdapter(provider: string): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`No adapter for provider: ${provider}`);
  }
  return adapter;
}
