import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchViaDb } from "../_shared/db_proxy.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};
import { getActiveProviders, logProviderError } from "../_shared/providers.ts";
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
  
  // Normal parsing with MB/GB detection
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (cleaned.includes("MB") && !cleaned.includes("GB")) {
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
    paystackSecretKey: settings?.paystack_secret_key || ""
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
async function resolveProvidersForOrder(supabaseAdmin: any, order: any): Promise<any[]> {
  let orderType = (order?.order_type || "data") as string;
  if (orderType.toLowerCase() === "api") {
    if (String(order?.package_size).toUpperCase() === "AIRTIME") {
      orderType = "airtime";
    } else {
      orderType = "data";
    }
  }
  const network = (order?.network || "") as string;
  const isKorbaNetwork = network && String(network).toUpperCase().startsWith("KORBA");
  
  if (isKorbaNetwork) {
    const { data: korbaProvider } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("name", "Korba")
      .maybeSingle();
    if (korbaProvider) {
      console.log(`[verify-payment] Resolved Korba provider for order ${order.id}`);
      return [korbaProvider];
    } else {
      console.warn(`[verify-payment] Korba provider not found in DB. Falling back to active data providers.`);
    }
  }
  
  if (orderType.toLowerCase() === "afa") {
    const { data: spendless } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "spendless")
      .maybeSingle();
    if (spendless) {
      console.log(`[verify-payment] Resolved Spendless provider for AFA order ${order.id}`);
      return [spendless];
    } else {
      console.warn(`[verify-payment] Spendless provider not found in DB for AFA. Falling back to active data providers.`);
    }
  }
  
  const providerCategory = orderType === "airtime" ? "airtime" : (orderType === "utility" ? "utility" : "data");
  return await getActiveProviders(supabaseAdmin, providerCategory);
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

    const { reference, phone, force } = body;

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

    if (!reference && !phone) {
      return new Response(JSON.stringify({ error: "Order reference or phone number is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetReference = reference;

    // Resolve custom API references (non-UUID or custom)
    if (reference) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
      if (isUuid) {
        // Try direct ID lookup first
        const { data: orderById } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("id", reference)
          .maybeSingle();
        if (orderById) {
          targetReference = orderById.id;
        } else {
          // Fallback to client_reference search if not found by direct ID
          const { data: orderByClientRef } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("metadata->>client_reference", reference)
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
          .eq("metadata->>client_reference", reference)
          .maybeSingle();
        if (orderByClientRef) {
          targetReference = orderByClientRef.id;
        } else {
          return new Response(JSON.stringify({ error: "Order not found with reference: " + reference }), {
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
        message: "Already processed",
        provider_order_id: existingOrder?.provider_order_id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    const isProviderOrder = !["agent_activation", "sub_agent_activation", "wallet_topup", "free_data_claim", "utility"].includes(orderType.toLowerCase());

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
          if (isFailed) {
            // User requested fix: Never yield into failed states. Retain processing queue so backend cron attempts to recover it.
            await supabaseAdmin.from("orders").update({ status: "processing", failure_reason: "Provider reported failure during status check" }).eq("id", targetReference);
            break; 
          } else {
            // User fix: Assume ALL recognized provider orders are fulfilled, destroying execution traps
            await supabaseAdmin.from("orders").update({ status: "fulfilled", provider_id: provider.id }).eq("id", targetReference);
            await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
            return new Response(JSON.stringify({ status: "fulfilled", provider_order_id: existingOrder.provider_order_id }), { headers: corsHeaders });
          }
        }
      }
    }

    // --- 1.2. AGE CHECK FALLBACK ---
    if (existingOrder && existingOrder.status === "processing" && !force) {
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
    // Optimization: Skip checking provider status for freshly paid/pending orders if they haven't been submitted yet (no provider_order_id).
    // This avoids slow and redundant API status check calls to providers, saving 1-3 seconds.
    if ((existingOrder?.status === "pending" || existingOrder?.status === "paid" || existingOrder?.status === "fulfillment_failed") && isProviderOrder && existingOrder?.provider_order_id) {
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
            await supabaseAdmin.from("orders").update({ 
              status: "fulfilled", 
              provider_id: provider.id,
              provider_order_id: checkResult.id || existingOrder.provider_order_id || null,
              failure_reason: null
            }).eq("id", targetReference);
            await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
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
          const failMsg = statusData.message || "Payment failed";
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: failMsg
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "error", error: failMsg }), { headers: corsHeaders });
        } else {
          console.log(`[verify-payment] Korba status is not success: ${korbaStatus}`);
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
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: "Customer abandoned transaction"
          }).eq("id", targetReference);
          return new Response(JSON.stringify({ status: "not_paid", error: "The customer abandoned the transaction." }), { headers: corsHeaders });
        } else if (txStatus === "ongoing") {
          console.log(`[verify-payment] Payment ongoing: user action needed (OTP/transfer)`);
          return new Response(JSON.stringify({ status: "pending", message: "Awaiting customer action (OTP / Transfer) to complete payment." }), { headers: corsHeaders });
        } else if (txStatus === "pending" || txStatus === "processing" || txStatus === "queued") {
          console.log(`[verify-payment] Payment in progress (${txStatus})`);
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
    const allowedStatuses = ["pending", "paid", "fulfillment_failed", "awaiting_payment"];

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
        if (claimedOrder.order_type === "api") {
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

    // Standard Data/Airtime/Utility/AFA Fulfillment
    const activeProviders = await resolveProvidersForOrder(supabaseAdmin, claimedOrder);

    // --- SIBLING DUPLICATE PROTECTION ---
    // Look for any identical order submitted in the last 60 minutes for the same phone, network, package, and amount.
    // We check if any sibling order was already successfully processed or is currently processing.
    if (isProviderOrder && customerPhone && network && packageSize) {
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
          
          // Case 2: Sibling is active in our DB (processing, pending, paid)
          if (sibling.status === "processing" || sibling.status === "pending" || sibling.status === "paid") {
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

    const { data: sysSettings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("auto_api_switch").eq("id", 1).maybeSingle();
    const autoApiSwitch = sysSettings?.auto_api_switch !== false;

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
      amount: claimedOrder.amount,
      order_type: effectiveOrderType,
      orderReference: targetReference,
      reference: targetReference,      // Alias
    };

    let result: any = { ok: false, reason: "No providers" };
    let successfulProviderId = null;

    const buildDataPayload = (provider: any, overrideNetKey?: string) => {
      const ht = provider.handler_type || "standard";
      const defaultNetKey = mapDataNetworkKey(network);
      
      const netKey = overrideNetKey || defaultNetKey;
      if (ht === "datamart") return { phoneNumber: recipient, network: netKey, planId: packageSize, plan: packageSize, bundle: packageSize, capacity: String(parseCapacity(packageSize)), orderReference: targetReference, gateway: "wallet", reference: targetReference };
      if (ht === "datahub" || ht === "spendless") return { networkKey: netKey, recipient, capacity: String(parseCapacity(packageSize)), reference: targetReference };
      if (ht === "qhowmenzconsult") {
        return {
          networkRaw: network,
          networkKey: netKey,
          recipient,
          package_size: packageSize,
          plan: packageSize,
          amount: claimedOrder.amount,
          reference: targetReference,
          order_id: targetReference,
        };
      }
      if (ht === "skdataplug") {
        return {
          networkRaw: network,
          networkKey: netKey,
          recipient,
          package_size: packageSize,
          plan: packageSize,
          amount: claimedOrder.amount,
          reference: targetReference,
          order_id: targetReference,
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
            amount: claimedOrder.amount,
            reference: targetReference,
            networkKey: "AFA",
            capacity: "BUNDLE",
          },
          "afa-registration"
        );
      } else {
        result = await callProviderApi(supabaseAdmin, provider, buildDataPayload(provider), "purchase");
      }
      
      // Auto-fallback for AirtelTigo: If AT_PREMIUM fails with "Bundle not available", try AT_BIGTIME
      if (!result.ok && /bundle not available|invalid bundle/i.test(result.reason) && (network.toUpperCase().includes("AIRTEL") || network.toUpperCase() === "AT")) {
        const ht = provider.handler_type || "standard";
        if (ht === "datamart" || ht === "spendless" || ht === "datahub" || ht === "bossu") {
          console.log(`[verify-payment] Retrying ${provider.name} with AT_BIGTIME/AT for AirtelTigo bundle...`);
          // Datamart/Datahub use AT_BIGTIME. Bossu uses AT.
          const fallbackNetKey = (ht === "bossu" || ht === "standard") ? "AT" : "AT_BIGTIME";
          result = await callProviderApi(supabaseAdmin, provider, buildDataPayload(provider, fallbackNetKey), "purchase");
        }
      }

      const providerDuration = Date.now() - providerCallStart;

      if (result.ok) {
        successfulProviderId = provider.id;
        // Reset consecutive failures on success
        supabaseAdmin.from("providers").update({ consecutive_failures: 0 }).eq("id", provider.id);
        log(supabaseAdmin, { level: "info", source: "verify-payment", event: "provider.called", message: `${provider.name} accepted order`, order_id: targetReference, provider_id: provider.id, duration_ms: providerDuration, data: { provider: provider.name, handler_type: provider.handler_type, provider_order_id: result.id, network, package_size: packageSize, recipient } });
        break; // success — stop trying
      } else {
        // Increment consecutive failures
        const { data: prov } = await supabaseAdmin.from("providers").select("consecutive_failures").eq("id", provider.id).maybeSingle();
        const newFailures = ((prov as any)?.consecutive_failures || 0) + 1;
        const autoDisable = newFailures >= 5 && autoApiSwitch;
        await supabaseAdmin.from("providers").update({
          consecutive_failures: newFailures,
          ...(autoDisable ? { is_active: false, disabled_reason: `Auto-disabled after ${newFailures} consecutive failures` } : {}),
        }).eq("id", provider.id);

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
        
        if (!autoApiSwitch) {
          console.log(`[verify-payment] Auto API switch is disabled. Not failing over from ${provider.name}.`);
          break;
        }

        // Continue to next provider (failover)
        console.log(`[verify-payment] Failing over from ${provider.name} to next provider...`);
      }
    }

    if (result.ok) {
      // successful API pushes remain at 'processing' state to be auto-delivered after delay
      const targetStatus = "processing";
      const patch: any = { provider_id: successfulProviderId, provider_order_id: result.id, status: targetStatus, failure_reason: null };
      await supabaseAdmin.from("orders").update(patch).eq("id", targetReference);

      if (targetStatus === "fulfilled") {
        try {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
          
          // Trigger Push Notification for Agent
          if (claimedOrder.agent_id && claimedOrder.agent_id !== '00000000-0000-0000-0000-000000000000') {
            const profit = Number(claimedOrder.profit || 0).toFixed(2);
            await triggerPushNotification(supabaseAdmin, {
              user_id: claimedOrder.agent_id,
              title: "🎉 New payment for Data selling",
              body: `You just received GHS ${profit} from your recent data sale.`,
              url: "/dashboard/orders",
              icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
            });
          }
        } catch (e) {
          console.error("[verify-payment] Profit credit or notification failed:", e);
        }
      }
      log(supabaseAdmin, { level: "info", source: "verify-payment", event: "order.processing", message: `Order successfully bought - set as processing — provider_order_id: ${result.id}`, order_id: targetReference, agent_id: claimedOrder.agent_id, provider_id: successfulProviderId, data: { provider_order_id: result.id, network, package_size: packageSize, amount: claimedOrder.amount } });
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
      const targetStatus = "processing";
      const targetProviderOrderId = "failed_api_call";
      const targetFailureReason = result.reason || "Provider rejected the request";

      await supabaseAdmin.from("orders").update({
        status: targetStatus,
        provider_order_id: targetProviderOrderId,
        failure_reason: targetFailureReason
      }).eq("id", targetReference);

      log(supabaseAdmin, { 
        level: isApiOrder ? "warn" : "error", 
        source: "verify-payment", 
        event: isApiOrder ? "order.processing_failed_api" : "order.failed", 
        message: isApiOrder 
          ? `Order provider call rejected. Sticking to processing: ${targetFailureReason}` 
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
