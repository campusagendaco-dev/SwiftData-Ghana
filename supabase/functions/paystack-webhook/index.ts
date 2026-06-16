import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// removed node:crypto
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate, sendPaymentSms } from "../_shared/sms.ts";
import { sendWhatsAppMessage } from "../_shared/whatsapp.ts";
import { notifyApiClient, notifyWalletCredit } from "../_shared/webhooks.ts";
import { getActiveProviders } from "../_shared/providers.ts";


function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) return value;
  }
  return "";
}

async function getProviderCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string }> {
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

  if (primaryApiKey && primaryBaseUrl) return { apiKey: primaryApiKey, baseUrl: primaryBaseUrl };

  // Fall back to DB if env vars are not set
  const { data: settings } = await supabaseAdmin
    .from("v_system_settings_with_secrets").select("data_provider_api_key, data_provider_base_url")
    .eq("id", 1)
    .maybeSingle();

  return {
    apiKey: primaryApiKey || settings?.data_provider_api_key || "",
    baseUrl: (primaryBaseUrl || settings?.data_provider_base_url || "").replace(/\/+$/, ""),
  };
}

async function getAirtimeCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string }> {
  // Try fetching from DB first
  const { data: dbSettings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("*").eq("id", 1).maybeSingle();

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

function mapDataNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AIRTEL-TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE" || n === "VOD") return "TELECEL";
  if (n === "MTN" || n === "YELLO" || n === "MTN MASH UP" || n === "MTN_MASH_UP" || n === "MTN MASHUP" || n === "MTN MASH-UP" || n === "MASHUP" || n === "MASH UP") return "YELLO";
  return n;
}

// Maps network names to the keys the airtime provider API expects (must match wallet-pay-airtime)
function mapAirtimeNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
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

  if (clean.includes("superbdatafy") || clean.includes("qhowmenzconsult")) {
    return [clean];
  }

  const isDatamart = clean.includes("/api/developer") || clean.includes("datamartgh");
  const endpointAliases = isDatamart
    ? (endpoint === "status" ? ["order-status"] : (endpoint === "purchase" ? ["purchase"] : [endpoint]))
    : (endpoint === "purchase" ? ["purchase", "order", "airtime", "buy", "data-purchase"] : [endpoint]);

  if (isDatamart) {
    for (const alias of endpointAliases) {
      urls.add(`${clean}/${alias}`);
    }
    return Array.from(urls);
  }

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

function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string; id?: string; status?: string } {
  try {
    const parsed = JSON.parse(body);
    const rawStatus = parsed?.status;
    const status = String(rawStatus || "").toLowerCase();
    const statusCode = Number(parsed?.statusCode);
    const message = typeof parsed?.message === "string" ? parsed.message : undefined;
    const orderId = parsed?.transaction?.reference || parsed?.data?.orderNumber || parsed?.data?.reference || parsed?.transaction_id || parsed?.order_id || parsed?.reference || parsed?.id;
    const deliveryStatus = String(parsed?.transaction?.status || parsed?.data?.status || parsed?.data?.orderStatus || parsed?.delivery_status || parsed?.status_message || "").toLowerCase();

    // Determine if it's actually delivered
    const isActuallyDelivered = !deliveryStatus || deliveryStatus === "delivered" || deliveryStatus === "success" || deliveryStatus === "successful" || deliveryStatus === "completed" || deliveryStatus === "fulfilled" || deliveryStatus === "true" || deliveryStatus === "sent";

    if (rawStatus === true || status === "true" || status === "success" || parsed?.success === true) {
      return { ok: true, id: orderId, status: isActuallyDelivered ? "delivered" : deliveryStatus };
    }

    if (rawStatus === false || parsed?.success === false || status === "false" || status === "error" || status === "failed" || status === "failure") {
      return { ok: false, reason: message || parsed?.error || "Provider rejected this order." };
    }

    if (Number.isFinite(statusCode) && statusCode >= 400) {
      return { ok: false, reason: message || "Provider rejected this order." };
    }

    // If it has an ID, it's likely a successful initiation
    if (orderId) return { ok: true, id: orderId, status: isActuallyDelivered ? "delivered" : deliveryStatus };

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

async function sendWhatsAppFulfillmentNotification(to: string, type: string, net: string, pkg: string, phone: string) {
  try {
    const msg = [
      `✅ *Order Fulfilled!*`,
      ``,
      `Your *${net} ${pkg || type}* order for *${phone}* has been delivered successfully. 🚀`,
      ``,
      `Thank you for choosing SwiftData!`,
    ].join("\n");
    await sendWhatsAppMessage(to, msg);
  } catch (err) {
    console.error("[WhatsApp Webhook] Notification error:", err);
  }
}

async function triggerPushNotification(supabaseAdmin: any, payload: { user_id: string; title: string; body: string; url?: string; icon?: string }) {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[Push Webhook] Trigger failed:", text);
    }
  } catch (e) {
    console.error("[Push Webhook] Trigger error:", e);
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
  id?: string;
  deliveryStatus?: string;
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
  
  // SuperbDatafy specific mapping
  if (baseUrl.includes("superbdatafy.com") && endpoint === "purchase") {
    const network = String(body.networkRaw || body.network || "").toLowerCase();
    let sbNetwork = network;
    if (network === "yello") sbNetwork = "mtn";
    if (network === "vod" || network === "vodafone") sbNetwork = "telecel";
    if (network === "airteltigo" || network === "at_premium") sbNetwork = "at";
    
    const pkgSize = String(body.package_size || body.plan || body.package_key || "").replace(/\s+/g, "").toLowerCase();
    const phone = String(body.recipient || body.phoneNumber || body.recipient_phone || "");

    try {
      const bundleRes = await fetch(`${baseUrl}/bundles?network=${sbNetwork}`, {
        headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
      });
      if (bundleRes.ok) {
         const bData = await bundleRes.json();
         const bundles = bData?.bundles || [];
         const match = bundles.find((b: any) => String(b.capacity).replace(/\s+/g, "").toLowerCase() === pkgSize);
         if (match) {
           baseRequestBody = { bundle_id: match.id, phone_number: phone };
         } else {
           return { ok: false, status: 400, body: "", reason: `SuperbDatafy: Bundle ${pkgSize} not found for ${sbNetwork}`, url: null };
         }
      } else {
         return { ok: false, status: 502, body: "", reason: `SuperbDatafy: Failed to fetch bundles (HTTP ${bundleRes.status})`, url: null };
      }
    } catch (e: any) {
       return { ok: false, status: 502, body: "", reason: `SuperbDatafy: Network error fetching bundles - ${e.message}`, url: null };
    }
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

      let reqUrl = url;
      if (baseUrl.includes("superbdatafy.com")) {
        if (endpoint === "status") {
           const ref = String(body.transaction_id || body.reference || body.order_id || "");
           reqUrl = `${url}/transaction/${ref}`;
        } else {
           reqUrl = `${url}/buy-data`;
        }
      } else if (baseUrl.includes("qhowmenzconsult.com")) {
        if (endpoint === "status") {
           const ref = String(body.transaction_id || body.reference || body.order_id || "");
           reqUrl = `${url}/orders/${ref}`;
        } else {
           reqUrl = `${url}/orders`;
        }
      }

      try {
        const response = await fetch(reqUrl, {
          method: ((baseUrl.includes("superbdatafy.com") || baseUrl.includes("qhowmenzconsult.com")) && endpoint === "status") ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": apiKey,
            ...(!baseUrl.includes("qhowmenzconsult.com") ? { "Authorization": `Bearer ${apiKey}` } : {}),
            "User-Agent": "DataHiveGH/1.0",
          },
          body: ((baseUrl.includes("superbdatafy.com") || baseUrl.includes("qhowmenzconsult.com")) && endpoint === "status") ? undefined : JSON.stringify(baseRequestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const contentType = response.headers.get("content-type");
        const text = await response.text();

        if (response.ok) {
          const semantic = parseProviderResponse(text, contentType);
          if (semantic.ok) {
            return { ok: true, status: response.status, body: text, reason: "", url, id: semantic.id, deliveryStatus: semantic.status };
          }

          const reason = semantic.reason || "Provider rejected this order.";
          const isAlreadyPlaced = /already placed/i.test(reason) || /currently being processed/i.test(reason);
          if (isAlreadyPlaced) {
            return { ok: true, status: 200, body: text, reason: "", url, deliveryStatus: "processing" };
          }

          lastFailure = { ok: false, status: response.status, body: text, reason, url, id: semantic.id, deliveryStatus: semantic.status };
          return lastFailure;
        }

        const reason = getProviderFailureReason(response.status, text, contentType);
        const isAlreadyPlaced = /already placed/i.test(reason) || /currently being processed/i.test(reason);
        if (isAlreadyPlaced) {
          return { ok: true, status: 200, body: text, reason: "", url, deliveryStatus: "processing" };
        }
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

function buildAfaPayload(metadata: Record<string, unknown>, recipient: string) {
  return {
    fullName: metadata.afa_full_name,
    ghanaCardNumber: metadata.afa_ghana_card,
    occupation: metadata.afa_occupation,
    email: metadata.afa_email,
    placeOfResidence: metadata.afa_residence,
    dateOfBirth: metadata.afa_date_of_birth,
    networkKey: "AFA",
    capacity: "BUNDLE",
    recipient,
    customer_phone: recipient,
    phone: recipient,
  };
}

function amountMatches(expected: number, actual: number, tolerance = 0.05): boolean {
  return Math.abs(expected - actual) <= tolerance;
}

async function notifyFailureAndRefund(
  supabaseAdmin: any,
  phone: string,
  amountGhs: number,
  packageLabel: string,
  reference: string,
  paystackKey: string,
): Promise<void> {
  // No refunds — orders are queued for automatic retry
  if (phone) {
    try {
      const { apiKey, senderId } = await getSmsConfig(supabaseAdmin);
      const recipient = normalizePhone(phone);
      if (apiKey && recipient) {
        const msg = `SwiftData: Your ${packageLabel} order is queued and will be retried automatically. No action needed. Ref: ${reference.slice(0, 8)}`;
        await sendSmsViaTxtConnect(apiKey, senderId, recipient, msg);
      }
    } catch (e) {
      console.error("[Failure SMS] Error:", e);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      headers: corsHeaders,
      status: 200
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let PAYSTACK_SECRET_KEY = "";
  let PAYSTACK_DEPOSIT_FEE_PERCENT = 0.03;
  try {
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("paystack_secret_key, paystack_deposit_fee_percent")
      .eq("id", 1)
      .maybeSingle();
    PAYSTACK_SECRET_KEY = settings?.paystack_secret_key || "";
    if (settings?.paystack_deposit_fee_percent !== undefined) {
      PAYSTACK_DEPOSIT_FEE_PERCENT = Number(settings.paystack_deposit_fee_percent);
    }
  } catch (dbErr) {
    console.error("Failed to fetch settings from DB in webhook:", dbErr);
  }

  if (!PAYSTACK_SECRET_KEY) {
    PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  }

  const DATA_PROVIDER_WEBHOOK_URL = getFirstEnvValue([
    "DATA_PROVIDER_WEBHOOK_URL",
    "PRIMARY_DATA_PROVIDER_WEBHOOK_URL",
    "SECONDARY_DATA_PROVIDER_WEBHOOK_URL",
  ]);

  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing required secrets (Paystack key, Supabase URL or Role Key)");
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

  // Paystack Webhook IP Whitelisting security check
  const paystackIPs = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];
  const bypassIpCheck = Deno.env.get("BYPASS_PAYSTACK_IP_WHITELIST") === "true";
  if (!bypassIpCheck) {
    const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
    const xForwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = cfConnectingIp || xForwardedFor;
    
    if (!clientIp || !paystackIPs.includes(clientIp)) {
      console.warn(`Blocked webhook request from unauthorized IP: ${clientIp || "unknown"}`);
      return new Response(JSON.stringify({ error: "Unauthorized IP address" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawBody));
  const hash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  
  const hashBuf = enc.encode(hash);
  const sigBuf = enc.encode(signature);
  
  function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  const signatureValid = safeEqual(hashBuf, sigBuf);
  if (!signatureValid) {
    console.error("Invalid signature. Expected:", hash, "Got:", signature);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const providerConfig = await getProviderCredentials(supabaseAdmin);
    let DATA_PROVIDER_API_KEY = providerConfig.apiKey;
    let DATA_PROVIDER_BASE_URL = providerConfig.baseUrl;

    const body = JSON.parse(rawBody);

    // ── Transfer events (outbound payouts / withdrawals) ─────────────────────
    if (body.event === "transfer.success") {
      const transferRef = body.data?.reference;
      console.log("Webhook: transfer.success for reference:", transferRef);

      if (transferRef) {
        const { data: withdrawal } = await supabaseAdmin
          .from("withdrawals")
          .select("id, agent_id, amount, status")
          .eq("paystack_transfer_reference", transferRef)
          .maybeSingle();

        if (withdrawal && withdrawal.status === "processing") {
          const { data: finalizeResult, error: finalizeErr } = await supabaseAdmin.rpc(
            "finalize_withdrawal",
            { p_withdrawal_id: withdrawal.id }
          );

          if (finalizeErr || !finalizeResult?.success) {
            console.error("CRITICAL: transfer.success but finalize_withdrawal failed", finalizeErr || finalizeResult?.error);
          } else {
            // Import sendWithdrawalCompletedSms is in admin-user-actions only; call inline here
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("momo_number")
              .eq("user_id", withdrawal.agent_id)
              .maybeSingle();

            const phone = profile?.momo_number;
            if (phone) {
              try {
                const smsConfig = await getSmsConfig(supabaseAdmin);
                if (smsConfig?.apiKey) {
                  const template = smsConfig.templates?.withdrawal_completed ||
                    "Your SwiftData withdrawal of GHS {amount} has been sent to your MoMo. Thank you!";
                  const message = formatTemplate(template, { amount: Number(withdrawal.amount).toFixed(2) });
                  await sendSmsViaTxtConnect(smsConfig.apiKey, smsConfig.senderId, normalizePhone(phone) ?? "", message);
                }
              } catch (smsErr) {
                console.error("SMS_ERROR on withdrawal complete:", smsErr);
              }
            }

            // Trigger Push Notification for Withdrawal Success
            await triggerPushNotification(supabaseAdmin, {
              user_id: withdrawal.agent_id,
              title: "✅ Withdrawal Successful",
              body: `Your withdrawal of GHS ${Number(withdrawal.amount).toFixed(2)} has been sent to your MoMo.`,
              url: "/dashboard/withdrawals",
              icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
            });
          }
        } else if (withdrawal) {
          console.warn("transfer.success received but withdrawal already in status:", withdrawal.status);
        } else {
          console.warn("transfer.success: no withdrawal found for reference:", transferRef);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.event === "transfer.failed" || body.event === "transfer.reversed") {
      const transferRef = body.data?.reference;
      const failReason = body.data?.reason || body.event;
      console.log(`Webhook: ${body.event} for reference:`, transferRef);

      if (transferRef) {
        const { data: withdrawal } = await supabaseAdmin
          .from("withdrawals")
          .select("id, status")
          .eq("paystack_transfer_reference", transferRef)
          .maybeSingle();

        if (withdrawal && withdrawal.status === "processing") {
          await supabaseAdmin
            .from("withdrawals")
            .update({ status: "failed", failure_reason: failReason })
            .eq("id", withdrawal.id);

          console.log(`Withdrawal ${withdrawal.id} marked failed due to ${body.event}`);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

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

    // Capture Customer and Authorization for Saved Cards
    const paystackCustomerCode = verifyData?.data?.customer?.customer_code;
    const paystackAuth = verifyData?.data?.authorization;
    
    const verifiedMetadata = (verifyData?.data?.metadata || {}) as Record<string, unknown>;
    const metadata = {
      ...(webhookMetadata as Record<string, unknown>),
      ...verifiedMetadata,
    };

    const agentIdForSavedCards = typeof metadata?.agent_id === "string" ? metadata.agent_id : null;
    if (agentIdForSavedCards && paystackCustomerCode) {
      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("paystack_saved_authorizations")
          .eq("user_id", agentIdForSavedCards)
          .maybeSingle();
          
        const savedAuths = Array.isArray(profile?.paystack_saved_authorizations) 
          ? profile.paystack_saved_authorizations 
          : [];
          
        if (paystackAuth && paystackAuth.reusable && paystackAuth.signature) {
          // Prevent duplicates by signature
          const exists = savedAuths.some((a: any) => a.signature === paystackAuth.signature);
          if (!exists) {
            const updatedAuths = [...savedAuths, {
              authorization_code: paystackAuth.authorization_code,
              bin: paystackAuth.bin,
              last4: paystackAuth.last4,
              exp_month: paystackAuth.exp_month,
              exp_year: paystackAuth.exp_year,
              channel: paystackAuth.channel,
              card_type: paystackAuth.card_type,
              bank: paystackAuth.bank,
              brand: paystackAuth.brand,
              signature: paystackAuth.signature
            }];
            
            await supabaseAdmin.from("profiles").update({
              paystack_customer_code: paystackCustomerCode,
              paystack_saved_authorizations: updatedAuths
            }).eq("user_id", agentIdForSavedCards);
            
            console.log("Saved new payment authorization for user:", agentIdForSavedCards);
          }
        } else if (paystackCustomerCode) {
          await supabaseAdmin.from("profiles").update({
            paystack_customer_code: paystackCustomerCode
          }).eq("user_id", agentIdForSavedCards);
        }
      } catch (e) {
        console.error("Failed to save customer/auth:", e);
      }
    }

    const orderId =
      (typeof metadata?.order_id === "string" && metadata.order_id) ||
      (typeof verifiedMetadata?.order_id === "string" && verifiedMetadata.order_id) ||
      reference;
    const verifiedAmount = Number(verifyData?.data?.amount || 0) / 100;
    // Use the fee Paystack actually charged rather than estimating it
    const paystackFeeOnVerified = parseFloat((Number(verifyData?.data?.fees || 0) / 100).toFixed(2));
    const orderTypeFromMetadata = typeof metadata?.order_type === "string" ? metadata.order_type : null;

    let { data: existingOrder } = await supabaseAdmin
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
      let normalizedProfit = 0;
      let normalizedParentProfit = 0;
      let resolvedCostPrice = 0;
      
      const orderType = orderTypeFromMetadata || "data";
      const isApiWallet = metadata?.wallet_type === "api";
      const requestedWalletCredit = Number(metadata?.wallet_credit);
      
      let walletCredit = verifiedAmount;
      
      if (orderType === "wallet_topup" || orderType === "store_wallet_topup") {
        if (isApiWallet) {
          // 0% fee for API wallet top-ups
          walletCredit = Number.isFinite(requestedWalletCredit) && requestedWalletCredit > 0
            ? Math.min(requestedWalletCredit, verifiedAmount)
            : verifiedAmount;
        } else {
          // Enforce dynamic standard fee for main or store wallet topups
          const divisor = 1 + PAYSTACK_DEPOSIT_FEE_PERCENT;
          const maxAllowedCredit = Number((verifiedAmount / divisor).toFixed(2));
          
          walletCredit = Number.isFinite(requestedWalletCredit) && requestedWalletCredit > 0
            ? Math.min(requestedWalletCredit, maxAllowedCredit)
            : maxAllowedCredit;
        }
      } else {
        walletCredit = Number.isFinite(requestedWalletCredit) && requestedWalletCredit > 0
          ? Math.min(requestedWalletCredit, verifiedAmount)
          : verifiedAmount;
      }

      const normalizedAmount = (orderType === "wallet_topup" || orderType === "store_wallet_topup")
        ? walletCredit
        : (Number.isFinite(verifiedAmount) && verifiedAmount > 0 ? verifiedAmount : 0);

      // Validate metadata agent_id against the DB — never trust client-supplied UUIDs blindly
      const metaAgentId = typeof metadata?.agent_id === "string" ? metadata.agent_id.trim() : "";
      const isValidUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metaAgentId);
      let verifiedAgentId = "00000000-0000-0000-0000-000000000000";
      if (isValidUuidFormat) {
        const { data: agentProfile } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("user_id", metaAgentId)
          .maybeSingle();
        if (agentProfile?.user_id) verifiedAgentId = agentProfile.user_id;
      }

      // Validate parent_agent_id the same way
      const metaParentId = typeof metadata?.parent_agent_id === "string" ? metadata.parent_agent_id.trim() : "";
      const isValidParentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metaParentId);
      let verifiedParentAgentId: string | null = null;
      if (isValidParentUuid) {
        const { data: parentProfile } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("user_id", metaParentId)
          .maybeSingle();
        if (parentProfile?.user_id) verifiedParentAgentId = parentProfile.user_id;
      }

      // Server-side profit resolution for missing orders
      if (orderType === "data" && verifiedAgentId !== "00000000-0000-0000-0000-000000000000") {
        const netPaid = verifiedAmount - paystackFeeOnVerified;
        const network = typeof metadata?.network === "string" ? metadata.network : "";
        const packageSize = typeof metadata?.package_size === "string" ? metadata.package_size : "";
        
        if (network && packageSize) {
           const { data: globalRow } = await supabaseAdmin
             .from("global_package_settings")
             .select("agent_price, cost_price")
             .eq("network", network)
             .eq("package_size", packageSize)
             .maybeSingle();
             
           if (globalRow) {
             const adminWholesale = Number(globalRow.agent_price || 0);
             resolvedCostPrice = Number(globalRow.cost_price || adminWholesale);
             if (adminWholesale > 0) {
               // Total margin available above admin wholesale
               const totalMargin = Math.max(0, netPaid - adminWholesale);
               
               if (verifiedParentAgentId) {
                 const metaParentProfit = Number(metadata?.parent_profit || 0);
                 const metaProfit = Number(metadata?.profit || 0);
                 const totalMeta = metaParentProfit + metaProfit;
                 
                 if (totalMeta > 0 && totalMargin > 0) {
                   const ratio = totalMargin / totalMeta;
                   normalizedParentProfit = parseFloat((metaParentProfit * ratio).toFixed(2));
                   normalizedProfit = parseFloat((metaProfit * ratio).toFixed(2));
                 } else {
                   normalizedProfit = parseFloat(totalMargin.toFixed(2));
                 }
               } else {
                 normalizedProfit = parseFloat(totalMargin.toFixed(2));
               }
             }
           }
        }
      } else if (orderType === "data") {
         resolvedCostPrice = Number(metadata?.cost_price || 0);
      }

      const recreatedOrder = {
        id: orderId,
        agent_id: verifiedAgentId,
        parent_agent_id: verifiedParentAgentId,
        order_type: orderType,
        amount: normalizedAmount,
        profit: normalizedProfit,
        parent_profit: normalizedParentProfit,
        cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
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
        customer_name: typeof metadata?.customer_name === "string" ? metadata.customer_name : null,
      };

      const { error: recreateError } = await supabaseAdmin.from("orders").insert(recreatedOrder);
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
      const hasPlaceholderAgentId = !existingOrder.agent_id || existingOrder.agent_id === "00000000-0000-0000-0000-000000000000";

      // Only recover agent_id if the stored one is a placeholder — validate against DB first
      if (hasPlaceholderAgentId) {
        const candidateId = typeof metadata?.agent_id === "string" ? metadata.agent_id.trim() : "";
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId);
        if (isUuid) {
          const { data: agentCheck } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", candidateId).maybeSingle();
          if (agentCheck?.user_id) patch.agent_id = agentCheck.user_id;
        }
      }
      if (!existingOrder.network && typeof metadata?.network === "string") patch.network = metadata.network;
      if (!existingOrder.package_size && typeof metadata?.package_size === "string") patch.package_size = metadata.package_size;
      if (!existingOrder.customer_phone && typeof (metadata?.customer_phone || metadata?.phone) === "string") {
        patch.customer_phone = metadata.customer_phone || metadata.phone;
      }
      if (!existingOrder.parent_agent_id && typeof metadata?.parent_agent_id === "string" && metadata.parent_agent_id) {
        patch.parent_agent_id = metadata.parent_agent_id;
      }
      if (typeof metadata?.customer_name === "string" && metadata.customer_name) {
        patch.customer_name = metadata.customer_name;
      }

      if (existingOrder.status === "pending" || existingOrder.status === "fulfillment_failed") {
        patch.status = "paid";
      }

      await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
      existingOrder = { ...existingOrder, ...patch };
    }

    if (shouldSendDataPaymentSms && smsPhone) {
      await sendPaymentSms(supabaseAdmin, smsPhone, "payment_success", {}, existingOrder?.agent_id);
    }

    // Declare orderType BEFORE first use to avoid temporal dead zone crash
    const orderType = (existingOrder?.order_type || orderTypeFromMetadata || "data") as string;
    const existingAmount = Number(existingOrder?.amount || 0);

    if (orderType === "wallet_topup" && existingOrder?.agent_id) {
      await sendWalletTopupSms(supabaseAdmin, existingOrder.agent_id, verifiedAmount);
    }

    if (orderType !== "wallet_topup" && orderType !== "store_wallet_topup" && Number.isFinite(existingAmount) && existingAmount > 0 && !amountMatches(existingAmount, verifiedAmount)) {
      await supabaseAdmin.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: `Payment amount mismatch. Expected GHS ${existingAmount.toFixed(2)}, received GHS ${verifiedAmount.toFixed(2)}.`,
      }).eq("id", orderId);
      const mismatchPhone = String(existingOrder?.customer_phone || "");
      await notifyFailureAndRefund(supabaseAdmin, mismatchPhone, verifiedAmount, existingOrder?.package_size || "your order", reference, PAYSTACK_SECRET_KEY);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Payment amount mismatch" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup" && Number.isFinite(existingAmount) && existingAmount > (verifiedAmount + 0.10)) {
      await supabaseAdmin.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: `Wallet credit mismatch. Credit GHS ${existingAmount.toFixed(2)} exceeds payment GHS ${verifiedAmount.toFixed(2)}.`,
      }).eq("id", orderId);

      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Wallet credit exceeds verified payment" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "store_wallet_topup" && Number.isFinite(existingAmount) && existingAmount > (verifiedAmount + 0.10)) {
      await supabaseAdmin.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: `Store wallet credit mismatch. Credit GHS ${existingAmount.toFixed(2)} exceeds payment GHS ${verifiedAmount.toFixed(2)}.`,
      }).eq("id", orderId);

      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Store wallet credit exceeds verified payment" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimableStatuses = ["pending", "paid", "fulfillment_failed"];
    const { data: claimedOrder, error: claimError } = await supabaseAdmin
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

    if (claimedOrder) {
      await notifyApiClient(supabaseAdmin, orderId, "processing");
    }

    if (!claimedOrder) {
      const { data: latestOrder } = await supabaseAdmin
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
      await supabaseAdmin.from("orders").update({ 
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
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("agent_activation_fee")
        .eq("id", 1)
        .maybeSingle();
      const AGENT_ACTIVATION_MINIMUM = Number(settings?.agent_activation_fee || 50);

      if (verifiedAmount < AGENT_ACTIVATION_MINIMUM * 0.97) {
        await supabaseAdmin.from("orders").update({
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
        await supabaseAdmin.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: false,
          parent_agent_id: null
        }).eq("user_id", agentId);
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        console.log("Agent activated via webhook:", agentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "vendor_activation") {
      const VENDOR_ACTIVATION_MINIMUM = 700.00;

      if (verifiedAmount < VENDOR_ACTIVATION_MINIMUM * 0.97) {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: `Payment too low for vendor activation. Minimum GHS ${VENDOR_ACTIVATION_MINIMUM}, received GHS ${verifiedAmount.toFixed(2)}.`,
        }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Activation payment below minimum" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabaseAdmin.from("profiles").update({ 
          vendor_status: "pending_approval"
        }).eq("user_id", agentId);
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        console.log("Vendor activated via webhook:", agentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "sub_agent_activation") {
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("sub_agent_base_fee")
        .eq("id", 1)
        .maybeSingle();
      const SUB_AGENT_MINIMUM = Number(settings?.sub_agent_base_fee || 5);

      if (verifiedAmount < SUB_AGENT_MINIMUM * 0.97) {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: `Payment too low for sub-agent activation. Minimum GHS ${SUB_AGENT_MINIMUM}, received GHS ${verifiedAmount.toFixed(2)}.`,
        }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Activation payment below minimum" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const subAgentId = metadata?.sub_agent_id;
      const parentAgentId = metadata?.parent_agent_id;
      const activationAmount = Number(metadata?.activation_fee || existingOrder?.amount || verifiedAmount || 0);
      
      const baseFee = SUB_AGENT_MINIMUM; // Reuse the previously fetched SUB_AGENT_MINIMUM

      // Security: Never trust client-supplied profit metadata. 
      // Activation fee base is dynamic. Anything above that is agent profit.
      const agentProfit = Math.max(0, parseFloat((activationAmount - baseFee).toFixed(2)));
      
      if (subAgentId) {
        // Fetch parent's sub_agent_prices to copy as the sub agent's agent_prices
        const { data: parentProfile } = await supabaseAdmin
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", parentAgentId)
          .maybeSingle();
        const subAgentPrices = parentProfile?.sub_agent_prices || {};

        await supabaseAdmin.from("profiles").update({
          is_agent: true,
          agent_approved: true,
          sub_agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: true,
          parent_agent_id: parentAgentId || null,
          agent_prices: subAgentPrices,
        }).eq("user_id", subAgentId);

        // Set parent_profit on the order BEFORE calling credit_order_profits,
        // so the RPC credits the correct amount to the parent's wallet.
        await supabaseAdmin
          .from("orders")
          .update({
            status: "fulfilled",
            failure_reason: null,
            profit: 0,
            parent_profit: agentProfit,
            parent_agent_id: parentAgentId || null,
          })
          .eq("id", orderId);

        if (parentAgentId && agentProfit > 0) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
        }
        console.log("Sub agent activated via webhook:", subAgentId, "parent:", parentAgentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup") {
      const { data: order } = await supabaseAdmin.from("orders").select("amount, agent_id, metadata").eq("id", orderId).maybeSingle();
      if (order) {
        const walletType = order.metadata?.wallet_type === "api" ? "api" : "main";
        if (walletType === "api") {
          await supabaseAdmin.schema("api").rpc("credit_api_wallet", { p_user_id: order.agent_id, p_amount: order.amount });
        } else {
          await supabaseAdmin.rpc("repay_credit", { p_agent_id: order.agent_id, p_amount: order.amount });
        }
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        
        // Notify API client about wallet funding
        await notifyWalletCredit(supabaseAdmin, order.agent_id, order.amount, walletType);

        // Trigger Push Notification for Wallet Top-up
        await triggerPushNotification(supabaseAdmin, {
          user_id: order.agent_id,
          title: "💰 Wallet Top-up Successful",
          body: `You just received GHS ${Number(order.amount).toFixed(2)} in your ${walletType === 'api' ? 'API' : 'main'} wallet.`,
          url: "/dashboard",
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
        });
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "store_wallet_topup") {
      // Read from order row first (most reliable) then fall back to metadata
      const { data: storeOrder } = await supabaseAdmin
        .from("orders")
        .select("amount, agent_id, customer_id, metadata")
        .eq("id", orderId)
        .maybeSingle();

      const customerId = (storeOrder?.customer_id as string | null)
        ?? (storeOrder?.metadata?.customer_id as string | null)
        ?? (typeof metadata?.customer_id === "string" ? metadata.customer_id : null);
      const agentId = (storeOrder?.agent_id as string | null)
        ?? (typeof metadata?.agent_id === "string" ? metadata.agent_id : null);
      const creditAmount = Number(
        storeOrder?.metadata?.wallet_credit
        ?? metadata?.wallet_credit
        ?? storeOrder?.amount
        ?? verifiedAmount
      );

      console.log("[store_wallet_topup] orderId:", orderId, "customerId:", customerId, "agentId:", agentId, "creditAmount:", creditAmount);

      if (customerId && agentId && creditAmount > 0) {
        const { data: creditRes, error: creditErr } = await supabaseAdmin.rpc("fulfill_store_wallet_topup", {
          p_order_id: orderId,
          p_customer_id: customerId,
          p_agent_id: agentId,
          p_amount: creditAmount
        });

        if (creditErr || !creditRes?.success) {
          console.error("Store topup automation failed:", creditErr || creditRes?.error);
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: creditRes?.error || "Automatic credit failed."
          }).eq("id", orderId);
          
          return new Response(JSON.stringify({ received: true, fulfilled: false, error: creditRes?.error || "Automatic credit failed" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Trigger Push Notification for Agent (Deposit Received)
        await triggerPushNotification(supabaseAdmin, {
          user_id: agentId,
          title: "💰 Store Customer Deposit",
          body: `Your customer has topped up GHS ${creditAmount.toFixed(2)}. Your agent wallet was credited!`,
          url: "/dashboard",
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
        });

        // Trigger Push Notification for Customer
        await triggerPushNotification(supabaseAdmin, {
          user_id: customerId,
          title: "💰 Store Wallet Funded",
          body: `Your store wallet has been credited with GHS ${creditAmount.toFixed(2)}. Start shopping!`,
          url: `/store/${metadata?.slug || 'shop'}/my-orders`,
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
        });
      } else {
        console.error("[store_wallet_topup] Missing required fields. customerId:", customerId, "agentId:", agentId, "creditAmount:", creditAmount);
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing customer_id or agent_id for store wallet top-up."
        }).eq("id", orderId);
      }
      
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Spendless override for AFA orders
    let isSpendlessAfaResolved = false;
    if (orderType === "afa") {
      const { data: spendless } = await supabaseAdmin
        .from("providers")
        .select("*")
        .eq("handler_type", "spendless")
        .maybeSingle();
      if (spendless?.api_key && spendless?.base_url) {
        DATA_PROVIDER_API_KEY = spendless.api_key;
        DATA_PROVIDER_BASE_URL = spendless.base_url.replace(/\/+$/, "");
        isSpendlessAfaResolved = true;
        console.log(`[Webhook] Routing AFA order ${orderId} exclusively via Spendless API`);
      } else {
        console.warn(`[Webhook] Spendless provider not found in DB for AFA. Falling back to active data providers.`);
      }
    }

    if (!isSpendlessAfaResolved) {
      // --- ACTIVE PROVIDER CHECK / PAUSE GATE ---
      // Fetch active providers from the central 'providers' table database. 
      // If all providers are toggled OFF by the admin, gracefully PAUSE automatic execution.
      const activeProviders = await getActiveProviders(supabaseAdmin, orderType === "airtime" ? "airtime" : "data");
      
      if (!activeProviders || activeProviders.length === 0) {
        console.log(`[Webhook] ALL APIs OFF for type '${orderType}'. Halting auto-fulfillment for order ${orderId}. Queueing for manual processing.`);
        await supabaseAdmin.from("orders").update({ 
          status: "paid", 
          failure_reason: "Queued for manual fulfillment (All APIs toggled OFF by admin)" 
        }).eq("id", orderId);
        
        return new Response(JSON.stringify({ 
          received: true, 
          fulfilled: false, 
          status: "paid", 
          message: "Provider APIs currently OFF. Enqueued for manual review." 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Dynamic Resolution: Override default credentials with the selected active provider's live configs
      const primaryProvider = activeProviders[0];
      if (primaryProvider.api_key) DATA_PROVIDER_API_KEY = primaryProvider.api_key;
      if (primaryProvider.base_url) DATA_PROVIDER_BASE_URL = primaryProvider.base_url.replace(/\/+$/, "");
    }

    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      console.error("Data provider not configured for fulfillment");
      await supabaseAdmin.from("orders").update({
        status: "processing",
        failure_reason: "Data provider not configured",
      }).eq("id", orderId);
      const unconfiguredPhone = String(existingOrder?.customer_phone || "");
      await notifyFailureAndRefund(supabaseAdmin, unconfiguredPhone, verifiedAmount, existingOrder?.package_size || "your order", reference, PAYSTACK_SECRET_KEY);
      return new Response(JSON.stringify({ received: true, fulfilled: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "afa") {
      const customerPhone = typeof existingOrder?.customer_phone === "string"
        ? existingOrder.customer_phone
        : (typeof (metadata?.customer_phone || metadata?.phone) === "string" ? (metadata.customer_phone || metadata.phone) : "");
      const recipient = normalizeRecipient(customerPhone);

      const result = await callProviderApi(
        DATA_PROVIDER_BASE_URL,
        DATA_PROVIDER_API_KEY,
        "afa-registration",
        buildAfaPayload(metadata, recipient),
      );

      console.log("Webhook AFA fulfillment response:", {
        orderId,
        status: result.status,
        reason: result.reason,
      });

      if (result.ok) {
        const patch: Record<string, any> = { status: "fulfilled", failure_reason: null };
        if (result.id) patch.provider_order_id = result.id;
        
        await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
        
        // Credit profits
        if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
        }
        
        return new Response(JSON.stringify({ received: true, fulfilled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("orders").update({ status: "processing", failure_reason: result.reason }).eq("id", orderId);
      const afaPhone = String(existingOrder?.customer_phone || "");
      await notifyFailureAndRefund(supabaseAdmin, afaPhone, verifiedAmount, "AFA Registration", reference, PAYSTACK_SECRET_KEY);
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
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing network, amount, or phone for airtime fulfillment.",
        }).eq("id", orderId);
        await notifyFailureAndRefund(supabaseAdmin, customerPhone, verifiedAmount, "Airtime", reference, PAYSTACK_SECRET_KEY);
        return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Missing airtime order details." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Use Airtime-specific credentials and format
      const { apiKey: fallbackKey, baseUrl: fallbackBase } = await getAirtimeCredentials(supabaseAdmin);
      const AIRTIME_KEY = activeProviders[0]?.api_key || fallbackKey;
      const AIRTIME_BASE = (activeProviders[0]?.base_url || fallbackBase || "").replace(/\/+$/, "");
      
      const airtimeNetworkKey = mapAirtimeNetworkKey(network);
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
        const providerOrderId = airtimeResult.id;
        const patch: Record<string, any> = { status: "fulfilled", failure_reason: null };
        if (providerOrderId) patch.provider_order_id = providerOrderId;

        await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
        
        if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
        }
        if (customerPhone) await sendPaymentSms(supabaseAdmin, customerPhone, "payment_success", {}, existingOrder?.agent_id);
        if (metadata.channel === "whatsapp" && metadata.wa_from) {
          await sendWhatsAppFulfillmentNotification(String(metadata.wa_from), "airtime", network, `GH₵${airtimeAmount}`, customerPhone);
        }

        // Trigger Push Notification for Agent Profit (Airtime)
        if (existingOrder?.agent_id && (existingOrder.profit > 0)) {
          const profit = Number(existingOrder.profit).toFixed(2);
          await triggerPushNotification(supabaseAdmin, {
            user_id: existingOrder.agent_id,
            title: "🎉 New payment for Airtime",
            body: `You just received GHS ${profit} profit from your airtime sale.`,
            url: "/dashboard/orders",
            icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
          });
        }
        return new Response(JSON.stringify({ received: true, fulfilled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("orders").update({ status: "processing", failure_reason: airtimeResult.reason }).eq("id", orderId);
      await notifyFailureAndRefund(supabaseAdmin, customerPhone, verifiedAmount, `${network} Airtime`, reference, PAYSTACK_SECRET_KEY);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: airtimeResult.reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!network || !packageSize || !customerPhone) {
      await supabaseAdmin.from("orders").update({
        status: "processing",
        failure_reason: `Could not parse package size from '${packageSize}'`,
      }).eq("id", orderId);
      await notifyFailureAndRefund(supabaseAdmin, customerPhone, verifiedAmount, packageSize || "your order", reference, PAYSTACK_SECRET_KEY);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Missing order details for fulfillment." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve QHowMenzConsult package mapping if relevant
    let resolvedPackageId = packageSize;
    if (baseUrlToLower.includes("qhowmenzconsult")) {
      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("external_id")
          .eq("provider_id", primaryProvider.id)
          .eq("network", network)
          .eq("package_name", packageSize)
          .maybeSingle();
        if (pkgMapping?.external_id) {
          resolvedPackageId = pkgMapping.external_id;
        }
      } catch (e) {
        console.error("[qhowmenzconsult-webhook-resolve] Error:", e);
      }
    }

    const handlerType = baseUrlToLower.includes("datamart") 
      ? "datamart" 
      : baseUrlToLower.includes("datahub") 
      ? "datahub" 
      : baseUrlToLower.includes("qhowmenzconsult")
      ? "qhowmenzconsult"
      : "standard";

    const networkKey = handlerType === "datamart" 
      ? (network.toUpperCase() === "MTN" ? "YELLO" : (network.toUpperCase() === "TELECEL" ? "TELECEL" : "AT_PREMIUM"))
      : mapDataNetworkKey(network);
    
    const dataPayload = handlerType === "datamart"
      ? {
          phoneNumber: normalizeRecipient(customerPhone),
          network: networkKey,
          planId: packageSize,
          plan: packageSize,
          bundle: packageSize,
          capacity: String(parseCapacity(packageSize)),
          orderReference: orderId,
          gateway: "wallet",
          reference: orderId
        }
      : handlerType === "datahub"
      ? {
          networkKey,
          recipient: normalizeRecipient(customerPhone),
          capacity: String(parseCapacity(packageSize)),
          reference: orderId,
        }
      : handlerType === "qhowmenzconsult"
      ? {
          network: networkKey === "YELLO" || networkKey.includes("MTN") 
            ? "MTN" 
            : (networkKey === "TELECEL" ? "Telecel" : "AirtelTigo"),
          recipient: normalizeRecipient(customerPhone),
          plan_id: resolvedPackageId,
          package_id: resolvedPackageId,
          product_id: resolvedPackageId,
          external_id: resolvedPackageId,
          amount: Number(existingOrder?.amount || verifiedAmount),
          reference: orderId,
        }
      : {
          networkRaw: network,
          networkKey,
          recipient: normalizeRecipient(customerPhone),
          capacity: String(parseCapacity(packageSize)),
          amount: existingOrder?.amount || verifiedAmount,
          order_type: "data",
          description: `Data: ${packageSize} for ${customerPhone}`
        };

    const result = await callProviderApi(
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      "purchase",
      dataPayload,
      DATA_PROVIDER_WEBHOOK_URL,
    );

    console.log("Webhook fulfillment response:", {
      orderId,
      status: result.status,
      reason: result.reason,
      url: result.url,
    });

    if (result.ok) {
      const providerOrderId = result.id;
      const deliveryStatus = result.deliveryStatus;
      
      // User explicitly requested immediate complete fulfillment to eliminate processing stalls
      const isActuallyDelivered = true; 
      
      const patch: Record<string, any> = { failure_reason: null, status: "fulfilled" };
      if (providerOrderId) patch.provider_order_id = providerOrderId;

      await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
      
      if (isActuallyDelivered) {
        // Credit profits
        if (existingOrder?.agent_id && (existingOrder.profit > 0 || existingOrder.parent_profit > 0)) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
        }

        if (customerPhone) {
          await sendPaymentSms(supabaseAdmin, customerPhone, "payment_success", {}, existingOrder?.agent_id);
        }

        if (metadata.channel === "whatsapp" && metadata.wa_from) {
          await sendWhatsAppFulfillmentNotification(String(metadata.wa_from), orderType, network, packageSize, customerPhone);
        }
      }

      return new Response(JSON.stringify({ received: true, fulfilled: isActuallyDelivered, status: patch.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("orders").update({ status: "processing", failure_reason: result.reason }).eq("id", orderId);
    await notifyFailureAndRefund(supabaseAdmin, customerPhone, verifiedAmount, packageSize || "Data", reference, PAYSTACK_SECRET_KEY);
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