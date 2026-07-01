import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

import { sendPaymentSms } from "../_shared/sms.ts";

// --- HELPERS ---
function normalizeRecipient(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log(`[REQ-AIRTIME] ${req.method} ${req.url}`);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const payload = await req.json().catch(() => ({}));
    console.log("[PAYLOAD-AIRTIME]", JSON.stringify(payload));

    const { network, customer_phone, amount: requestedAmount, reference } = payload;
    
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[AUTH-AIRTIME] No header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("[AUTH-AIRTIME] Verifying user...");
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("[AUTH-AIRTIME] Error:", userError);
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[USER-AIRTIME] ${user.id}`);

    // Fetch agent profile for sub-agent tracking
    const { data: agentProfile } = await supabaseAdmin
      .from("profiles")
      .select("is_sub_agent, parent_agent_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const parentAgentId = agentProfile?.is_sub_agent ? (agentProfile?.parent_agent_id ?? null) : null;

    // --- 🔴 SECURITY ENFORCEMENT: AMOUNT RANGE CHECK ---
    const amountNum = Number(requestedAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.error(`[SECURITY] Blocked invalid airtime amount from user ${user.id}: ${requestedAmount}`);
      return new Response(JSON.stringify({ error: "Invalid airtime amount. Order rejected." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-Duplicate Protection (1 Minute to prevent double-clicks, strictly scoped to this agent)
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const normalizedPhone = normalizeRecipient(customer_phone);
    let duplicateOrder = null;

    const { data: recentOrders } = await supabaseAdmin
      .from("orders")
      .select("id, status, network, amount, created_at")
      .eq("agent_id", user.id)
      .eq("customer_phone", normalizedPhone)
      .gte("created_at", oneMinuteAgo);

    if (recentOrders && recentOrders.length > 0) {
      const statusesToCheck = ["paid", "processing", "pending", "fulfilled", "completed", "failed", "fulfillment_failed", "refunded"];
      const match = recentOrders.find(o => {
        if (!statusesToCheck.includes(o.status)) return false;

        // Compare network case-insensitively with alias support
        const n1 = String(o.network || "").trim().toUpperCase();
        const n2 = String(network || "").trim().toUpperCase();
        const networksMatch = n1 === n2 ||
          ((n1 === "MTN" || n1 === "YELLO") && (n2 === "MTN" || n2 === "YELLO")) ||
          ((n1 === "TELECEL" || n1 === "VODAFONE" || n1 === "RED") && (n2 === "TELECEL" || n2 === "VODAFONE" || n2 === "RED")) ||
          ((n1 === "AT" || n1 === "AIRTELTIGO" || n1 === "BLUE") && (n2 === "AT" || n2 === "AIRTELTIGO" || n2 === "BLUE"));
        if (!networksMatch) return false;

        // Compare amount
        if (Math.abs(Number(o.amount) - Number(requestedAmount)) > 0.01) return false;

        return true;
      });

      if (match) {
        duplicateOrder = match;
      }
    }

    if (duplicateOrder) {
      console.warn(`[DUPLICATE-AIRTIME] Rejected duplicate order for ${normalizedPhone} within 1 minute`);
      return new Response(JSON.stringify({ 
        error: "Duplicate order detected. Please wait 60 seconds before placing the same order again." 
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. ATOMIC DEBIT (FOREGROUND)
    console.log(`[DEBIT-AIRTIME] Starting debit for ${requestedAmount}...`);
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: requestedAmount,
    });

    if (debitError || !debitResult?.success) {
      console.error(`[DEBIT_FAIL-AIRTIME] ${user.id}:`, debitError || debitResult?.error);
      return new Response(JSON.stringify({ error: debitResult?.error || "Insufficient balance" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = reference || crypto.randomUUID();

    // 2. INSERT ORDER (FOREGROUND)
    console.log(`[INSERT-AIRTIME] Creating order ${orderId}...`);
    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      customer_phone: normalizeRecipient(customer_phone),
      network: network,
      amount: requestedAmount,
      order_type: "airtime",
      profit: 0,
      parent_agent_id: parentAgentId,
      parent_profit: 0,
      status: "paid"
    });

    if (insertError) {
      console.error(`[INSERT_FAIL-AIRTIME] ${orderId}:`, insertError);
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: requestedAmount });
      return new Response(JSON.stringify({ error: "Failed to create order" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. TRIGGER SMS (NON-BLOCKING)
    sendPaymentSms(supabaseAdmin, customer_phone, "payment_success", {
      phone: customer_phone,
      package: "Airtime",
      amount: requestedAmount
    }, user.id).catch(e => console.error("[SMS-ERROR-AIRTIME]", e));

    return new Response(JSON.stringify({ 
      success: true, 
      order_id: orderId, 
      status: "paid" 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[CRASH-AIRTIME]", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
