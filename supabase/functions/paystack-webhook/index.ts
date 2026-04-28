import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate, sendPaymentSms } from "../_shared/sms.ts";

function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) return value;
  }
  return "";
}

function getProviderCredentials(): { apiKey: string; baseUrl: string } {
  const primaryApiKey = getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_PRIMARY_API_KEY",
  ]);

  const primaryBaseUrl = getFirstEnvValue([
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_PRIMARY_BASE_URL",
  ]).replace(/\/+$/, "");

  return {
    apiKey: primaryApiKey,
    baseUrl: primaryBaseUrl,
  };
}

async function getAirtimeCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string }> {
  // Try fetching from DB first
  const { data: dbSettings } = await supabaseAdmin.from("system_settings").select("*").eq("id", 1).maybeSingle();

  const apiKey = Deno.env.get("AIRTIME_PROVIDER_API_KEY") || 
                 Deno.env.get("PRIMARY_DATA_PROVIDER_API_KEY") || 
                 dbSettings?.airtime_provider_api_key || 
                 dbSettings?.data_provider_api_key || "";
  
  const baseUrl = Deno.env.get("AIRTIME_PROVIDER_BASE_URL") || 
                  Deno.env.get("PRIMARY_DATA_PROVIDER_BASE_URL") || 
                  dbSettings?.airtime_provider_base_url || 
                  dbSettings?.data_provider_base_url || "";
  
  return { apiKey, baseUrl: (baseUrl || "").replace(/\/+$/, "") };
}

function mapNetworkKey(network: string, variant: number = 0): string {
  const n = network.trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return "MTN";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "VOD";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AT";
  if (n === "GLO") return "GLO";
  return n;
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

  // Also try host-root endpoints in case the configured base URL contains an extra path segment.
  if (rootUrl) {
    for (const alias of endpointAliases) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
      urls.add(`${rootUrl}/functions/v1/developer-api/${alias}`);
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

async function sendWalletTopupSms(supabaseAdmin: any, userId: string, amount: number) {
  try {
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
    const { data: wallet } = await supabaseAdmin.from("wallets").select("balance").eq("agent_id", userId).maybeSingle();
    
    if (!profile?.phone) return;

    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(profile.phone);
    
    if (!apiKey || !recipient) return;

    const message = formatTemplate(templates.wallet_topup, {
      amount: amount.toFixed(2),
      balance: (wallet?.balance || 0).toFixed(2)
    });

    await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error("sendWalletTopupSms error:", error);
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
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
  providerWebhookUrl = "",
): Promise<ProviderResult> {
  const urls = buildProviderUrls(baseUrl, endpoint);

  let baseRequestBody: Record<string, unknown> = body;

  if (endpoint === "purchase" && providerWebhookUrl && !Object.prototype.hasOwnProperty.call(body, "webhook_url")) {
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
            "Authorization": `Bearer ${apiKey}`,
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
        const tryNextUrl =
          response.status === 404 ||
          (isHtmlResponse(contentType, text) && response.status !== 401 && response.status !== 403);

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

function amountMatches(expected: number, actual: number, tolerance = 0.01): boolean {
  return Math.abs(expected - actual) <= tolerance;
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
  const hashBuf = Buffer.from(hash, "utf8");
  const sigBuf = Buffer.from(signature, "utf8");
  const signatureValid = hashBuf.length === sigBuf.length && timingSafeEqual(hashBuf, sigBuf);
  if (!signatureValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const providerConfig = getProviderCredentials();
    const DATA_PROVIDER_API_KEY = providerConfig.apiKey;
    const DATA_PROVIDER_BASE_URL = providerConfig.baseUrl;

    const body = JSON.parse(rawBody);
    if (body.event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference, metadata: webhookMetadata = {} } = body.data;
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

    const verifiedMetadata = (verifyData?.data?.metadata || {}) as Record<string, unknown>;
    const metadata = {
      ...(webhookMetadata as Record<string, unknown>),
      ...verifiedMetadata,
    };

    const orderId =
      (typeof metadata?.order_id === "string" && metadata.order_id) ||
      (typeof verifiedMetadata?.order_id === "string" && verifiedMetadata.order_id) ||
      reference;
    const verifiedAmount = Number(verifyData?.data?.amount || 0) / 100;
    const paystackFeeOnVerified = parseFloat(Math.min(verifiedAmount * 0.03 / 1.03, 100).toFixed(2));
    const orderTypeFromMetadata = typeof metadata?.order_type === "string" ? metadata.order_type : null;

    let { data: existingOrder } = await supabase
      .from("orders")
      .select("id, order_type, agent_id, parent_agent_id, network, package_size, customer_phone, amount, status, profit, parent_profit")
      .eq("id", orderId)
      .maybeSingle();

    if (existingOrder?.status === "fulfilled") {
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let shouldSendDataPaymentSms = false;
    let smsPhone = "";

    if (!existingOrder) {
      // Profit is always 0 for recreated orders — never trust client-supplied metadata values
      const normalizedProfit = 0;
      const normalizedParentProfit = 0;
      const requestedWalletCredit = Number(metadata?.wallet_credit);
      const walletCredit = Number.isFinite(requestedWalletCredit) && requestedWalletCredit > 0
        ? Math.min(requestedWalletCredit, verifiedAmount)
        : verifiedAmount;
      const normalizedAmount = (orderTypeFromMetadata || "data") === "wallet_topup"
        ? walletCredit
        : (Number.isFinite(verifiedAmount) && verifiedAmount > 0 ? verifiedAmount : 0);
      const recreatedOrder = {
        id: orderId,
        agent_id: typeof metadata?.agent_id === "string" ? metadata.agent_id : "00000000-0000-0000-0000-000000000000",
        parent_agent_id: typeof metadata?.parent_agent_id === "string" ? metadata.parent_agent_id : null,
        order_type: orderTypeFromMetadata || "data",
        amount: normalizedAmount,
        profit: normalizedProfit,
        parent_profit: normalizedParentProfit,
        status: "paid",
        failure_reason: null,
        network: typeof metadata?.network === "string" ? metadata.network : null,
        package_size: typeof metadata?.package_size === "string" ? metadata.package_size : null,
        customer_phone: typeof (metadata?.customer_phone || metadata?.phone) === "string" 
          ? (metadata.customer_phone || metadata.phone) 
          : null,
        afa_full_name: typeof metadata?.afa_full_name === "string" ? metadata.afa_full_name : null,
        afa_ghana_card: typeof metadata?.afa_ghana_card === "string" ? metadata.afa_ghana_card : null,
        afa_occupation: typeof metadata?.afa_occupation === "string" ? metadata.afa_occupation : null,
        afa_email: typeof metadata?.afa_email === "string" ? metadata.afa_email : null,
        afa_residence: typeof metadata?.afa_residence === "string" ? metadata.afa_residence : null,
        afa_date_of_birth: typeof metadata?.afa_date_of_birth === "string" ? metadata.afa_date_of_birth : null,
        utility_type: typeof metadata?.utility_type === "string" ? metadata.utility_type : null,
        utility_provider: typeof metadata?.utility_provider === "string" ? metadata.utility_provider : null,
        utility_account_number: typeof metadata?.utility_account_number === "string" ? metadata.utility_account_number : null,
        utility_account_name: typeof metadata?.utility_account_name === "string" ? metadata.utility_account_name : null,
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
      const patch: Record<string, unknown> = { failure_reason: null };
      const recoveredAgentId = typeof metadata?.agent_id === "string" ? metadata.agent_id : "";
      const hasPlaceholderAgentId = !existingOrder.agent_id || existingOrder.agent_id === "00000000-0000-0000-0000-000000000000";

      if (hasPlaceholderAgentId && recoveredAgentId) patch.agent_id = recoveredAgentId;
      if (!existingOrder.network && typeof metadata?.network === "string") patch.network = metadata.network;
      if (!existingOrder.package_size && typeof metadata?.package_size === "string") patch.package_size = metadata.package_size;
      if (!existingOrder.customer_phone && typeof (metadata?.customer_phone || metadata?.phone) === "string") {
        patch.customer_phone = metadata.customer_phone || metadata.phone;
      }
      if (!existingOrder.parent_agent_id && typeof metadata?.parent_agent_id === "string" && metadata.parent_agent_id) {
        patch.parent_agent_id = metadata.parent_agent_id;
      }

      if (existingOrder.status === "pending" || existingOrder.status === "fulfillment_failed") {
        patch.status = "paid";
      }

      await supabase.from("orders").update(patch).eq("id", orderId);
      existingOrder = { ...existingOrder, ...patch };
    }

    if (shouldSendDataPaymentSms && smsPhone) {
      await sendPaymentSms(supabase, smsPhone, "payment_success");
    }

    // Declare orderType BEFORE first use to avoid temporal dead zone crash
    const orderType = (existingOrder?.order_type || orderTypeFromMetadata || "data") as string;
    const existingAmount = Number(existingOrder?.amount || 0);

    if (orderType === "wallet_topup" && existingOrder?.agent_id) {
      await sendWalletTopupSms(supabase, existingOrder.agent_id, verifiedAmount);
    }

    if (orderType !== "wallet_topup" && Number.isFinite(existingAmount) && existingAmount > 0 && !amountMatches(existingAmount, verifiedAmount)) {
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: `Payment amount mismatch. Expected GHS ${existingAmount.toFixed(2)}, received GHS ${verifiedAmount.toFixed(2)}.`,
      }).eq("id", orderId);

      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Payment amount mismatch" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup" && Number.isFinite(existingAmount) && existingAmount > (verifiedAmount + 0.05)) {
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: `Wallet credit mismatch. Credit GHS ${existingAmount.toFixed(2)} exceeds payment GHS ${verifiedAmount.toFixed(2)}.`,
      }).eq("id", orderId);

      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Wallet credit exceeds verified payment" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimableStatuses = ["pending", "paid", "fulfillment_failed"];
    const { data: claimedOrder, error: claimError } = await supabase
      .from("orders")
      .update({
        status: "processing",
        failure_reason: null,
        paystack_verified_amount: verifiedAmount,
        paystack_fee: paystackFeeOnVerified,
      })
      .eq("id", orderId)
      .in("status", claimableStatuses)
      .select("*")
      .maybeSingle();

    if (claimError) {
      console.error("Webhook failed to claim order for fulfillment:", orderId, claimError);
    }

    if (!claimedOrder) {
      const { data: latestOrder } = await supabase
        .from("orders")
        .select("status, failure_reason")
        .eq("id", orderId)
        .maybeSingle();

      return new Response(JSON.stringify({
        received: true,
        fulfilled: latestOrder?.status === "fulfilled",
        status: latestOrder?.status || existingOrder?.status || "unknown",
        failure_reason: latestOrder?.failure_reason || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    existingOrder = claimedOrder;

    if (orderType === "utility") {
      // For now, utility payments are marked as 'paid' and require manual fulfillment or an API connection
      await supabase.from("orders").update({ 
        status: "paid", 
        failure_reason: "Awaiting manual fulfillment / Token generation" 
      }).eq("id", orderId);
      
      console.log("Utility payment successful, awaiting fulfillment:", orderId);
      
      return new Response(JSON.stringify({ received: true, fulfilled: false, status: "paid" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "agent_activation") {
      const AGENT_ACTIVATION_MINIMUM = 80; // GHS — enforced server-side
      if (verifiedAmount < AGENT_ACTIVATION_MINIMUM * 0.97) {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: `Payment too low for agent activation. Minimum GHS ${AGENT_ACTIVATION_MINIMUM}, received GHS ${verifiedAmount.toFixed(2)}.`,
        }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Activation payment below minimum" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabase.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: false,
          parent_agent_id: null
        }).eq("user_id", agentId);
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
      const activationAmount = Number(metadata?.activation_fee || existingOrder?.amount || verifiedAmount || 0);
      // Security: Never trust client-supplied profit metadata. 
      // Activation fee base is GHS 80. Anything above that is agent profit.
      const agentProfit = Math.max(0, parseFloat((activationAmount - 80).toFixed(2)));
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
          await supabase.rpc("credit_order_profits", { p_order_id: orderId });
        }

        await supabase
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null, profit: agentProfit })
          .eq("id", orderId);
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
        await supabase.rpc("credit_wallet", { p_agent_id: order.agent_id, p_amount: order.amount });
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
        DATA_PROVIDER_BASE_URL,
        DATA_PROVIDER_API_KEY,
        "afa-registration",
        buildAfaPayload(metadata),
      );

      console.log("Webhook AFA fulfillment response:", {
        orderId,
        status: result.status,
        reason: result.reason,
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        
        // Credit profits
        if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
          await supabase.rpc("credit_order_profits", { p_order_id: orderId });
        }
        
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
      : (typeof (metadata?.customer_phone || metadata?.phone) === "string" ? (metadata.customer_phone || metadata.phone) : "");

    // Airtime orders have no package_size — they use amount instead.
    if (orderType === "airtime") {
      const airtimeAmount: number =
        Number(metadata?.base_price) || 
        (typeof existingOrder?.amount === "number"
          ? existingOrder.amount
          : typeof metadata?.amount === "number"
          ? metadata.amount
          : 0);

      if (!network || !airtimeAmount || !customerPhone) {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing network, amount, or phone for airtime fulfillment.",
        }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Missing airtime order details." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Use Airtime-specific credentials and format
      const { apiKey: AIRTIME_KEY, baseUrl: AIRTIME_BASE } = await getAirtimeCredentials(supabase);
      
      const airtimeNetworkKey = mapNetworkKey(network);
      const airtimeRecipient = normalizeRecipient(customerPhone);
      const airtimeResult = await callProviderApi(
        AIRTIME_BASE,
        AIRTIME_KEY,
        "purchase",
        {
          customerNumber: airtimeRecipient,
          amount: airtimeAmount,
          networkCode: airtimeNetworkKey,
          description: `Airtime topup: GHS ${airtimeAmount} for ${airtimeRecipient}`
        },
        DATA_PROVIDER_WEBHOOK_URL
      );

      if (airtimeResult.ok) {
        let providerOrderId = null;
        try {
          const parsed = JSON.parse(airtimeResult.body);
          providerOrderId = parsed.transaction_id || parsed.order_id || parsed.reference;
        } catch { /* ignore */ }

        await supabase.from("orders").update({ 
          status: "fulfilled", 
          failure_reason: null,
          provider_order_id: providerOrderId 
        }).eq("id", orderId);
        
        if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
          await supabase.rpc("credit_order_profits", { p_order_id: orderId });
        }
        if (customerPhone) await sendPaymentSms(supabase, customerPhone, "payment_success");
        return new Response(JSON.stringify({ received: true, fulfilled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: airtimeResult.reason }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: airtimeResult.reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      "purchase",
      {
        networkRaw: network,
        networkKey: mapNetworkKey(network),
        recipient: normalizeRecipient(customerPhone),
        capacity: parseCapacity(packageSize),
        amount: existingOrder?.amount || verifiedAmount,
        order_type: "data",
        description: `Data: ${packageSize} for ${customerPhone}`
      },
      DATA_PROVIDER_WEBHOOK_URL,
    );

    console.log("Webhook fulfillment response:", {
      orderId,
      status: result.status,
      reason: result.reason,
      url: result.url,
    });

    if (result.ok) {
      let providerOrderId = null;
      try {
        const parsed = JSON.parse(result.body);
        providerOrderId = parsed.transaction_id || parsed.order_id || parsed.reference;
      } catch { /* ignore */ }

      await supabase.from("orders").update({ 
        status: "fulfilled", 
        failure_reason: null,
        provider_order_id: providerOrderId
      }).eq("id", orderId);
      
      // Credit profits
      if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
        await supabase.rpc("credit_order_profits", { p_order_id: orderId });
      }

      if (customerPhone) {
        await sendPaymentSms(supabase, customerPhone, "payment_success");
      }

      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
    
    if (customerPhone) {
      await sendPaymentSms(supabase, customerPhone, "order_failed", {
        package: packageSize || "Data",
        phone: customerPhone,
        amount: (existingOrder?.amount || 0).toFixed(2)
      });
    }
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