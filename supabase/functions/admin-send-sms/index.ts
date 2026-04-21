import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type TargetType = "all" | "agents" | "users";

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

async function sendSmsViaTwilio(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio send failed (${response.status}): ${text}`);
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

  // Twilio config: prefer env vars, fall back to admin-configured system_settings
  let twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  let twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  let twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "";

  if (!twilioSid || !twilioToken || !twilioFrom) {
    try {
      const { data: smsRow } = await supabaseAdmin
        .from("system_settings")
        .select("twilio_account_sid, twilio_auth_token, twilio_from_number")
        .eq("id", 1)
        .maybeSingle();
      if (smsRow) {
        twilioSid = twilioSid || String(smsRow.twilio_account_sid || "");
        twilioToken = twilioToken || String(smsRow.twilio_auth_token || "");
        twilioFrom = twilioFrom || String(smsRow.twilio_from_number || "");
      }
    } catch { /* columns may not exist yet — ignore */ }
  }

  if (!twilioSid || !twilioToken || !twilioFrom) {
    return new Response(JSON.stringify({
      error: "SMS not configured. Add Twilio credentials in Admin → Settings → SMS Configuration.",
    }), {
      status: 500,
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

    const payload = await req.json();
    const target_type = (payload?.target_type || "all") as TargetType | "test";
    const title = String(payload?.title || "").trim();
    const message = String(payload?.message || "").trim();
    const test_phone = String(payload?.test_phone || "").trim();

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smsBody = title ? `${title}\n${message}` : message;

    // Test mode: send to a single provided number
    if (target_type === "test") {
      const normalized = normalizePhone(test_phone);
      if (!normalized) {
        return new Response(JSON.stringify({ error: "Invalid test phone number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sendSmsViaTwilio(twilioSid, twilioToken, twilioFrom, normalized, smsBody);
      return new Response(JSON.stringify({ success: true, sent: 1, target_type: "test", to: normalized }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["all", "agents", "users"].includes(target_type)) {
      return new Response(JSON.stringify({ error: "Invalid target_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniquePhones = new Set<string>();
    let skipped = 0;

    for (const row of recipients || []) {
      const normalized = normalizePhone(row.phone);
      if (!normalized) {
        skipped += 1;
        continue;
      }
      uniquePhones.add(normalized);
    }

    let sent = 0;
    const failures: Array<{ phone: string; reason: string }> = [];

    for (const phone of uniquePhones) {
      try {
        await sendSmsViaTwilio(
          twilioSid,
          twilioToken,
          twilioFrom,
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
      total_recipients: (recipients || []).length,
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
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
