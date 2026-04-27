import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate, sendPaymentSms } from "../_shared/sms.ts";

function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) return value;
  }
  return "";
}

function getProviderCredentials(settings: any): { 
  apiKey: string; 
  baseUrl: string;
  secondaryApiKey: string;
  secondaryBaseUrl: string;
  autoFailover: boolean;
} {
  const primaryApiKey = getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
  ]) || settings?.data_provider_api_key || "";

  const primaryBaseUrl = (getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
  ]) || settings?.data_provider_base_url || "").replace(/\/+$/, "");

  return {
    apiKey: primaryApiKey,
    baseUrl: primaryBaseUrl,
    secondaryApiKey: settings?.secondary_data_provider_api_key || Deno.env.get("SECONDARY_DATA_PROVIDER_API_KEY") || "",
    secondaryBaseUrl: (settings?.secondary_data_provider_base_url || Deno.env.get("SECONDARY_DATA_PROVIDER_BASE_URL") || "").replace(/\/+$/, ""),
    autoFailover: settings?.auto_failover_enabled || false,
  };
}

function normalizeNetworkForPricing(network: string): "MTN" | "Telecel" | "AirtelTigo" {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AT" || normalized === "AIRTEL TIGO" || normalized === "AIRTELTIGO") return "AirtelTigo";
  if (normalized === "VODAFONE" || normalized === "TELECEL") return "Telecel";
  return "MTN";
}

function resolvePriceFromMap(
  priceMap: Record<string, Record<string, string | number>>,
  normalizedNetwork: string,
  rawNetwork: string,
  normalizedPackage: string,
  rawPackage: string,
): number {
  const networkCandidates = [
    normalizedNetwork,
    rawNetwork,
    rawNetwork.replace(/\s+/g, ""),
  ];

  const packageCandidates = [
    normalizedPackage,
    rawPackage,
    rawPackage.replace(/\s+/g, ""),
    rawPackage.toUpperCase(),
  ];

  for (const networkKey of networkCandidates) {
    const byNetwork = priceMap[networkKey];
    if (!byNetwork || typeof byNetwork !== "object") continue;
    for (const packageKey of packageCandidates) {
      const value = Number(byNetwork[packageKey]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }

  return 0;
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
  return null;
}

// deno-lint-ignore no-explicit-any
async function resolveOrderDetails(
  supabaseAdmin: any,
  userId: string,
  network: string,
  packageSize: string,
  multiplier: number,
): Promise<{ cost: number; parentAgentId?: string; parentProfit?: number; profit?: number } | null> {
  const normalizedNetwork = normalizeNetworkForPricing(network);
  const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();

  // Run profile + global pricing lookups in parallel
  const [{ data: profile }, { data: globalRow }] = await Promise.all([
    supabaseAdmin.from("profiles").select("is_sub_agent, parent_agent_id, agent_prices").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("global_package_settings").select("agent_price").eq("network", normalizedNetwork).eq("package_size", normalizedPackage).maybeSingle(),
  ]);

  const adminBase = Number(globalRow?.agent_price || 0);
  if (!(adminBase > 0)) return null;
  const adminCost = Number((adminBase * multiplier).toFixed(2));

  if (profile?.is_sub_agent) {
    let parentAssignedBase = 0;
    if (profile?.parent_agent_id) {
      const { data: parentProfile } = await supabaseAdmin
        .from("profiles")
        .select("sub_agent_prices")
        .eq("user_id", profile.parent_agent_id)
        .maybeSingle();

      const parentMap = (parentProfile?.sub_agent_prices || {}) as Record<string, Record<string, string | number>>;
      parentAssignedBase = resolvePriceFromMap(
        parentMap,
        normalizedNetwork,
        network,
        normalizedPackage,
        packageSize,
      );
    }

    // If no parent price is assigned, we can't process sub-agent wallet orders
    if (!(parentAssignedBase > 0)) return null;
    
    const parentCost = Number((parentAssignedBase * multiplier).toFixed(2));
    const parentProfit = Math.max(0, Number((parentCost - adminCost).toFixed(2)));

    // For wallet orders, the agent pays their cost (parentCost)
    return { 
      cost: parentCost, 
      parentAgentId: profile.parent_agent_id, 
      parentProfit: parentProfit,
      profit: 0 // In wallet orders, agent markup is cash in hand, not wallet credit
    };
  }

  // Regular agent: they pay the admin cost
  return { 
    cost: adminCost, 
    profit: 0 // Regular agent markup is cash in hand
  };
}

// deno-lint-ignore no-explicit-any
async function getPricingContext(_supabaseAdmin: any): Promise<{ source: "primary"; multiplier: number }> {
  return { source: "primary", multiplier: 1 };
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
  if (normalized === "MTN" || normalized === "YELLO") return "YELLO";
  return normalized;
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
  const endpointAliases = endpoint === "purchase" ? ["purchase", "order", "airtime", "buy"] : [endpoint];
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  let projectUrl = "";
  try {
    if (supabaseUrl) projectUrl = new URL(supabaseUrl).origin;
  } catch { /* ignore */ }

  // Also try host-root endpoints in case the configured base URL contains an extra path segment.
  if (rootUrl) {
    for (const alias of endpointAliases) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
      urls.add(`${rootUrl}/functions/v1/developer-api/${alias}`);
    }
  }
  
  if (projectUrl) {
    for (const alias of endpointAliases) {
      urls.add(`${projectUrl}/functions/v1/developer-api/${alias}`);
    }
  }

  return Array.from(urls);
}

function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string } {
  try {
    const parsed = JSON.parse(body);
    const rawStatus = parsed?.status;
    const status = String(rawStatus || "").toLowerCase();
    const statusCode = Number(parsed?.statusCode);
    const message = typeof parsed?.message === "string" ? parsed.message : undefined;

    if (rawStatus === true || status === "true") return { ok: true };
    if (rawStatus === false || status === "false") {
      return { ok: false, reason: message || "Provider rejected this order." };
    }

    if (status === "success") return { ok: true };
    if (status === "error" || status === "failed" || status === "failure") {
      return { ok: false, reason: message || "Provider rejected this order." };
    }

    if (Number.isFinite(statusCode) && statusCode >= 400) {
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
    return "The platform's provider balance is currently insufficient. Please top up your provider wallet in Admin Settings. Your agent wallet has been refunded.";
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
  attemptedUrls: string[];
};

async function placeDataOrder(
  baseUrl: string,
  apiKey: string,
  network: string,
  packageSize: string,
  customerPhone: string,
  providerWebhookUrl: string,
  amount: number,
): Promise<ProviderResult> {
  const urls = buildProviderUrls(baseUrl, "purchase");
  const networkKey = mapNetworkKey(network);
  const capacity = parseCapacity(packageSize);
  const requestBody: Record<string, unknown> = {
    networkRaw: network,
    networkKey: networkKey,
    recipient: normalizeRecipient(customerPhone),
    capacity: capacity,
    amount: amount,
    order_type: "data",
    description: `Data purchase: ${packageSize} for ${customerPhone}`
  };
  if (providerWebhookUrl) {
    requestBody.webhook_url = providerWebhookUrl;
  }

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    body: "",
    reason: "Provider request failed",
    url: null,
    attemptedUrls: urls,
  };

  console.log("Provider request body:", requestBody);

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`,
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
            return { ok: true, status: response.status, body, reason: "", url, attemptedUrls: urls };
          }

          const reason = semantic.reason || "Provider rejected this order.";
          lastFailure = { ok: false, status: response.status, body, reason, url, attemptedUrls: urls };
          return lastFailure;
        }

        const reason = getProviderFailureReason(response.status, body, contentType);
        lastFailure = { ok: false, status: response.status, body, reason, url, attemptedUrls: urls };

        const retryable = response.status >= 500 || response.status === 429;
        const tryNextUrl =
          response.status === 404 ||
          (isHtmlResponse(contentType, body) && response.status !== 401 && response.status !== 403);

        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
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
          attemptedUrls: urls,
        };

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
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

  const payload = await req.json().catch(() => null);
  const rawToken = req.headers.get("x-user-access-token") || (typeof payload?.access_token === "string" ? payload.access_token.trim() : "");
  const authHeader = rawToken ? `Bearer ${rawToken}` : (req.headers.get("Authorization") || null);
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
    // Parallel: verify user session and fetch system settings simultaneously
    const [userResult, settingsResult] = await Promise.all([
      supabaseUser.auth.getUser(),
      supabaseAdmin.from("system_settings").select("disable_ordering, holiday_message, data_provider_api_key, data_provider_base_url, secondary_data_provider_api_key, secondary_data_provider_base_url, auto_failover_enabled").eq("id", 1).maybeSingle(),
    ]);

    const { data: { user }, error: userError } = userResult;
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = settingsResult.data;
    const network = typeof payload?.network === "string" ? payload.network.trim() : "";
    const package_size = typeof payload?.package_size === "string" ? payload.package_size.trim() : "";
    const customer_phone = typeof payload?.customer_phone === "string" ? payload.customer_phone.trim() : "";
    const requestedAmount = Number(payload?.amount);

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

    const ALLOWED_NETWORKS = ["MTN", "Telecel", "AirtelTigo"];
    if (!ALLOWED_NETWORKS.includes(network)) {
      return new Response(JSON.stringify({ error: "Invalid network" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate phone: must be 9-15 digits only (no scripts, no SQL, no special chars)
    const phoneDigits = customer_phone.replace(/\D/g, "");
    if (!/^\d{9,15}$/.test(phoneDigits)) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/^\d+(\.\d+)?GB$/i.test(package_size.replace(/\s+/g, ""))) {
      return new Response(JSON.stringify({ error: "Invalid package size" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providerConfig = getProviderCredentials(settings);
    
    if (!providerConfig.apiKey || !providerConfig.baseUrl) {
      return new Response(JSON.stringify({ error: "Primary data provider not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pricingContext = await getPricingContext(supabaseAdmin);
    const orderDetails = await resolveOrderDetails(
      supabaseAdmin,
      user.id,
      network,
      package_size,
      pricingContext.multiplier,
    );
    if (!orderDetails) {
      const { data: priceProfile } = await supabaseAdmin
        .from("profiles")
        .select("is_sub_agent")
        .eq("user_id", user.id)
        .maybeSingle();

      const errorMessage = priceProfile?.is_sub_agent
        ? "Sub-agent price is not configured by your assigned agent"
        : "Package price not configured";

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientReference = typeof payload?.reference === "string" ? payload.reference.trim() : "";

    // ── IDEMPOTENCY CHECK ────────────────────────────────────────────────────
    if (clientReference) {
      const { data: existing } = await supabaseAdmin
        .from("orders")
        .select("id, status, failure_reason")
        .eq("id", clientReference)
        .eq("agent_id", user.id)
        .maybeSingle();

      if (existing) {
        console.log("Duplicate request detected for reference:", clientReference);
        return new Response(JSON.stringify({ 
          success: true, 
          order_id: existing.id, 
          status: existing.status,
          failure_reason: existing.failure_reason,
          reused: true 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { cost: expectedAmount, parentAgentId, parentProfit } = orderDetails;

    // Ensure wallet row exists before attempting atomic debit
    const { data: existingWallet } = await supabaseAdmin.from("wallets").select("id").eq("agent_id", user.id).maybeSingle();
    if (!existingWallet) {
      await supabaseAdmin.from("wallets").insert({ agent_id: user.id, balance: 0 });
    }

    // Atomic read-check-debit via SQL function — prevents race conditions
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: expectedAmount,
    });

    if (debitError || !debitResult?.success) {
      const errMsg = debitResult?.error || "Wallet debit failed";
      const balance = Number(debitResult?.balance || 0);
      return new Response(JSON.stringify({
        error: errMsg === "Insufficient balance"
          ? `Insufficient wallet balance. Available: GHS ${balance.toFixed(2)}`
          : errMsg,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = clientReference || crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "data",
      network,
      package_size,
      customer_phone,
      amount: expectedAmount,
      profit: 0,
      parent_agent_id: parentAgentId || null,
      parent_profit: parentProfit || 0,
      status: "paid",
      failure_reason: null,
    });

    console.log("Wallet buy data:", { orderId, network, package_size, customer_phone });

    // Run provider delivery in the background — respond immediately so the
    // client is unblocked. OrderStatusBanner updates via Realtime when done.
    const fulfillmentTask = (async () => {
      let result = await placeDataOrder(
        providerConfig.baseUrl,
        providerConfig.apiKey,
        network,
        package_size,
        customer_phone,
        DATA_PROVIDER_WEBHOOK_URL,
        expectedAmount,
      );

      if (!result.ok && providerConfig.autoFailover && providerConfig.secondaryApiKey) {
        console.warn(`Primary failed (${result.reason}). Trying secondary...`);
        result = await placeDataOrder(
          providerConfig.secondaryBaseUrl,
          providerConfig.secondaryApiKey,
          network,
          package_size,
          customer_phone,
          DATA_PROVIDER_WEBHOOK_URL,
          expectedAmount,
        );
        if (result.ok) console.log("Failover succeeded.");
        else console.error(`Failover also failed: ${result.reason}`);
      }

      console.log("Fulfillment:", { orderId, status: result.status, reason: result.reason, url: result.url });

      if (result.ok) {
        await Promise.all([
          supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId),
          ...((parentProfit ?? 0) > 0 && parentAgentId ? [supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId })] : []),
          sendPaymentSms(supabaseAdmin, customer_phone, "payment_success"),
        ]);
      } else {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: result.reason,
        }).eq("id", orderId);

        const { error: refundError } = await supabaseAdmin.rpc("credit_wallet", {
          p_agent_id: user.id,
          p_amount: expectedAmount,
        });
        if (!refundError) {
          console.log(`Refunded GHS ${expectedAmount} to ${user.id}`);
          void sendPaymentSms(supabaseAdmin, customer_phone, "order_failed", {
            package: package_size, phone: customer_phone, amount: expectedAmount.toFixed(2),
          });
        }
      }
    })();

    // Keep the edge function alive until fulfillment finishes
    // deno-lint-ignore no-explicit-any
    if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime.waitUntil(fulfillmentTask);
    }

    // Return immediately — wallet debited, order created, banner will update via Realtime
    return new Response(JSON.stringify({ success: true, order_id: orderId, status: "processing" }), {
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