import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdmin } from "../_shared/auth.ts";

// SECURITY: This function is DISABLED and locked down.
// Raw SQL execution via unauthenticated endpoint is a critical vulnerability.
// All database maintenance must be done via authenticated admin RPCs or Supabase Studio.

declare const Deno: any;

serve(async (req) => {
  // Allow CORS preflight for internal tooling (no wildcard data exposed)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "https://app.supabase.com",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SECURITY: Verify the caller is authenticated and is an admin
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";

  // Service role key bypass (only for internal server-to-server calls)
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;

  if (!isServiceRole) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authResult = await verifyAdmin(req, supabase);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // SECURITY: Raw SQL execution is permanently disabled.
  // This function only exposes a safe, read-only diagnostic query.
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("system_settings")
      .select("id, maintenance_mode, disable_ordering, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, system: data }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
