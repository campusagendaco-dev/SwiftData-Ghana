import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;

// Mirrors src/lib/data.ts — used when global_package_settings has no row for a package
const BASE_PACKAGE_PRICES: Record<string, Record<string, number>> = {
  MTN: {
    "1GB": 4.45, "2GB": 8.9, "3GB": 13.1, "4GB": 17.3, "5GB": 21.2,
    "6GB": 25.7, "7GB": 29.6, "8GB": 33.2, "10GB": 42.5, "15GB": 62.0,
    "20GB": 80.2, "25GB": 100.8, "30GB": 124.0, "40GB": 159.0,
    "50GB": 199.3, "100GB": 385.0,
  },
  Telecel: {
    "5GB": 23.0, "10GB": 41.8, "12GB": 49.0, "15GB": 58.99, "18GB": 71.8,
    "20GB": 78.5, "22GB": 82.5, "25GB": 102.0, "30GB": 125.5,
    "40GB": 166.0, "50GB": 190.0,
  },
  AirtelTigo: {
    "1GB": 4.3, "2GB": 8.2, "3GB": 12.0, "4GB": 15.8, "5GB": 19.85,
    "6GB": 23.49, "7GB": 27.0, "8GB": 30.59, "9GB": 34.2,
  },
};

function getHardcodedBasePrice(network: string, packageSize: string): number {
  const byNet = BASE_PACKAGE_PRICES[network] ?? {};
  const candidates = [...new Set([packageSize, packageSize.replace(/\s+/g, "").toUpperCase()])];
  for (const c of candidates) {
    if (Number.isFinite(byNet[c]) && byNet[c] > 0) return byNet[c];
  }
  return 0;
}

function amountMatches(expected: number, actual: number, tolerance = 0.01): boolean {
  return Math.abs(expected - actual) <= tolerance;
}

function calculatePaystackFee(amount: number): number {
  return Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);
}

function normalizeNetwork(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AT" || normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO") return "AirtelTigo";
  if (normalized === "VODAFONE") return "Telecel";
  if (normalized === "TELECEL") return "Telecel";
  return "MTN";
}

function resolvePriceFromMap(
  prices: Record<string, Record<string, string | number>>,
  normalizedNetwork: string,
  network: string,
  normalizedPackage: string,
  packageSize: string,
): number {
  const networkCandidates = [normalizedNetwork, network, network.replace(/\s+/g, "")];
  const packageCandidates = [normalizedPackage, packageSize, packageSize.replace(/\s+/g, "")];

  for (const n of networkCandidates) {
    const byNetwork = prices[n];
    if (!byNetwork || typeof byNetwork !== "object") continue;
    for (const p of packageCandidates) {
      const value = Number(byNetwork[p]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return 0;
}

function hasValidAgentId(agentId: unknown): agentId is string {
  return typeof agentId === "string" && agentId.length > 0 && agentId !== "00000000-0000-0000-0000-000000000000";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = (Deno as any).env.get("PAYSTACK_SECRET_KEY");
  const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY is not configured");
    return new Response(JSON.stringify({ error: "Paystack not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Validate key type — must be a secret key
  if (PAYSTACK_SECRET_KEY.startsWith("pk_")) {
    console.error("PAYSTACK_SECRET_KEY contains a public key instead of secret key");
    return new Response(JSON.stringify({ error: "Invalid Paystack key configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("holiday_mode_enabled, holiday_message, disable_ordering")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.disable_ordering) {
      // Read order type from body to decide whether to bypass — parse body early
      let earlyOrderType = "data";
      try {
        const earlyBody = await req.clone().json();
        earlyOrderType = earlyBody?.metadata?.order_type || "data";
      } catch { /* ignore */ }
      const bypassTypes = ["agent_activation", "sub_agent_activation", "wallet_topup", "utility"];
      if (!bypassTypes.includes(earlyOrderType)) {
        return new Response(JSON.stringify({
          error: settings.holiday_message || "Ordering is currently disabled. Please try again later.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const payload = await req.json();
    const email = typeof payload?.email === "string" ? payload.email.trim() : "";
    const amount = Number(payload?.amount);
    const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";
    const callback_url = payload?.callback_url;
    const metadata = payload?.metadata || {};

    if (!email || !reference) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side order creation — don't trust frontend to create orders
    const orderType = metadata.order_type || "data";
    const agentId = metadata.agent_id || "00000000-0000-0000-0000-000000000000";
    const isAgentLinkedOrder = hasValidAgentId(agentId);

    const priceMultiplier = 1;
    let resolvedAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    let resolvedProfit = 0;
    let resolvedParentProfit = 0;
    let resolvedParentAgentId: string | null = null;
    let resolvedPaystackFee = 0;
    let resolvedCostPrice = 0;
    let resolvedWalletCredit: number | null = null;
    let enrichedMetadata: Record<string, unknown> = { ...metadata };

    if (orderType === "data") {
      const network = typeof metadata.network === "string" ? metadata.network : "";
      const packageSize = typeof metadata.package_size === "string" ? metadata.package_size : "";
      if (!network || !packageSize) {
        return new Response(JSON.stringify({ error: "Missing data order metadata" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const normalizedNetwork = normalizeNetwork(network);
      const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();

      type GlobalRow = {
        cost_price: number | null;
        agent_price: number | null;
        public_price: number | null;
        is_unavailable: boolean;
        pricing_source: "db" | "hardcoded_fallback";
      };

      // Helper: look up a package row trying normalised key then original key,
      // with hardcoded base prices as final fallback so purchases never fail
      // just because the admin hasn't seeded global_package_settings yet.
      async function lookupGlobalRow(net: string, pkg: string): Promise<GlobalRow | null> {
        const candidates = [pkg, packageSize, packageSize.replace(/\s+/g, "")];
        let dbRow: { cost_price: number | null; agent_price: number | null; public_price: number | null; is_unavailable: boolean } | null = null;
        for (const candidate of [...new Set(candidates)]) {
          const { data } = await supabaseAdmin
            .from("global_package_settings")
            .select("cost_price, agent_price, public_price, is_unavailable")
            .eq("network", net)
            .eq("package_size", candidate)
            .maybeSingle();
          if (data) { dbRow = data; break; }
        }

        const hasValidCost = Number.isFinite(Number(dbRow?.cost_price)) && Number(dbRow?.cost_price) > 0;
        const hasValidAgent = Number.isFinite(Number(dbRow?.agent_price)) && Number(dbRow?.agent_price) > 0;
        const hasValidPublic = Number.isFinite(Number(dbRow?.public_price)) && Number(dbRow?.public_price) > 0;

        // If DB row has at least one valid price, return it with db source
        if (dbRow && (hasValidCost || hasValidAgent || hasValidPublic)) {
          return { ...dbRow, pricing_source: "db" };
        }

        // DB row missing or has no valid prices — synthesise/merge from hardcoded prices
        const fallbackBase = getHardcodedBasePrice(net, pkg) || getHardcodedBasePrice(normalizedNetwork, packageSize);
        if (fallbackBase > 0) {
          console.warn(
            `[pricing] Using hardcoded fallback for ${net}/${pkg}: agent=${fallbackBase}, public=${(fallbackBase * 1.12).toFixed(2)}. ` +
            `Run "Seed Default Prices" in Admin > Package Management to remove this warning.`
          );
          return {
            cost_price: hasValidCost ? dbRow!.cost_price : fallbackBase,
            agent_price: hasValidAgent ? dbRow!.agent_price : fallbackBase,
            public_price: hasValidPublic ? dbRow!.public_price : Number((fallbackBase * 1.12).toFixed(2)),
            is_unavailable: dbRow?.is_unavailable ?? false,
            pricing_source: "hardcoded_fallback",
          };
        }
        return null;
      }

      if (isAgentLinkedOrder) {
        const globalRow = await lookupGlobalRow(normalizedNetwork, normalizedPackage);

        if (globalRow?.is_unavailable) {
          return new Response(JSON.stringify({ error: "This package is currently unavailable." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prefer agent_price; fall back to public_price so stores still work
        // when the admin has only filled in the public column.
        const adminBase = Number(globalRow?.agent_price) > 0
          ? Number(globalRow!.agent_price)
          : Number(globalRow?.public_price);

        if (!(Number.isFinite(adminBase) && adminBase > 0)) {
          return new Response(JSON.stringify({ error: "Package price is not configured" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: sellerProfile } = await supabaseAdmin
          .from("profiles")
          .select("is_sub_agent, parent_agent_id, agent_prices")
          .eq("user_id", agentId)
          .maybeSingle();

        const sellerPrices = (sellerProfile?.agent_prices || {}) as Record<string, Record<string, string | number>>;
        const sellerListed = resolvePriceFromMap(
          sellerPrices,
          normalizedNetwork,
          network,
          normalizedPackage,
          packageSize,
        );

        let chargeBase = adminBase;

        if (sellerProfile?.is_sub_agent) {
          resolvedParentAgentId = sellerProfile.parent_agent_id || null;
          let parentAssignedBase = 0; // what parent charges sub-agent per bundle

          if (resolvedParentAgentId) {
            const { data: parentProfile } = await supabaseAdmin
              .from("profiles")
              .select("sub_agent_prices, agent_prices")
              .eq("user_id", resolvedParentAgentId)
              .maybeSingle();

            if (parentProfile) {
              // Prefer parent's explicit wholesale prices for sub-agents; fall back
              // to parent's own published selling prices so sub-agents always pay
              // at least what the parent charges their own customers.
              const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, Record<string, string | number>>;
              const agentPrices = (parentProfile.agent_prices || {}) as Record<string, Record<string, string | number>>;
              const hasSubPrices = Object.keys(subPrices).length > 0;

              parentAssignedBase = resolvePriceFromMap(
                hasSubPrices ? subPrices : agentPrices,
                normalizedNetwork,
                network,
                normalizedPackage,
                packageSize,
              );

              // If sub_agent_prices had an entry but agent_prices is a better fallback, try agent_prices too
              if (!(Number.isFinite(parentAssignedBase) && parentAssignedBase > 0) && hasSubPrices) {
                parentAssignedBase = resolvePriceFromMap(agentPrices, normalizedNetwork, network, normalizedPackage, packageSize);
              }
            }
          }

          // Final fallback: if parent has no prices at all, use adminBase as sub-agent cost
          if (!(Number.isFinite(parentAssignedBase) && parentAssignedBase >= adminBase)) {
            parentAssignedBase = adminBase;
          }

          // Sub-agent's customer price:
          // 1. Must be at least the parent-assigned price (Parent sets the floor)
          // 2. Can be higher if the sub-agent has set their own retail price
          chargeBase = Number.isFinite(sellerListed) && sellerListed > parentAssignedBase
            ? sellerListed
            : parentAssignedBase;

          // Important: In this model, if the parent sets the price, the parent keeps the margin
          // between parentAssignedBase and adminBase.
          // The sub-agent profit would be chargeBase - parentAssignedBase.
          // If we force chargeBase = parentAssignedBase, sub-agent profit = 0.
          
          // Parent profit = parent's margin above admin wholesale
          resolvedParentProfit = Math.max(0, Number((parentAssignedBase - adminBase).toFixed(2)));
          // Sub-agent profit = their markup above what they pay parent
          resolvedProfit = Math.max(0, Number((chargeBase - parentAssignedBase).toFixed(2)));
        } else {
          // Regular agent: profit = their listed price − admin wholesale
          chargeBase = Number.isFinite(sellerListed) && sellerListed > adminBase
            ? sellerListed
            : adminBase;
          resolvedProfit = Math.max(0, Number((chargeBase - adminBase).toFixed(2)));
        }

        resolvedCostPrice = Number(globalRow?.cost_price) > 0 ? Number(globalRow!.cost_price) : adminBase;
        const adjustedBase = Number((chargeBase * priceMultiplier).toFixed(2));
        resolvedPaystackFee = parseFloat(calculatePaystackFee(adjustedBase).toFixed(2));
        resolvedAmount = parseFloat((adjustedBase + resolvedPaystackFee).toFixed(2));
        enrichedMetadata = {
          ...metadata,
          agent_id: agentId,
          network,
          package_size: packageSize,
          base_price: adjustedBase,
          cost_price: resolvedCostPrice,
          profit: resolvedProfit,
          parent_profit: resolvedParentProfit,
          parent_agent_id: resolvedParentAgentId,
          pricing_source: globalRow?.pricing_source ?? "unknown",
        };
      } else {
        // Direct public purchase (no agent store) — use global public_price.
        // The backend resolves the price server-side; the amount sent by the
        // client is overwritten so the client can never choose a cheaper price.
        const globalRow = await lookupGlobalRow(normalizedNetwork, normalizedPackage);

        if (globalRow?.is_unavailable) {
          return new Response(JSON.stringify({ error: "This package is currently unavailable." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const publicBase = Number(globalRow?.public_price) > 0
          ? Number(globalRow!.public_price)
          : (Number(globalRow?.agent_price) > 0 ? Number(globalRow!.agent_price) : 0);

        if (!(Number.isFinite(publicBase) && publicBase > 0)) {
          return new Response(JSON.stringify({ error: "Package price is not configured" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        resolvedCostPrice = Number(globalRow?.cost_price) > 0 ? Number(globalRow!.cost_price) : publicBase;
        const adjustedBase = Number((publicBase * priceMultiplier).toFixed(2));
        resolvedPaystackFee = parseFloat(calculatePaystackFee(adjustedBase).toFixed(2));
        resolvedAmount = parseFloat((adjustedBase + resolvedPaystackFee).toFixed(2));
        enrichedMetadata = {
          ...metadata,
          network,
          package_size: packageSize,
          base_price: adjustedBase,
          cost_price: resolvedCostPrice,
          profit: 0,
          parent_profit: 0,
          pricing_source: globalRow?.pricing_source ?? "unknown",
        };
      }
    }

    if (orderType === "afa") {
      const { data: afaSetting } = await supabaseAdmin
        .from("global_package_settings")
        .select("agent_price, public_price")
        .eq("network", "AFA")
        .eq("package_size", "BUNDLE")
        .maybeSingle();

      const baseAfa = Number(
        isAgentLinkedOrder
          ? (afaSetting?.agent_price ?? afaSetting?.public_price ?? 0)
          : (afaSetting?.public_price ?? afaSetting?.agent_price ?? 0),
      );
      if (Number.isFinite(baseAfa) && baseAfa > 0) {
        const adjustedBase = Number((baseAfa * priceMultiplier).toFixed(2));
        resolvedPaystackFee = parseFloat(calculatePaystackFee(adjustedBase).toFixed(2));
        const expectedTotal = parseFloat((adjustedBase + resolvedPaystackFee).toFixed(2));
        if (!amountMatches(expectedTotal, amount)) {
          return new Response(JSON.stringify({
            error: `Invalid AFA amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── Agent activation: enforce fixed fee + bind agent_id to JWT user ────────
    if (orderType === "agent_activation") {
      const AGENT_FEE = 80;
      resolvedPaystackFee = parseFloat(calculatePaystackFee(AGENT_FEE).toFixed(2));
      const expectedTotal = parseFloat((AGENT_FEE + resolvedPaystackFee).toFixed(2));
      if (!amountMatches(expectedTotal, amount)) {
        return new Response(JSON.stringify({
          error: `Invalid activation amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      resolvedAmount = expectedTotal;

      // Bind agent_id to the authenticated user — prevents activating someone else
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const { data: { user: jwtUser } } = await supabaseAdmin.auth.getUser(token);
        if (jwtUser && jwtUser.id !== agentId) {
          return new Response(JSON.stringify({ error: "agent_id must match your authenticated account." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // ── Sub-agent activation: enforce parent-configured fee ──────────────────
    if (orderType === "sub_agent_activation") {
      const parentAgentId = typeof metadata.parent_agent_id === "string" ? metadata.parent_agent_id : null;
      if (!parentAgentId) {
        return new Response(JSON.stringify({ error: "Missing parent_agent_id for sub-agent activation." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: parentProfile } = await supabaseAdmin
        .from("profiles")
        .select("sub_agent_activation_markup")
        .eq("user_id", parentAgentId)
        .maybeSingle();
      const configuredFee = Number(parentProfile?.sub_agent_activation_markup ?? 0);
      if (!Number.isFinite(configuredFee) || configuredFee <= 0) {
        return new Response(JSON.stringify({ error: "This agent has not configured a sub-agent activation fee." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      resolvedPaystackFee = parseFloat(calculatePaystackFee(configuredFee).toFixed(2));
      const expectedTotal = parseFloat((configuredFee + resolvedPaystackFee).toFixed(2));
      if (!amountMatches(expectedTotal, amount)) {
        return new Response(JSON.stringify({
          error: `Invalid sub-agent activation amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      resolvedAmount = expectedTotal;
    }

    if (orderType === "wallet_topup") {
      const walletCredit = Number(metadata.wallet_credit);
      if (!Number.isFinite(walletCredit) || walletCredit < 10) {
        return new Response(JSON.stringify({ error: "Minimum wallet top-up is GHS 10.00" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      resolvedPaystackFee = parseFloat(calculatePaystackFee(walletCredit).toFixed(2));
      const expectedTotal = parseFloat((walletCredit + resolvedPaystackFee).toFixed(2));
      if (!amountMatches(expectedTotal, amount) || walletCredit > amount) {
        return new Response(JSON.stringify({
          error: `Invalid wallet top-up amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Store credit amount in order (not total paid) — matches wallet-topup function behaviour.
      resolvedWalletCredit = walletCredit;
      resolvedAmount = expectedTotal;
    }

    if (orderType === "airtime") {
      const network = typeof metadata.network === "string" ? metadata.network : "";
      if (!network || !metadata.customer_phone) {
        return new Response(JSON.stringify({ error: "Missing airtime metadata" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (amount < 1) {
        return new Response(JSON.stringify({ error: "Minimum airtime purchase is GHS 1.00" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const airtimeBase = Number(amount.toFixed(2));
      resolvedPaystackFee = parseFloat(calculatePaystackFee(airtimeBase).toFixed(2));
      resolvedAmount = parseFloat((airtimeBase + resolvedPaystackFee).toFixed(2));
      enrichedMetadata = { ...metadata, base_price: airtimeBase, profit: 0 };
    }

    if (orderType === "utility") {
      if (!metadata.utility_type || !metadata.utility_provider || !metadata.utility_account_number) {
        return new Response(JSON.stringify({ error: "Missing utility payment details" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (amount < 5) {
        return new Response(JSON.stringify({ error: "Minimum utility payment is GHS 5.00" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const utilityBase = Number(amount.toFixed(2));
      resolvedPaystackFee = parseFloat(calculatePaystackFee(utilityBase).toFixed(2));
      resolvedAmount = parseFloat((utilityBase + resolvedPaystackFee).toFixed(2));
      enrichedMetadata = { ...metadata, base_price: utilityBase, profit: 0 };
    }

    // ── Phone rate limiting for direct anonymous purchases ───────────────────
    // Block the same phone from spamming orders (max 2 pending within 2 min).
    if (orderType === "data" && !isAgentLinkedOrder) {
      const customerPhone = (metadata.customer_phone || "").trim();
      if (customerPhone) {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { count: recentPending } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_phone", customerPhone)
          .eq("order_type", "data")
          .eq("status", "pending")
          .gte("created_at", twoMinutesAgo);
        if ((recentPending ?? 0) >= 2) {
          return new Response(JSON.stringify({
            error: "Too many pending orders for this number. Please wait a moment before trying again.",
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // Check if order already exists (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("id", reference)
      .maybeSingle();

    if (!existingOrder) {
      const normalizedProfit = Number.isFinite(resolvedProfit) && resolvedProfit > 0
        ? parseFloat(resolvedProfit.toFixed(2))
        : 0;
      const normalizedParentProfit = Number.isFinite(resolvedParentProfit) && resolvedParentProfit > 0
        ? parseFloat(resolvedParentProfit.toFixed(2))
        : 0;

      // For wallet_topup: order.amount = credit given, not total charged.
      const orderAmount = resolvedWalletCredit !== null ? resolvedWalletCredit : resolvedAmount;

      const orderRow: Record<string, unknown> = {
        id: reference,
        agent_id: agentId,
        order_type: orderType,
        amount: orderAmount,
        paystack_fee: resolvedPaystackFee > 0 ? resolvedPaystackFee : undefined,
        cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
        profit: normalizedProfit,
        parent_profit: normalizedParentProfit,
        status: "pending",
      };
      if (resolvedParentAgentId) orderRow.parent_agent_id = resolvedParentAgentId;
      if (metadata.customer_phone) orderRow.customer_phone = metadata.customer_phone;
      if (metadata.network) orderRow.network = metadata.network;
      if (metadata.package_size) orderRow.package_size = metadata.package_size;
      // AFA fields
      if (metadata.afa_full_name) orderRow.afa_full_name = metadata.afa_full_name;
      if (metadata.afa_ghana_card) orderRow.afa_ghana_card = metadata.afa_ghana_card;
      if (metadata.afa_occupation) orderRow.afa_occupation = metadata.afa_occupation;
      if (metadata.afa_email) orderRow.afa_email = metadata.afa_email;
      if (metadata.afa_residence) orderRow.afa_residence = metadata.afa_residence;
      if (metadata.afa_date_of_birth) orderRow.afa_date_of_birth = metadata.afa_date_of_birth;

      // Utility fields
      if (metadata.utility_type) orderRow.utility_type = metadata.utility_type;
      if (metadata.utility_provider) orderRow.utility_provider = metadata.utility_provider;
      if (metadata.utility_account_number) orderRow.utility_account_number = metadata.utility_account_number;
      if (metadata.utility_account_name) orderRow.utility_account_name = metadata.utility_account_name;

      const { error: insertError } = await supabaseAdmin.from("orders").insert(orderRow);
      if (insertError) {
        console.error("Failed to create order:", insertError);
        return new Response(JSON.stringify({ error: "Failed to create order" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log("Order created server-side:", reference, orderType);
    } else {
      const patch: Record<string, unknown> = {};

      if (metadata.agent_id) patch.agent_id = metadata.agent_id;
      if (metadata.customer_phone) patch.customer_phone = metadata.customer_phone;
      if (metadata.network) patch.network = metadata.network;
      if (metadata.package_size) patch.package_size = metadata.package_size;
      if (metadata.afa_full_name) patch.afa_full_name = metadata.afa_full_name;
      if (metadata.afa_ghana_card) patch.afa_ghana_card = metadata.afa_ghana_card;
      if (metadata.afa_occupation) patch.afa_occupation = metadata.afa_occupation;
      if (metadata.afa_email) patch.afa_email = metadata.afa_email;
      if (metadata.afa_residence) patch.afa_residence = metadata.afa_residence;
      if (metadata.afa_date_of_birth) patch.afa_date_of_birth = metadata.afa_date_of_birth;

      if (metadata.utility_type) patch.utility_type = metadata.utility_type;
      if (metadata.utility_provider) patch.utility_provider = metadata.utility_provider;
      if (metadata.utility_account_number) patch.utility_account_number = metadata.utility_account_number;
      if (metadata.utility_account_name) patch.utility_account_name = metadata.utility_account_name;

      if (orderType === "data") {
        patch.amount = resolvedAmount;
        patch.paystack_fee = resolvedPaystackFee > 0 ? resolvedPaystackFee : undefined;
        patch.profit = Number.isFinite(resolvedProfit) ? parseFloat(resolvedProfit.toFixed(2)) : 0;
        patch.parent_profit = Number.isFinite(resolvedParentProfit) ? parseFloat(resolvedParentProfit.toFixed(2)) : 0;
        patch.parent_agent_id = resolvedParentAgentId;
      } else {
        const metadataProfit = Number(metadata.profit);
        if (Number.isFinite(metadataProfit) && metadataProfit > 0) {
          patch.profit = parseFloat(metadataProfit.toFixed(2));
        }
      }

      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("orders").update(patch).eq("id", reference);
      }
    }

  const amountInPesewas = Math.round(resolvedAmount * 100);
  console.log("Initializing payment:", { email, amount: resolvedAmount, amountInPesewas, reference });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInPesewas,
        reference,
        callback_url,
        metadata: enrichedMetadata,
        currency: "GHS",
      }),
    });

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const textResponse = await response.text();
      console.error("Paystack returned non-JSON:", textResponse.substring(0, 500));
      return new Response(JSON.stringify({ error: "Paystack returned an invalid response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("Paystack response:", JSON.stringify(data));

    if (!response.ok || !data.status) {
      console.error("Paystack initialization failed", {
        status: response.status,
        statusText: response.statusText,
        paystackMessage: data?.message,
      });
      return new Response(JSON.stringify({ error: data.message || "Payment initialization failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Payment init error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
