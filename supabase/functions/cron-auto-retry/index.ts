import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";

serve(async (_req) => {
  console.log("[cron-auto-retry] Auto-retry is disabled. System relies on provider webhooks.");
  return new Response(
    JSON.stringify({ message: "Auto-retry is disabled. Relying on provider webhooks." }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
