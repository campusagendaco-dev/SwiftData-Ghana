import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

const DEFAULT_MESSAGE = "We are performing scheduled maintenance. Please check back soon.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured: missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const clientIp =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    null;

  const checkIpBlocked = async (): Promise<boolean> => {
    if (!clientIp) return false;
    const { data } = await supabaseAdmin
      .from("security_blacklist")
      .select("id")
      .eq("type", "ip")
      .eq("value", clientIp)
      .maybeSingle();
    return Boolean(data);
  };

  const readMaintenance = async () => {
    const { data, error } = await supabaseAdmin
      .from("maintenance_settings")
      .select("is_enabled, message")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      const missingTable = error.message.toLowerCase().includes("maintenance_settings");
      return {
        is_enabled: false,
        message: DEFAULT_MESSAGE,
        table_ready: !missingTable,
        warning: missingTable ? "maintenance_settings table missing" : error.message,
      };
    }

    return {
      is_enabled: Boolean(data?.is_enabled),
      message: String(data?.message || DEFAULT_MESSAGE),
      table_ready: true,
      warning: null,
    };
  };

  try {
    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = payload?.action === "set" ? "set" : "get";

    if (action === "get") {
      const [maintenance, is_blocked] = await Promise.all([
        readMaintenance(),
        checkIpBlocked(),
      ]);
      return new Response(JSON.stringify({ success: true, is_blocked, ...maintenance }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = authResult.user;

    const isEnabled = Boolean(payload?.is_enabled);
    const message = String(payload?.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;

    const { error: saveError } = await supabaseAdmin.from("maintenance_settings").upsert({
      id: 1,
      is_enabled: isEnabled,
      message,
      updated_at: new Date().toISOString(),
    });

    if (saveError) {
      return new Response(JSON.stringify({ error: saveError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, is_enabled: isEnabled, message, table_ready: true, warning: null }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
