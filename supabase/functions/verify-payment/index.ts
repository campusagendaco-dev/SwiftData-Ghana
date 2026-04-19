import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

// deno-lint-ignore no-explicit-any
async function getActiveProviderSource(supabase: any): Promise<ProviderSource> {
  const { data } = await supabase
    .from("system_settings")
    .select("preferred_provider")
    .eq("id", 1)
    .maybeSingle();

  return data?.preferred_provider === "secondary"
    ? "secondary"
    : "primary";
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
  text: string;
  reason: string;
  url: string | null;
};

async function callProviderApi(
  providerSource: ProviderSource,
  baseUrl: string,
  apiKey: string,
  endpoint: "purchase" | "afa-registration",
  body: Record<string, unknown>,
  providerWebhookUrl = "",
): Promise<ProviderResult> {
  const urls = providerSource === "secondary" && endpoint === "purchase"
    ? buildSecondaryOrderUrls(baseUrl, apiKey)
    : buildProviderUrls(baseUrl, endpoint);

  let baseRequestBody: Record<string, unknown> = body;

  if (endpoint === "purchase" && providerSource === "secondary") {
    const networkValue = typeof body.networkRaw === "string"
      ? body.networkRaw
      : (typeof body.networkKey === "string" ? body.networkKey : "MTN");
    const recipientValue = typeof body.recipient === "string" ? body.recipient : "";
    const capacityValue = Number(body.capacity || 0);
    baseRequestBody = {
      phone: normalizeSecondaryPhone(recipientValue),
      size: capacityValue,
      network: mapSecondaryNetwork(networkValue),
    };
    // API 2 integration intentionally omits callback.
  } else if (endpoint === "purchase" && providerWebhookUrl && !Object.prototype.hasOwnProperty.call(body, "webhook_url")) {
    baseRequestBody = { ...body, webhook_url: providerWebhookUrl };
  }

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    text: "",
    reason: "Provider request failed",
    url: null,
  };

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": apiKey,
            "User-Agent": "DataHiveGH/1.0",
          },
          body: JSON.stringify(baseRequestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const contentType = res.headers.get("content-type");
        const text = await res.text();

        if (res.ok) {
          const semantic = parseProviderResponse(text, contentType);
          if (semantic.ok) {
            return { ok: true, status: res.status, text, reason: "", url };
          }

          const reason = semantic.reason || "Provider rejected this order.";
          lastFailure = { ok: false, status: res.status, text, reason, url };
          return lastFailure;
        }

        const reason = getProviderFailureReason(res.status, text, contentType);
        lastFailure = { ok: false, status: res.status, text, reason, url };

        const retryable = res.status >= 500 || res.status === 429;
        const secondaryAuthFailure = providerSource === "secondary" && (res.status === 401 || res.status === 403);
        const tryNextUrl =
          res.status === 404 ||
          (isHtmlResponse(contentType, text) && res.status !== 401 && res.status !== 403) ||
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
          text: "",
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

function buildAfaPayload(source: Record<string, unknown>) {
  return {
    fullName: source.afa_full_name,
    ghanaCardNumber: source.afa_ghana_card,
    occupation: source.afa_occupation,
    email: source.afa_email,
    placeOfResidence: source.afa_residence,
    dateOfBirth: source.afa_date_of_birth,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const DATA_PROVIDER_WEBHOOK_URL = getFirstEnvValue([
    "DATA_PROVIDER_WEBHOOK_URL",
    "PRIMARY_DATA_PROVIDER_WEBHOOK_URL",
    "SECONDARY_DATA_PROVIDER_WEBHOOK_URL",
  ]);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const activeSource = await getActiveProviderSource(supabase);
    const providerConfig = getProviderCredentials(activeSource);
    const DATA_PROVIDER_API_KEY = providerConfig.apiKey;
    const DATA_PROVIDER_BASE_URL = providerConfig.baseUrl;

    const payload = await req.json().catch(() => null);
    const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { data: order } = await supabase.from("orders").select("*").eq("id", reference).maybeSingle();

    if (order?.status === "fulfilled") {
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For orders already paid/failed (e.g. wallet-paid orders retried by admin),
    // skip Paystack verification and go straight to fulfillment.
    if (order && (order.status === "paid" || order.status === "fulfillment_failed")) {
      if (!DATA_PROVIDER_BASE_URL || !DATA_PROVIDER_API_KEY) {
        return new Response(JSON.stringify({ status: "fulfillment_failed", failure_reason: "Data provider not configured" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let fulfilled = false;
      let recoveredMetadata: Record<string, unknown> = {};

      // Some legacy rows can be paid but missing fulfillment fields.
      // Recover metadata from Paystack so retries can still reach the provider API.
      const needsMetadataRecovery =
        (order.order_type === "data" && (!order.network || !order.package_size || !order.customer_phone)) ||
        (order.order_type === "afa" && (!order.afa_full_name || !order.afa_ghana_card || !order.afa_email));

      if (needsMetadataRecovery) {
        try {
          const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
          });
          const verifyData = await verifyRes.json().catch(() => null);
          recoveredMetadata = (verifyData?.data?.metadata || {}) as Record<string, unknown>;

          const recoveredFields: Record<string, unknown> = {};
          const recoveredAgentId = typeof recoveredMetadata.agent_id === "string" ? recoveredMetadata.agent_id : "";
          const hasPlaceholderAgentId = !order.agent_id || order.agent_id === "00000000-0000-0000-0000-000000000000";
          if (hasPlaceholderAgentId && recoveredAgentId) recoveredFields.agent_id = recoveredAgentId;
          if (!order.network && typeof recoveredMetadata.network === "string") recoveredFields.network = recoveredMetadata.network;
          if (!order.package_size && typeof recoveredMetadata.package_size === "string") recoveredFields.package_size = recoveredMetadata.package_size;
          if (!order.customer_phone && typeof recoveredMetadata.customer_phone === "string") recoveredFields.customer_phone = recoveredMetadata.customer_phone;
          if (!order.afa_full_name && typeof recoveredMetadata.afa_full_name === "string") recoveredFields.afa_full_name = recoveredMetadata.afa_full_name;
          if (!order.afa_ghana_card && typeof recoveredMetadata.afa_ghana_card === "string") recoveredFields.afa_ghana_card = recoveredMetadata.afa_ghana_card;
          if (!order.afa_occupation && typeof recoveredMetadata.afa_occupation === "string") recoveredFields.afa_occupation = recoveredMetadata.afa_occupation;
          if (!order.afa_email && typeof recoveredMetadata.afa_email === "string") recoveredFields.afa_email = recoveredMetadata.afa_email;
          if (!order.afa_residence && typeof recoveredMetadata.afa_residence === "string") recoveredFields.afa_residence = recoveredMetadata.afa_residence;
          if (!order.afa_date_of_birth && typeof recoveredMetadata.afa_date_of_birth === "string") recoveredFields.afa_date_of_birth = recoveredMetadata.afa_date_of_birth;

          if (Object.keys(recoveredFields).length > 0) {
            await supabase.from("orders").update(recoveredFields).eq("id", reference);
            order = { ...order, ...recoveredFields };
          }
        } catch (error) {
          console.error("Metadata recovery failed for paid order:", reference, error);
        }
      }

      if (order.order_type === "afa") {
        const afaData = buildAfaPayload(order);
        const result = await callProviderApi(activeSource, DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "afa-registration", afaData);
        if (result.ok) {
          await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
          fulfilled = true;
        } else {
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", reference);
        }
      } else {
        const network = order.network || (typeof recoveredMetadata.network === "string" ? recoveredMetadata.network : null);
        const packageSize = order.package_size || (typeof recoveredMetadata.package_size === "string" ? recoveredMetadata.package_size : null);
        const customerPhone = order.customer_phone || (typeof recoveredMetadata.customer_phone === "string" ? recoveredMetadata.customer_phone : null);
        if (!network || !packageSize || !customerPhone) {
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Missing order details" }).eq("id", reference);
        } else {
          const result = await callProviderApi(activeSource, DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
            networkRaw: network,
            networkKey: mapNetworkKey(network),
            recipient: normalizeRecipient(customerPhone),
            capacity: parseCapacity(packageSize),
          }, DATA_PROVIDER_WEBHOOK_URL);
          if (result.ok) {
            await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
            fulfilled = true;
          } else {
            await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", reference);
          }
        }
      }

      const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();
      return new Response(JSON.stringify({
        status: updatedOrder?.status || (fulfilled ? "fulfilled" : "fulfillment_failed"),
        failure_reason: updatedOrder?.failure_reason || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyContentType = verifyRes.headers.get("content-type");
    if (!verifyContentType?.includes("application/json")) {
      return new Response(JSON.stringify({ status: order?.status || "unknown", error: "Verification failed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      return new Response(JSON.stringify({ status: order?.status || "pending" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metadata = verifyData.data.metadata || {};
    const orderType = order?.order_type || metadata.order_type;
    const paidAmount = Number(order?.amount || (verifyData.data.amount / 100));

    if (order) {
      const recoveredAgentId = typeof metadata.agent_id === "string" ? metadata.agent_id : "";
      const patch: Record<string, unknown> = {};
      const hasPlaceholderAgentId = !order.agent_id || order.agent_id === "00000000-0000-0000-0000-000000000000";

      if (hasPlaceholderAgentId && recoveredAgentId) patch.agent_id = recoveredAgentId;
      if (!order.network && metadata.network) patch.network = metadata.network;
      if (!order.package_size && metadata.package_size) patch.package_size = metadata.package_size;
      if (!order.customer_phone && metadata.customer_phone) patch.customer_phone = metadata.customer_phone;
      if ((!order.profit || Number(order.profit) === 0) && Number.isFinite(Number(metadata.profit))) {
        patch.profit = parseFloat(Number(metadata.profit).toFixed(2));
      }

      if (Object.keys(patch).length > 0) {
        await supabase.from("orders").update(patch).eq("id", reference);
        order = { ...order, ...patch };
      }
    }

    let shouldSendDataPaymentSms = false;
    let smsPhone = "";
    const resolvedAgentId = order?.agent_id || metadata.agent_id || "00000000-0000-0000-0000-000000000000";

    if (!order) {
      console.log("Recreating order from Paystack metadata:", { reference, orderType, agentId: resolvedAgentId });
      const walletCredit = Number(metadata.wallet_credit || metadata.amount || paidAmount);
      const metadataProfit = Number(metadata.profit);
      const normalizedProfit = Number.isFinite(metadataProfit) && metadataProfit > 0
        ? parseFloat(metadataProfit.toFixed(2))
        : 0;
      await supabase.from("orders").insert({
        id: reference,
        agent_id: resolvedAgentId,
        order_type: orderType || "wallet_topup",
        amount: orderType === "wallet_topup" ? walletCredit : paidAmount,
        profit: normalizedProfit,
        status: "paid",
        network: metadata.network || null,
        package_size: metadata.package_size || null,
        customer_phone: metadata.customer_phone || null,
      });
      shouldSendDataPaymentSms = (orderType || "") === "data";
      smsPhone = String(metadata.customer_phone || "");
    } else if (order?.status === "pending") {
      await supabase.from("orders").update({ status: "paid", failure_reason: null }).eq("id", reference);
      shouldSendDataPaymentSms = (orderType || order?.order_type || "") === "data";
      smsPhone = String(order?.customer_phone || metadata.customer_phone || "");
    }

    if (shouldSendDataPaymentSms && smsPhone) {
      await sendPaymentSms(smsPhone);
    }

    console.log("Payment verified for:", reference, "type:", orderType);

    if (orderType === "agent_activation" && resolvedAgentId) {
      console.log("Processing agent activation for:", resolvedAgentId);
      await supabase.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", resolvedAgentId);
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "sub_agent_activation") {
      const subAgentId = metadata?.sub_agent_id || resolvedAgentId;
      const parentAgentId = metadata?.parent_agent_id;
      const activationAmount = Number(metadata?.activation_fee || order?.amount || paidAmount || 0);
      const agentProfit = Number.isFinite(Number(metadata?.agent_profit))
        ? Number(metadata?.agent_profit)
        : parseFloat((activationAmount * 0.5).toFixed(2));
      if (subAgentId) {
        const { data: parentProfile } = await supabase
          .from("profiles").select("sub_agent_prices").eq("user_id", parentAgentId).maybeSingle();
        const subAgentPrices = parentProfile?.sub_agent_prices || {};
        await supabase.from("profiles").update({
          is_agent: true, agent_approved: true, sub_agent_approved: true,
          onboarding_complete: true, agent_prices: subAgentPrices,
        }).eq("user_id", subAgentId);
        if (parentAgentId && agentProfit > 0) {
          const { data: pw } = await supabase.from("wallets").select("balance").eq("agent_id", parentAgentId).maybeSingle();
          if (pw) {
            await supabase.from("wallets").update({ balance: parseFloat(((Number(pw.balance) || 0) + agentProfit).toFixed(2)) }).eq("agent_id", parentAgentId);
          } else {
            await supabase.from("wallets").insert({ agent_id: parentAgentId, balance: agentProfit });
          }
        }
        await supabase
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null, profit: agentProfit })
          .eq("id", reference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup") {
      const creditAmount = Number(metadata.wallet_credit || order?.amount || paidAmount);
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", resolvedAgentId).maybeSingle();
      if (wallet) {
        const newBalance = parseFloat(((wallet.balance || 0) + creditAmount).toFixed(2));
        await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", resolvedAgentId);
      } else {
        await supabase.from("wallets").insert({ agent_id: resolvedAgentId, balance: creditAmount });
      }
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!DATA_PROVIDER_BASE_URL || !DATA_PROVIDER_API_KEY) {
      console.error("Data provider not configured");
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }).eq("id", reference);
      return new Response(JSON.stringify({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const needsFulfillment = !order || order.status === "pending" || order.status === "paid" || order.status === "fulfillment_failed";
    if (!needsFulfillment) {
      return new Response(JSON.stringify({ status: order?.status || "unknown" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fulfilled = false;

    if (orderType === "afa") {
      const afaData = buildAfaPayload({
        afa_full_name: order?.afa_full_name ?? metadata.afa_full_name,
        afa_ghana_card: order?.afa_ghana_card ?? metadata.afa_ghana_card,
        afa_occupation: order?.afa_occupation ?? metadata.afa_occupation,
        afa_email: order?.afa_email ?? metadata.afa_email,
        afa_residence: order?.afa_residence ?? metadata.afa_residence,
        afa_date_of_birth: order?.afa_date_of_birth ?? metadata.afa_date_of_birth,
      });

      const result = await callProviderApi(activeSource, DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "afa-registration", afaData);
      console.log("AFA fulfillment response:", {
        reference,
        status: result.status,
        reason: result.reason,
        url: result.url,
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
        fulfilled = true;
      } else {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: result.reason,
        }).eq("id", reference);
      }
    } else {
      const network = order?.network ?? metadata.network;
      const packageSize = order?.package_size ?? metadata.package_size;
      const customerPhone = order?.customer_phone ?? metadata.customer_phone;

      if (!network || !packageSize || !customerPhone) {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing order details for fulfillment.",
        }).eq("id", reference);
      } else {
        const networkKey = mapNetworkKey(network);
        const capacity = parseCapacity(packageSize);
        console.log("Fulfilling data order:", { networkKey, capacity, recipient: customerPhone });

        const result = await callProviderApi(activeSource, DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
          networkRaw: network,
          networkKey,
          recipient: normalizeRecipient(customerPhone),
          capacity,
        }, DATA_PROVIDER_WEBHOOK_URL);
        console.log("Data fulfillment response:", {
          reference,
          status: result.status,
          reason: result.reason,
          url: result.url,
        });

        if (result.ok) {
          await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
          fulfilled = true;
        } else {
          await supabase.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: result.reason,
          }).eq("id", reference);
        }
      }
    }

    const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();

    return new Response(JSON.stringify({
      status: updatedOrder?.status || (fulfilled ? "fulfilled" : "pending"),
      failure_reason: updatedOrder?.failure_reason || null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});