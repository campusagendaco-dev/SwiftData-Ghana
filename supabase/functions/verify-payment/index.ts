import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchViaDb } from "../_shared/db_proxy.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};
import { getActiveProviders, logProviderError, resolveProvidersForOrder } from "../_shared/providers.ts";
import { log } from "../_shared/logger.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";
import { getProviderAdapter } from "../_shared/providers/registry.ts";

// --- Utilities ---

function getFirstEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = Deno.env.get(key)?.trim();
    if (v) return v;
  }
  return "";
}

// Maps network names to the keys the data provider API expects (must match wallet-buy-data)
function mapDataNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AIRTEL-TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE" || n === "VOD") return "TELECEL";
  if (n === "MTN" || n === "YELLO" || n === "MTN_XPRESS") return "YELLO";
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

function parseCapacity(packageSize: string | null | undefined): number {
  if (!packageSize) return 0;
  const cleaned = packageSize.replace(/\s+/g, "").toUpperCase();
  
  // Handle specific Korba Product IDs
  if (cleaned === "MTNDLY20MB" || cleaned === "AIRDLY20MB" || cleaned.includes("20MB") || cleaned.includes("20 MB")) {
    return 20 / 1024;
  }
  if (cleaned === "MTNMIDNIGHT" || cleaned === "MTNMIDNGT3G" || cleaned === "AIRMIDNGT3G" || cleaned === "AIRMIDNIGHT") {
    return 2.6; // MTN midnight is 2.6GB or 3GB
  }
  if (cleaned === "MTNMTH200GB" || cleaned === "AIRMTH200GB") {
    return 200;
  }
  
  let parseTarget = cleaned;
  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) {
    parseTarget = parenMatch[1];
  }
  
  // Normal parsing with MB/GB detection
  const match = parseTarget.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (parseTarget.includes("MB") && !parseTarget.includes("GB")) {
    return num / 1024;
  }
  return num;
}

function normalizeRecipient(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

function translateFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = String(reason).trim().toUpperCase();
  if (r.includes("LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED")) {
    return "The recipient number has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.";
  }
  if (r.includes("PAYEE_LIMIT_REACHED")) {
    return "The recipient's MTN daily transfer limit has been reached. Please try again tomorrow or use another number.";
  }
  if (r.includes("NOT_ALLOWED")) {
    return "This number is not allowed to receive SME data bundles (e.g. corporate/postpaid lines). Please try another number.";
  }
  if (r.includes("CUSTOMER ABANDONED TRANSACTION")) {
    return "The checkout payment was cancelled or abandoned. Please try initiating the payment again.";
  }
  if (r.includes("INSUFFICIENT BALANCE") || r.includes("INSUFFICIENT_BALANCE")) {
    return "Fulfillment failed due to insufficient wallet balance. Please top up your wallet to retry.";
  }
  return reason;
}

async function getProviderCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string; paystackSecretKey: string }> {
  const apiKey = getFirstEnv(
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_PRIMARY_API_KEY",
  );
  const baseUrl = getFirstEnv(
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_PRIMARY_BASE_URL",
  ).replace(/\/+$/, "");

  const { data: settings } = await supabaseAdmin
    .from("v_system_settings_with_secrets").select("data_provider_api_key, data_provider_base_url, paystack_secret_key")
    .eq("id", 1)
    .maybeSingle();

  return {
    apiKey: apiKey || settings?.data_provider_api_key || "",
    baseUrl: (baseUrl || settings?.data_provider_base_url || "").replace(/\/+$/, ""),
    paystackSecretKey: getFirstEnv("PAYSTACK_SECRET_KEY") || settings?.paystack_secret_key || ""
  };
}

async function getAirtimeCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string }> {
  const { data: dbSettings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("*").eq("id", 1).maybeSingle();

  const apiKey = getFirstEnv("AIRTIME_PROVIDER_API_KEY", "PRIMARY_DATA_PROVIDER_API_KEY") || 
                 dbSettings?.airtime_provider_api_key || 
                 dbSettings?.data_provider_api_key || "";
  
  const baseUrl = getFirstEnv("AIRTIME_PROVIDER_BASE_URL", "PRIMARY_DATA_PROVIDER_BASE_URL") || 
                  dbSettings?.airtime_provider_base_url || 
                  dbSettings?.data_provider_base_url || "";
  
  return { apiKey, baseUrl: (baseUrl || "").replace(/\/+$/, "") };
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
      console.error("[Push] Trigger failed:", text);
    }
  } catch (e) {
    console.error("[Push] Trigger error:", e);
  }
}

async function fulfillOrder(
  supabaseAdmin: any,
  orderId: string,
  providerId: string | null,
  providerOrderId: string | null,
  token?: string | null,
  failureReason?: string | null
) {
  // Fetch current order details
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return;

  const patch: any = {
    status: "fulfilled",
    provider_id: providerId,
    provider_order_id: providerOrderId,
    failure_reason: token ? `Token: ${token}` : (failureReason || null),
    updated_at: new Date().toISOString()
  };
  if (token) {
    patch.metadata = { ...(order.metadata || {}), prepaid_token: token };
  }

  await supabaseAdmin.from("orders").update(patch).eq("id", orderId);

  try {
    // Credit profits
    await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });

    // Trigger Push Notification for Agent
    if (order.agent_id && order.agent_id !== '00000000-0000-0000-0000-000000000000') {
      const profit = Number(order.profit || 0).toFixed(2);
      const isUtility = order.order_type === "utility";
      await triggerPushNotification(supabaseAdmin, {
        user_id: order.agent_id,
        title: isUtility ? "🎉 Utility Bill Payment Completed" : "🎉 New payment for Data selling",
        body: isUtility ? `Your utility order has been processed. Prepaid Token: ${token || ''}` : `You just received GHS ${profit} from your recent data sale.`,
        url: "/dashboard/orders",
        icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
      });
    }
  } catch (e) {
    console.error("[verify-payment] Profit credit or notification failed:", e);
  }

  // Trigger SMS for Customer
  if (order.customer_phone) {
    try {
      const isUtility = order.order_type === "utility";
      const networkName = order.network || "";
      const packageName = order.package_size || "";
      const isAirtime = String(packageName).toUpperCase() === "AIRTIME";
      
      let displayPackage = `${networkName} ${packageName}`;
      if (isAirtime) {
        // Base price is preferred for display if it exists in metadata, fallback to order amount
        const basePrice = order.metadata?.base_price || order.amount;
        displayPackage = `${networkName} GHS ${Number(basePrice).toFixed(2)} Airtime`;
      }

      let customMsg = "";
      if (isUtility) {
        if (token) {
          customMsg = `Payment received! ECG Prepaid Token: ${token}\nMeter: ${order.customer_phone}\nAmount: GHS ${Number(order.amount).toFixed(2)}\nTxID: ${order.id}`;
        } else {
          customMsg = `Payment received! Your ${networkName} payment for account ${order.customer_phone} of GHS ${Number(order.amount).toFixed(2)} is being processed.\nTxID: ${order.id}`;
        }
      } else {
        customMsg = `Success! Your order for ${displayPackage} to ${order.customer_phone} has been processed.\nTxID: ${order.id}`;
      }

      await sendPaymentSms(supabaseAdmin, order.customer_phone, "custom", { message: customMsg }, order.agent_id);
    } catch (smsErr) {
      console.error("[verify-payment] Success SMS dispatch failed:", smsErr);
    }
  }
}

async function callProviderApi(
  supabaseAdmin: any,
  provider: any,
  data: Record<string, unknown>,
  endpoint: string = "purchase"
): Promise<{ ok: boolean; reason: string; id?: string; status?: string }> {
  const handlerType = provider.handler_type || "standard";
  const adapter = getProviderAdapter(handlerType);

  if (endpoint === "status") {
    const providerOrderId = String(data.transaction_id || data.reference || data.order_id || "");
    const reference = String(data.reference || "");
    return adapter.checkStatus(supabaseAdmin, provider, providerOrderId, reference);
  } else {
    const purchaseData = {
      recipient: String(data.recipient || data.phoneNumber || data.customer_phone || ""),
      amount: Number(data.amount || 0),
      reference: String(data.reference || data.orderReference || data.order_id || ""),
      networkRaw: String(data.networkRaw || data.network || ""),
      networkKey: String(data.networkKey || ""),
      package_size: String(data.package_size || data.plan || ""),
      plan: String(data.plan || ""),
      order_type: String(data.order_type || "data"),
      ...data
    };
    return adapter.purchase(supabaseAdmin, provider, purchaseData);
  }
}

// --- Main Handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      console.error("[verify-payment] Failed to parse request JSON:", e);
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 🛡️ DOS & BRUTE-FORCE RATE LIMITING ─────────────────────────────────
    const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
    
    // Limit IP-based requests to 60 per minute (allows 5-second polling with buffer)
    const { data: ipAllowed } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: `ip_verify_${clientIp}`,
      p_rate_limit: 60
    });
    
    if (!ipAllowed) {
      console.warn(`[SECURITY] Blocked rate-limited IP on verify-payment: ${clientIp}`);
      return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference, orderId, phone, force: forceInput, action } = body;
    const force = forceInput || action === "retry_order";
    const resolvedReference = reference || orderId;

    // Limit Target Phone-based requests to 4 per minute
    if (phone) {
      const cleanPhone = phone.replace(/\D+/g, "");
      if (cleanPhone) {
        const { data: phoneAllowed } = await supabaseAdmin.rpc("check_generic_rate_limit", {
          p_key: `phone_verify_${cleanPhone}`,
          p_rate_limit: 4
        });
        
        if (!phoneAllowed) {
          console.warn(`[SECURITY] Blocked rate-limited phone verification lookup: ${cleanPhone}`);
          return new Response(JSON.stringify({ error: "Checking status too frequently. Please try again in a minute." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (!resolvedReference && !phone) {
      return new Response(JSON.stringify({ error: "Order reference or phone number is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetReference = resolvedReference;

    // Resolve custom API references (non-UUID or custom)
    if (resolvedReference) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedReference);
      if (isUuid) {
        // Try direct ID lookup first
        const { data: orderById } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("id", resolvedReference)
          .maybeSingle();
        if (orderById) {
          targetReference = orderById.id;
        } else {
          // Fallback to client_reference search if not found by direct ID
          const { data: orderByClientRef } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("metadata->>client_reference", resolvedReference)
            .maybeSingle();
          if (orderByClientRef) {
            targetReference = orderByClientRef.id;
          }
        }
      } else {
        // Non-UUID: must be client custom reference
        const { data: orderByClientRef } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("metadata->>client_reference", resolvedReference)
          .maybeSingle();
        if (orderByClientRef) {
          targetReference = orderByClientRef.id;
        } else {
          return new Response(JSON.stringify({ error: "Order not found with reference: " + resolvedReference }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // --- SECURE GUEST LOOKUP BY PHONE ---
    if (!targetReference && phone) {
      console.log(`[verify-payment] Looking up guest order for phone: ${phone}`);
      const sanitized = phone.replace(/\D+/g, "");
      const last9 = sanitized.slice(-9); // GH numbers are usually 9 or 10 digits
      
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: latestOrder, error: searchError } = await supabaseAdmin
        .from("orders")
        .select("id, customer_phone")
        .or(`customer_phone.ilike.%${last9},customer_phone.eq.${sanitized}`)
        .gte("created_at", fortyEightHoursAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (searchError) {
        console.error("[verify-payment] Search error:", searchError);
        throw searchError;
      }
      if (!latestOrder) {
        return new Response(JSON.stringify({ error: "No recent order found for this number" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetReference = latestOrder.id;
      console.log(`[verify-payment] Resolved phone ${phone} to order ${targetReference}`);
    }

    if (!targetReference) {
      return new Response(JSON.stringify({ error: "Order reference or phone required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Since targetReference is resolved to the exact order UUID from DB, validate it's a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetReference);
    if (!isUuid) {
       return new Response(JSON.stringify({ error: "Invalid reference format" }), {
         status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
       });
    }

    // 1. Check if already processed
    const { data: existingOrder } = await supabaseAdmin
      .from("orders").select("*").eq("id", targetReference).maybeSingle();

    const authHeader = req.headers.get("authorization") || "";
    const isServiceRole = authHeader.includes(SUPABASE_SERVICE_ROLE_KEY || "nevermatch_placeholder");

    // Client restriction: Leave the payment verification/fulfillment trigger to the webhook confirmation,
    // but if the order is older than 8 seconds, allow client-side verification as a fallback in case webhooks are slow/delayed.
    const orderAgeMs = Date.now() - new Date(existingOrder?.created_at || Date.now()).getTime();
    if (!isServiceRole && !force && orderAgeMs < 8000 && (existingOrder?.status === "pending" || existingOrder?.status === "awaiting_payment")) {
      console.log(`[verify-payment] Client request for pending order ${targetReference} under 8s age. Awaiting webhook confirmation.`);
      return new Response(JSON.stringify({ 
        status: "pending", 
        message: "Awaiting payment confirmation webhook."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingOrder?.status === "fulfilled" || existingOrder?.status === "completed") {
      return new Response(JSON.stringify({ 
        status: "fulfilled", 
        message: existingOrder.failure_reason || "Already processed",
        provider_order_id: existingOrder?.provider_order_id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sendPendingSmsIfNeeded = async (forceSend = false) => {
      if (!existingOrder || existingOrder.sms_reminder_sent) return;
      
      let phone = existingOrder.customer_phone;
      if (!phone && existingOrder.metadata) {
        try {
          const meta = typeof existingOrder.metadata === "string" 
            ? JSON.parse(existingOrder.metadata) 
            : existingOrder.metadata;
          phone = meta?.payment_phone || meta?.customer_phone;
        } catch (e) {
          console.error("[verify-payment] Failed to parse metadata for phone fallback:", e);
        }
      }
      
      if (!phone) return;
      
      const orderAgeMs = Date.now() - new Date(existingOrder.created_at).getTime();
      if (forceSend || orderAgeMs > 30000) {
        try {
          const momoMsg = "Your checkout payment is pending. Please check your account for approvals by dialing *170# (Option 6 - My Approvals) to approve your pending MoMo transaction.";
          await sendPaymentSms(supabaseAdmin, phone, "custom", { message: momoMsg, senderId: "swiftupdate" }, existingOrder.agent_id);
          await supabaseAdmin.from("orders").update({ sms_reminder_sent: true }).eq("id", targetReference);
          existingOrder.sms_reminder_sent = true;
          console.log(`[verify-payment] Sent pending/abandoned payment SMS reminder to ${phone} for order ${targetReference}`);
        } catch (smsErr) {
          console.error("[verify-payment] Payment SMS dispatch failed:", smsErr);
        }
      }
    };

    const credentials = await getProviderCredentials(supabaseAdmin);
    const paystackSecretKey = credentials.paystackSecretKey;
    let orderType = (existingOrder?.order_type || "data") as string;
    if (orderType.toLowerCase() === "api") {
      if (String(existingOrder?.package_size).toUpperCase() === "AIRTIME") {
        orderType = "airtime";
      } else {
        orderType = "data";
      }
    }
    const isQueuedError = /queued/i.test(String(existingOrder?.failure_reason || ""));
    const isProviderOrder = !["agent_activation", "sub_agent_activation", "wallet_topup", "free_data_claim"].includes(orderType.toLowerCase());

    // --- 1. STATUS CHECK (For orders already being processed) ---
    // Skip for non-data/airtime order types — they don't involve a data provider.
    if (existingOrder?.status === "processing" && !isQueuedError && isProviderOrder) {
      const providers = await resolveProvidersForOrder(supabaseAdmin, existingOrder);
      let foundOnProvider = false;
      for (const provider of providers) {
        console.log(`[verify-payment] Checking status for ${targetReference} at ${provider.name}`);
        const checkResult = await callProviderApi(supabaseAdmin, provider, {
          transaction_id: existingOrder.provider_order_id,
          order_id: existingOrder.provider_order_id || targetReference,
          reference: targetReference,
        }, "status");

        if (checkResult.ok) {
          foundOnProvider = true;
          const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
          const isFailed = checkResult.status === "failed" || checkResult.status === "error" || checkResult.status === "refunded";
          if (isDelivered) {
            const token = checkResult.raw?.prepaid_token;
            await fulfillOrder(supabaseAdmin, targetReference, provider.id, existingOrder.provider_order_id, token || null);
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: existingOrder.provider_order_id, message: token ? `Token: ${token}` : null }), { headers: corsHeaders });
          } else if (isFailed) {
            const targetStatus = "fulfillment_failed";
            const resolvedReason = translateFailureReason(checkResult.reason || "Provider reported failure during status check");
            await supabaseAdmin.from("orders").update({ 
              status: targetStatus, 
              failure_reason: resolvedReason 
            }).eq("id", targetReference);
            return new Response(JSON.stringify({ 
              status: targetStatus, 
              provider_order_id: existingOrder.provider_order_id,
              reason: resolvedReason
            }), { headers: corsHeaders });
          } else {
            console.log(`[verify-payment] Order ${targetReference} is still processing at provider. Status: ${checkResult.status}`);
            return new Response(JSON.stringify({ status: "processing", provider_order_id: existingOrder.provider_order_id }), { headers: corsHeaders });
          }
        }
      }
    }

    // --- 1.2. AGE CHECK FALLBACK ---
    if (existingOrder && existingOrder.status === "processing") {
      if (existingOrder.network === "MTN Mash Up") {
        return new Response(JSON.stringify({ status: "processing", message: "MTN Mash Up order is processing manually by admin" }), { headers: corsHeaders });
      }
      
      // Safety: Never re-submit any processing order to the provider API.
      // If it is stuck at processing, it has likely already entered/passed through the provider's API.
      console.log(`[verify-payment] Order ${targetReference} is currently in processing state. Safety check: blocking re-submission to provider API.`);
      return new Response(JSON.stringify({ 
        status: "processing", 
        message: "Order is in processing state. Re-submission blocked to prevent duplicate carrier charging." 
      }), { headers: corsHeaders });
    }

    // --- 1.5. PRE-VERIFICATION PROVIDER CHECK ---
    // If the order is pending, paid, or fulfillment_failed, check if the provider already processed it
    // (handles race conditions, retries, or manual bypasses)
    // Skip for non-data/airtime order types — they don't involve a data provider
    // Optimization: Skip checking provider status for freshly paid/pending orders if they haven't been submitted yet (no provider_order_id)
    // AND they are less than 20 seconds old. This avoids slow and redundant API status check calls.
    const orderAgeSec = (Date.now() - new Date(existingOrder?.created_at || 0).getTime()) / 1000;
    const shouldCheckProvider = existingOrder?.provider_order_id || orderAgeSec > 20 || force;

    if ((existingOrder?.status === "pending" || existingOrder?.status === "paid" || existingOrder?.status === "fulfillment_failed") && isProviderOrder && shouldCheckProvider) {
      const providers = await resolveProvidersForOrder(supabaseAdmin, existingOrder);
      for (const provider of providers) {
        console.log(`[verify-payment] Pre-check status for ${targetReference} at ${provider.name}`);
        const checkResult = await callProviderApi(supabaseAdmin, provider, { 
          transaction_id: targetReference,
          reference: targetReference, 
          order_id: targetReference 
        }, "status");
        
        if (checkResult.ok) {
          const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
          const isProcessing = checkResult.status === "processing" || checkResult.status === "pending" || checkResult.status === "queued" || checkResult.status === "ongoing";
          
          if (isDelivered) {
            console.log(`[verify-payment] Found fulfilled order ${targetReference} at ${provider.name} during pre-check.`);
            const token = checkResult.raw?.prepaid_token;
            await fulfillOrder(supabaseAdmin, targetReference, provider.id, checkResult.id || existingOrder.provider_order_id || null, token || null);
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: checkResult.id || existingOrder.provider_order_id }), { headers: corsHeaders });
          } else if (isProcessing) {
            console.log(`[verify-payment] Found processing/pending order ${targetReference} at ${provider.name} during pre-check.`);
            await supabaseAdmin.from("orders").update({ 
              status: "processing", 
              provider_id: provider.id,
              provider_order_id: checkResult.id || existingOrder.provider_order_id || null,
              failure_reason: "Provider is processing the order"
            }).eq("id", targetReference);
            return new Response(JSON.stringify({ status: "processing", provider_order_id: checkResult.id || existingOrder.provider_order_id }), { headers: corsHeaders });
          }
        }
      }
    }

    // --- 2. PAYMENT VERIFICATION ---
    let verifiedAmount = 0;
    let paystackFeeOnVerified = 0;
    let currentOrderType = (existingOrder?.order_type || "data") as string;
    if (currentOrderType.toLowerCase() === "api") {
      if (String(existingOrder?.package_size).toUpperCase() === "AIRTIME") {
        currentOrderType = "airtime";
      } else {
        currentOrderType = "data";
      }
    }
    let metadata = existingOrder?.metadata || {};

    const status = (existingOrder?.status || "").toLowerCase();
    const paymentMethod = (existingOrder?.payment_method || "").toLowerCase();

    const isInternalPayment = 
      ["wallet", "promo", "balance", "api"].includes(paymentMethod) || 
      status === "paid" ||
      (status === "processing" && !isQueuedError);

    // Special validation for free data claims to prevent spamming
    if (orderType.toLowerCase() === "free_data_claim") {
      const failOrder = async (reason: string) => {
        await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", targetReference);
        return new Response(JSON.stringify({ status: "fulfillment_failed", error: reason }), { status: 200, headers: corsHeaders });
      };

      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("free_data_enabled, free_data_max_claims, free_data_claims_count")
        .eq("id", 1)
        .maybeSingle();

      if (!settings?.free_data_enabled) {
        return await failOrder("Free data campaign is not active");
      }

      if ((settings.free_data_claims_count || 0) >= (settings.free_data_max_claims || 0)) {
        return await failOrder("Free data claim limit reached");
      }

      // Check if this specific agent already has a fulfilled claim (excluding the current order if we are retrying it)
      if (existingOrder?.agent_id && existingOrder.agent_id !== '00000000-0000-0000-0000-000000000000') {
        const { count: agentClaimCount } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", existingOrder.agent_id)
          .eq("order_type", "free_data_claim")
          .eq("status", "fulfilled")
          .neq("id", targetReference); // Exclude current order
        
        if ((agentClaimCount || 0) > 0) {
          console.warn(`[SECURITY] Blocked duplicate free data claim for agent ${existingOrder.agent_id}.`);
          return await failOrder("You have already claimed your free data");
        }
      }

      // NEW: Check if this phone number has already received a free data claim
      if (existingOrder?.customer_phone) {
        const { count: phoneClaimCount } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_phone", existingOrder.customer_phone)
          .eq("order_type", "free_data_claim")
          .eq("status", "fulfilled")
          .neq("id", targetReference); // Exclude current order

        if ((phoneClaimCount || 0) > 0) {
          console.warn(`[SECURITY] Blocked duplicate free data claim for recipient phone ${existingOrder.customer_phone}.`);
          return await failOrder("This phone number has already received free data");
        }
      }
    }

    if (isInternalPayment || orderType.toLowerCase() === "free_data_claim") {
      console.log(`[verify-payment] Internal/Free payment confirmed for ${targetReference}`);
      verifiedAmount = Number(existingOrder?.amount || 0);
    } else if (paymentMethod === "korba") {
      const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
      const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "";
      const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";

      if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Korba gateway not configured" }), { status: 500, headers: corsHeaders });
      }

      const statusPayload = {
        transaction_id: targetReference,
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
      };

      // Generate HMAC signature
      const sortedKeys = Object.keys(statusPayload).sort();
      const messageParts = [];
      for (const key of sortedKeys) {
        messageParts.push(`${key}=${(statusPayload as any)[key]}`);
      }
      const message = messageParts.join("&");
      
      const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const messageData = new TextEncoder().encode(message);
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      console.log(`[verify-payment] Querying Korba status for ${targetReference}`);
      try {
        const statusRes = await fetchViaDb(supabaseAdmin, "https://xchange.korba365.com/api/v1.0/transaction_status/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
          },
          body: JSON.stringify(statusPayload),
          allowMutationFallback: true,
        });

        const statusText = await statusRes.text();
        console.log(`[verify-payment] Korba status response:`, statusText);
        let statusData;
        try {
          statusData = JSON.parse(statusText);
        } catch {
          return new Response(JSON.stringify({ status: "error", error: "Payment gateway returned invalid response" }), { headers: corsHeaders });
        }

        if (!statusRes.ok || statusData.error) {
          console.error(`[verify-payment] Korba status check failed via DB Proxy:`, statusText);
          return new Response(JSON.stringify({
            status: "error",
            error: `Database HTTP Proxy error: ${statusData.error || statusText || "Unknown proxy error"}`
          }), { headers: corsHeaders });
        }

        const korbaStatus = String(statusData?.status || "").toLowerCase();

        if (korbaStatus === "success") {
          verifiedAmount = Number(existingOrder?.amount || 0);
          paystackFeeOnVerified = Number(existingOrder?.paystack_fee || 0);
          metadata = existingOrder?.metadata || {};
          currentOrderType = (existingOrder?.order_type || "data") as string;
        } else if (korbaStatus === "failed" || korbaStatus === "failure") {
          const failMsg = translateFailureReason(statusData.message || "Payment failed");
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: failMsg
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: failMsg }), { headers: corsHeaders });
        } else {
          console.log(`[verify-payment] Korba status is not success: ${korbaStatus}`);
          await sendPendingSmsIfNeeded(false);
          return new Response(JSON.stringify({ status: "pending", message: "Awaiting mobile money approval." }), { headers: corsHeaders });
        }
      } catch (e) {
        console.error(`[verify-payment] Korba status check network error:`, e);
        return new Response(JSON.stringify({ status: "error", error: "Failed to connect to payment gateway" }), { headers: corsHeaders });
      }
    } else {
      const PAYSTACK_SECRET_KEY = paystackSecretKey || getFirstEnv("PAYSTACK_SECRET_KEY");
      if (!PAYSTACK_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Payment gateway not configured" }), { status: 500, headers: corsHeaders });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${targetReference}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        
        const verifyText = await verifyRes.text();
        let verifyData;
        try {
           verifyData = JSON.parse(verifyText);
        } catch (e) {
           console.error(`[verify-payment] Paystack non-JSON:`, verifyText.slice(0, 100));
           return new Response(JSON.stringify({ status: "error", error: "Payment gateway returned invalid response" }), { headers: corsHeaders });
        }

        const txStatus = verifyData.data?.status;

        if (txStatus === "success") {
          verifiedAmount = verifyData.data.amount / 100;
          
          // Verify payment currency and amount to prevent tampering
          if (verifyData.data.currency !== "GHS") {
            console.error(`[verify-payment] Currency mismatch: Paid in ${verifyData.data.currency}, Expected GHS`);
            return new Response(JSON.stringify({ status: "error", error: "Currency mismatch. Only payments in GHS are accepted." }), { headers: corsHeaders });
          }

          const expectedAmount = Number(existingOrder.amount) + 
            ((existingOrder.order_type === "wallet_topup" || existingOrder.order_type === "store_wallet_topup") ? Number(existingOrder.paystack_fee || 0) : 0);
          
          const amountDiff = Math.abs(verifiedAmount - expectedAmount);
          if (amountDiff > 0.05) {
            console.error(`[verify-payment] Amount mismatch: Paid ${verifiedAmount} GHS, Expected ${expectedAmount} GHS`);
            await supabaseAdmin.from("orders").update({
              status: "fulfillment_failed",
              failure_reason: `Amount mismatch: Paid GHS ${verifiedAmount}, expected GHS ${expectedAmount}`
            }).eq("id", targetReference);
            return new Response(JSON.stringify({ status: "error", error: `Amount mismatch. Paid ${verifiedAmount} GHS, Expected ${expectedAmount} GHS` }), { headers: corsHeaders });
          }
        } else if (txStatus === "failed") {
          const failMsg = verifyData.data.gateway_response || verifyData.data.message || verifyData.message || "Payment failed";
          console.warn(`[verify-payment] Payment failed explicitly:`, failMsg);
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: failMsg
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: failMsg }), { headers: corsHeaders });
        } else if (txStatus === "reversed") {
          console.warn(`[verify-payment] Payment reversed explicitly`);
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: "Transaction was reversed (refunded/charged back)"
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: "The transaction was reversed." }), { headers: corsHeaders });
        } else if (txStatus === "abandoned") {
          console.warn(`[verify-payment] Payment abandoned`);
          
          await sendPendingSmsIfNeeded(true);

          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: "Customer abandoned transaction"
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "not_paid", error: "The customer abandoned the transaction." }), { headers: corsHeaders });
        } else if (txStatus === "ongoing") {
          console.log(`[verify-payment] Payment ongoing: user action needed (OTP/transfer)`);
          await sendPendingSmsIfNeeded(false);
          return new Response(JSON.stringify({ status: "pending", message: "Awaiting customer action (OTP / Transfer) to complete payment." }), { headers: corsHeaders });
        } else if (txStatus === "pending" || txStatus === "processing" || txStatus === "queued") {
          console.log(`[verify-payment] Payment in progress (${txStatus})`);
          await sendPendingSmsIfNeeded(false);
          return new Response(JSON.stringify({ status: "pending", message: "Transaction is currently in progress." }), { headers: corsHeaders });
        } else {
          console.warn(`[verify-payment] Payment not confirmed or unknown status:`, txStatus);
          return new Response(JSON.stringify({ status: "not_paid", error: verifyData.message || "Payment not verified" }), { headers: corsHeaders });
        }
        
        // Fetch dynamic fee configuration for estimation
        const { data: settings } = await supabaseAdmin
          .from("v_system_settings_with_secrets").select("paystack_deposit_fee_percent")
          .eq("id", 1)
          .maybeSingle();
        
        const feeRate = Number(settings?.paystack_deposit_fee_percent ?? 0.03);
        paystackFeeOnVerified = parseFloat(Math.min(verifiedAmount * (feeRate / (1 + feeRate)), 100).toFixed(2)) || 0;
        metadata = verifyData.data.metadata || {};
        if (typeof metadata === "string") try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
        currentOrderType = (metadata?.order_type || currentOrderType) as string;
      } catch (e) {
        clearTimeout(timeoutId);
        console.error(`[verify-payment] Network error during verification:`, e);
        return new Response(JSON.stringify({ status: "error", error: "Failed to connect to payment gateway" }), { headers: corsHeaders });
      }
    }

    // --- 3. ATOMIC FULFILLMENT LOCK ---
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60000).toISOString();
    
    const orderCreatedAt = existingOrder ? new Date(existingOrder.created_at).getTime() : Date.now();
    const ageInMinutes = (Date.now() - orderCreatedAt) / 60000;
    const allowedStatuses = ["pending", "paid", "fulfillment_failed", "awaiting_payment", "failed"];

    const isMashUp = existingOrder?.network === "MTN Mash Up";
    const targetStatus = isMashUp ? "pending" : "processing";
    const { data: claimedOrder, error: claimError } = await supabaseAdmin
      .from("orders")
      .update({ 
        status: targetStatus, 
        paystack_verified_amount: verifiedAmount,
        paystack_fee: paystackFeeOnVerified,
        failure_reason: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", targetReference)
      .in("status", allowedStatuses)
      .select("*")
      .maybeSingle();

    if (claimError) {
      console.error("[verify-payment] Lock error:", claimError);
      return new Response(JSON.stringify({ 
        status: "error", 
        error: `Database update failed: ${claimError.message}` 
      }), { status: 500, headers: corsHeaders });
    }

    if (!claimedOrder) {
      // If we couldn't claim it, it might be already fulfilling or already finished.
      // Refresh state from DB to return the current status
      const { data: refreshed } = await supabaseAdmin.from("orders").select("*").eq("id", targetReference).maybeSingle();
      return new Response(JSON.stringify({ 
        status: refreshed?.status || "processing",
        message: "Order is being handled",
        provider_order_id: refreshed?.provider_order_id
      }), { headers: corsHeaders });
    }

    // Reverse any auto-refunds if the order was previously failed and refunded
    if (claimedOrder.auto_refunded === true) {
      console.log(`[verify-payment] Reversing auto-refund for order ${targetReference} to re-charge agent ${claimedOrder.agent_id}`);
      
      const { data: wallet, error: walletErr } = await supabaseAdmin
        .from("wallets")
        .select("balance, api_balance")
        .eq("agent_id", claimedOrder.agent_id)
        .maybeSingle();

      if (walletErr) {
        console.error("[verify-payment] Failed to fetch wallet for reversal:", walletErr);
      } else {
        const isApiOrder = claimedOrder.order_type === "api" || claimedOrder.metadata?.wallet_type === "api" || claimedOrder.metadata?.client_reference;
        if (isApiOrder) {
          const currentApi = Number(wallet?.api_balance || 0);
          await supabaseAdmin
            .from("wallets")
            .update({
              api_balance: currentApi - Number(claimedOrder.amount),
              updated_at: new Date().toISOString()
            })
            .eq("agent_id", claimedOrder.agent_id);
        } else {
          const currentBal = Number(wallet?.balance || 0);
          await supabaseAdmin
            .from("wallets")
            .update({
              balance: currentBal - Number(claimedOrder.amount),
              updated_at: new Date().toISOString()
            })
            .eq("agent_id", claimedOrder.agent_id);
        }

        // Clear the refund columns in orders table
        await supabaseAdmin
          .from("orders")
          .update({
            auto_refunded: false,
            refund_amount: 0,
            refunded_at: null,
            refund_reason: 'Refund reversed: order manually retried by admin.',
            updated_at: new Date().toISOString()
          })
          .eq("id", targetReference);

        // Log the reversal
        await supabaseAdmin
          .from("system_logs")
          .insert({
            level: "info",
            source: "system",
            event: "wallet.deduction_reversal",
            message: `Manually reversed refund and re-charged GHS ${claimedOrder.amount} for retried order`,
            order_id: targetReference,
            agent_id: claimedOrder.agent_id,
            data: {
              amount: claimedOrder.amount,
              network: claimedOrder.network,
              package_size: claimedOrder.package_size,
              reason: "manual_retry_reversal"
            }
          });
      }
    }

    if (claimedOrder?.network === "MTN Mash Up") {
      console.log(`[verify-payment] MTN Mash Up order ${targetReference} verified. Set status as 'pending' for manual export.`);
      return new Response(JSON.stringify({
        status: "pending",
        message: "MTN Mash Up order queued for manual processing"
      }), { headers: corsHeaders });
    }

    // --- 4. FULFILLMENT ---
    if (currentOrderType === "wallet_topup") {
      const agentId = claimedOrder.agent_id || metadata?.agent_id;
      if (agentId) {
        // Use the requested credit amount (order.amount), not the full paid amount (verifiedAmount)
        // This ensures the 3% processing fee is effectively charged.
        const creditAmount = Number(claimedOrder.amount || verifiedAmount);
        await supabaseAdmin.rpc("credit_wallet", { p_agent_id: agentId, p_amount: creditAmount });
        await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", targetReference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
    }

    if (currentOrderType === "store_wallet_topup") {
      const customerId = claimedOrder.customer_id || metadata?.customer_id;
      const agentId = claimedOrder.agent_id;
      const creditAmount = Number(claimedOrder.amount);

      if (customerId && agentId && creditAmount > 0) {
        const { data: creditRes, error: creditErr } = await supabaseAdmin.rpc("fulfill_store_wallet_topup", {
          p_order_id: targetReference,
          p_customer_id: customerId,
          p_agent_id: agentId,
          p_amount: creditAmount
        });

        if (creditErr || !creditRes?.success) {
          console.error("Store topup automation failed in verify-payment:", creditErr || creditRes?.error);
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: creditRes?.error || "Automatic credit failed."
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: creditRes?.error || "Automatic credit failed" }), { headers: corsHeaders });
        }
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
    }

    if (currentOrderType === "agent_activation") {
      const agentId = claimedOrder.agent_id || metadata?.agent_id;
      if (agentId) {
        await supabaseAdmin.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: false,
          parent_agent_id: null
        }).eq("user_id", agentId);
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", targetReference);
        console.log("Agent activated via verify-payment:", agentId);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
    }

    if (currentOrderType === "sub_agent_activation") {
      const subAgentId = claimedOrder.agent_id || metadata?.sub_agent_id;
      const parentAgentId = metadata?.parent_agent_id;
      const activationAmount = Number(metadata?.activation_fee || claimedOrder.amount || verifiedAmount || 0);
      
      const { data: settings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("sub_agent_base_fee").eq("id", 1).maybeSingle();
      const baseFee = Number(settings?.sub_agent_base_fee || 5);

      const agentProfit = Math.max(0, parseFloat((activationAmount - baseFee).toFixed(2)));
      
      if (subAgentId) {
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

        await supabaseAdmin
          .from("orders")
          .update({
            status: "fulfilled",
            failure_reason: null,
            profit: 0,
            parent_profit: agentProfit,
            parent_agent_id: parentAgentId || null,
          })
          .eq("id", targetReference);

        if (parentAgentId && agentProfit > 0) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
        }
        console.log("Sub agent activated via verify-payment:", subAgentId, "parent:", parentAgentId);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
    }


    const network = claimedOrder.network || metadata?.network || "";
    const customerPhone = claimedOrder.customer_phone || metadata?.customer_phone || "";
    const packageSize = claimedOrder.package_size || metadata?.package_size || "";
    const recipient = normalizeRecipient(customerPhone);
    const effectiveOrderType = currentOrderType === "free_data_claim" ? "data" : currentOrderType;

    // Fetch manual fulfillment mode from system settings
    const { data: globalSettings } = await supabaseAdmin
      .from("v_system_settings_with_secrets")
      .select("manual_fulfillment_mode")
      .eq("id", 1)
      .maybeSingle();
    const isManualFulfillmentMode = globalSettings?.manual_fulfillment_mode === true;

    if (isManualFulfillmentMode) {
      console.log(`[verify-payment] Manual fulfillment mode is active. Queuing order ${targetReference} in processing status.`);
      await supabaseAdmin.from("orders").update({
        status: "processing",
        provider_order_id: "manual_fulfillment_mode",
        failure_reason: "Queued for manual fulfillment (Auto-delivery paused)"
      }).eq("id", targetReference);

      log(supabaseAdmin, {
        level: "info",
        source: "verify-payment",
        event: "order.manual_queued",
        message: `Order queued for manual fulfillment (auto-delivery paused)`,
        order_id: targetReference,
        agent_id: claimedOrder.agent_id,
        data: { network, package_size: packageSize, amount: claimedOrder.amount }
      });

      return new Response(JSON.stringify({
        status: "processing",
        provider_order_id: "manual_fulfillment_mode",
        message: "Order placed successfully. Processing manually."
      }), { headers: corsHeaders });
    }

    // Standard Data/Airtime/Utility/AFA Fulfillment
    const activeProviders = await resolveProvidersForOrder(supabaseAdmin, claimedOrder);

    // --- SIBLING DUPLICATE PROTECTION ---
    // Look for any identical order submitted in the last 60 minutes for the same phone, network, package, and amount.
    // We check if any sibling order was already successfully processed or is currently processing.
    // Skip this check for Korba orders to allow duplicate back-to-back purchases.
    const isKorbaPackage = activeProviders && activeProviders.some((p: any) => p?.name === "Korba" || p?.handler_type === "korba");
    if (isProviderOrder && customerPhone && network && packageSize && !isKorbaPackage) {
      const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: rawSiblings } = await supabaseAdmin
        .from("orders")
        .select("id, status, provider_order_id, provider_id, profit, parent_profit, parent_agent_id, created_at, network, package_size, amount")
        .eq("customer_phone", customerPhone)
        .neq("id", targetReference) // Exclude current order
        .gte("created_at", sixtyMinutesAgo)
        .order("created_at", { ascending: false });

      const siblingOrders = (rawSiblings || []).filter(o => {
        const n1 = String(o.network || "").trim().toUpperCase();
        const n2 = String(network || "").trim().toUpperCase();
        const networksMatch = n1 === n2 ||
          ((n1 === "MTN" || n1 === "YELLO") && (n2 === "MTN" || n2 === "YELLO")) ||
          ((n1 === "TELECEL" || n1 === "VODAFONE" || n1 === "RED") && (n2 === "TELECEL" || n2 === "VODAFONE" || n2 === "RED")) ||
          ((n1 === "AT" || n1 === "AIRTELTIGO" || n1 === "BLUE") && (n2 === "AT" || n2 === "AIRTELTIGO" || n2 === "BLUE"));
        if (!networksMatch) return false;

        const p1 = String(o.package_size || "").replace(/\s+/g, "").toUpperCase();
        const p2 = String(packageSize || "").replace(/\s+/g, "").toUpperCase();
        if (p1 !== p2) return false;

        if (Math.abs(Number(o.amount) - Number(claimedOrder.amount)) > 0.01) return false;
        return true;
      });

      if (siblingOrders && siblingOrders.length > 0) {
        console.log(`[verify-payment] Found ${siblingOrders.length} sibling orders for duplicate protection.`);
        
        for (const sibling of siblingOrders) {
          const siblingTime = new Date(sibling.created_at).getTime();
          const currentTime = new Date(claimedOrder.created_at).getTime();
          const isOlder = siblingTime < currentTime || (siblingTime === currentTime && sibling.id < targetReference);

          // Case 1: Sibling is already fulfilled
          if (sibling.status === "fulfilled" || sibling.status === "completed") {
            console.log(`[verify-payment] Sibling order ${sibling.id} is already fulfilled. Marking current order ${targetReference} as fulfilled.`);
            await supabaseAdmin.from("orders").update({
              status: "fulfilled",
              provider_id: sibling.provider_id || null,
              provider_order_id: sibling.provider_order_id || null,
              failure_reason: `Completed via duplicate sibling order ${sibling.id}`
            }).eq("id", targetReference);
            
            await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
            await notifyApiClient(supabaseAdmin, targetReference, "fulfilled");
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: sibling.provider_order_id }), { headers: corsHeaders });
          }
          
          // Case 2: Sibling is active in our DB (processing, paid)
          if (sibling.status === "processing" || sibling.status === "paid") {
            if (!isOlder) {
              console.log(`[verify-payment] Sibling order ${sibling.id} is active but newer than current order. Ignoring sibling.`);
              continue;
            }
            console.log(`[verify-payment] Sibling order ${sibling.id} is active (${sibling.status}). Checking provider status.`);
            
            for (const provider of activeProviders) {
              const checkResult = await callProviderApi(supabaseAdmin, provider, {
                transaction_id: sibling.provider_order_id || sibling.id,
                order_id: sibling.provider_order_id || sibling.id,
                reference: sibling.id,
              }, "status");
              
              if (checkResult.ok) {
                const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
                const isProcessing = checkResult.status === "processing" || checkResult.status === "pending" || checkResult.status === "queued" || checkResult.status === "ongoing";
                
                if (isDelivered) {
                  console.log(`[verify-payment] Sibling order ${sibling.id} was actually fulfilled at provider. Marking current order ${targetReference} as fulfilled.`);
                  await supabaseAdmin.from("orders").update({
                    status: "fulfilled",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: null
                  }).eq("id", sibling.id);
                  
                  await supabaseAdmin.from("orders").update({
                    status: "fulfilled",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: `Completed via duplicate sibling order ${sibling.id}`
                  }).eq("id", targetReference);

                  await supabaseAdmin.rpc("credit_order_profits", { p_order_id: sibling.id });
                  await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });

                  await notifyApiClient(supabaseAdmin, sibling.id, "fulfilled");
                  await notifyApiClient(supabaseAdmin, targetReference, "fulfilled");
                  
                  return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: checkResult.id || sibling.provider_order_id }), { headers: corsHeaders });
                } else if (isProcessing) {
                  console.log(`[verify-payment] Sibling order ${sibling.id} is confirmed processing at provider. Halting current purchase.`);
                  await supabaseAdmin.from("orders").update({
                    status: "processing",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: `Waiting for sibling order ${sibling.id} processing`
                  }).eq("id", targetReference);
                  
                  return new Response(JSON.stringify({ status: "processing", provider_order_id: checkResult.id || sibling.provider_order_id }), { headers: corsHeaders });
                }
              }
            }
            
            // If provider status check failed or returned NOT_FOUND, but sibling status in our DB is STILL active:
            // We MUST NOT proceed to submit this order. We halt and wait for the sibling.
            console.log(`[verify-payment] Sibling order ${sibling.id} is active in DB but provider status check was inconclusive. Halting current purchase to prevent duplicates.`);
            await supabaseAdmin.from("orders").update({
              status: "processing",
              failure_reason: `Waiting for sibling order ${sibling.id} processing`
            }).eq("id", targetReference);
            
            return new Response(JSON.stringify({ status: "processing", message: `Waiting for sibling order ${sibling.id} processing` }), { headers: corsHeaders });
          }

          // Case 3: Sibling is failed / fulfillment_failed / refunded in our DB
          if (sibling.status === "fulfillment_failed" || sibling.status === "failed" || sibling.status === "refunded") {
            if (!isOlder) {
              console.log(`[verify-payment] Sibling order ${sibling.id} is failed (${sibling.status}) but newer than current order. Ignoring sibling.`);
              continue;
            }
            console.log(`[verify-payment] Sibling order ${sibling.id} is failed (${sibling.status}) in DB. Checking provider status to ensure it wasn't actually processed.`);
            
            for (const provider of activeProviders) {
              const checkResult = await callProviderApi(supabaseAdmin, provider, {
                transaction_id: sibling.provider_order_id || sibling.id,
                order_id: sibling.provider_order_id || sibling.id,
                reference: sibling.id,
              }, "status");
              
              if (checkResult.ok) {
                const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
                const isProcessing = checkResult.status === "processing" || checkResult.status === "pending" || checkResult.status === "queued" || checkResult.status === "ongoing";
                
                if (isDelivered) {
                  console.log(`[verify-payment] Sibling order ${sibling.id} was actually fulfilled at provider despite failure status. Marking both as fulfilled.`);
                  await supabaseAdmin.from("orders").update({
                    status: "fulfilled",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: null
                  }).eq("id", sibling.id);
                  
                  await supabaseAdmin.from("orders").update({
                    status: "fulfilled",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: `Completed via duplicate sibling order ${sibling.id}`
                  }).eq("id", targetReference);

                  await supabaseAdmin.rpc("credit_order_profits", { p_order_id: sibling.id });
                  await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });

                  await notifyApiClient(supabaseAdmin, sibling.id, "fulfilled");
                  await notifyApiClient(supabaseAdmin, targetReference, "fulfilled");
                  
                  return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: checkResult.id || sibling.provider_order_id }), { headers: corsHeaders });
                } else if (isProcessing) {
                  console.log(`[verify-payment] Sibling order ${sibling.id} is processing at provider. Moving sibling back to processing and halting current purchase.`);
                  await supabaseAdmin.from("orders").update({
                    status: "processing",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: "Re-processing after status check"
                  }).eq("id", sibling.id);
                  
                  await supabaseAdmin.from("orders").update({
                    status: "processing",
                    provider_id: provider.id,
                    provider_order_id: checkResult.id || sibling.provider_order_id || null,
                    failure_reason: `Waiting for sibling order ${sibling.id} processing`
                  }).eq("id", targetReference);
                  
                  return new Response(JSON.stringify({ status: "processing", provider_order_id: checkResult.id || sibling.provider_order_id }), { headers: corsHeaders });
                }
              }
            }
            
            // If provider check confirmed it is not found / failed, we proceed and submit the current order
            console.log(`[verify-payment] Sibling order ${sibling.id} is confirmed failed. Proceeding with current purchase.`);
          }
        }
      }
    }

    const { data: sysSettings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("auto_api_switch, auto_failover_non_beneficiary_to_datamart").eq("id", 1).maybeSingle();
    const autoApiSwitch = sysSettings?.auto_api_switch !== false;

    // Retrieve the actual base price (excluding payment fees) to deliver to the provider API
    const deliveryAmount = (currentOrderType === "airtime" || currentOrderType === "utility" || currentOrderType === "data")
      ? Number(claimedOrder.metadata?.base_price || metadata?.base_price || claimedOrder.amount)
      : claimedOrder.amount;

    const requestBody = {
      networkRaw: network,
      networkKey: mapDataNetworkKey(network),
      recipient,
      customerNumber: recipient, // Alias
      phoneNumber: recipient,    // Alias
      capacity: parseCapacity(packageSize),
      plan: packageSize,         // Required by standard providers
      bundle: packageSize,       // Alias
      package_size: packageSize, // Alias
      amount: deliveryAmount,
      order_type: effectiveOrderType,
      orderReference: targetReference,
      reference: targetReference,      // Alias
      bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary,
      category: claimedOrder.metadata?.category,
    };

    let result: any = { ok: false, reason: "No providers" };
    let successfulProviderId = null;

    const buildDataPayload = async (provider: any, overrideNetKey?: string) => {
      const ht = provider.handler_type || "standard";
      const defaultNetKey = mapDataNetworkKey(network);
      
      const netKey = overrideNetKey || defaultNetKey;
      if (ht === "datamart") {
        let externalId = packageSize;
        const capNum = parseCapacity(packageSize);
        const datamartNet = (network.toUpperCase().includes("MTN") || network.toUpperCase() === "YELLO")
          ? "YELLO"
          : ((network.toUpperCase().includes("TELECEL") || network.toUpperCase().includes("VODA")) ? "TELECEL" : "AT_PREMIUM");

        try {
          const { data: pkgMapping } = await supabaseAdmin
            .from("provider_packages")
            .select("external_id")
            .eq("provider_id", provider.id)
            .eq("network", "MTN")
            .eq("package_name", packageSize)
            .maybeSingle();
          if (pkgMapping?.external_id) {
            externalId = pkgMapping.external_id;
          } else if (capNum > 0) {
            externalId = `MTN_${capNum}`;
          }
        } catch (e) {
          console.error("[datamart-payload-resolve] Error:", e);
        }

        return { 
          phoneNumber: recipient,
          recipient,
          phone: recipient, 
          network: datamartNet, 
          package_size: packageSize,
          planId: externalId, 
          plan: externalId, 
          bundle: externalId, 
          capacity: String(capNum > 0 ? capNum : packageSize), 
          orderReference: targetReference, 
          reference: targetReference,
          gateway: "wallet", 
          bypass_beneficiary: true, 
          category: claimedOrder.metadata?.category 
        };
      }
      if (ht === "datahub" || ht === "spendless") return { networkKey: netKey, recipient, capacity: String(parseCapacity(packageSize)), reference: targetReference, bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary, category: claimedOrder.metadata?.category };
      if (ht === "qhowmenzconsult") {
        return {
          networkRaw: network,
          networkKey: netKey,
          recipient,
          package_size: packageSize,
          plan: packageSize,
          amount: deliveryAmount,
          reference: targetReference,
          order_id: targetReference,
          bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary,
        };
      }
      if (ht === "skdataplug") {
        return {
          networkRaw: network,
          networkKey: netKey,
          recipient,
          package_size: packageSize,
          plan: packageSize,
          amount: deliveryAmount,
          reference: targetReference,
          order_id: targetReference,
          bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary,
        };
      }
      
      // Pass override network to standard request body if provided
      if (overrideNetKey) return { ...requestBody, networkKey: overrideNetKey };
      return requestBody;
    };

    // Auto-failover: try each active provider in priority order
    for (const provider of activeProviders) {
      const providerCallStart = Date.now();
      if (currentOrderType === "afa") {
        result = await callProviderApi(
          supabaseAdmin,
          provider,
          {
            fullName: metadata.afa_full_name,
            ghanaCardNumber: metadata.afa_ghana_card,
            occupation: metadata.afa_occupation,
            email: metadata.afa_email,
            placeOfResidence: metadata.afa_residence,
            dateOfBirth: metadata.afa_date_of_birth,
            customer_phone: customerPhone,
            phone: customerPhone,
            recipient,
            amount: deliveryAmount,
            reference: targetReference,
            networkKey: "AFA",
            capacity: "BUNDLE",
          },
          "afa-registration"
        );
      } else if (currentOrderType === "utility") {
        result = await callProviderApi(
          supabaseAdmin,
          provider,
          {
            order_type: "utility",
            utility_type: claimedOrder.utility_type,
            utility_provider: claimedOrder.utility_provider,
            utility_account_number: claimedOrder.utility_account_number,
            utility_account_name: claimedOrder.utility_account_name,
            amount: deliveryAmount,
            reference: targetReference,
            lookup_transaction_id: claimedOrder.metadata?.lookup_transaction_id,
            metadata: claimedOrder.metadata,
            meter_id: claimedOrder.metadata?.meter_id,
            meter_number: claimedOrder.metadata?.meter_number
          },
          "purchase"
        );
      } else {
        result = await callProviderApi(supabaseAdmin, provider, await buildDataPayload(provider), "purchase");
      }
      
      // Auto-fallback for AirtelTigo: If AT_PREMIUM fails with "Bundle not available", try AT_BIGTIME
      if (!result.ok && /bundle not available|invalid bundle/i.test(result.reason) && (network.toUpperCase().includes("AIRTEL") || network.toUpperCase() === "AT")) {
        const ht = provider.handler_type || "standard";
        if (ht === "datamart" || ht === "spendless" || ht === "datahub" || ht === "bossu") {
          console.log(`[verify-payment] Retrying ${provider.name} with AT_BIGTIME/AT for AirtelTigo bundle...`);
          // Datamart/Datahub use AT_BIGTIME. Bossu uses AT.
          const fallbackNetKey = (ht === "bossu" || ht === "standard") ? "AT" : "AT_BIGTIME";
          result = await callProviderApi(supabaseAdmin, provider, await buildDataPayload(provider, fallbackNetKey), "purchase");
        }
      }

      // Auto-failover to Datamart for MTN orders rejected by DataHub (Beneficiary / Payee Limit / Unlisted number / Provider rejection)
      const isDataHub = (provider.handler_type || "").toLowerCase() === "datahub";
      const isMtn = network.toUpperCase().includes("MTN") || network.toUpperCase() === "YELLO";
      const isBeneficiaryOrLimitError = /beneficiary|payee|limit|not_allowed|not allowed|not added|whitelist|recipient/i.test(String(result.reason || ""));
      
      if (!result.ok && isMtn && (isDataHub || isBeneficiaryOrLimitError)) {
        console.log(`[verify-payment] MTN order rejected by ${provider.name} (${result.reason}). Attempting Datamart API failover...`);
        const { data: dmProvider } = await supabaseAdmin
          .from("providers")
          .select("*")
          .eq("handler_type", "datamart")
          .eq("is_active", true)
          .maybeSingle();

        if (dmProvider && dmProvider.id !== provider.id) {
          console.log(`[verify-payment] Routing non-beneficiary order for ${recipient} via ${dmProvider.name} (Datamart API)...`);
          const dmPayload = await buildDataPayload(dmProvider, "MTN");
          const dmResult = await callProviderApi(supabaseAdmin, dmProvider, dmPayload, "purchase");
          if (dmResult.ok) {
            result = dmResult;
            successfulProviderId = dmProvider.id;
            console.log(`[verify-payment] Datamart API failover SUCCESSFUL for ${recipient}! Provider Order ID: ${dmResult.id}`);
          } else {
            console.error(`[verify-payment] Datamart failover also rejected: ${dmResult.reason}`);
          }
        }
      }

      const providerDuration = Date.now() - providerCallStart;

      if (result.ok) {
        if (!successfulProviderId) {
          successfulProviderId = provider.id;
        }
        // Reset consecutive failures on success
        supabaseAdmin.from("providers").update({ consecutive_failures: 0 }).eq("id", successfulProviderId);
        log(supabaseAdmin, { level: "info", source: "verify-payment", event: "provider.called", message: `Provider accepted order`, order_id: targetReference, provider_id: successfulProviderId, duration_ms: providerDuration, data: { provider_order_id: result.id, network, package_size: packageSize, recipient } });
        break; // success — stop trying
      } else {
        // Increment consecutive failures ONLY for technical server outages, NOT for unlisted beneficiary numbers
        const isBeneficiaryErr = /beneficiary|payee|limit|not_allowed|not allowed|not added|whitelist|recipient/i.test(String(result.reason || ""));
        let newFailures = 0;
        let autoDisable = false;

        if (!isBeneficiaryErr) {
          const { data: prov } = await supabaseAdmin.from("providers").select("consecutive_failures").eq("id", provider.id).maybeSingle();
          newFailures = ((prov as any)?.consecutive_failures || 0) + 1;
          autoDisable = newFailures >= 5 && autoApiSwitch;
          await supabaseAdmin.from("providers").update({
            consecutive_failures: newFailures,
            ...(autoDisable ? { is_active: false, disabled_reason: `Auto-disabled after ${newFailures} consecutive failures` } : {}),
          }).eq("id", provider.id);
        }

        await logProviderError(supabaseAdmin, provider.id, targetReference, result.reason);
        log(supabaseAdmin, { level: "error", source: "verify-payment", event: "provider.rejected", message: `${provider.name} rejected (${newFailures} failures)${autoDisable ? " — AUTO-DISABLED" : ""}: ${result.reason}`, order_id: targetReference, provider_id: provider.id, duration_ms: providerDuration, data: { provider: provider.name, reason: result.reason, consecutive_failures: newFailures, auto_disabled: autoDisable } });

        if (autoDisable) {
          // Insert admin alert
          const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
          if (admins?.length) {
            await supabaseAdmin.from("user_notifications").insert(admins.map((a: any) => ({
              user_id: a.user_id, title: `Provider Auto-Disabled: ${provider.name}`,
              message: `${provider.name} was automatically disabled after ${newFailures} consecutive failures. Check System Logs.`,
              type: "error", data: { link: "/admin/system-logs", provider_id: provider.id },
            })));
          }
        }
        
        const datamartFailoverEnabled = sysSettings?.auto_failover_non_beneficiary_to_datamart !== false;
        if (!autoApiSwitch && !datamartFailoverEnabled) {
          console.log(`[verify-payment] Auto API switch is disabled. Not failing over from ${provider.name}.`);
          break;
        }

        // Continue to next provider (failover)
        console.log(`[verify-payment] Failing over from ${provider.name} to next provider...`);
      }
    }

    if (result.ok) {
      // successful API pushes remain at 'processing' state to be auto-delivered after delay
      const token = result.raw?.prepaid_token;
      const isSyncUtilityFulfill = currentOrderType === "utility" && token;
      
      const targetStatus = isSyncUtilityFulfill ? "fulfilled" : "processing";
      
      if (targetStatus === "fulfilled") {
        await fulfillOrder(supabaseAdmin, targetReference, successfulProviderId, result.id || null, token || null);
      } else {
        const patch: any = { 
          provider_id: successfulProviderId, 
          provider_order_id: result.id, 
          status: targetStatus, 
          failure_reason: null
        };
        await supabaseAdmin.from("orders").update(patch).eq("id", targetReference);
      }
      
      log(supabaseAdmin, { level: "info", source: "verify-payment", event: "order.processing", message: `Order successfully bought - set as ${targetStatus} — provider_order_id: ${result.id}`, order_id: targetReference, agent_id: claimedOrder.agent_id, provider_id: successfulProviderId, data: { provider_order_id: result.id, network, package_size: packageSize, amount: claimedOrder.amount } });
      return new Response(JSON.stringify({ status: targetStatus, provider_order_id: result.id }), { headers: corsHeaders });
    } else {
      // Purchase failed - check if it is a transient timeout/network error
      const reasonStr = String(result.reason || "").toLowerCase();
      const isTimeoutOrNetworkError = 
        reasonStr.includes("timeout") || 
        reasonStr.includes("504") || 
        reasonStr.includes("502") || 
        reasonStr.includes("proxy failed") || 
        reasonStr.includes("connection") || 
        reasonStr.includes("network error") ||
        reasonStr.includes("abort");

      if (isTimeoutOrNetworkError) {
        // Mark as processing (with provider_order_id = "timeout" to prevent cron-auto-retry from retrying it)
        // This keeps it in processing state so webhook can fulfill it when it arrives,
        // and prevents the auto-refund trigger from firing immediately.
        const updatedMetadata = {
          ...(claimedOrder.metadata || {}),
          provider_timeout_reason: result.reason || "Connection timeout"
        };
        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_order_id: "timeout",
          failure_reason: null,
          metadata: updatedMetadata
        }).eq("id", targetReference);

        log(supabaseAdmin, { 
          level: "warn", 
          source: "verify-payment", 
          event: "order.timeout_processing", 
          message: `Order timed out during provider purchase. Left in processing: ${result.reason}`, 
          order_id: targetReference, 
          agent_id: claimedOrder.agent_id, 
          data: { reason: result.reason, network, package_size: packageSize } 
        });

        return new Response(JSON.stringify({
          status: "processing",
          reason: `Provider connection timed out. We are verifying the transaction status. Please wait.`,
          provider_order_id: "timeout"
        }), { headers: corsHeaders });
      }

      // Otherwise, it's a definitive failure/rejection (e.g. Insufficient Balance, Invalid Number, etc.)
      const isWalletOrApiPayment = ["wallet", "credit", "api"].includes(paymentMethod.toLowerCase());
      const targetStatus = "fulfillment_failed";
      const targetProviderOrderId = "failed_api_call";
      const targetFailureReason = translateFailureReason(result.reason || "Provider rejected the request");

      await supabaseAdmin.from("orders").update({
        status: targetStatus,
        provider_order_id: targetProviderOrderId,
        failure_reason: targetFailureReason
      }).eq("id", targetReference);

      const isApiOrder = (claimedOrder?.order_type || "").toLowerCase() === "api";

      log(supabaseAdmin, { 
        level: (isApiOrder || isWalletOrApiPayment) ? "warn" : "error", 
        source: "verify-payment", 
        event: (isApiOrder || isWalletOrApiPayment) ? "order.processing_failed_api" : "order.failed", 
        message: (isApiOrder || isWalletOrApiPayment)
          ? `Order provider call rejected. Status set to ${targetStatus}: ${targetFailureReason}` 
          : `Order fulfillment failed: ${targetFailureReason}`, 
        order_id: targetReference, 
        agent_id: claimedOrder.agent_id, 
        data: { reason: targetFailureReason, network, package_size: packageSize } 
      });

      return new Response(JSON.stringify({
        status: targetStatus,
        reason: targetFailureReason,
        provider_order_id: targetProviderOrderId
      }), { headers: corsHeaders });
    }
  } catch (error: any) {
    console.error("[verify-payment] CRITICAL ERROR:", error);
    const errorMsg = error?.message || (typeof error === 'string' ? error : "Internal fulfillment error");
    log(supabaseAdmin, { level: "error", source: "verify-payment", event: "error", message: `Critical error: ${errorMsg}`, data: { stack: error?.stack?.slice(0, 500) } });
    return new Response(JSON.stringify({
      error: errorMsg,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
