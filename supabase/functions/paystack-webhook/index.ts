import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

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

  urls.add(`${clean}/order`);
  urls.add(`${clean}/api/order`);

  if (token) {
    urls.add(`${clean}/${token}/order`);
    urls.add(`${clean}/api/${token}/order`);
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
  const smsType = getFirstEnvValue(["TXTCONNECT_SMS_TYPE"]) || "regular";

  if (!smsApiKey || !customerPhone.trim()) return;

  try {
    const res = await fetch(smsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${smsApiKey}`,
      },
      body: JSON.stringify({
        to: customerPhone.trim(),
        from: senderId,
        unicode: smsType,
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
    body: "",
    reason: "Provider request failed",
    url: null,
  };

  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
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
          body: JSON.stringify(baseRequestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const contentType = response.headers.get("content-type");
        const text = await response.text();

        if (response.ok) {
          const semantic = parseProviderResponse(text, contentType);
          if (semantic.ok) {
            return { ok: true, status: response.status, body: text, reason: "", url };
          }

          const reason = semantic.reason || "Provider rejected this order.";
          lastFailure = { ok: false, status: response.status, body: text, reason, url };
          return lastFailure;
        }

        const reason = getProviderFailureReason(response.status, text, contentType);
        lastFailure = { ok: false, status: response.status, body: text, reason, url };

        const retryable = response.status >= 500 || response.status === 429;
        const tryNextUrl = response.status === 404 || (isHtmlResponse(contentType, text) && response.status !== 401 && response.status !== 403);

        if (retryable && attempt < 3) {
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

        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }
  }

  return lastFailure;
}

function buildAfaPayload(metadata: Record<string, unknown>) {
  return {
    fullName: metadata.afa_full_name,
    ghanaCardNumber: metadata.afa_ghana_card,
    occupation: metadata.afa_occupation,
    email: metadata.afa_email,
    placeOfResidence: metadata.afa_residence,
    dateOfBirth: metadata.afa_date_of_birth,
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
    console.error("Missing required secrets");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hash = createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  if (hash !== signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const activeSource = await getActiveProviderSource(supabase);
    const providerConfig = getProviderCredentials(activeSource);
    const DATA_PROVIDER_API_KEY = providerConfig.apiKey;
    const DATA_PROVIDER_BASE_URL = providerConfig.baseUrl;

    const body = JSON.parse(rawBody);
    if (body.event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference, metadata = {} } = body.data;
    console.log("Webhook: Payment successful for reference:", reference);

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Payment verification failed:", verifyData);
      return new Response(JSON.stringify({ error: "Payment verification failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = metadata?.order_id || reference;
    const verifiedAmount = Number(verifyData?.data?.amount || 0) / 100;
    const orderTypeFromMetadata = typeof metadata?.order_type === "string" ? metadata.order_type : null;

    let { data: existingOrder } = await supabase
      .from("orders")
      .select("id, order_type, agent_id, network, package_size, customer_phone, amount, status")
      .eq("id", orderId)
      .maybeSingle();

    let shouldSendDataPaymentSms = false;
    let smsPhone = "";

    if (!existingOrder) {
      const recreatedOrder = {
        id: orderId,
        agent_id: typeof metadata?.agent_id === "string" ? metadata.agent_id : "00000000-0000-0000-0000-000000000000",
        order_type: orderTypeFromMetadata || "data",
        amount: Number.isFinite(verifiedAmount) && verifiedAmount > 0 ? verifiedAmount : Number(metadata?.amount || 0),
        profit: 0,
        status: "paid",
        failure_reason: null,
        network: typeof metadata?.network === "string" ? metadata.network : null,
        package_size: typeof metadata?.package_size === "string" ? metadata.package_size : null,
        customer_phone: typeof metadata?.customer_phone === "string" ? metadata.customer_phone : null,
        afa_full_name: typeof metadata?.afa_full_name === "string" ? metadata.afa_full_name : null,
        afa_ghana_card: typeof metadata?.afa_ghana_card === "string" ? metadata.afa_ghana_card : null,
        afa_occupation: typeof metadata?.afa_occupation === "string" ? metadata.afa_occupation : null,
        afa_email: typeof metadata?.afa_email === "string" ? metadata.afa_email : null,
        afa_residence: typeof metadata?.afa_residence === "string" ? metadata.afa_residence : null,
        afa_date_of_birth: typeof metadata?.afa_date_of_birth === "string" ? metadata.afa_date_of_birth : null,
      };

      const { error: recreateError } = await supabase.from("orders").insert(recreatedOrder);
      if (recreateError) {
        console.error("Webhook failed to recreate missing order:", recreateError);
      } else {
        existingOrder = recreatedOrder;
        shouldSendDataPaymentSms = (recreatedOrder.order_type || "") === "data";
        smsPhone = String(recreatedOrder.customer_phone || metadata?.customer_phone || "");
      }
    } else {
      shouldSendDataPaymentSms = existingOrder.status === "pending" && (existingOrder.order_type || "") === "data";
      smsPhone = String(existingOrder.customer_phone || metadata?.customer_phone || "");
      await supabase.from("orders").update({ status: "paid", failure_reason: null }).eq("id", orderId);
    }

    if (shouldSendDataPaymentSms && smsPhone) {
      await sendPaymentSms(smsPhone);
    }

    const orderType = (existingOrder?.order_type || orderTypeFromMetadata || "data") as string;

    if (orderType === "agent_activation") {
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabase.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", agentId);
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        console.log("Agent activated via webhook:", agentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "sub_agent_activation") {
      const subAgentId = metadata?.sub_agent_id;
      const parentAgentId = metadata?.parent_agent_id;
      const agentProfit = Number(metadata?.agent_profit || 0);
      if (subAgentId) {
        // Fetch parent's sub_agent_prices to copy as the sub agent's agent_prices
        const { data: parentProfile } = await supabase
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", parentAgentId)
          .maybeSingle();
        const subAgentPrices = parentProfile?.sub_agent_prices || {};

        await supabase.from("profiles").update({
          is_agent: true,
          agent_approved: true,
          sub_agent_approved: true,
          onboarding_complete: true,
          agent_prices: subAgentPrices,
        }).eq("user_id", subAgentId);

        // Credit parent agent wallet with the activation markup profit
        if (parentAgentId && agentProfit > 0) {
          const { data: parentWallet } = await supabase
            .from("wallets").select("balance").eq("agent_id", parentAgentId).maybeSingle();
          if (parentWallet) {
            const newBalance = parseFloat(((Number(parentWallet.balance) || 0) + agentProfit).toFixed(2));
            await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", parentAgentId);
          } else {
            await supabase.from("wallets").insert({ agent_id: parentAgentId, balance: agentProfit });
          }
        }

        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        console.log("Sub agent activated via webhook:", subAgentId, "parent:", parentAgentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup") {
      const { data: order } = await supabase.from("orders").select("amount, agent_id").eq("id", orderId).maybeSingle();
      if (order) {
        const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", order.agent_id).maybeSingle();
        if (wallet) {
          const newBalance = parseFloat(((wallet.balance || 0) + order.amount).toFixed(2));
          await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", order.agent_id);
        } else {
          await supabase.from("wallets").insert({ agent_id: order.agent_id, balance: order.amount });
        }
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      console.error("Data provider not configured for fulfillment");
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "afa") {
      const result = await callProviderApi(
        activeSource,
        DATA_PROVIDER_BASE_URL,
        DATA_PROVIDER_API_KEY,
        "afa-registration",
        buildAfaPayload(metadata),
      );

      console.log("Webhook AFA fulfillment response:", {
        orderId,
        status: result.status,
        reason: result.reason,
        url: result.url,
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: result.reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const network = typeof existingOrder?.network === "string"
      ? existingOrder.network
      : (typeof metadata?.network === "string" ? metadata.network : "");
    const packageSize = typeof existingOrder?.package_size === "string"
      ? existingOrder.package_size
      : (typeof metadata?.package_size === "string" ? metadata.package_size : "");
    const customerPhone = typeof existingOrder?.customer_phone === "string"
      ? existingOrder.customer_phone
      : (typeof metadata?.customer_phone === "string" ? metadata.customer_phone : "");

    if (!network || !packageSize || !customerPhone) {
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Missing order details for fulfillment.",
      }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Missing order details for fulfillment." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await callProviderApi(
      activeSource,
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      "purchase",
      {
        networkRaw: network,
        networkKey: mapNetworkKey(network),
        recipient: normalizeRecipient(customerPhone),
        capacity: parseCapacity(packageSize),
      },
      DATA_PROVIDER_WEBHOOK_URL,
    );

    console.log("Webhook data fulfillment response:", {
      orderId,
      status: result.status,
      reason: result.reason,
      url: result.url,
    });

    if (result.ok) {
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
    return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: result.reason }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});