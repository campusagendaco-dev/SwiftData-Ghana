import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

import { sendPaymentSms } from "../_shared/sms.ts";
import { log } from "../_shared/logger.ts";

// --- HELPERS ---
function normalizeNetworkForPricing(network: string): "MTN" | "Telecel" | "AirtelTigo" {
  const n = (network || "").trim().toUpperCase();
  if (n === "AT" || n === "AIRTEL TIGO" || n === "AIRTELTIGO") return "AirtelTigo";
  if (n === "VODAFONE" || n === "TELECEL") return "Telecel";
  return "MTN";
}

function normalizeRecipient(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let supabaseAdmin: any;
  try {
    console.log(`[REQ] ${req.method} ${req.url}`);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables");
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const payload = await req.json().catch(() => ({}));
    console.log("[PAYLOAD]", JSON.stringify(payload));

    const { network: networkRaw, package_size, customer_phone, amount: requestedAmount, reference } = payload;
    
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[AUTH] No header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("[AUTH] Verifying user...");
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("[AUTH] Error:", userError);
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[USER] ${user.id} (${user.email})`);

    const normalizedPhone = normalizeRecipient(customer_phone);
    const normalizedNet = normalizeNetworkForPricing(networkRaw);

    // Maintenance mode check
    const { data: sysSettings } = await supabaseAdmin
      .from("system_settings").select("maintenance_mode, maintenance_message").eq("id", 1).maybeSingle();
    if (sysSettings?.maintenance_mode) {
      return new Response(JSON.stringify({
        error: sysSettings.maintenance_message || "System is under maintenance. Please try again shortly."
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fraud / velocity check
    const { data: velocityFlag } = await supabaseAdmin.rpc("check_order_velocity", {
      p_phone: normalizedPhone, p_agent_id: user.id
    });
    if (velocityFlag) {
      log(supabaseAdmin, { level: "warn", source: "wallet-buy-data", event: "fraud.blocked", message: `Order blocked — ${velocityFlag} flag for ${normalizedPhone}`, agent_id: user.id, data: { flag: velocityFlag, phone: normalizedPhone, network: networkRaw, package_size } });
      return new Response(JSON.stringify({ error: velocityFlag === "blacklist" ? "This number is not eligible to receive data bundles." : "Order limit reached. Please wait before placing another order." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch agent profile and package info in parallel for profit calculation
    const [profileResult, pkgResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("is_sub_agent, parent_agent_id, credit_enabled, credit_limit, credit_used").eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("global_package_settings").select("package_size, agent_price, cost_price, is_unavailable").eq("network", normalizedNet),
    ]);

    const agentProfile = profileResult.data;
    
    const normalizeSize = (s: string) => s.replace(/\s+/g, "").toUpperCase();
    const pkgRow = (pkgResult.data || []).find(
      (row: any) => normalizeSize(row.package_size) === normalizeSize(package_size)
    );

    // Check if the package is globally marked as unavailable/offline
    if (pkgRow?.is_unavailable) {
      log(supabaseAdmin, {
        level: "warn",
        source: "wallet-buy-data",
        event: "order.offline_blocked",
        message: `Blocked wallet order for offline package: ${normalizedNet} ${package_size}`,
        agent_id: user.id,
      });
      return new Response(JSON.stringify({ 
        error: "This package is currently offline and unavailable for purchase. Please try another bundle." 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const adminBase = Number(pkgRow?.agent_price || 0);
    const resolvedCostPrice = Number(pkgRow?.cost_price || 0) > 0 ? Number(pkgRow!.cost_price) : adminBase;

    // Calculate profit and parent referral commission
    let parentAgentId: string | null = null;
    let parentProfit = 0;
    let agentProfit = 0;

    if (agentProfile?.is_sub_agent && agentProfile?.parent_agent_id && adminBase > 0) {
      // Sub-agent: profit stays 0 (they sell at their own price); parent earns the margin
      parentAgentId = agentProfile.parent_agent_id;
      parentProfit = Math.max(0, parseFloat((Number(requestedAmount) - adminBase).toFixed(2)));
    } else if (resolvedCostPrice > 0) {
      // Regular agent: profit = selling price - cost price
      agentProfit = Math.max(0, parseFloat((Number(requestedAmount) - resolvedCostPrice).toFixed(2)));
    }

    // --- 🔴 SECURITY ENFORCEMENT: AMOUNT & PRICE FLOOR CHECK ---
    const amountNum = Number(requestedAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.error(`[SECURITY] Blocked invalid amount from user ${user.id}: ${requestedAmount}`);
      return new Response(JSON.stringify({ error: "Invalid order amount. Transaction rejected." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce a loose safety floor (50% of cost or agent price) to prevent 
    // malicious API abuse (e.g. paying 1 pesewa) while still fully allowing 
    // legitimate loss-leader promotional discounts from the frontend.
    const dbCostPrice = Number(pkgRow?.cost_price || 0);
    const referencePrice = dbCostPrice > 0 ? dbCostPrice : adminBase;
    const absoluteFloor = referencePrice * 0.5;

    if (amountNum < absoluteFloor && absoluteFloor > 0) {
      console.error(`[SECURITY] Blocked underpriced order from user ${user.id}. Received: ${amountNum}, Absolute Floor: ${absoluteFloor}`);
      return new Response(JSON.stringify({ error: "Transaction rejected due to package price discrepancy. Price is below minimum floor." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-Duplicate Protection (1 Minute to prevent double-clicks, strictly scoped to this agent)
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    const { data: duplicateOrder } = await supabaseAdmin
      .from("orders")
      .select("id, created_at")
      .eq("agent_id", user.id)
      .eq("customer_phone", normalizedPhone)
      .eq("network", normalizedNet)
      .eq("package_size", package_size)
      .in("status", ["paid", "processing", "fulfilled", "completed"])
      .gte("created_at", oneMinuteAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicateOrder) {
      console.warn(`[DUPLICATE] Rejected duplicate order for ${normalizedPhone} within 1 minute`);
      return new Response(JSON.stringify({ 
        error: "Duplicate order detected. Please wait 60 seconds before placing the same order again." 
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. ATOMIC DEBIT (wallet first, credit fallback)
    console.log(`[DEBIT] Starting debit for ${requestedAmount}...`);
    let paymentMethod = "wallet";
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: requestedAmount,
    });

    if (debitError || !debitResult?.success) {
      const debitErrMsg = debitError?.message || debitResult?.message || debitResult?.error || "Insufficient funds and credit limit";
      console.error(`[DEBIT_FAIL] ${user.id}: ${debitErrMsg}`, { debitError, debitResult });
      
      log(supabaseAdmin, { level: "error", source: "wallet-buy-data", event: "debit.failed", message: `Wallet debit failed: ${debitErrMsg}`, agent_id: user.id, data: { amount: requestedAmount, debit_error: debitError?.message, debit_result: debitResult } });
      
      return new Response(JSON.stringify({ error: debitErrMsg }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (debitResult?.new_balance < 0) {
      paymentMethod = "credit";
      log(supabaseAdmin, { level: "info", source: "wallet-buy-data", event: "credit.drawn", message: `Credit drawn. Account is in overdraft (GHS ${debitResult.new_balance}) for ${user.id}`, agent_id: user.id, data: { amount: requestedAmount, new_balance: debitResult.new_balance } });
    }
    
    console.log(`[DEBIT_SUCCESS] New balance: ${(debitResult as any).new_balance}`);

    const orderId = reference || crypto.randomUUID();

    // 2. INSERT ORDER (FOREGROUND)
    console.log(`[INSERT] Creating order ${orderId}...`);
    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      customer_phone: normalizeRecipient(customer_phone),
      network: normalizeNetworkForPricing(networkRaw),
      package_size: package_size,
      amount: requestedAmount,
      payment_method: paymentMethod,
      cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
      profit: agentProfit,
      parent_agent_id: parentAgentId,
      parent_profit: parentProfit,
      status: "paid"
    });

    if (insertError) {
      console.error(`[INSERT_FAIL] ${orderId}:`, insertError);
      log(supabaseAdmin, { level: "error", source: "wallet-buy-data", event: "order.create_failed", message: `Order insert failed: ${insertError.message}`, order_id: orderId, agent_id: user.id, data: { network: networkRaw, package_size, amount: requestedAmount, error: insertError.message } });
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: requestedAmount });
      return new Response(JSON.stringify({ error: "Failed to create order record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[INSERT_SUCCESS] Order ${orderId} created as PAID.`);
    log(supabaseAdmin, { level: "info", source: "wallet-buy-data", event: "order.created", message: `Order created — ${networkRaw} ${package_size} for ${customer_phone}`, order_id: orderId, agent_id: user.id, data: { network: networkRaw, package_size, amount: requestedAmount, profit: agentProfit, parent_profit: parentProfit, cost_price: resolvedCostPrice } });

    // 3. TRIGGER SMS (NON-BLOCKING)
    sendPaymentSms(supabaseAdmin, customer_phone, "payment_success", {
      phone: customer_phone,
      package: package_size || "Data Bundle",
      amount: requestedAmount
    }, user.id).catch(e => console.error("[SMS-ERROR]", e));

    // 4. AUTO-BRIDGE CHECK (NON-BLOCKING)
    if (agentProfile?.is_sub_agent) {
      supabaseAdmin.rpc("process_auto_bridges_for_agent", { p_sub_agent_id: user.id })
        .then(({ data, error }: any) => {
          if (error) console.error("[AUTO-BRIDGE-ERROR]", error);
          else if (data?.success) console.log("[AUTO-BRIDGE-SUCCESS]", data);
        })
        .catch((e: any) => console.error("[AUTO-BRIDGE-CRASH]", e));
    }

    // 4. RETURN SUCCESS IMMEDIATELY
    return new Response(JSON.stringify({ 
      success: true, 
      order_id: orderId, 
      status: "paid" 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[CRASH]", error);
    if (supabaseAdmin) {
      log(supabaseAdmin, { level: "error", source: "wallet-buy-data", event: "error", message: `Unhandled crash: ${error?.message || String(error)}`, data: { stack: error?.stack?.slice(0, 500) } });
    }
    return new Response(JSON.stringify({ error: "Internal processing error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});