/**
 * list-ai-models — lets a teacher pick their grading model from whatever
 * Anthropic currently offers, instead of it being hardcoded.
 *
 * Calls Anthropic's Models API using the teacher's OWN decrypted key (same
 * Vault path as grade-answer) so the browser never needs direct access to it.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return err(401, "Unauthorized");

    const { data: keyRows, error: kErr } = await supabase
      .rpc("get_teacher_api_key_decrypted", { _teacher_id: user.id });

    if (kErr || !keyRows?.length) {
      return err(400, "No AI provider key configured. Add your key first.");
    }

    const { provider, api_key } = keyRows[0] as { provider: string; api_key: string };

    if (provider !== "anthropic") {
      return err(400, `Provider "${provider}" does not support model selection yet.`);
    }

    const res = await fetch(ANTHROPIC_MODELS_URL, {
      headers: {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      data: Array<{
        id: string;
        display_name: string;
        capabilities?: {
          effort?: Record<string, { supported?: boolean } | undefined>;
          thinking?: {
            types?: {
              adaptive?: { supported?: boolean };
              enabled?: { supported?: boolean };
            };
          };
        };
      }>;
    };

    const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

    // Live, per-model capability info — not a hardcoded list — so the
    // Settings page can only ever offer effort levels / a thinking toggle a
    // given model actually supports. `thinkingFamily` distinguishes the two
    // different thinking systems Claude models use ("adaptive" — Sonnet 5,
    // Opus 5, Fable 5, Opus 4.6+, Sonnet 4.6 — vs the older "legacy"
    // enabled+budget_tokens style on Haiku 4.5, Sonnet 4.5, Opus 4.5/4.1),
    // since grade-answer needs to send a different shape for each.
    const models = data.data.map((m) => {
      const effortLevels = EFFORT_LEVELS.filter(
        (lvl) => m.capabilities?.effort?.[lvl]?.supported === true,
      );
      const thinkingFamily = m.capabilities?.thinking?.types?.adaptive?.supported
        ? "adaptive"
        : m.capabilities?.thinking?.types?.enabled?.supported
          ? "legacy"
          : "none";
      return { id: m.id, displayName: m.display_name, effortLevels, thinkingFamily };
    });

    return new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Unexpected error");
  }
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
