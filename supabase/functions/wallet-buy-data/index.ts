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
      .from("v_system_settings_with_secrets").select("maintenance_mode, maintenance_message").eq("id", 1).maybeSingle();
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

    // --- 🔴 SECURITY ENFORCEMENT: STRICT SERVER-SIDE PRICING ---
    // Ignore the frontend's requested amount entirely. Calculate the exact wholesale price 
    // the agent must pay based on their tier (Sub-Agent vs Direct Agent) and the global settings.

    let resolvedChargeAmount = adminBase;
    let parentAgentId: string | null = null;
    let parentProfit = 0;
    let agentProfit = 0;
    let orderAgentId = user.id;
    let orderCustomerId: string | null = null;

    const isStorefrontCustomer = agentProfile?.parent_agent_id && !agentProfile?.is_sub_agent;

    if (isStorefrontCustomer) {
      const storeOwnerId = agentProfile.parent_agent_id!;
      orderAgentId = storeOwnerId;
      orderCustomerId = user.id;

      // Fetch store owner's profile
      const { data: sellerProfile } = await supabaseAdmin
        .from("profiles")
        .select("is_sub_agent, parent_agent_id, agent_prices")
        .eq("user_id", storeOwnerId)
        .maybeSingle();

      if (sellerProfile) {
        const sellerPrices = (sellerProfile.agent_prices || {}) as Record<string, Record<string, string | number>>;
        
        let sellerListed = 0;
        const netCandidates = [normalizedNet, networkRaw, networkRaw.replace(/\s+/g, "")];
        const pkgCandidates = [normalizeSize(package_size), package_size];
        
        // Helper to search price maps
        const searchMap = (map: Record<string, Record<string, string | number>>) => {
          for (const n of netCandidates) {
            if (!map[n]) continue;
            for (const p of pkgCandidates) {
              const val = Number(map[n][p]);
              if (Number.isFinite(val) && val > 0) return val;
            }
          }
          return 0;
        };

        sellerListed = searchMap(sellerPrices);

        let chargeBase = adminBase;

        if (sellerProfile.is_sub_agent) {
          parentAgentId = sellerProfile.parent_agent_id || null;
          let parentAssignedBase = 0;

          if (parentAgentId) {
            const { data: parentProfile } = await supabaseAdmin
              .from("profiles")
              .select("sub_agent_prices, agent_prices")
              .eq("user_id", parentAgentId)
              .maybeSingle();

            if (parentProfile) {
              const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, Record<string, string | number>>;
              const agentPrices = (parentProfile.agent_prices || {}) as Record<string, Record<string, string | number>>;
              const hasSubPrices = Object.keys(subPrices).length > 0;

              parentAssignedBase = searchMap(hasSubPrices ? subPrices : agentPrices);

              if (!(parentAssignedBase > 0) && hasSubPrices) {
                parentAssignedBase = searchMap(agentPrices);
              }
            }
          }

          if (!(parentAssignedBase >= adminBase)) {
            parentAssignedBase = adminBase;
          }

          chargeBase = Number.isFinite(sellerListed) && sellerListed > parentAssignedBase
            ? sellerListed
            : parentAssignedBase;

          parentProfit = Math.max(0, parseFloat((parentAssignedBase - adminBase).toFixed(2)));
          agentProfit = Math.max(0, parseFloat((chargeBase - parentAssignedBase).toFixed(2)));
        } else {
          chargeBase = Number.isFinite(sellerListed) && sellerListed > adminBase
            ? sellerListed
            : adminBase;
          agentProfit = Math.max(0, parseFloat((chargeBase - adminBase).toFixed(2)));
        }

        resolvedChargeAmount = chargeBase;
      }
    } else if (agentProfile?.is_sub_agent && agentProfile?.parent_agent_id) {
      // Find parent's assigned price for this sub-agent
      const { data: parentProfile } = await supabaseAdmin
        .from("profiles")
        .select("sub_agent_prices, agent_prices")
        .eq("user_id", agentProfile.parent_agent_id)
        .maybeSingle();

      if (parentProfile) {
        const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, Record<string, string | number>>;
        const agentPrices = (parentProfile.agent_prices || {}) as Record<string, Record<string, string | number>>;
        
        let parentAssignedBase = 0;
        const netCandidates = [normalizedNet, networkRaw, networkRaw.replace(/\s+/g, "")];
        const pkgCandidates = [normalizeSize(package_size), package_size];
        
        const searchMap = (map: Record<string, Record<string, string | number>>) => {
          for (const n of netCandidates) {
            if (!map[n]) continue;
            for (const p of pkgCandidates) {
              const val = Number(map[n][p]);
              if (Number.isFinite(val) && val > 0) return val;
            }
          }
          return 0;
        };

        if (Object.keys(subPrices).length > 0) {
          parentAssignedBase = searchMap(subPrices);
        }
        if (!(parentAssignedBase > 0)) {
          parentAssignedBase = searchMap(agentPrices);
        }

        if (parentAssignedBase > 0) {
          resolvedChargeAmount = parentAssignedBase;
        }
      }

      // Sub-agent pays parent's wholesale price; parent keeps margin above admin wholesale
      parentAgentId = agentProfile.parent_agent_id;
      parentProfit = Math.max(0, parseFloat((resolvedChargeAmount - adminBase).toFixed(2)));
      agentProfit = 0; // Sub-agent profit is collected offline as cash
    } else {
      // Direct agent pays admin wholesale price
      resolvedChargeAmount = adminBase;
      agentProfit = 0; // Regular agent profit is collected offline as cash
    }

    if (resolvedChargeAmount <= 0) {
      console.error(`[SECURITY] Blocked order: Could not resolve valid wholesale price for ${normalizedNet} ${package_size}.`);
      return new Response(JSON.stringify({ error: "Pricing configuration error. Please contact support." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountNum = resolvedChargeAmount;

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
    console.log(`[DEBIT] Starting debit for ${amountNum}...`);
    let paymentMethod = "wallet";
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: amountNum,
    });

    if (debitError || !debitResult?.success) {
      const debitErrMsg = debitError?.message || debitResult?.message || debitResult?.error || "Insufficient funds and credit limit";
      console.error(`[DEBIT_FAIL] ${user.id}: ${debitErrMsg}`, { debitError, debitResult });
      
      log(supabaseAdmin, { level: "error", source: "wallet-buy-data", event: "debit.failed", message: `Wallet debit failed: ${debitErrMsg}`, agent_id: user.id, data: { amount: amountNum, debit_error: debitError?.message, debit_result: debitResult } });
      
      return new Response(JSON.stringify({ error: debitErrMsg }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (debitResult?.new_balance < 0) {
      paymentMethod = "credit";
      log(supabaseAdmin, { level: "info", source: "wallet-buy-data", event: "credit.drawn", message: `Credit drawn. Account is in overdraft (GHS ${debitResult.new_balance}) for ${user.id}`, agent_id: user.id, data: { amount: amountNum, new_balance: debitResult.new_balance } });
    }
    
    console.log(`[DEBIT_SUCCESS] New balance: ${(debitResult as any).new_balance}`);

    const orderId = reference || crypto.randomUUID();

    // 2. INSERT ORDER (FOREGROUND)
    console.log(`[INSERT] Creating order ${orderId}...`);
    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: orderAgentId,
      customer_id: orderCustomerId || undefined,
      customer_phone: normalizeRecipient(customer_phone),
      network: normalizeNetworkForPricing(networkRaw),
      package_size: package_size,
      amount: amountNum, // Use strictly resolved server-side amount
      payment_method: paymentMethod,
      cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
      profit: agentProfit,
      parent_agent_id: parentAgentId,
      parent_profit: parentProfit,
      status: "paid"
    });

    if (insertError) {
      console.error(`[INSERT_FAIL] ${orderId}:`, insertError);
      log(supabaseAdmin, { level: "error", source: "wallet-buy-data", event: "order.create_failed", message: `Order insert failed: ${insertError.message}`, order_id: orderId, agent_id: user.id, data: { network: networkRaw, package_size, amount: amountNum, error: insertError.message } });
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: amountNum });
      return new Response(JSON.stringify({ error: "Failed to create order record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[INSERT_SUCCESS] Order ${orderId} created as PAID.`);
    log(supabaseAdmin, { level: "info", source: "wallet-buy-data", event: "order.created", message: `Order created — ${networkRaw} ${package_size} for ${customer_phone}`, order_id: orderId, agent_id: user.id, data: { network: networkRaw, package_size, amount: amountNum, profit: agentProfit, parent_profit: parentProfit, cost_price: resolvedCostPrice } });

    // 3. TRIGGER SMS (NON-BLOCKING)
    sendPaymentSms(supabaseAdmin, customer_phone, "payment_success", {
      phone: customer_phone,
      package: package_size || "Data Bundle",
      amount: amountNum
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