/**
 * Standard CORS headers for QuizFlow Edge Functions.
 * All functions must return these on OPTIONS preflight requests and on every
 * response so the browser can read the result.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;
