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

function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) return value;
  }
  return "";
}

type ProviderSource = "primary" | "secondary";

function getProviderCredentials(source: ProviderSource): { apiKey: string; baseUrl: string } {
  const primaryApiKey = getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_PRIMARY_API_KEY",
  ]);
  const secondaryApiKey = getFirstEnvValue([
    "SECONDARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_SECONDARY_API_KEY",
  ]);

  const primaryBaseUrl = getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_PRIMARY_BASE_URL",
  ]).replace(/\/+$/, "");
  const secondaryBaseUrl = getFirstEnvValue([
    "SECONDARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_SECONDARY_BASE_URL",
  ]).replace(/\/+$/, "");

  if (source === "secondary") {
    return {
      apiKey: secondaryApiKey || primaryApiKey,
      baseUrl: secondaryBaseUrl || primaryBaseUrl,
    };
  }

  return {
    apiKey: primaryApiKey || secondaryApiKey,
    baseUrl: primaryBaseUrl || secondaryBaseUrl,
  };
}

function normalizeNetworkForPricing(network: string): "MTN" | "Telecel" | "AirtelTigo" {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AT" || normalized === "AIRTEL TIGO" || normalized === "AIRTELTIGO") return "AirtelTigo";
  if (normalized === "VODAFONE" || normalized === "TELECEL") return "Telecel";
  return "MTN";
}

// deno-lint-ignore no-explicit-any
async function resolveExpectedAmount(supabaseAdmin: any, network: string, packageSize: string, multiplier: number): Promise<number | null> {
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
    return Number((configuredPrice * multiplier).toFixed(2));
  }

  const basePrice = BASE_PACKAGE_PRICES[normalizedNetwork]?.[normalizedPackage];
  if (!basePrice) return null;
  return Number((basePrice * multiplier).toFixed(2));
}

// deno-lint-ignore no-explicit-any
async function resolveExpectedAmountForUser(
  supabaseAdmin: any,
  userId: string,
  network: string,
  packageSize: string,
  multiplier: number,
): Promise<number | null> {
  const normalizedNetwork = normalizeNetworkForPricing(network);
  const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_sub_agent, agent_prices")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile?.is_sub_agent) {
    const assigned = (profile.agent_prices || {}) as Record<string, Record<string, string | number>>;
    const networkCandidates = [normalizedNetwork, network, network.replace(/\s+/g, "")];
    const packageCandidates = [normalizedPackage, packageSize, packageSize.replace(/\s+/g, "")];

    for (const n of networkCandidates) {
      const byNetwork = assigned[n];
      if (!byNetwork || typeof byNetwork !== "object") continue;
      for (const p of packageCandidates) {
        const assignedPrice = Number(byNetwork[p]);
        if (Number.isFinite(assignedPrice) && assignedPrice > 0) {
          return Number((assignedPrice * multiplier).toFixed(2));
        }
      }
    }
  }

  return await resolveExpectedAmount(supabaseAdmin, network, packageSize, multiplier);
}

// deno-lint-ignore no-explicit-any
async function getPricingContext(supabaseAdmin: any): Promise<{ source: ProviderSource; multiplier: number }> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("preferred_provider")
    .eq("id", 1)
    .maybeSingle();

  const source: ProviderSource = data?.preferred_provider === "secondary"
    ? "secondary"
    : "primary";

  const pct = 8.11;
  const multiplier = source === "secondary"
    ? Number.isFinite(pct) ? Number((1 + pct / 100).toFixed(6)) : 1.0811
    : 1;

  return { source, multiplier };
}

function mapNetworkKey(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (
    normalized === "AIRTELTIGO" ||
    normalized === "AIRTEL TIGO" ||
    normalized === "AIRTEL-TIGO" ||
    normalized === "AT"
  ) return "AT_PREMIUM";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  if (normalized === "MTN") return "YELLO";
  return normalized;
}

function mapSecondaryNetwork(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (
    normalized === "AIRTELTIGO" ||
    normalized === "AIRTEL TIGO" ||
    normalized === "AIRTEL-TIGO" ||
    normalized === "AT" ||
    normalized === "AIRTELTIGO_ISHARE"
  ) return "AIRTELTIGO_ISHARE";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  return "MTN";
}

function parseCapacity(packageSize: string): number {
  const match = packageSize.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/)
  return match ? parseFloat(match[1]) : 0;
}

function normalizeRecipient(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

function normalizeSecondaryPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

function buildSecondaryOrderUrls(baseUrl: string, apiKey: string): string[] {
  const clean = normalizeProviderBaseUrl(baseUrl);
  if (!clean) return [];

  const urls = new Set<string>();
  const token = apiKey.trim();

  // Try tokenized variants first for providers that expect key in path.
  if (token) {
    urls.add(`${clean}/${token}/order`);
    urls.add(`${clean}/api/${token}/order`);
  }

  urls.add(`${clean}/order`);
  urls.add(`${clean}/api/order`);

  return Array.from(urls);
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
  const endpointAliases = endpoint === "purchase" ? ["purchase", "order"] : [endpoint];
  let rootUrl = "";

  try {
    const parsed = new URL(clean);
    rootUrl = parsed.origin;
  } catch {
    rootUrl = "";
  }

  for (const alias of endpointAliases) {
    if (clean.endsWith(`/${alias}`) || clean.endsWith(`/api/${alias}`)) {
      urls.add(clean);
    }
  }

  for (const alias of endpointAliases) {
    if (clean.endsWith("/api")) {
      urls.add(`${clean}/${alias}`);
      urls.add(`${clean.replace(/\/api$/, "")}/api/${alias}`);
    } else {
      urls.add(`${clean}/api/${alias}`);
      urls.add(`${clean}/${alias}`);
    }
  }

  // Also try host-root endpoints in case the configured base URL contains an extra path segment.
  if (rootUrl) {
    for (const alias of endpointAliases) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
    }
  }

  return Array.from(urls);
}

function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string } {
  try {
    const parsed = JSON.parse(body);
    const status = String(parsed?.status || "").toLowerCase();
    const message = typeof parsed?.message === "string" ? parsed.message : undefined;

    if (status === "success") return { ok: true };
    if (status === "error" || status === "failed" || status === "failure") {
      return { ok: false, reason: message || "Provider rejected this order." };
    }
  } catch {
    // Non-JSON responses are handled below.
  }

  if (isHtmlResponse(contentType, body)) {
    return { ok: false, reason: "Provider returned an HTML response. Check API URL configuration." };
  }

  // If provider doesn't include a status field but responded with 2xx JSON/text, treat as success.
  return { ok: true };
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>")
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sendPaymentSms(customerPhone: string) {
  const smsApiKey = getFirstEnvValue(["TXTCONNECT_API_KEY"]);
  const smsUrl = getFirstEnvValue(["TXTCONNECT_SMS_URL"]) || "https://api.txtconnect.net/dev/api/sms/send";
  const senderId = getFirstEnvValue(["TXTCONNECT_SENDER_ID"]) || "SwiftDataGh";
  const smsType = getFirstEnvValue(["TXTCONNECT_SMS_TYPE"]).toLowerCase();
  const unicode = smsType === "true" || smsType === "1" || smsType === "unicode";

  const digits = customerPhone.replace(/\D+/g, "");
  const recipient = digits.startsWith("0") && digits.length === 10
    ? `233${digits.slice(1)}`
    : (digits.startsWith("233") ? digits : digits);

  if (!smsApiKey || !recipient) return;

  try {
    const res = await fetch(smsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${smsApiKey}`,
      },
      body: JSON.stringify({
        to: recipient,
        from: senderId,
        unicode,
        sms: "Your data bundle is being processed. Thanks for choosing SwiftData GH",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("SMS send failed:", res.status, text.slice(0, 300));
    }
  } catch (error) {
    console.error("SMS send error:", error);
  }
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
  providerSource: ProviderSource,
  baseUrl: string,
  apiKey: string,
  network: string,
  packageSize: string,
  customerPhone: string,
  providerWebhookUrl: string,
): Promise<ProviderResult> {
  const urls = providerSource === "secondary"
    ? buildSecondaryOrderUrls(baseUrl, apiKey)
    : buildProviderUrls(baseUrl, "purchase");
  const networkKey = mapNetworkKey(network);
  const capacity = parseCapacity(packageSize);
  const requestBody: Record<string, unknown> = providerSource === "secondary"
    ? {
      phone: normalizeSecondaryPhone(customerPhone),
      size: capacity,
      network: mapSecondaryNetwork(network),
    }
    : {
      networkKey,
      recipient: normalizeRecipient(customerPhone),
      capacity,
    };
  if (providerSource !== "secondary" && providerWebhookUrl) {
    requestBody.webhook_url = providerWebhookUrl;
  }
  // API 2 integration intentionally omits callback.

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    body: "",
    reason: "Provider request failed",
    url: null,
  };

  console.log("Provider request body:", requestBody);

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
          const semantic = parseProviderResponse(body, contentType);
          if (semantic.ok) {
            return { ok: true, status: response.status, body, reason: "", url };
          }

          const reason = semantic.reason || "Provider rejected this order.";
          lastFailure = { ok: false, status: response.status, body, reason, url };
          return lastFailure;
        }

        const reason = getProviderFailureReason(response.status, body, contentType);
        lastFailure = { ok: false, status: response.status, body, reason, url };

        const retryable = response.status >= 500 || response.status === 429;
        const secondaryAuthFailure = providerSource === "secondary" && (response.status === 401 || response.status === 403);
        const tryNextUrl =
          response.status === 404 ||
          (isHtmlResponse(contentType, body) && response.status !== 401 && response.status !== 403) ||
          secondaryAuthFailure;

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
  const DATA_PROVIDER_WEBHOOK_URL = getFirstEnvValue([
    "DATA_PROVIDER_WEBHOOK_URL",
    "PRIMARY_DATA_PROVIDER_WEBHOOK_URL",
    "SECONDARY_DATA_PROVIDER_WEBHOOK_URL",
  ]);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200,
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

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200,
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
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!network || !package_size || !customer_phone || !Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pricingContext = await getPricingContext(supabaseAdmin);
    const providerConfig = getProviderCredentials(pricingContext.source);
    const DATA_PROVIDER_API_KEY = providerConfig.apiKey;
    const DATA_PROVIDER_BASE_URL = providerConfig.baseUrl;

    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      return new Response(JSON.stringify({ error: "Data provider not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedAmount = await resolveExpectedAmountForUser(
      supabaseAdmin,
      user.id,
      network,
      package_size,
      pricingContext.multiplier,
    );
    if (!expectedAmount) {
      return new Response(JSON.stringify({ error: "Package price not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Math.abs(requestedAmount - expectedAmount) > 0.01) {
      return new Response(JSON.stringify({
        error: `Invalid amount for ${network} ${package_size}. Expected GHS ${expectedAmount.toFixed(2)}.`,
      }), {
        status: 200,
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
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newBalance = parseFloat((Number(wallet.balance) - expectedAmount).toFixed(2));
    await supabaseAdmin.from("wallets").update({ balance: newBalance }).eq("agent_id", user.id);

    // Calculate profit: agent's selling price for this package minus the cost base
    const normalizedNetworkKey = normalizeNetworkForPricing(network);
    const normalizedPackageKey = package_size.replace(/\s+/g, "").toUpperCase();
    const { data: agentProfile } = await supabaseAdmin
      .from("profiles")
      .select("agent_prices")
      .eq("user_id", user.id)
      .maybeSingle();
    const agentPricesMap = (agentProfile?.agent_prices || {}) as Record<string, Record<string, string | number>>;
    const rawAgentSellPrice = parseFloat(String(agentPricesMap[normalizedNetworkKey]?.[normalizedPackageKey] || 0));
    const agentSellPrice = Number.isFinite(rawAgentSellPrice)
      ? Number((rawAgentSellPrice * pricingContext.multiplier).toFixed(2))
      : 0;
    const walletProfit = Number.isFinite(agentSellPrice) && agentSellPrice > expectedAmount
      ? parseFloat((agentSellPrice - expectedAmount).toFixed(2))
      : 0;

    const orderId = crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "data",
      network,
      package_size,
      customer_phone,
      amount: expectedAmount,
      profit: walletProfit,
      status: "paid",
      failure_reason: null,
    });

    await sendPaymentSms(customer_phone);

    console.log("Wallet buy data:", { orderId, network, package_size, customer_phone });

    const fulfillmentResult = await placeDataOrder(
      pricingContext.source,
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      network,
      package_size,
      customer_phone,
      DATA_PROVIDER_WEBHOOK_URL,
    );
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
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});