import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PUBLIC_MARKUP = 1.12;
const BASE_PACKAGE_PRICES: Record<string, Record<string, number>> = {
  MTN: {
    "1GB": 4.45, "2GB": 8.9, "3GB": 13.1, "4GB": 17.3, "5GB": 21.2, "6GB": 25.7, "7GB": 29.6, "8GB": 33.2,
    "10GB": 42.5, "15GB": 62.0, "20GB": 80.2, "25GB": 100.8, "30GB": 124.0, "40GB": 159.0, "50GB": 199.3, "100GB": 385.0,
  },
  Telecel: {
    "5GB": 23.0, "10GB": 41.8, "12GB": 49.0, "15GB": 58.99, "18GB": 71.8, "20GB": 78.5, "22GB": 82.5, "25GB": 102.0, "30GB": 125.5, "40GB": 166.0, "50GB": 190.0,
  },
  AirtelTigo: {
    "1GB": 4.3, "2GB": 8.2, "3GB": 12.0, "4GB": 15.8, "5GB": 19.85, "6GB": 23.49, "7GB": 27.0, "8GB": 30.59, "9GB": 34.2,
  },
};

function normalizeNetworkForPricing(network: string): "MTN" | "Telecel" | "AirtelTigo" {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AT" || normalized === "AIRTEL TIGO" || normalized === "AIRTELTIGO") return "AirtelTigo";
  if (normalized === "VODAFONE" || normalized === "TELECEL") return "Telecel";
  return "MTN";
}

async function resolveExpectedAmount(
  supabaseAdmin: ReturnType<typeof createClient>,
  network: string,
  packageSize: string,
): Promise<number | null> {
  const normalizedNetwork = normalizeNetworkForPricing(network);
  const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();

  const { data: globalRow } = await supabaseAdmin
    .from("global_package_settings")
    .select("public_price")
    .eq("network", normalizedNetwork)
    .eq("package_size", normalizedPackage)
    .maybeSingle();

  const configuredPrice = Number(globalRow?.public_price);
  if (Number.isFinite(configuredPrice) && configuredPrice > 0) {
    return Number(configuredPrice.toFixed(2));
  }

  const basePrice = BASE_PACKAGE_PRICES[normalizedNetwork]?.[normalizedPackage];
  if (!basePrice) return null;
  return Number((basePrice * PUBLIC_MARKUP).toFixed(2));
}

function mapNetworkToApi(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO") return "AIRTELTIGO";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  if (normalized === "MTN") return "MTN";
  return normalized;
}

function formatDataPlan(packageSize: string): string {
  return packageSize.replace(/\s+/g, "").toUpperCase();
}

async function placeDataOrder(
  baseUrl: string,
  apiKey: string,
  network: string,
  packageSize: string,
  customerPhone: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const apiNetwork = mapNetworkToApi(network);
  const dataPlan = formatDataPlan(packageSize);
  const response = await fetch(`${baseUrl}/api/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      network: apiNetwork,
      data_plan: dataPlan,
      beneficiary: customerPhone,
    }),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY")?.trim();
  const DATA_PROVIDER_BASE_URL = Deno.env.get("DATA_PROVIDER_BASE_URL")?.trim().replace(/\/+$/, "");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { network, package_size, customer_phone, amount } = await req.json();

    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("disable_ordering, holiday_message")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: settings.holiday_message || "Ordering is currently disabled. Please try again later.",
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!network || !package_size || !customer_phone || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedAmount = await resolveExpectedAmount(supabaseAdmin, network, package_size);
    if (!expectedAmount) {
      return new Response(JSON.stringify({ error: "Package price not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Math.abs(requestedAmount - expectedAmount) > 0.01) {
      return new Response(JSON.stringify({
        error: `Invalid amount for ${network} ${package_size}. Expected GHS ${expectedAmount.toFixed(2)}.`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or create wallet
    let { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", user.id)
      .maybeSingle();

    if (!wallet) {
      const { data: newWallet } = await supabaseAdmin
        .from("wallets")
        .insert({ agent_id: user.id, balance: 0 })
        .select()
        .single();
      wallet = newWallet;
    }

    if (!wallet || wallet.balance < expectedAmount) {
      return new Response(JSON.stringify({ error: `Insufficient wallet balance. Available: GHS ${(wallet?.balance || 0).toFixed(2)}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduct from wallet
    const newBalance = parseFloat((wallet.balance - expectedAmount).toFixed(2));
    await supabaseAdmin.from("wallets").update({ balance: newBalance }).eq("agent_id", user.id);

    // Create order
    const orderId = crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "data",
      network,
      package_size,
      customer_phone,
      amount: expectedAmount,
      profit: 0,
      status: "paid",
    });

    console.log("Wallet buy data:", { network, package_size, customer_phone });

    let fulfillmentResult = await placeDataOrder(
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      network,
      package_size,
      customer_phone,
    );

    console.log("Fulfillment response:", fulfillmentResult.status, fulfillmentResult.body);

    if (fulfillmentResult.ok) {
      await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let reason = "Data delivery failed";
    try { reason = JSON.parse(fulfillmentResult.body)?.message || reason; } catch { /* keep fallback */ }
    await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", orderId);
    return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfillment_failed", failure_reason: reason }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Wallet buy data error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
