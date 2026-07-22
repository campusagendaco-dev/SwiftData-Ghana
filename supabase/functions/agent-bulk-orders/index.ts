import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function normalizeNetworkForPricing(network: string): "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo" {
  const n = (network || "").trim().toUpperCase();
  if (n === "AT" || n === "AIRTEL TIGO" || n === "AIRTELTIGO" || n === "AIRTEL") return "AirtelTigo";
  if (n === "VODAFONE" || n === "TELECEL") return "Telecel";
  if (n === "MTN MASH UP" || n === "MTN_MASH_UP" || n === "MTN MASHUP" || n === "MTN MASH-UP" || n === "MASHUP" || n === "MASH UP") return "MTN Mash Up";
  return "MTN";
}

function normalizeRecipient(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json().catch(() => ({}));
    const { orders } = payload;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid orders array" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (orders.length > 500) {
      return new Response(JSON.stringify({ error: "Maximum 500 orders per bulk dispatch" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Fetch Agent Profile and Settings
    const [profileRes, walletRes, settingsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("is_sub_agent, parent_agent_id").eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
      supabaseAdmin.from("global_package_settings").select("network, package_size, cost_price, agent_price, sub_agent_price, is_unavailable")
    ]);

    const profile = profileRes.data;
    const walletBalance = walletRes.data?.balance ?? 0;
    const allPkgs = settingsRes.data || [];

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Validate and Calculate Totals
    let totalCost = 0;
    const validOrdersToInsert = [];
    const errors = [];

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const normNet = normalizeNetworkForPricing(o.network);
      const normPhone = normalizeRecipient(o.customer_phone);
      const size = (o.package_size || "").replace(/\s+/g, "").toUpperCase();

      const pkg = allPkgs.find(p => p.network === normNet && p.package_size.replace(/\s+/g, "").toUpperCase() === size);
      
      if (!pkg) {
        errors.push({ row: i + 1, phone: o.customer_phone, error: `Unknown package: ${o.network} ${o.package_size}` });
        continue;
      }

      if (pkg.is_unavailable) {
        errors.push({ row: i + 1, phone: o.customer_phone, error: `Package ${o.network} ${o.package_size} is currently offline (unavailable).` });
        continue;
      }

      if (!normPhone || normPhone.length !== 10) {
        errors.push({ row: i + 1, phone: o.customer_phone, error: "Invalid phone number format" });
        continue;
      }

      // Calculate the cost
      const requestedAmount = Number(o.amount);
      const adminBase = Number(pkg.agent_price);
      if (!adminBase || adminBase <= 0) {
        errors.push({ row: i + 1, phone: o.customer_phone, error: `Pricing gap: Package ${o.network} ${o.package_size} has no valid system price.` });
        continue;
      }
      const resolvedCostPrice = Number(pkg.cost_price || 0) > 0 ? Number(pkg.cost_price) : adminBase;

      let parentAgentId = null;
      let parentProfit = 0;
      let agentProfit = 0;

      if (profile.is_sub_agent && profile.parent_agent_id && adminBase > 0) {
        parentAgentId = profile.parent_agent_id;
        parentProfit = Math.max(0, requestedAmount - adminBase);
      } else if (resolvedCostPrice > 0) {
        agentProfit = Math.max(0, requestedAmount - resolvedCostPrice);
      }

      // We trust the frontend amount, but enforce a floor of 50% cost price to prevent hacking
      if (requestedAmount < (resolvedCostPrice > 0 ? resolvedCostPrice : adminBase) * 0.5) {
        errors.push({ row: i + 1, phone: o.customer_phone, error: "Amount submitted is below system floor price." });
        continue;
      }

      totalCost += requestedAmount;

      validOrdersToInsert.push({
        id: crypto.randomUUID(),
        agent_id: user.id,
        customer_phone: normPhone,
        network: normNet,
        package_size: o.package_size,
        amount: requestedAmount,
        payment_method: "wallet",
        cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
        profit: agentProfit,
        parent_agent_id: parentAgentId,
        parent_profit: parentProfit,
        status: "paid"
      });
    }

    if (validOrdersToInsert.length === 0) {
      return new Response(JSON.stringify({ 
        error: "All orders failed validation", 
        errors 
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Debit Wallet ATOMICALLY for total cost
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: totalCost
    });

    if (debitError || !debitResult?.success) {
       return new Response(JSON.stringify({ 
        error: "Insufficient wallet balance for bulk dispatch", 
        required_balance: totalCost,
        current_balance: walletBalance
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Insert Orders
    const { error: insertError } = await supabaseAdmin.from("orders").insert(validOrdersToInsert);

    if (insertError) {
      // Refund if insert fails
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: totalCost });
      return new Response(JSON.stringify({ error: "Failed to create bulk orders. Wallet refunded." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully dispatched ${validOrdersToInsert.length} orders.`,
      total_debited: totalCost,
      errors: errors.length > 0 ? errors : undefined
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
