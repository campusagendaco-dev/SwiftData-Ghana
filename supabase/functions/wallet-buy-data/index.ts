import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// deno-lint-ignore no-explicit-any
async function resolveExpectedAmount(supabaseAdmin: any, network: string, packageSize: string): Promise<number | null> {
  const normalizedNetwork = normalizeNetworkForPricing(network);
  const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();

  const { data: globalRow } = await supabaseAdmin
    .from("global_package_settings")
    .select("agent_price")
    .eq("network", normalizedNetwork)
    .eq("package_size", normalizedPackage)
    .maybeSingle();

  const configuredPrice = Number(globalRow?.agent_price);
  if (Number.isFinite(configuredPrice) && configuredPrice > 0) {
    return Number(configuredPrice.toFixed(2));
  }

  const basePrice = BASE_PACKAGE_PRICES[normalizedNetwork]?.[normalizedPackage];
  if (!basePrice) return null;
  return Number(basePrice.toFixed(2));
}

function mapNetworkToApi(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO" || normalized === "AT") return "AIRTELTIGO_ISHARE";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  if (normalized === "MTN") return "MTN";
  return normalized;
}

function formatDataPlan(packageSize: string): string {
  return packageSize.replace(/\s+/g, "").toUpperCase().replace(/GB$/, "");
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return "";

  try {
    new URL(clean);
  } catch {
    return clean;
  }

  return clean;
}

function buildProviderUrls(baseUrl: string, endpoint: string): string[] {
  const clean = normalizeProviderBaseUrl(baseUrl);
  if (!clean) return [];

  const urls = new Set<string>();

  if (clean.endsWith(`/${endpoint}`) || clean.endsWith(`/api/${endpoint}`)) {
    urls.add(clean);
  }

  if (clean.endsWith("/api")) {
    urls.add(`${clean}/${endpoint}`);
    urls.add(`${clean.replace(/\/api$/, "")}/api/${endpoint}`);
  } else {
    urls.add(`${clean}/api/${endpoint}`);
    urls.add(`${clean}/${endpoint}`);
  }

  return Array.from(urls);
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    contentType?.includes("text/html") ||
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>")
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getProviderFailureReason(status: number, body: string, contentType: string | null): string {
  let parsedMessage: string | null = null;

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") parsedMessage = parsed.message;
    else if (typeof parsed?.error === "string") parsedMessage = parsed.error;
  } catch {
    parsedMessage = null;
  }

  const normalized = `${parsedMessage || stripHtml(body)}`.toLowerCase();

  if ((normalized.includes("insufficient") || normalized.includes("low")) && normalized.includes("balance")) {
    return "Provider balance is too low. Refill the API source and retry this order.";
  }

  if (normalized.includes("cloudflare")) {
    return "Provider blocked the server request. Ask the data source to allow this server and retry.";
  }

  if (status === 401 || status === 403) {
    return "Provider rejected the API request. Check the data source API key and access permissions.";
  }

  if (status === 404) {
    return "Provider endpoint not found. Update the data source API URL and retry.";
  }

  if (status >= 500 || status === 429) {
    return "Provider is temporarily unavailable. Retry this order shortly.";
  }

  if (parsedMessage) {
    return parsedMessage;
  }

  if (isHtmlResponse(contentType, body)) {
    return "Provider returned an HTML error page. Check the data source API URL and retry.";
  }

  const cleaned = stripHtml(body);
  if (!cleaned) return "Data delivery failed";
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

type ProviderResult = {
  ok: boolean;
  status: number;
  body: string;
  reason: string;
  url: string | null;
};

async function placeDataOrder(
  baseUrl: string,
  apiKey: string,
  network: string,
  packageSize: string,
  customerPhone: string,
): Promise<ProviderResult> {
  const urls = buildProviderUrls(baseUrl, "purchase");
  const requestBody = {
    network: mapNetworkToApi(network),
    data_plan: formatDataPlan(packageSize),
    beneficiary: customerPhone,
  };

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    body: "",
    reason: "Provider request failed",
    url: null,
  };

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": apiKey,
            "User-Agent": "DataHiveGH/1.0",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const contentType = response.headers.get("content-type");
        const body = await response.text();

        if (response.ok) {
          return { ok: true, status: response.status, body, reason: "", url };
        }

        const reason = getProviderFailureReason(response.status, body, contentType);
        lastFailure = { ok: false, status: response.status, body, reason, url };

        const retryable = response.status >= 500 || response.status === 429;
        const tryNextUrl = response.status === 404 || (isHtmlResponse(contentType, body) && response.status !== 401 && response.status !== 403);

        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        if (tryNextUrl) break;
        return lastFailure;
      } catch (error) {
        clearTimeout(timeoutId);
        lastFailure = {
          ok: false,
          status: 502,
          body: "",
          reason: error instanceof Error ? `Provider request failed: ${error.message}` : "Provider request failed",
          url,
        };

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }
  }

  return lastFailure;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY")?.trim();
  const DATA_PROVIDER_BASE_URL = Deno.env.get("DATA_PROVIDER_BASE_URL")?.trim().replace(/\/+$/, "");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY || !DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
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

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json().catch(() => null);
    const network = typeof payload?.network === "string" ? payload.network.trim() : "";
    const package_size = typeof payload?.package_size === "string" ? payload.package_size.trim() : "";
    const customer_phone = typeof payload?.customer_phone === "string" ? payload.customer_phone.trim() : "";
    const requestedAmount = Number(payload?.amount);

    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("disable_ordering, holiday_message")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: settings.holiday_message || "Ordering is currently disabled. Please try again later.",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!network || !package_size || !customer_phone || !Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedAmount = await resolveExpectedAmount(supabaseAdmin, network, package_size);
    if (!expectedAmount) {
      return new Response(JSON.stringify({ error: "Package price not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Math.abs(requestedAmount - expectedAmount) > 0.01) {
      return new Response(JSON.stringify({
        error: `Invalid amount for ${network} ${package_size}. Expected GHS ${expectedAmount.toFixed(2)}.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { data: wallet } = await supabaseAdmin.from("wallets").select("id, balance").eq("agent_id", user.id).maybeSingle();
    if (!wallet) {
      const { data: newWallet } = await supabaseAdmin.from("wallets").insert({ agent_id: user.id, balance: 0 }).select().single();
      wallet = newWallet;
    }

    if (!wallet || Number(wallet.balance) < expectedAmount) {
      return new Response(JSON.stringify({
        error: `Insufficient wallet balance. Available: GHS ${Number(wallet?.balance || 0).toFixed(2)}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newBalance = parseFloat((Number(wallet.balance) - expectedAmount).toFixed(2));
    await supabaseAdmin.from("wallets").update({ balance: newBalance }).eq("agent_id", user.id);

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
      failure_reason: null,
    });

    console.log("Wallet buy data:", { orderId, network, package_size, customer_phone });

    const fulfillmentResult = await placeDataOrder(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, network, package_size, customer_phone);
    console.log("Fulfillment response:", {
      orderId,
      status: fulfillmentResult.status,
      reason: fulfillmentResult.reason,
      url: fulfillmentResult.url,
    });

    if (fulfillmentResult.ok) {
      await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("orders").update({
      status: "fulfillment_failed",
      failure_reason: fulfillmentResult.reason,
    }).eq("id", orderId);

    return new Response(JSON.stringify({
      success: true,
      order_id: orderId,
      status: "fulfillment_failed",
      failure_reason: fulfillmentResult.reason,
      retryable: true,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Wallet buy data error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});