/**
 * ask-ai — authoring assistant Edge Function (spec §5.2, §8.3).
 *
 * Called from the question editor when the teacher clicks
 * "שאל את ה-AI מה התשובה הנכונה". Returns a proposed correct answer
 * that the teacher can then edit. The key never leaves the server.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";

const RequestSchema = z.object({
  question_prompt: z.string().min(1).max(10_000),
  grading_instructions: z.string().max(2_000),
});

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const input = RequestSchema.parse(body);

    // Resolve caller from the JWT they sent.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );

    if (authErr || !user) return err(401, "Unauthorized");

    // Retrieve the teacher's decrypted API key from Vault.
    const { data: keyRows, error: kErr } = await supabase
      .rpc("get_teacher_api_key_decrypted", { _teacher_id: user.id });

    if (kErr || !keyRows?.length) {
      return err(400, "No AI provider key configured. Add your key in Settings.");
    }

    const { provider, api_key } = keyRows[0] as {
      provider: string;
      api_key: string;
    };

    if (provider !== "anthropic") {
      return err(400, `Provider "${provider}" is not yet supported for the authoring assistant.`);
    }

    const prompt = [
      `שאלה:\n${input.question_prompt}`,
      input.grading_instructions
        ? `הנחיות ציון:\n${input.grading_instructions}`
        : "",
      "כתוב את התשובה הנכונה לשאלה זו. היה תמציתי וברור. החזר את התשובה בלבד, ללא הסבר.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const correctAnswer = data.content.find((c) => c.type === "text")?.text?.trim() ?? "";

    return new Response(JSON.stringify({ correctAnswer }), {
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
