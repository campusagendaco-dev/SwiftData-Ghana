import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type SecretCheck = {
  key: string;
  present: boolean;
  required_for: string[];
};

type TableCheck = {
  table: string;
  exists: boolean;
  error?: string | null;
};

type FunctionCheck = {
  name: string;
  reachable: boolean;
  status?: number;
  error?: string | null;
};

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const {
      data: { user: actor },
      error: actorError,
    } = await supabaseUser.auth.getUser();

    if (actorError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", actor.id)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requiredSecrets: SecretCheck[] = [
      {
        key: "SUPABASE_URL",
        present: !!Deno.env.get("SUPABASE_URL"),
        required_for: ["all edge functions"],
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        present: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        required_for: ["admin actions", "wallet updates", "webhooks"],
      },
      {
        key: "SUPABASE_ANON_KEY",
        present: !!Deno.env.get("SUPABASE_ANON_KEY"),
        required_for: ["auth user validation in edge functions"],
      },
      {
        key: "PAYSTACK_SECRET_KEY",
        present: !!Deno.env.get("PAYSTACK_SECRET_KEY"),
        required_for: ["initialize-payment", "wallet-topup", "verify-payment", "paystack-webhook"],
      },
      {
        key: "DATA_PROVIDER_API_KEY",
        present: !!Deno.env.get("DATA_PROVIDER_API_KEY"),
        required_for: ["data/AFA fulfillment in verify-payment and webhook"],
      },
      {
        key: "TWILIO_ACCOUNT_SID",
        present: !!Deno.env.get("TWILIO_ACCOUNT_SID"),
        required_for: ["admin-send-sms"],
      },
      {
        key: "TWILIO_AUTH_TOKEN",
        present: !!Deno.env.get("TWILIO_AUTH_TOKEN"),
        required_for: ["admin-send-sms"],
      },
      {
        key: "TWILIO_FROM_NUMBER",
        present: !!Deno.env.get("TWILIO_FROM_NUMBER"),
        required_for: ["admin-send-sms"],
      },
      {
        key: "SITE_URL",
        present: !!Deno.env.get("SITE_URL"),
        required_for: ["stable reset-password redirect links"],
      },
    ];

    const requiredTables = [
      { table: "profiles", probeColumn: "id" },
      { table: "orders", probeColumn: "id" },
      { table: "wallets", probeColumn: "id" },
      { table: "withdrawals", probeColumn: "id" },
      { table: "user_roles", probeColumn: "user_id" },
      { table: "notifications", probeColumn: "id" },
      { table: "maintenance_settings", probeColumn: "id" },
      { table: "global_package_settings", probeColumn: "id" },
    ];

    const tableChecks: TableCheck[] = [];

    for (const item of requiredTables) {
      const { error } = await supabaseAdmin
        .from(item.table)
        .select(item.probeColumn)
        .limit(1);

      tableChecks.push({
        table: item.table,
        exists: !error,
        error: error?.message || null,
      });
    }

    const functionNames = [
      "initialize-payment",
      "wallet-topup",
      "verify-payment",
      "paystack-webhook",
      "wallet-buy-data",
      "agent-withdraw",
      "admin-user-actions",
      "admin-send-sms",
      "admin-system-health",
    ];

    const functionChecks: FunctionCheck[] = [];

    for (const fn of functionNames) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "OPTIONS" });
        functionChecks.push({
          name: fn,
          reachable: res.status !== 404,
          status: res.status,
          error: res.status === 404 ? "Function not found (likely not deployed)" : null,
        });
      } catch (error) {
        functionChecks.push({
          name: fn,
          reachable: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const missingSecrets = requiredSecrets.filter((x) => !x.present).length;
    const missingTables = tableChecks.filter((x) => !x.exists).length;
    const missingFunctions = functionChecks.filter((x) => !x.reachable).length;

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        actor: {
          id: actor.id,
          email: actor.email,
          is_admin: true,
        },
        checks: {
          secrets: requiredSecrets,
          tables: tableChecks,
          functions: functionChecks,
        },
        summary: {
          missing_secrets: missingSecrets,
          missing_tables: missingTables,
          missing_functions: missingFunctions,
          healthy: missingSecrets === 0 && missingTables === 0 && missingFunctions === 0,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("admin-system-health error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
