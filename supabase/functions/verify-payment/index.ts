declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchViaDb } from "../_shared/db_proxy.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getActiveProviders, logProviderError, resolveProvidersForOrder } from "../_shared/providers.ts";
import { log, notifyAdmins } from "../_shared/logger.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";
import { getProviderAdapter } from "../_shared/providers/registry.ts";
import { executeGuestBeneficiaryRefund, handleGuestBeneficiaryFailure, isGuestOrder } from "../_shared/guest-refund.ts";
import { sendWhatsAppOrderReceipt, checkAndTriggerDeliveryOnFire } from "../_shared/whatsapp.ts";
import { isDuplicateOrderError } from "../_shared/providers/utils.ts";

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
  const raw = (network || "").trim().toUpperCase();
  const cleaned = raw.replace(/[\s\-_]+/g, "_");

  if (cleaned.includes("XPRESS") || cleaned.includes("EXPRESS")) return "MTN_XPRESS";
  if (cleaned.includes("BIGTIME") || cleaned.includes("BIG_TIME")) return "AT_BIGTIME";
  if (cleaned.includes("TELECEL") || cleaned.includes("VODA") || cleaned.includes("RED") || cleaned === "VOD") return "TELECEL";
  if (cleaned.includes("AIRTEL") || cleaned.includes("TIGO") || cleaned.includes("AT") || cleaned.includes("PREMIUM") || cleaned.includes("BLUE")) return "AT_PREMIUM";
  if (cleaned === "YELLO" || cleaned.includes("MTN") || cleaned.includes("KOKRO") || cleaned.includes("MASH") || cleaned.includes("DATA")) return "YELLO";

  return raw || "YELLO";
}

// Maps network names to the keys the airtime provider API expects (must match wallet-pay-airtime)
function mapAirtimeNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n.includes("MTN") || n === "YELLO") return "MTN";
  if (n.includes("VOD") || n.includes("TELECEL") || n === "RED") return "VOD";
  if (n.includes("AT") || n.includes("AIRTEL") || n.includes("TIGO") || n.includes("BLUE")) return "AT";
  if (n.includes("GLO")) return "GLO";
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

function translateFailureReason(
  reason: string | null | undefined,
  network?: string | null,
  orderType?: string | null,
  provider?: string | null
): string | null {
  if (!reason) return null;
  const r = String(reason).trim().toUpperCase();

  // 1. Mobile Money checkout payment failures
  if (
    r.includes("LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED") ||
    r.includes("LOW_BALANCE") ||
    r.includes("LOW BALANCE") ||
    r.includes("PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED")
  ) {
    return "Mobile Money payment declined: Customer wallet has insufficient funds or has reached its daily MoMo transaction limit.";
  }
  if (r.includes("CUSTOMER ABANDONED TRANSACTION") || r.includes("CUSTOMER ABANDONED")) {
    return "The checkout payment was cancelled or abandoned. Please try initiating the payment again.";
  }
  if (r.includes("INSUFFICIENT BALANCE") || r.includes("INSUFFICIENT_BALANCE")) {
    return "Fulfillment failed due to insufficient wallet balance. Please top up your wallet to retry.";
  }

  const netUpper = String(network || "").toUpperCase();
  const isMtn = netUpper.includes("MTN") || netUpper.includes("YELLO");
  const typeLower = String(orderType || "data").toLowerCase();
  const isDataOrSme = typeLower === "data" || typeLower === "sme";
  const isKorba = String(provider || "").toLowerCase() === "korba";

  // Beneficiary, Whitelist, and MTN Daily Data limits ONLY apply to MTN SME Data orders from data aggregators
  const isMtnSmeData = isMtn && isDataOrSme && !isKorba;

  if (isMtnSmeData) {
    if (r.includes("PAYEE_LIMIT_REACHED") || r.includes("DAILY LIMIT")) {
      return "The recipient's MTN daily transfer limit has been reached. Please try again tomorrow or use another number.";
    }
    if (
      r.includes("BENEFICIARY") ||
      r.includes("NOT_ALLOWED") ||
      r.includes("NOT ALLOWED") ||
      r.includes("NOT ADDED") ||
      r.includes("NOT_ADDED") ||
      r.includes("WHITELIST") ||
      r.includes("JESSCO") ||
      r.includes("ELIGIBILITY")
    ) {
      return "The recipient number has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.";
    }
  }

  // Non-MTN or Non-SME orders: Never show MTN data limit errors!
  if (typeLower === "airtime") {
    if (r.includes("NOT_ALLOWED") || r.includes("NOT ALLOWED") || r.includes("INVALID") || r.includes("FAILED")) {
      return "Airtime delivery could not be completed by carrier for this recipient number. Please verify recipient number or try another amount.";
    }
  }

  if (isKorba) {
    return reason
      .replace(/\b(Korba|Korba365)\b/gi, "Carrier Network")
      .replace(/Carrier Network reported:\s*/gi, "Carrier reported: ");
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

  // Credit profits — retry once before giving up, since this moves real
  // commission money into the agent's wallet and a transient DB blip
  // shouldn't silently cost them their payout.
  let profitCredited = false;
  let lastProfitErr: any = null;
  for (let attempt = 0; attempt < 2 && !profitCredited; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
      profitCredited = true;
    } catch (e) {
      lastProfitErr = e;
    }
  }

  if (!profitCredited) {
    const errMsg = lastProfitErr?.message || String(lastProfitErr);
    console.error("[verify-payment] CRITICAL: credit_order_profits failed after retry:", orderId, errMsg);
    log(supabaseAdmin, {
      level: "error",
      source: "verify-payment",
      event: "profit_credit_failed",
      message: `Order ${orderId} fulfilled but profit crediting failed after retry — agent commission not paid`,
      order_id: orderId,
      agent_id: order.agent_id,
      data: { error: errMsg, profit: order.profit },
    });
    notifyAdmins(supabaseAdmin, {
      title: "⚠️ Profit credit failed",
      message: `Order ${orderId.slice(0, 8)} was fulfilled but the agent's commission (GHS ${Number(order.profit || 0).toFixed(2)}) failed to credit after retry. Needs manual reconciliation.`,
      data: { link: "/admin/pnl", order_id: orderId, agent_id: order.agent_id },
    });
  }

  // Trigger Push Notification for Agent — best-effort, not critical
  try {
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
    console.error("[verify-payment] Push notification failed:", e);
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

    // Trigger Instant WhatsApp Push Receipt to Customer
    try {
      sendWhatsAppOrderReceipt(order.customer_phone, {
        id: order.id,
        network: order.network,
        package_size: order.package_size,
        amount: order.amount,
        order_type: order.order_type,
        customer_phone: order.customer_phone,
        token: token || null,
        vouchers: order.metadata?.vouchers,
      }).catch((waErr) => console.warn("[verify-payment] WhatsApp order receipt error:", waErr));
    } catch (waErr) {
      console.error("[verify-payment] WhatsApp dispatch error:", waErr);
    }
  }

  // Trigger auto delivery velocity announcement to WhatsApp Channel if cooldown passed
  try {
    checkAndTriggerDeliveryOnFire(supabaseAdmin).catch((cErr) =>
      console.warn("[verify-payment] Delivery fire channel alert error:", cErr)
    );
  } catch (cErr) {
    console.warn("[verify-payment] Delivery fire trigger dispatch error:", cErr);
  }
}

async function callProviderApi(
  supabaseAdmin: any,
  provider: any,
  data: Record<string, unknown>,
  endpoint: string = "purchase"
): Promise<{ ok: boolean; reason?: string; id?: string; status?: string }> {
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

serve(async (req: any) => {
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

    const { reference, orderId, phone, force: forceInput, action } = body;
    const force = forceInput || action === "retry_order";
    const resolvedReference = reference || orderId;

    if (action === "guest_refund") {
      const targetOrderId = resolvedReference || body.order_id;
      if (!targetOrderId) {
        return new Response(JSON.stringify({ success: false, refunded: false, error: "Missing order_id for guest refund" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let ord: any = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetOrderId);
      if (isUuid) {
        const { data: ordById } = await supabaseAdmin.from("orders").select("*").eq("id", targetOrderId).maybeSingle();
        ord = ordById;
      }
      if (!ord) {
        const { data: ordByClientRef } = await supabaseAdmin
          .from("orders")
          .select("*")
          .eq("metadata->>client_reference", targetOrderId)
          .maybeSingle();
        ord = ordByClientRef;
      }
      if (!ord) {
        const { data: ordByMetaRef } = await supabaseAdmin
          .from("orders")
          .select("*")
          .or(`metadata->>reference.eq.${targetOrderId},metadata->>payment_reference.eq.${targetOrderId},metadata->>paystack_reference.eq.${targetOrderId},metadata->>trxref.eq.${targetOrderId}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        ord = ordByMetaRef;
      }

      if (!ord) {
        return new Response(JSON.stringify({ success: false, refunded: false, error: "Order not found" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check if order has already been fulfilled or completed
      if (ord.status === "fulfilled" || ord.status === "completed") {
        return new Response(JSON.stringify({
          success: false,
          refunded: false,
          error: "Order has already been fulfilled by the carrier and delivered. It cannot be refunded."
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check if order has already been refunded
      if (ord.status === "refunded" || ord.auto_refunded === true) {
        return new Response(JSON.stringify({
          success: false,
          refunded: false,
          already_refunded: true,
          error: "Order has already been refunded."
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check if order has already entered a provider
      const hasActiveProviderRef = ord.provider_order_id &&
        ord.provider_order_id !== "" &&
        ord.provider_order_id !== "failed_api_call" &&
        ord.provider_order_id !== "timeout";

      const hasEnteredProvider = Boolean(
        hasActiveProviderRef ||
        (ord.provider_id && ord.provider_order_id !== "failed_api_call" && ord.provider_order_id !== "timeout") ||
        ord.status === "processing"
      );

      if (hasEnteredProvider) {
        return new Response(JSON.stringify({
          success: false,
          refunded: false,
          has_entered_provider: true,
          error: "This order has already entered the carrier network provider API and delivery is 100% guaranteed. Orders that have entered a provider cannot be cancelled or refunded."
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const refundRes = await executeGuestBeneficiaryRefund(supabaseAdmin, ord, body.reason || "Customer requested guest refund");
      return new Response(JSON.stringify(refundRes), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ─── 🛡️ DOS & BRUTE-FORCE RATE LIMITING ─────────────────────────────────
    const rawIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const clientIp = rawIp || "unknown-ip";
    const authHeader = req.headers.get("authorization") || req.headers.get("x-user-access-token") || "";
    const isAuthedOrForce = force || (authHeader.length > 20);

    // Differentiate rate key if IP is unknown/shared
    const rateKey = (clientIp === "unknown-ip" && authHeader)
      ? `ip_verify_auth_${authHeader.slice(-16)}`
      : `ip_verify_${clientIp}`;

    // Limit IP-based requests (1200/min for authed/admin retries, 600/min for public)
    const ipRateLimit = isAuthedOrForce ? 1200 : 600;
    const { data: ipAllowed } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: rateKey,
      p_rate_limit: ipRateLimit
    });
    
    if (!ipAllowed) {
      console.warn(`[SECURITY] Blocked rate-limited key on verify-payment: ${rateKey}`);
      return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Limit Target Phone-based requests ONLY when performing pure phone lookups without an order reference
    if (phone && !resolvedReference && !force) {
      const cleanPhone = phone.replace(/\D+/g, "");
      if (cleanPhone) {
        const { data: phoneAllowed } = await supabaseAdmin.rpc("check_generic_rate_limit", {
          p_key: `phone_verify_${cleanPhone}`,
          p_rate_limit: 60
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

    // Resolve custom API references (UUID, non-UUID, phone number, or Paystack reference)
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
        }
      }

      if (!targetReference) {
        // 1. Check if resolvedReference is a phone number (e.g. 024xxxxxxx or 233xxxxxxxxx)
        const digitsOnly = String(resolvedReference).replace(/\D+/g, "");
        if (digitsOnly.length >= 9 && digitsOnly.length <= 13) {
          const last9 = digitsOnly.slice(-9);
          const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
          const { data: phoneOrder } = await supabaseAdmin
            .from("orders")
            .select("id")
            .or(`customer_phone.ilike.%${last9},customer_phone.eq.${digitsOnly}`)
            .gte("created_at", fortyEightHoursAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (phoneOrder) {
            targetReference = phoneOrder.id;
          }
        }
      }

      if (!targetReference) {
        // 2. Try client_reference in metadata
        const { data: orderByClientRef } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("metadata->>client_reference", resolvedReference)
          .maybeSingle();
        if (orderByClientRef) {
          targetReference = orderByClientRef.id;
        }
      }

      if (!targetReference) {
        // 3. Try paystack / checkout reference in metadata
        const { data: orderByMetaRef } = await supabaseAdmin
          .from("orders")
          .select("id")
          .or(`metadata->>reference.eq.${resolvedReference},metadata->>payment_reference.eq.${resolvedReference},metadata->>paystack_reference.eq.${resolvedReference},metadata->>trxref.eq.${resolvedReference}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (orderByMetaRef) {
          targetReference = orderByMetaRef.id;
        }
      }

      if (!targetReference && !phone) {
        return new Response(JSON.stringify({ 
          status: "not_paid", 
          error: "Order not found with reference: " + resolvedReference,
          message: "We couldn't find a transaction for this reference."
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
        return new Response(JSON.stringify({ 
          status: "not_paid",
          error: "No recent order found for this number",
          message: "No recent order found for this phone number."
        }), {
          status: 200,
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

    if (!existingOrder) {
      return new Response(JSON.stringify({ 
        status: "not_paid",
        error: "Order not found with reference: " + targetReference,
        message: "Order not found. Please verify reference or phone number."
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isServiceRole = authHeader.includes(SUPABASE_SERVICE_ROLE_KEY || "nevermatch_placeholder");

    // Client restriction: Allow client-side verification fallback or instant verification when force is requested
    const orderAgeMs = Date.now() - new Date(existingOrder?.created_at || Date.now()).getTime();
    if (!isServiceRole && !force && orderAgeMs < 2000 && (existingOrder?.status === "pending" || existingOrder?.status === "awaiting_payment")) {
      console.log(`[verify-payment] Client request for pending order ${targetReference} under 2s age. Awaiting initial charge broadcast.`);
      return new Response(JSON.stringify({ 
        status: "pending", 
        message: "Awaiting payment confirmation."
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

    const hasActiveProviderOrder = Boolean(
      existingOrder?.provider_id &&
      existingOrder?.provider_order_id &&
      existingOrder.provider_order_id !== "timeout" &&
      existingOrder.provider_order_id !== "failed_api_call"
    );

    // --- 1. STATUS CHECK (For orders already being processed by a provider) ---
    // Only query provider status if this order was ACTUALLY dispatched to a provider!
    if (existingOrder?.status === "processing" && hasActiveProviderOrder && !isQueuedError && isProviderOrder) {
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
            const token = (checkResult as any).raw?.prepaid_token;
            await fulfillOrder(supabaseAdmin, targetReference, provider.id, existingOrder.provider_order_id, token || null);
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: existingOrder.provider_order_id, message: token ? `Token: ${token}` : null }), { headers: corsHeaders });
          } else if (isFailed) {
            const targetStatus = "fulfillment_failed";
            const resolvedReason = translateFailureReason(
              checkResult.reason || "Provider reported failure during status check",
              existingOrder?.network,
              existingOrder?.order_type,
              provider?.handler_type
            );
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

    // --- 1.2. PROCESSING FALLBACK (No arbitrary timeouts - strictly rely on provider status updates) ---
    const hasAssignedProvider = Boolean(
      existingOrder?.provider_id &&
      existingOrder?.provider_order_id &&
      existingOrder.provider_order_id !== "timeout" &&
      existingOrder.provider_order_id !== "failed_api_call"
    );

    const orderUpdatedAt = existingOrder?.updated_at ? new Date(existingOrder.updated_at).getTime() : new Date(existingOrder?.created_at || 0).getTime();
    const secondsSinceUpdate = (Date.now() - orderUpdatedAt) / 1000;

    if (existingOrder && existingOrder.status === "processing" && !force) {
      // If already assigned to an external provider order ID (and not just our dispatching lock)
      if (hasAssignedProvider && existingOrder.provider_order_id !== "dispatching") {
        console.log(`[verify-payment] Order ${targetReference} is currently in processing state with provider ${existingOrder.provider_id}. Awaiting provider status update.`);
        return new Response(JSON.stringify({ 
          status: "processing", 
          provider_order_id: existingOrder.provider_order_id,
          message: "Order is in processing state awaiting provider status update." 
        }), { headers: corsHeaders });
      }

      // If actively in-flight/dispatching within the last 60 seconds, block duplicate concurrent dispatch
      if (secondsSinceUpdate < 60 && existingOrder.provider_order_id !== "timeout" && existingOrder.provider_order_id !== "failed_api_call") {
        console.log(`[verify-payment] Order ${targetReference} is currently actively in-flight/dispatching (${secondsSinceUpdate.toFixed(1)}s ago). Blocking duplicate concurrent dispatch.`);
        return new Response(JSON.stringify({ 
          status: "processing", 
          provider_order_id: existingOrder.provider_order_id || "dispatching",
          message: "Order is currently being dispatched to provider." 
        }), { headers: corsHeaders });
      }
    }

    // --- 1.5. PRE-VERIFICATION PROVIDER CHECK ---
    // If the order is pending, paid, or fulfillment_failed, check if the provider already processed it
    // (handles race conditions, retries, or manual bypasses)
    // Skip for non-data/airtime order types — they don't involve a data provider
    // Optimization: Skip checking provider status for freshly paid/pending orders if they haven't been submitted yet (no provider_order_id)
    // AND they are less than 20 seconds old. This avoids slow and redundant API status check calls.
    const orderAgeSec = (Date.now() - new Date(existingOrder?.created_at || 0).getTime()) / 1000;
    const shouldCheckProvider = !!existingOrder?.provider_order_id;

    if ((existingOrder?.status === "pending" || existingOrder?.status === "paid" || existingOrder?.status === "fulfillment_failed" || existingOrder?.status === "processing") && isProviderOrder && shouldCheckProvider) {
      let providersToCheck: any[] = [];
      const currentRef = String(existingOrder?.provider_order_id || "");

      if (existingOrder?.provider_id) {
        const { data: assignedP } = await supabaseAdmin.from("providers").select("*").eq("id", existingOrder.provider_id).maybeSingle();
        if (assignedP && assignedP.is_active) providersToCheck = [assignedP];
      }

      if (providersToCheck.length === 0 && currentRef.startsWith("SKP")) {
        const { data: skP } = await supabaseAdmin.from("providers").select("*").eq("handler_type", "skdataplug").maybeSingle();
        if (skP && skP.is_active) providersToCheck = [skP];
      }

      if (providersToCheck.length === 0) {
        providersToCheck = await resolveProvidersForOrder(supabaseAdmin, existingOrder);
      }

      for (const provider of providersToCheck) {
        console.log(`[verify-payment] Pre-check status for ${targetReference} at ${provider.name}`);
        const checkResult = await callProviderApi(supabaseAdmin, provider, { 
          transaction_id: currentRef || targetReference,
          reference: targetReference, 
          order_id: currentRef || targetReference 
        }, "status");
        
        if (checkResult.ok) {
          const rawStatus = String(checkResult.status || "").toLowerCase();
          const isDelivered = rawStatus === "delivered" || rawStatus === "success" || rawStatus === "successful" || rawStatus === "fulfilled" || rawStatus === "completed" || rawStatus === "sent";
          const isFailed = rawStatus === "failed" || rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "refunded" || rawStatus === "reversed";
          const isProcessing = !isFailed && (rawStatus === "processing" || rawStatus === "pending" || rawStatus === "queued" || rawStatus === "ongoing");
          
          if (isDelivered) {
            console.log(`[verify-payment] Found fulfilled order ${targetReference} at ${provider.name} during pre-check.`);
            const token = (checkResult as any).raw?.prepaid_token;
            await fulfillOrder(supabaseAdmin, targetReference, provider.id, checkResult.id || existingOrder.provider_order_id || null, token || null);
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: checkResult.id || existingOrder.provider_order_id }), { headers: corsHeaders });
          } else if (isFailed) {
            console.log(`[verify-payment] Found failed/refunded order ${targetReference} at ${provider.name} during pre-check (${rawStatus}).`);
            const failReason = checkResult.reason || (rawStatus === "refunded" ? "Provider refunded order" : `Provider reported ${rawStatus}`);
            
            const failedIds = Array.isArray(existingOrder.metadata?.failed_provider_ids)
              ? [...existingOrder.metadata.failed_provider_ids]
              : [];
            if (!failedIds.includes(provider.id)) failedIds.push(provider.id);

            await logProviderError(supabaseAdmin, {
              provider_id: provider.id,
              order_id: targetReference,
              error_type: rawStatus === "refunded" ? "provider_refunded" : "provider_failed",
              error_message: failReason,
              status_code: 400,
            });

            // Unlock and record failure so it can proceed to route to another verified provider
            await supabaseAdmin.from("orders").update({
              provider_id: null,
              provider_order_id: null,
              failure_reason: `Refunded by ${provider.name}. Re-routing to alternative verified provider.`,
              metadata: {
                ...(existingOrder.metadata || {}),
                failed_provider_ids: failedIds,
                last_failed_provider: provider.name,
                refund_detected_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString()
            }).eq("id", targetReference);

            existingOrder.metadata = {
              ...(existingOrder.metadata || {}),
              failed_provider_ids: failedIds,
            };
            existingOrder.provider_order_id = null;
            existingOrder.provider_id = null;
            break; // Stop pre-checking with this refunded provider, proceed to fulfillment failover below
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
    if (existingOrder?.network === "AFA" || existingOrder?.network?.toUpperCase().includes("AFA") || existingOrder?.afa_ghana_card) {
      currentOrderType = "afa";
    } else if (currentOrderType.toLowerCase() === "api") {
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
      let korbaProvider: any = null;
      try {
        const { data } = await supabaseAdmin
          .from("providers")
          .select("settings, api_secret, api_key")
          .eq("handler_type", "korba")
          .maybeSingle();
        korbaProvider = data;
      } catch (err) {
        console.error("[verify-payment] Error fetching Korba provider:", err);
      }

      const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || korbaProvider?.settings?.client_id || "2419";
      const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || korbaProvider?.api_key || korbaProvider?.settings?.client_key || "";
      const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || korbaProvider?.api_secret || korbaProvider?.settings?.secret_key || "";

      if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Korba gateway credentials not configured" }), { status: 500, headers: corsHeaders });
      }

      const cleanRef = targetReference.replace(/_disb$/, "");
      const candidateKorbaIds = targetReference.endsWith("_disb")
        ? [targetReference, cleanRef]
        : [cleanRef, `${cleanRef}_disb`];

      console.log(`[verify-payment] Querying Korba status for candidates: ${candidateKorbaIds.join(", ")}`);
      try {
        let statusData: any = null;
        let statusResOk = false;
        let lastStatusText = "";
        let isExplicitSuccess = false;
        let isExplicitPending = false;
        let isKorbaFailed = false;
        let rawKorbaStatus = "";

        for (const candidateTxId of candidateKorbaIds) {
          const statusPayload = {
            transaction_id: candidateTxId,
            client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          };

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
          lastStatusText = statusText;
          statusResOk = statusRes.ok;
          console.log(`[verify-payment] Korba status response for ${candidateTxId}:`, statusText);
          try {
            statusData = JSON.parse(statusText);
          } catch {
            continue;
          }

          if (!statusRes.ok || statusData?.error) {
            continue;
          }

          rawKorbaStatus = String(statusData?.status || statusData?.results || statusData?.delivery_status || statusData?.code || "").toLowerCase();
          const codeStr = String(statusData?.code || statusData?.status_code || "").toLowerCase();

          isExplicitSuccess =
            rawKorbaStatus === "success" ||
            rawKorbaStatus === "successful" ||
            rawKorbaStatus === "paid" ||
            rawKorbaStatus === "completed" ||
            rawKorbaStatus === "fulfilled" ||
            rawKorbaStatus === "delivered" ||
            rawKorbaStatus === "000" ||
            rawKorbaStatus === "0000" ||
            codeStr === "000" ||
            codeStr === "0000" ||
            statusData?.code === 0 ||
            statusData?.status_code === 0;

          isExplicitPending =
            rawKorbaStatus === "pending" ||
            rawKorbaStatus === "initialized" ||
            rawKorbaStatus === "queued" ||
            rawKorbaStatus === "processing" ||
            rawKorbaStatus === "ongoing" ||
            statusData?.code === "0001" ||
            statusData?.code === "0002" ||
            statusData?.code === "100" ||
            statusData?.status === "PENDING" ||
            statusData?.status === "INITIALIZED";

          isKorbaFailed =
            !isExplicitSuccess &&
            !isExplicitPending &&
            (statusData?.success === false ||
             rawKorbaStatus.includes("fail") ||
             rawKorbaStatus.includes("error") ||
             rawKorbaStatus.includes("cancel") ||
             rawKorbaStatus.includes("reject") ||
             rawKorbaStatus.includes("expire") ||
             rawKorbaStatus.includes("decline") ||
             (statusData?.error_code && Number(statusData.error_code) > 0));

          if (isExplicitSuccess || isExplicitPending) {
            break;
          }
        }

        if (!statusData) {
          return new Response(JSON.stringify({ status: "error", error: "Payment gateway returned invalid response" }), { headers: corsHeaders });
        }

        if (!statusResOk || statusData.error) {
          console.error(`[verify-payment] Korba status check failed via DB Proxy:`, lastStatusText);
          return new Response(JSON.stringify({
            status: "error",
            error: `Database HTTP Proxy error: ${statusData.error || lastStatusText || "Unknown proxy error"}`
          }), { headers: corsHeaders });
        }

        if (isExplicitSuccess) {
          verifiedAmount = Number(existingOrder?.amount || 0);
          paystackFeeOnVerified = Number(existingOrder?.paystack_fee || 0);
          metadata = existingOrder?.metadata || {};
          currentOrderType = (existingOrder?.order_type || "data") as string;
        } else if (isKorbaFailed) {
          const failMsg = translateFailureReason(
            statusData.message || statusData.results || statusData.error_message || "Payment failed",
            existingOrder?.network,
            existingOrder?.order_type,
            "korba"
          );
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: failMsg
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: failMsg }), { headers: corsHeaders });
        } else {
          console.log(`[verify-payment] Korba payment status is pending (${rawKorbaStatus || 'pending'}). Waiting for user MoMo PIN approval...`);
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

          const feeToAdd = (Number(existingOrder.paystack_fee) > 0 && Math.abs(verifiedAmount - (Number(existingOrder.amount) + Number(existingOrder.paystack_fee))) <= 0.05) 
            ? Number(existingOrder.paystack_fee) 
            : ((existingOrder.order_type === "wallet_topup" || existingOrder.order_type === "store_wallet_topup") ? Number(existingOrder.paystack_fee || 0) : 0);
          const expectedAmount = Number(existingOrder.amount) + feeToAdd;
          
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
          const rawFailMsg = verifyData.data?.gateway_response || verifyData.data?.message || verifyData.message || "Payment failed on Mobile Money";
          const failMsg = translateFailureReason(rawFailMsg, existingOrder?.network, existingOrder?.order_type) || rawFailMsg;
          console.warn(`[verify-payment] Payment failed on gateway:`, failMsg);
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
    const orderCreatedAt = existingOrder ? new Date(existingOrder.created_at).getTime() : now;
    const lockUpdatedAt = existingOrder?.updated_at ? new Date(existingOrder.updated_at).getTime() : orderCreatedAt;
    const lockSecondsSinceUpdate = (now - lockUpdatedAt) / 1000;
    
    // An order in 'processing' is ONLY re-claimable if:
    // 1. It explicitly timed out or failed previously (provider_order_id === "timeout" or "failed_api_call")
    // 2. OR it has been stuck/abandoned for > 90 seconds AND force is true / explicit retry
    const isUndispatchedProcessing = existingOrder?.status === "processing" && (
      existingOrder?.provider_order_id === "timeout" || 
      existingOrder?.provider_order_id === "failed_api_call" || 
      existingOrder?.provider_order_id === "refunded" ||
      !existingOrder?.provider_order_id ||
      (lockSecondsSinceUpdate > 90 && (!existingOrder?.provider_order_id || existingOrder?.provider_order_id === "dispatching")) ||
      force
    );
    const allowedStatuses = isUndispatchedProcessing 
      ? ["pending", "paid", "fulfillment_failed", "awaiting_payment", "failed", "processing"]
      : ["pending", "paid", "fulfillment_failed", "awaiting_payment", "failed"];

    const targetStatus = "processing";
    const { data: claimedOrder, error: claimError } = await supabaseAdmin
      .from("orders")
      .update({ 
        status: targetStatus, 
        provider_order_id: targetStatus === "processing" ? "dispatching" : null,
        paystack_verified_amount: verifiedAmount || existingOrder?.paystack_verified_amount,
        paystack_fee: paystackFeeOnVerified || existingOrder?.paystack_fee,
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
      const reversalAmount = Number(claimedOrder.amount || 0);
      const isApiOrder = claimedOrder.order_type === "api" || claimedOrder.metadata?.wallet_type === "api" || claimedOrder.metadata?.client_reference;

      let debitSuccess = false;
      let debitErrMsg = "";

      if (isApiOrder) {
        const { data: apiDebitRes, error: apiDebitErr } = await supabaseAdmin.schema("api").rpc("debit_api_wallet", {
          p_user_id: claimedOrder.agent_id,
          p_amount: reversalAmount
        });
        if (!apiDebitErr && apiDebitRes?.success !== false) {
          debitSuccess = true;
        } else {
          debitErrMsg = apiDebitErr?.message || apiDebitRes?.error || "Insufficient API wallet balance to reverse auto-refund";
        }
      } else {
        const { data: debitRes, error: debitErr } = await supabaseAdmin.rpc("debit_wallet", {
          p_agent_id: claimedOrder.agent_id,
          p_amount: reversalAmount
        });
        if (!debitErr && debitRes?.success) {
          debitSuccess = true;
        } else {
          debitErrMsg = debitErr?.message || debitRes?.error || "Insufficient wallet balance to reverse auto-refund";
        }
      }

      if (!debitSuccess) {
        console.warn(`[verify-payment] Cannot reverse auto-refund for order ${targetReference}: ${debitErrMsg}`);
        await supabaseAdmin
          .from("orders")
          .update({
            status: "fulfillment_failed",
            failure_reason: `Cannot retry auto-refunded order: ${debitErrMsg}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", targetReference);
        return new Response(JSON.stringify({
          status: "error",
          error: `Cannot retry auto-refunded order: ${debitErrMsg}`
        }), { status: 400, headers: corsHeaders });
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

    const isMashUpOrderCheck = 
      claimedOrder?.network === "MTN Mash Up" || 
      String(claimedOrder?.network || "").toUpperCase().includes("MASH") ||
      (claimedOrder?.metadata?.category || "").toLowerCase() === "mashup";

    if (isMashUpOrderCheck) {
      console.log(`[verify-payment] MTN Mash Up order ${targetReference} verified. Proceeding directly to automated DataMart fulfillment.`);
    }

    // --- 4. FULFILLMENT ---
    if (currentOrderType === "wallet_topup") {
      const agentId = claimedOrder.agent_id || metadata?.agent_id;
      if (agentId) {
        // Use the requested credit amount (order.amount), not the full paid amount (verifiedAmount)
        // This ensures the 3% processing fee is effectively charged.
        const creditAmount = Number(claimedOrder.amount || verifiedAmount);
        const walletType = (claimedOrder.metadata?.wallet_type || metadata?.wallet_type) === "api" ? "api" : "main";
        if (walletType === "api") {
          await supabaseAdmin.schema("api").rpc("credit_api_wallet", { p_user_id: agentId, p_amount: creditAmount });
        } else {
          const { error: repayErr } = await supabaseAdmin.rpc("repay_credit", { p_agent_id: agentId, p_amount: creditAmount });
          if (repayErr) {
            await supabaseAdmin.rpc("credit_wallet", { p_agent_id: agentId, p_amount: creditAmount });
          }
        }
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
        const { data: agentProfile } = await supabaseAdmin
          .from("profiles")
          .update({ 
            is_agent: true, 
            agent_approved: true,
            onboarding_complete: true,
            is_sub_agent: false,
            parent_agent_id: null
          })
          .eq("user_id", agentId)
          .select("store_name, slug, whatsapp_number, agent_prices")
          .maybeSingle();

        if (agentProfile?.store_name || agentProfile?.slug) {
          const { error: storeSyncErr } = await supabaseAdmin.from("reseller_stores").upsert({
            user_id: agentId,
            store_name: agentProfile.store_name || "SwiftData Store",
            slug: agentProfile.slug || `store-${agentId.slice(0, 8)}`,
            whatsapp_number: agentProfile.whatsapp_number || null,
            custom_prices: agentProfile.agent_prices || {},
            is_active: true,
            updated_at: new Date().toISOString()
          }, { onConflict: "user_id" });
          if (storeSyncErr) {
            console.warn("[verify-payment] Non-fatal reseller_stores sync warning:", storeSyncErr.message);
          }
        }

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

        const { data: subProfile } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            sub_agent_approved: true,
            onboarding_complete: true,
            is_sub_agent: true,
            parent_agent_id: parentAgentId || null,
            agent_prices: subAgentPrices,
          })
          .eq("user_id", subAgentId)
          .select("store_name, slug, whatsapp_number")
          .maybeSingle();

        if (subProfile?.store_name || subProfile?.slug) {
          const { error: storeSyncErr } = await supabaseAdmin.from("reseller_stores").upsert({
            user_id: subAgentId,
            store_name: subProfile.store_name || "SwiftData Store",
            slug: subProfile.slug || `store-${subAgentId.slice(0, 8)}`,
            whatsapp_number: subProfile.whatsapp_number || null,
            custom_prices: subAgentPrices,
            is_active: true,
            updated_at: new Date().toISOString()
          }, { onConflict: "user_id" });
          if (storeSyncErr) {
            console.warn("[verify-payment] Non-fatal sub-agent reseller_stores sync warning:", storeSyncErr.message);
          }
        }

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
    // Look for any identical order submitted in the last 60 seconds for the same phone, network, package, and amount.
    // We check if an active sibling order for identical details is currently processing (e.g. rapid double-click or webhook race condition within 60 seconds).
    if (isProviderOrder && customerPhone && network && packageSize) {
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: rawSiblings } = await supabaseAdmin
        .from("orders")
        .select("id, status, provider_order_id, provider_id, profit, parent_profit, parent_agent_id, created_at, network, package_size, amount")
        .eq("customer_phone", customerPhone)
        .neq("id", targetReference)
        .in("status", ["processing", "paid"])
        .gte("created_at", sixtySecondsAgo)
        .order("created_at", { ascending: false });

      const siblingOrders = (rawSiblings || []).filter((o: any) => {
        // Only inspect siblings that have a valid provider_order_id (actually sent to provider)
        if (!o.provider_order_id || o.provider_order_id === "timeout") return false;
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
        console.log(`[verify-payment] Found ${siblingOrders.length} active in-progress sibling orders for rapid-fire duplicate protection.`);
        
        for (const sibling of siblingOrders) {
          const siblingTime = new Date(sibling.created_at).getTime();
          const currentTime = new Date(claimedOrder.created_at).getTime();
          const isOlder = siblingTime < currentTime || (siblingTime === currentTime && sibling.id < targetReference);

          if (!isOlder) continue;
          
          // Check assigned provider first for fast status check
          const assignedProvider = activeProviders.find((p: any) => p.id === sibling.provider_id) || activeProviders[0];
          if (assignedProvider) {
            const checkResult = await callProviderApi(supabaseAdmin, assignedProvider, {
              transaction_id: sibling.provider_order_id,
              order_id: sibling.provider_order_id,
              reference: sibling.id,
            }, "status");
            
            if (checkResult.ok) {
              const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
              
              if (isDelivered) {
                console.log(`[verify-payment] Sibling order ${sibling.id} was fulfilled at provider. Marking current order ${targetReference} as fulfilled.`);
                await supabaseAdmin.from("orders").update({
                  status: "fulfilled",
                  provider_id: assignedProvider.id,
                  provider_order_id: checkResult.id || sibling.provider_order_id || null,
                  failure_reason: null
                }).eq("id", sibling.id);
                
                await supabaseAdmin.from("orders").update({
                  status: "fulfilled",
                  provider_id: assignedProvider.id,
                  provider_order_id: checkResult.id || sibling.provider_order_id || null,
                  failure_reason: `Completed via duplicate sibling order ${sibling.id}`
                }).eq("id", targetReference);

                await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: sibling.id })).catch(() => {});
                await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference })).catch(() => {});
                
                return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: checkResult.id || sibling.provider_order_id }), { headers: corsHeaders });
              }
            }
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
    let isBeneficiaryErr = false;

    const buildDataPayload = async (provider: any, overrideNetKey?: string) => {
      const ht = provider.handler_type || "standard";
      const defaultNetKey = mapDataNetworkKey(network);
      
      const netKey = overrideNetKey || defaultNetKey;
      if (ht === "datamart") {
        let externalId = packageSize;
        const capNum = parseCapacity(packageSize);
        const pkgUpper = String(packageSize || "").toUpperCase();
        const isMashUp = 
          network.toUpperCase().includes("MASH") || 
          network.toUpperCase().includes("COMBO") ||
          claimedOrder?.network === "MTN Mash Up" ||
          (claimedOrder?.metadata?.category || "").toLowerCase() === "mashup" ||
          (pkgUpper.includes("MINS") && network.toUpperCase().includes("MTN"));

        const datamartNet = isMashUp
          ? "MTN_COMBO"
          : ((network.toUpperCase().includes("MTN") || network.toUpperCase() === "YELLO")
            ? "YELLO"
            : ((network.toUpperCase().includes("TELECEL") || network.toUpperCase().includes("VODA")) ? "TELECEL" : "AT_PREMIUM"));

        let comboCost: number | undefined = undefined;
        if (isMashUp) {
          const cleanPkgKey = packageSize.toLowerCase().replace(/[\s\-_+]/g, "");
          const MASHUP_COMBO_MAP: Record<string, number> = {
            // Official DataMart packages
            "511mb176mins": 10,
            "511mb": 10,
            "1gb353mins": 20,
            "1015mb353mins": 20,
            "1015mb": 20,
            "2gb397mins": 30,
            "2013mb397mins": 30,
            "2013mb": 30,
            "3.5gb88mins": 35,
            "3530mb88mins": 35,
            "3530mb": 35,
            "4gb176mins": 40,
            "4043mb176mins": 40,
            "4043mb": 40,
            "3.5gb529mins": 50,
            "3545mb529mins": 50,
            "3545mb": 50,
            "5.5gb264mins": 55,
            "5556mb264mins": 55,
            "5556mb": 55,
            "6gb353mins": 60,
            "6066mb353mins": 60,
            "6066mb": 60,
            "7gb441mins": 75,
            "7100mb441mins": 75,
            "7100mb": 75,
            "6.5gb705mins": 80,
            "6630mb705mins": 80,
            "6630mb": 80,
            "8gb529mins": 85,
            "8074mb529mins": 85,
            "8074mb": 85,
            "8gb881mins": 100,
            "8079mb881mins": 100,
            "8079mb": 100,

            // Legacy backwards-compatible aliases
            "2.6gb1077mins": 20,
            "4.5gb1800mins": 30,
            "3.4gbonly": 35,
            "3.4gb": 35,
            "6gb700mins": 40,
            "10gb1800mins": 50,
            "5.1gbonly": 55,
            "5.1gb": 55,
            "6.8gbonly": 60,
            "6.8gb": 60,
            "8.5only": 75,
            "8.5gbonly": 75,
            "8.5gb": 75,
            "8.5": 75,
            "10gbonly": 80,
            "870mb360mins": 85,
            "3.5gb14500mins": 100,
            "3.5gb1450mins": 100,
          };
          const VALID_COMBO_COSTS = new Set([10, 20, 30, 35, 40, 50, 55, 60, 75, 80, 85, 100]);
          if (MASHUP_COMBO_MAP[cleanPkgKey]) {
            comboCost = MASHUP_COMBO_MAP[cleanPkgKey];
          }

          try {
            const { data: pkgMapping } = await supabaseAdmin
              .from("provider_packages")
              .select("external_id")
              .eq("provider_id", provider.id)
              .or("network.ilike.%MASH%,network.eq.MTN_COMBO")
              .or(`package_name.eq.${packageSize},package_name.ilike.%${packageSize.trim()}%`)
              .maybeSingle();
            if (pkgMapping?.external_id && VALID_COMBO_COSTS.has(Number(pkgMapping.external_id))) {
              comboCost = Number(pkgMapping.external_id);
            }
          } catch (e) {
            console.error("[datamart-mashup-resolve] Error:", e);
          }

          if (!comboCost || !VALID_COMBO_COSTS.has(comboCost)) {
            if (cleanPkgKey.includes("10gb") && cleanPkgKey.includes("only")) comboCost = 80;
            else if (cleanPkgKey.includes("10gb")) comboCost = 50;
            else comboCost = 10;
          }
          externalId = String(comboCost);
        } else {
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
          comboCost: comboCost,
          orderReference: targetReference, 
          reference: targetReference,
          gateway: "wallet", 
          bypass_beneficiary: true, 
          category: isMashUp ? "mashup" : claimedOrder.metadata?.category 
        };
      }
      const parsedCapVal = parseCapacity(packageSize);
      const safeCap = parsedCapVal > 0 ? (parsedCapVal < 1 ? 1 : Math.round(parsedCapVal)) : 1;
      if (ht === "datahub") return { networkKey: netKey, recipient, capacity: String(safeCap), reference: targetReference, bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary, category: claimedOrder.metadata?.category };
      if (ht === "spendless") {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const webhookSecret = Deno.env.get("PROVIDER_WEBHOOK_SECRET");
        const webhookUrl = supabaseUrl
          ? `${supabaseUrl}/functions/v1/provider-webhook${webhookSecret ? `?secret=${webhookSecret}` : ""}`
          : undefined;
        const payload: any = {
          networkKey: netKey,
          recipient,
          capacity: safeCap,
          reference: targetReference,
          bypass_beneficiary: claimedOrder.metadata?.bypass_beneficiary,
          category: claimedOrder.metadata?.category,
        };
        if (webhookUrl) payload.webhook_url = webhookUrl;
        return payload;
      }
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
      
      // Standard request body for other providers
      const requestBody: Record<string, unknown> = {
        networkRaw: network,
        networkKey: netKey,
        recipient,
        phoneNumber: recipient,
        phone: recipient,
        package_size: packageSize,
        amount: deliveryAmount,
        price: deliveryAmount,
        reference: targetReference,
        order_id: targetReference,
        metadata: claimedOrder.metadata,
        afa_full_name: claimedOrder.afa_full_name || claimedOrder.metadata?.afa_full_name || metadata.afa_full_name,
        fullName: claimedOrder.afa_full_name || claimedOrder.metadata?.afa_full_name || metadata.afa_full_name,
        afa_ghana_card: claimedOrder.afa_ghana_card || claimedOrder.metadata?.afa_ghana_card || metadata.afa_ghana_card,
        ghana_card: claimedOrder.afa_ghana_card || claimedOrder.metadata?.afa_ghana_card || metadata.afa_ghana_card,
        ghanaCardNumber: claimedOrder.afa_ghana_card || claimedOrder.metadata?.afa_ghana_card || metadata.afa_ghana_card,
        afa_occupation: claimedOrder.afa_occupation || claimedOrder.metadata?.afa_occupation || metadata.afa_occupation,
        occupation: claimedOrder.afa_occupation || claimedOrder.metadata?.afa_occupation || metadata.afa_occupation,
        afa_residence: claimedOrder.afa_residence || claimedOrder.metadata?.afa_residence || metadata.afa_residence,
        location: claimedOrder.afa_residence || claimedOrder.metadata?.afa_residence || metadata.afa_residence,
        placeOfResidence: claimedOrder.afa_residence || claimedOrder.metadata?.afa_residence || metadata.afa_residence,
        afa_date_of_birth: claimedOrder.afa_date_of_birth || claimedOrder.metadata?.afa_date_of_birth || metadata.afa_date_of_birth,
        dob: claimedOrder.afa_date_of_birth || claimedOrder.metadata?.afa_date_of_birth || metadata.afa_date_of_birth,
        dateOfBirth: claimedOrder.afa_date_of_birth || claimedOrder.metadata?.afa_date_of_birth || metadata.afa_date_of_birth,
        afa_email: claimedOrder.afa_email || claimedOrder.metadata?.afa_email || metadata.afa_email,
        email: claimedOrder.afa_email || claimedOrder.metadata?.afa_email || metadata.afa_email,
      };

      // Pass override network to standard request body if provided
      if (overrideNetKey) return { ...requestBody, networkKey: overrideNetKey };
      return requestBody;
    };

    // Auto-failover: try each active provider in priority order
    let lastAttemptedProvider: any = null;
    for (const provider of activeProviders) {
      lastAttemptedProvider = provider;
      const providerCallStart = Date.now();
      if (currentOrderType === "afa" || network.toUpperCase().includes("AFA") || claimedOrder.afa_ghana_card) {
        result = await callProviderApi(
          supabaseAdmin,
          provider,
          {
            fullName: claimedOrder.afa_full_name || metadata.afa_full_name || metadata.fullName,
            ghanaCardNumber: claimedOrder.afa_ghana_card || metadata.afa_ghana_card || metadata.ghanaCardNumber,
            occupation: claimedOrder.afa_occupation || metadata.afa_occupation || metadata.occupation,
            email: claimedOrder.afa_email || metadata.afa_email || metadata.email,
            placeOfResidence: claimedOrder.afa_residence || metadata.afa_residence || metadata.residence,
            location: claimedOrder.afa_residence || metadata.afa_residence || metadata.residence,
            dateOfBirth: claimedOrder.afa_date_of_birth || metadata.afa_date_of_birth || metadata.dateOfBirth,
            dob: claimedOrder.afa_date_of_birth || metadata.afa_date_of_birth || metadata.dateOfBirth,
            customer_phone: customerPhone,
            phone: customerPhone,
            recipient,
            amount: deliveryAmount,
            reference: targetReference,
            networkKey: "AFA",
            capacity: "BUNDLE",
            order_type: "afa",
            afa_full_name: claimedOrder.afa_full_name || metadata.afa_full_name,
            afa_ghana_card: claimedOrder.afa_ghana_card || metadata.afa_ghana_card,
            afa_occupation: claimedOrder.afa_occupation || metadata.afa_occupation,
            afa_residence: claimedOrder.afa_residence || metadata.afa_residence,
            afa_date_of_birth: claimedOrder.afa_date_of_birth || metadata.afa_date_of_birth,
            afa_email: claimedOrder.afa_email || metadata.afa_email,
          },
          "purchase"
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
      } else if (currentOrderType === "voucher") {
        // Fulfill WAEC/BECE Result Checker Vouchers
        const vType = String(claimedOrder.metadata?.voucher_type || claimedOrder.metadata?.VoucherType || "WASSCE").toUpperCase();
        const vQty = parseInt(claimedOrder.metadata?.quantity || claimedOrder.metadata?.Quantity || "1", 10) || 1;
        const vRecipient = claimedOrder.customer_phone || claimedOrder.recipient;

        try {
          const { data: vProviders } = await supabaseAdmin
            .from("providers")
            .select("*")
            .eq("handler_type", "datahub")
            .eq("is_active", true)
            .limit(1);

          const vProv = vProviders?.[0];
          const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || vProv?.base_url || "https://user.datahubgh.com/api/external";
          const apiKey = Deno.env.get("DATAHUB_API_KEY") || vProv?.api_key || "";

          let vouchersList: any[] = [];
          if (apiKey) {
            try {
              const vRes = await fetch(`${rawBaseUrl.replace(/\/+$/, "")}/vouchers/buy`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                },
                body: JSON.stringify({
                  service: vType,
                  quantity: vQty,
                  recipient_phone: vRecipient,
                })
              });
              const vJson = await vRes.json().catch(() => ({}));
              if (vJson?.success && Array.isArray(vJson?.data?.vouchers)) {
                vouchersList = vJson.data.vouchers;
              }
            } catch (apiErr) {
              console.warn("[verify-payment] Voucher DataHub call error:", apiErr);
            }
          }

          // Fallback to DataMart Checker API if DataHub didn't return vouchers
          const dmApiKey = Deno.env.get("DATAMART_API_KEY") || "";
          if (vouchersList.length === 0 && dmApiKey) {
            try {
              const checkerType = vType.includes("BECE") ? "BECE" : "WAEC";
              const cleanRecipient = (vRecipient || "").replace(/\D/g, "");
              const formattedPhone = cleanRecipient.length === 9 ? `0${cleanRecipient}` : (cleanRecipient.startsWith("233") ? `0${cleanRecipient.slice(3)}` : cleanRecipient);
              
              console.log(`[verify-payment] Purchasing ${vQty} ${checkerType} voucher(s) via DataMart Checkers API...`);
              for (let i = 0; i < vQty; i++) {
                const dmRef = `v_${targetReference.slice(0, 12)}_${i}_${Date.now()}`;
                const dmRes = await fetch("https://api.datamartgh.shop/api/checkers/purchase", {
                  method: "POST",
                  headers: {
                    "X-API-Key": dmApiKey,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    checkerType,
                    phoneNumber: formattedPhone || "0240000000",
                    ref: dmRef,
                    skipSms: true
                  })
                });
                const dmJson = await dmRes.json().catch(() => ({}));
                if (dmJson?.status === "success" && dmJson?.data?.pin) {
                  vouchersList.push({
                    serial: dmJson.data.serialNumber || dmJson.data.serial || "WAEC-ONLINE",
                    pin: dmJson.data.pin,
                    type: `${checkerType} Results Checker`,
                    purchasedAt: new Date().toISOString()
                  });
                } else {
                  console.warn("[verify-payment] DataMart Checker response was not success:", dmJson?.message);
                }
              }
            } catch (dmErr) {
              console.warn("[verify-payment] DataMart Checker purchase exception:", dmErr);
            }
          }

          if (vouchersList.length === 0) {
            throw new Error("Unable to obtain voucher PINs from voucher providers. Please contact support or retry.");
          }

          await supabaseAdmin.from("orders").update({
            metadata: {
              ...(claimedOrder.metadata || {}),
              vouchers: vouchersList,
              voucher_count: vouchersList.length,
            },
            status: "fulfilled",
            failure_reason: null
          }).eq("id", targetReference);

          result = { ok: true, status: "fulfilled", id: targetReference };
        } catch (vErr: any) {
          console.error("[verify-payment] Voucher fulfillment error:", vErr);
          result = { ok: false, reason: vErr?.message || "Voucher provider error" };
        }
      } else {
        result = await callProviderApi(supabaseAdmin, provider, await buildDataPayload(provider), "purchase");
      }
      
      // Auto-fallback for AirtelTigo: If AT_PREMIUM fails with "Bundle not available", try AT_BIGTIME
      if (!result.ok && /bundle not available|invalid bundle/i.test(result.reason) && (network.toUpperCase().includes("AIRTEL") || network.toUpperCase() === "AT")) {
        const ht = String(provider.handler_type || "standard");
        if (ht === "datamart" || ht === "spendless" || ht === "datahub" || ht === "bossu") {
          console.log(`[verify-payment] Retrying ${provider.name} with AT_BIGTIME/AT for AirtelTigo bundle...`);
          // Datamart/Datahub use AT_BIGTIME. Bossu uses AT.
          const fallbackNetKey = (ht as string === "bossu" || ht as string === "standard") ? "AT" : "AT_BIGTIME";
          result = await callProviderApi(supabaseAdmin, provider, await buildDataPayload(provider, fallbackNetKey), "purchase");
        }
      }

      // Auto-failover: If Spendless rejects an order, immediately cascade to SKPlug (skdataplug)
      const isSpendless = (provider.handler_type || "").toLowerCase() === "spendless";
      if (!result.ok && isSpendless) {
        console.log(`[verify-payment] Order rejected by Spendless (${result.reason}). Attempting SKPlug API failover...`);
        const { data: skProvider } = await supabaseAdmin
          .from("providers")
          .select("*")
          .eq("handler_type", "skdataplug")
          .eq("is_active", true)
          .maybeSingle();

        if (skProvider && skProvider.id !== provider.id) {
          console.log(`[verify-payment] Cascading Spendless failed order for ${recipient} via ${skProvider.name} (SKPlug)...`);
          const skPayload = await buildDataPayload(skProvider);
          const skResult = await callProviderApi(supabaseAdmin, skProvider, skPayload, "purchase");
          if (skResult.ok) {
            result = skResult;
            successfulProviderId = skProvider.id;
            console.log(`[verify-payment] SKPlug failover SUCCESSFUL for ${recipient}! Provider Order ID: ${skResult.id}`);
          } else {
            console.error(`[verify-payment] SKPlug failover also rejected: ${skResult.reason}`);
          }
        }
      }

      // Auto-failover to Datamart/SKPlug for MTN orders rejected by DataHub (Beneficiary / Payee Limit / Unlisted number / Provider rejection)
      const isDataHub = (provider.handler_type || "").toLowerCase() === "datahub";
      const isMtn = network.toUpperCase().includes("MTN") || network.toUpperCase() === "YELLO";
      const isBeneficiaryOrLimitError = /beneficiary|payee|limit|not_allowed|not allowed|not added|whitelist|recipient/i.test(String(result.reason || ""));
      
      if (!result.ok && isMtn && (isDataHub || isBeneficiaryOrLimitError)) {
        console.log(`[verify-payment] MTN order rejected by ${provider.name} (${result.reason}). Attempting Datamart/SKPlug API failover...`);
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
        await supabaseAdmin.from("providers").update({ consecutive_failures: 0, disabled_reason: null }).eq("id", successfulProviderId);
        log(supabaseAdmin, { level: "info", source: "verify-payment", event: "provider.called", message: `Provider accepted order`, order_id: targetReference, provider_id: successfulProviderId, duration_ms: providerDuration, data: { provider_order_id: result.id, network, package_size: packageSize, recipient } });
        break; // success — stop trying
      } else {
        const isDuplicateErr = isDuplicateOrderError(result.reason);
        // Increment consecutive failures ONLY for technical server outages, NOT for unlisted beneficiary numbers or validation/duplicate errors
        isBeneficiaryErr = /beneficiary|payee|limit|not_allowed|not allowed|not added|whitelist|recipient/i.test(String(result.reason || "")) || isDuplicateErr;
        let newFailures = 0;

        const isDatamartProvider = (provider.handler_type || "").toLowerCase() === "datamart";
        if (!isBeneficiaryErr && !isDatamartProvider) {
          const { data: prov } = await supabaseAdmin.from("providers").select("consecutive_failures").eq("id", provider.id).maybeSingle();
          newFailures = ((prov as any)?.consecutive_failures || 0) + 1;
          // Increment consecutive failures for healthy priority sorting, but NEVER automatically disable the provider
          await supabaseAdmin.from("providers").update({
            consecutive_failures: newFailures,
          }).eq("id", provider.id);
        }

        await logProviderError(supabaseAdmin, provider.id, targetReference, result.reason);
        log(supabaseAdmin, { level: "error", source: "verify-payment", event: "provider.rejected", message: `${provider.name} rejected (${newFailures} failures): ${result.reason}`, order_id: targetReference, provider_id: provider.id, duration_ms: providerDuration, data: { provider: provider.name, reason: result.reason, consecutive_failures: newFailures } });

        // Duplicate Safety Guard: If rejection is due to carrier/aggregator deduplication, DO NOT cascade to other providers
        if (isDuplicateErr) {
          console.warn(`[verify-payment] Halting provider failover for order ${targetReference}: Duplicate order detected (${result.reason}). Entering 60-min auto-route cooldown.`);
          break;
        }
        
        const datamartFailoverEnabled = sysSettings?.auto_failover_non_beneficiary_to_datamart !== false;
        if (!autoApiSwitch && !datamartFailoverEnabled && !isBeneficiaryErr && (provider.handler_type || "") !== "spendless") {
          console.log(`[verify-payment] Auto API switch and non-beneficiary auto-route are disabled. Not failing over from ${provider.name}.`);
          break;
        }

        // Continue to next provider (failover)
        console.log(`[verify-payment] Failing over from ${provider.name} to next provider...`);
      }
    }

    if (result.ok) {
      const token = result.raw?.prepaid_token;
      const isSyncUtilityFulfill = currentOrderType === "utility" && token;
      const isDeliveredStatus = result.status && ["delivered", "success", "successful", "fulfilled", "completed", "sent"].includes(String(result.status).toLowerCase());
      
      const targetStatus = (isSyncUtilityFulfill || isDeliveredStatus) ? "fulfilled" : "processing";
      
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
      // Purchase failed - check if it is a transient duplicate cooldown error
      const reasonStr = (result.reason || "").toLowerCase();
      const isDuplicateError = isDuplicateOrderError(result.reason);

      if (isDuplicateError) {
        // Stop failing duplicate orders! Keep in processing with duplicate_cooldown to route after 60 mins
        const delayedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const updatedMetadata = {
          ...(claimedOrder.metadata || {}),
          duplicate_delayed: true,
          delayed_until: delayedUntil,
          last_duplicate_reason: result.reason || "Duplicate order detected",
        };
        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_order_id: "duplicate_cooldown",
          failure_reason: `Duplicate order detected. Delayed for auto-routing after 60 mins. (${result.reason || 'Duplicate'})`,
          last_retry_at: new Date().toISOString(),
          metadata: updatedMetadata
        }).eq("id", targetReference);

        log(supabaseAdmin, { 
          level: "warn", 
          source: "verify-payment", 
          event: "order.duplicate_cooldown", 
          message: `Order duplicate detected by provider. Held in processing for 60-minute auto-routing cooldown: ${result.reason}`, 
          order_id: targetReference, 
          agent_id: claimedOrder.agent_id, 
          data: { reason: result.reason, delayed_until: delayedUntil } 
        });

        return new Response(JSON.stringify({
          status: "processing",
          message: "Duplicate order detected. We have queued it to automatically route in 60 minutes.",
          provider_order_id: "duplicate_cooldown",
          delayed_until: delayedUntil
        }), { headers: corsHeaders });
      }

      // Check if it is a DataMart MashUp account enablement or lane closed error
      const isMashUpOrder = claimedOrder?.network === "MTN Mash Up" || (claimedOrder?.metadata?.category || "").toLowerCase() === "mashup";
      if (isMashUpOrder && (reasonStr.includes("mashup_not_enabled") || reasonStr.includes("not enabled") || reasonStr.includes("mashup_unavailable") || reasonStr.includes("lane closed"))) {
        const failureNote = reasonStr.includes("not enabled")
          ? `MashUp API not enabled on provider account. Queued for manual fulfillment. (${result.reason})`
          : `MashUp provider lane closed temporarily. Queued for manual fulfillment. (${result.reason})`;

        await supabaseAdmin.from("orders").update({
          status: "pending",
          provider_order_id: null,
          failure_reason: failureNote,
          updated_at: new Date().toISOString()
        }).eq("id", targetReference);

        log(supabaseAdmin, {
          level: "warn",
          source: "verify-payment",
          event: "order.mashup_manual_queue",
          message: failureNote,
          order_id: targetReference,
          agent_id: claimedOrder.agent_id,
          data: { reason: result.reason }
        });

        return new Response(JSON.stringify({
          status: "pending",
          message: failureNote
        }), { headers: corsHeaders });
      }

      // Check if it is a transient timeout/network error
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
      const isMtnData = (!network || network.toUpperCase().includes("MTN") || network.toUpperCase() === "YELLO") &&
                        (!currentOrderType || currentOrderType === "data" || currentOrderType === "sme") &&
                        (lastAttemptedProvider?.handler_type || "").toLowerCase() !== "korba" &&
                        claimedOrder?.metadata?.category !== "korba" &&
                        claimedOrder?.metadata?.is_korba !== true &&
                        claimedOrder?.metadata?.is_korba !== "true";

      const targetFailureReason = translateFailureReason(
        result.reason || "Provider rejected the request",
        network || claimedOrder?.network,
        currentOrderType || claimedOrder?.order_type,
        lastAttemptedProvider?.handler_type
      ) || result.reason || "Provider rejected the request";

      isBeneficiaryErr = isMtnData && /beneficiary|payee|daily.*limit|not_allowed|not allowed|not added|whitelist|jessco|eligibility/i.test(String(result.reason || ""));

      let guestRefundResult = null;
      if (isBeneficiaryErr && isGuestOrder(claimedOrder)) {
        console.log(`[verify-payment] Non-beneficiary failure on MTN guest order ${targetReference}. Queuing carrier whitelist submission & sending tracking SMS...`);
        guestRefundResult = await handleGuestBeneficiaryFailure(supabaseAdmin, claimedOrder, targetFailureReason);
      } else {
        await supabaseAdmin.from("orders").update({
          status: targetStatus,
          provider_order_id: targetProviderOrderId,
          failure_reason: targetFailureReason
        }).eq("id", targetReference);
      }

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
        message: targetFailureReason,
        is_beneficiary: isBeneficiaryErr,
        provider_order_id: targetProviderOrderId,
        order: {
          ...claimedOrder,
          status: targetStatus,
          failure_reason: targetFailureReason,
          network,
          package_size: packageSize,
          customer_phone: customerPhone,
        }
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
