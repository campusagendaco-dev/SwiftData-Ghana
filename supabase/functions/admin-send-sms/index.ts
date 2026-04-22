import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type TargetType = "all" | "agents" | "users" | "pending_orders";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const clean = raw.trim().replace(/[^\d+]/g, "");
  if (!clean) return null;

  if (clean.startsWith("+")) {
    const onlyDigits = `+${clean.slice(1).replace(/\D/g, "")}`;
    return onlyDigits.length >= 11 ? onlyDigits : null;
  }

  const digits = clean.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("233") && digits.length >= 12) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length >= 10) {
    return `+233${digits.slice(1)}`;
  }

  if (digits.startsWith("00") && digits.length > 2) {
    return `+${digits.slice(2)}`;
  }

  return digits.length >= 10 ? `+${digits}` : null;
}

async function sendSmsViaTxtConnect(
  apiKey: string,
  from: string,
  to: string,
  body: string,
) {
  const endpoint = "https://api.txtconnect.net/v1/send";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      API_key: apiKey,
      TO: to,
      FROM: from,
      SMS: body,
      RESPONSE: "json",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TxtConnect send failed (${response.status}): ${text}`);
  }
  
  const data = await response.json();
  if (data && data.status !== "ok" && data.error) {
     throw new Error(`TxtConnect API Error: ${data.error}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, // Important: Changed to 200 so Supabase JS Client can parse data.error instead of throwing generic exception
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // TxtConnect config: prefer env vars, fall back to admin-configured system_settings, then hardcoded fallbacks
  let txtApiKey = Deno.env.get("TXTCONNECT_API_KEY") || "";
  let txtSenderId = Deno.env.get("TXTCONNECT_SENDER_ID") || "";

  if (!txtApiKey || !txtSenderId) {
    try {
      const { data: smsRow } = await supabaseAdmin
        .from("system_settings")
        .select("txtconnect_api_key, txtconnect_sender_id")
        .eq("id", 1)
        .maybeSingle();
      if (smsRow) {
        txtApiKey = txtApiKey || String(smsRow.txtconnect_api_key || "");
        txtSenderId = txtSenderId || String(smsRow.txtconnect_sender_id || "");
      }
    } catch { /* columns may not exist yet — ignore */ }
  }

  // Hardcoded fallback provided by user to ensure it works immediately
  if (!txtApiKey) txtApiKey = "T5Ca1X9vjBnVexWoyLrfcpQSYdR02NhU46wm7IsE8gMZJOGqlF";
  if (!txtSenderId) txtSenderId = "SwiftDataGh";

  if (!txtApiKey || !txtSenderId) {
    return new Response(JSON.stringify({
      error: "SMS not configured. Please ensure you have added your TxtConnect API Key and Sender ID in the Admin Settings.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      data: { user: actor },
      error: actorError,
    } = await supabaseUser.auth.getUser();

    if (actorError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200,
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
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const target_type = (payload?.target_type || "all") as TargetType | "test";
    const title = String(payload?.title || "").trim();
    const message = String(payload?.message || "").trim();
    const test_phone = String(payload?.test_phone || "").trim();

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smsBody = title ? `${title}\n${message}` : message;

    // Test mode: send to a single provided number
    if (target_type === "test") {
      const normalized = normalizePhone(test_phone);
      if (!normalized) {
        return new Response(JSON.stringify({ error: "Invalid test phone number" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sendSmsViaTxtConnect(txtApiKey, txtSenderId, normalized, smsBody);
      return new Response(JSON.stringify({ success: true, sent: 1, target_type: "test", to: normalized }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["all", "agents", "users", "pending_orders"].includes(target_type)) {
      return new Response(JSON.stringify({ error: "Invalid target_type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniquePhones = new Set<string>();
    let skipped = 0;
    let totalRecipients = 0;

    if (target_type === "pending_orders") {
      const { data: pendingOrders, error: ordersError } = await supabaseAdmin
        .from("orders")
        .select(`
          customer_phone,
          agent_id,
          profiles ( phone )
        `)
        .eq("status", "pending");

      if (ordersError) {
        return new Response(JSON.stringify({ error: ordersError.message }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const row of pendingOrders || []) {
        totalRecipients += 1;
        const cPhone = normalizePhone(row.customer_phone);
        const aPhone = row.profiles ? normalizePhone((row.profiles as any).phone) : null;
        
        if (cPhone) uniquePhones.add(cPhone);
        else if (aPhone) uniquePhones.add(aPhone);
        else skipped += 1;
      }
    } else {
      let profilesQuery = supabaseAdmin
        .from("profiles")
        .select("user_id, phone, is_agent");

      if (target_type === "agents") {
        profilesQuery = profilesQuery.eq("is_agent", true);
      } else if (target_type === "users") {
        profilesQuery = profilesQuery.eq("is_agent", false);
      }

      const { data: recipients, error: recipientsError } = await profilesQuery;
      if (recipientsError) {
        return new Response(JSON.stringify({ error: recipientsError.message }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      totalRecipients = (recipients || []).length;
      for (const row of recipients || []) {
        const normalized = normalizePhone(row.phone);
        if (!normalized) {
          skipped += 1;
          continue;
        }
        uniquePhones.add(normalized);
      }
    }

    let sent = 0;
    const failures: Array<{ phone: string; reason: string }> = [];

    for (const phone of uniquePhones) {
      try {
        await sendSmsViaTxtConnect(
          txtApiKey,
          txtSenderId,
          phone,
          smsBody,
        );
        sent += 1;
      } catch (error) {
        failures.push({
          phone,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      target_type,
      total_recipients: totalRecipients,
      valid_numbers: uniquePhones.size,
      sent,
      failed: failures.length,
      skipped_invalid_or_empty: skipped,
      failures: failures.slice(0, 15),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("admin-send-sms error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
