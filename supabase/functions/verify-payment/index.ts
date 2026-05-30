import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};
import { getActiveProviders, logProviderError } from "../_shared/providers.ts";
import { log } from "../_shared/logger.ts";

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
  const match = packageSize.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
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

function buildProviderUrls(baseUrl: string | null | undefined, endpoint: string = "purchase", handlerType?: string): string[] {
  const clean = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return [];

  const urls = new Set<string>();
  
  if (handlerType === "bossu" || handlerType === "superbdatafy") {
    return [clean];
  }

  let aliases: string[] = [];
  const isDatamart = handlerType === "datamart" || clean.includes("/api/developer") || clean.includes("datamartgh");

  if (isDatamart) {
    if (endpoint === "status") aliases = ["order-status"];
    else if (endpoint === "purchase") aliases = ["purchase"];
    else aliases = [endpoint];
    
    for (const alias of aliases) {
      urls.add(`${clean}/${alias}`);
    }
    return Array.from(urls);
  }

  if (handlerType === "datahub") {
    // DataHub has a fixed URL structure — always just append the alias directly
    const alias = endpoint === "purchase" ? "data-purchase" : (endpoint === "status" ? "order-status" : endpoint);
    return [`${clean}/${alias}`];
  } else if (handlerType === "spendless") {
    const alias = endpoint === "purchase" ? "purchase" : (endpoint === "status" ? "order-status" : endpoint);
    return [`${clean}/${alias}`];
  } else if (handlerType === "justbuy") {
    return [`${clean}`]; // We will append the correct path dynamically in callProviderApi
  }

  aliases = endpoint === "purchase"
    ? ["purchase", "order", "airtime", "buy", "topup", "recharge"]
    : (endpoint === "status" ? ["status", "query", "check", "query-order"] : [endpoint]);

  let rootUrl = "";
  try {
    rootUrl = new URL(clean).origin;
  } catch { /* ignore */ }

  // If the configured URL already ends with an alias, use it directly
  for (const alias of aliases) {
    if (clean.endsWith(`/${alias}`) || clean.endsWith(`/api/${alias}`)) {
      urls.add(clean);
    }
  }

  // Build /api/<alias> and /<alias> variants from the configured base
  for (const alias of aliases) {
    if (clean.endsWith("/api")) {
      urls.add(`${clean}/${alias}`);
      urls.add(`${clean.replace(/\/api$/, "")}/api/${alias}`);
    } else {
      urls.add(`${clean}/api/${alias}`);
      urls.add(`${clean}/${alias}`);
    }
  }

  // Also try from the root origin in case the base URL has an extra path segment
  if (rootUrl) {
    for (const alias of aliases) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
      urls.add(`${rootUrl}/functions/v1/developer-api/${alias}`);
    }
  }

  return Array.from(urls);
}

function mapFulfillmentStatus(providerStatus: string | null | undefined): "fulfilled" | "processing" | "fulfillment_failed" {
  const s = String(providerStatus || "").trim().toLowerCase();
  if (s === "fulfilled" || s === "delivered" || s === "successful" || s === "success" || s === "completed" || s === "true" || s === "1") {
    return "fulfilled";
  }
  if (s === "failed" || s === "failure" || s === "error" || s === "cancelled" || s === "rejected") {
    return "fulfillment_failed";
  }
  return "processing";
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>"),
  );
}

function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string; id?: string; status?: string } {
  try {
    const parsed = JSON.parse(body);
    const technicalStatus = String(parsed?.status ?? parsed?.success ?? "").toLowerCase();
    const data = parsed?.data || {};
    const deliveryStatus = String(parsed?.transaction?.status ?? data?.status ?? data?.orderStatus ?? parsed?.delivery_status ?? parsed?.status_message ?? "").toLowerCase();
    const effectiveStatus = deliveryStatus || technicalStatus;
    const message = typeof parsed?.message === "string" ? parsed.message : undefined;
    
    // DataMart uses purchaseId or orderReference
    const orderId = String(parsed?.transaction?.reference ?? data?.orderNumber ?? data?.reference ?? data?.purchaseId ?? data?.orderReference ?? parsed?.transaction_id ?? parsed?.order_id ?? parsed?.id ?? parsed?.reference ?? "");

    const ok = technicalStatus === "success" || technicalStatus === "true" || technicalStatus === "1" || technicalStatus === "completed" || technicalStatus === "pending" || parsed?.success === true || parsed?.ok === true;

    if (ok) {
      return { ok: true, id: orderId, status: effectiveStatus };
    }
    
    const isFailed = technicalStatus === "false" || technicalStatus === "error" || technicalStatus === "failed" || technicalStatus === "failure";
    if (isFailed) {
      return { ok: false, reason: message || "Provider rejected this order." };
    }

    const statusCode = Number(parsed?.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 400) {
      return { ok: false, reason: message || "Provider rejected this order." };
    }
    
    // If it has an ID, it's likely a successful initiation
    if (orderId && orderId !== "undefined" && orderId !== "") return { ok: true, id: orderId, status: effectiveStatus };

  } catch { /* non-JSON */ }

  if (isHtmlResponse(contentType, body)) {
    return { ok: false, reason: "Provider returned an HTML response. Check API URL configuration." };
  }

  return { ok: true };
}

async function callProviderApi(
  provider: any,
  data: Record<string, unknown>,
  endpoint: string = "purchase"
): Promise<{ ok: boolean; reason: string; id?: string; status?: string }> {
  const handlerType = provider.handler_type || "standard";
  const baseUrl = provider.base_url;
  const apiKey = provider.api_key;
  
  let payload = { ...data };
  if (handlerType === "superbdatafy") {
    if (endpoint !== "status") {
      const network = String(data.networkRaw || data.network || "").toLowerCase();
      let sbNetwork = network;
      if (network === "yello") sbNetwork = "mtn";
      if (network === "vod" || network === "vodafone") sbNetwork = "telecel";
      if (network === "airteltigo" || network === "at_premium") sbNetwork = "at";
      
      const pkgSize = String(data.package_size || data.plan || data.package_key || "").replace(/\s+/g, "").toLowerCase();
      const phone = String(data.recipient || data.phoneNumber || data.recipient_phone || "");

      try {
        const bundleRes = await fetch(`${baseUrl}/bundles?network=${sbNetwork}`, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
        });
        if (bundleRes.ok) {
           const bData = await bundleRes.json();
           const bundles = bData?.bundles || [];
           const match = bundles.find((b: any) => String(b.capacity).replace(/\s+/g, "").toLowerCase() === pkgSize);
           if (match) {
             payload = { bundle_id: match.id, phone_number: phone };
           } else {
             return { ok: false, reason: `SuperbDatafy: Bundle ${pkgSize} not found for ${sbNetwork}` };
           }
        } else {
           return { ok: false, reason: `SuperbDatafy: Failed to fetch bundles (HTTP ${bundleRes.status})` };
        }
      } catch (e: any) {
         return { ok: false, reason: `SuperbDatafy: Network error fetching bundles - ${e.message}` };
      }
    }
  } else if (handlerType === "datahub" && endpoint === "status") {
    payload = {
      reference: String(data.reference || data.transaction_id || data.order_id || ""),
    };
  }

  const urls = buildProviderUrls(baseUrl, endpoint, handlerType);
  let lastReason = "Provider error";

  for (let url of urls) {
    if (handlerType === "datamart" && endpoint === "status") {
      const ref = String(data.transaction_id || data.reference || "");
      url = `${url}/${ref}`;
    } else if (handlerType === "superbdatafy") {
      if (endpoint === "status") {
         const ref = String(data.transaction_id || data.reference || data.order_id || "");
         url = `${url}/transaction/${ref}`;
      } else {
         url = `${url}/buy-data`;
      }
    } else if (handlerType === "justbuy") {
       if (data.order_type === "airtime") {
          url = `${url}/payment/airtime`;
       } else if (data.order_type === "utility") {
          if (data.utility_provider === "ECG") url = `${url}/api/payment/ecg`;
          else url = `${url}/api/payment/bills`;
       } else {
          url = `${url}/payment/data`;
       }
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
        };

        headers["X-API-Key"] = apiKey;
        // Global idempotency key to prevent double charging on provider retries
        const idempotencyKey = String(data.orderReference || data.reference || data.order_id || "");
        if (idempotencyKey) {
          headers["X-Idempotency-Key"] = idempotencyKey;
        }

        if (handlerType !== "datamart" && handlerType !== "spendless") {
          headers["Authorization"] = `Bearer ${apiKey}`;
          headers["User-Agent"] = "SwiftDataGH/2.0";
        }

        const isGet = (handlerType === "datamart" && endpoint === "status") || (handlerType === "superbdatafy" && endpoint === "status");

        const res = await fetch(url, {
          method: isGet ? "GET" : "POST",
          headers,
          body: isGet ? undefined : JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const contentType = res.headers.get("content-type");
        const text = await res.text();

        if (res.ok) {
          const semantic = parseProviderResponse(text, contentType);
          if (semantic.ok) return { ok: true, reason: "", id: semantic.id, status: semantic.status };
          return { ok: false, reason: semantic.reason || "Provider rejected this order." };
        }

        let parsedMsg = "";
        try { parsedMsg = JSON.parse(text)?.message || JSON.parse(text)?.error || ""; } catch { /* ignore */ }
        lastReason = parsedMsg || `Provider returned ${res.status}`;

        const isAlreadyPlaced = /already placed/i.test(lastReason) || /currently being processed/i.test(lastReason);
        if (isAlreadyPlaced) {
          return { ok: true, reason: "", status: "processing" };
        }

        if (res.status === 401 || res.status === 403) return { ok: false, reason: lastReason };
        if (res.status === 404 || isHtmlResponse(contentType, text)) break;

        if (res.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        break;
      } catch (e: any) {
        lastReason = e?.message || "Network error";
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  return { ok: false, reason: lastReason };
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

    const { reference, phone } = body;

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

    // UUID validation (Only if it's the raw reference from user)
    // We only validate if targetReference was passed as 'reference' in the request
    if (reference && targetReference === reference) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetReference);
      if (!isUuid) {
         return new Response(JSON.stringify({ error: "Invalid reference format" }), {
           status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
         });
      }
    }

    // 1. Check if already processed
    const { data: existingOrder } = await supabaseAdmin
      .from("orders").select("*").eq("id", targetReference).maybeSingle();

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
    const orderType = (existingOrder?.order_type || "data") as string;
    const isQueuedError = /queued/i.test(String(existingOrder?.failure_reason || ""));
    const isProviderOrder = !["agent_activation", "sub_agent_activation", "wallet_topup", "free_data_claim", "utility"].includes(orderType.toLowerCase());

    // --- 1. STATUS CHECK (For orders already being processed) ---
    // Skip for non-data/airtime order types — they don't involve a data provider.
    if (existingOrder?.status === "processing" && !isQueuedError && isProviderOrder) {
      const providers = await getActiveProviders(supabaseAdmin, orderType === "airtime" ? "airtime" : "data");
      let foundOnProvider = false;
      for (const provider of providers) {
        console.log(`[verify-payment] Checking status for ${targetReference} at ${provider.name}`);
        const checkResult = await callProviderApi(provider, {
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
    if (existingOrder && existingOrder.status === "processing") {
      const isQueuedError = /queued/i.test(String(existingOrder.failure_reason || ""));
      const orderCreatedAt = new Date(existingOrder.created_at).getTime();
      const ageInMinutes = (Date.now() - orderCreatedAt) / 60000;

      // If the order already has a provider_order_id, it was submitted to the provider
      // and we must wait for the webhook callback — never re-submit.
      if (existingOrder.provider_order_id) {
        console.log(`[verify-payment] Order ${targetReference} already submitted to provider (${existingOrder.provider_order_id}). Waiting for webhook.`);
        return new Response(JSON.stringify({ status: "processing", message: "Waiting for provider webhook" }), { headers: corsHeaders });
      }

      if (isQueuedError || ageInMinutes > 20) {
        console.log(`[verify-payment] Order ${targetReference} stuck for ${ageInMinutes.toFixed(1)} mins with no provider ID. Re-submitting.`);
        // Fall through to re-submit to the provider
      } else {
        // Normal processing lock: wait for webhook
        return new Response(JSON.stringify({ status: "processing", message: "Still processing on provider" }), { headers: corsHeaders });
      }
    }

    // --- 1.5. PRE-VERIFICATION PROVIDER CHECK ---
    // If the order is pending, check if DataMart/Admin already has it
    // (handles race conditions or manual bypasses)
    // Skip for non-data/airtime order types — they don't involve a data provider
    if (existingOrder?.status === "pending" && isProviderOrder) {
      const providers = await getActiveProviders(supabaseAdmin, orderType === "airtime" ? "airtime" : "data");
      for (const provider of providers) {
        const checkResult = await callProviderApi(provider, { 
          transaction_id: targetReference,
          reference: targetReference, 
          order_id: targetReference 
        }, "status");
        
        if (checkResult.ok) {
          const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "successful" || checkResult.status === "fulfilled" || checkResult.status === "completed" || checkResult.status === "sent";
          if (isDelivered) {
            console.log(`[verify-payment] Found fulfilled order ${targetReference} at ${provider.name} during pre-check.`);
            await supabaseAdmin.from("orders").update({ status: "fulfilled", provider_id: provider.id }).eq("id", targetReference);
            await supabaseAdmin.rpc("credit_order_profits", { p_order_id: targetReference });
            return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
          }
        }
      }
    }

    // --- 2. PAYMENT VERIFICATION ---
    let verifiedAmount = 0;
    let paystackFeeOnVerified = 0;
    let currentOrderType = (existingOrder?.order_type || "data") as string;
    let metadata = existingOrder?.metadata || {};

    const status = (existingOrder?.status || "").toLowerCase();
    const paymentMethod = (existingOrder?.payment_method || "").toLowerCase();

    const isInternalPayment = 
      ["wallet", "promo", "balance", "api"].includes(paymentMethod) || 
      (["paid", "processing", "fulfilled", "fulfillment_failed", "completed", "failed"].includes(status) && status !== "pending") ||
      (orderType.toLowerCase() === "data" && !paymentMethod && ["processing", "fulfillment_failed"].includes(status));

    // Special validation for free data claims to prevent spamming
    if (orderType.toLowerCase() === "free_data_claim") {
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("free_data_enabled, free_data_max_claims, free_data_claims_count")
        .eq("id", 1)
        .maybeSingle();

      if (!settings?.free_data_enabled) {
        return new Response(JSON.stringify({ status: "fulfillment_failed", error: "Free data campaign is not active" }), { status: 200, headers: corsHeaders });
      }

      if ((settings.free_data_claims_count || 0) >= (settings.free_data_max_claims || 0)) {
        return new Response(JSON.stringify({ status: "fulfillment_failed", error: "Free data claim limit reached" }), { status: 200, headers: corsHeaders });
      }

      // Check if this specific agent already has a fulfilled claim (excluding the current order if we are retrying it)
      if (existingOrder?.agent_id) {
        const { count: agentClaimCount } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", existingOrder.agent_id)
          .eq("order_type", "free_data_claim")
          .eq("status", "fulfilled")
          .neq("id", targetReference); // Exclude current order
        
        if ((agentClaimCount || 0) > 0) {
          console.warn(`[SECURITY] Blocked duplicate free data claim for agent ${existingOrder.agent_id}.`);
          return new Response(JSON.stringify({ status: "fulfillment_failed", error: "You have already claimed your free data" }), { status: 200, headers: corsHeaders });
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
          return new Response(JSON.stringify({ status: "fulfillment_failed", error: "This phone number has already received free data" }), { status: 200, headers: corsHeaders });
        }
      }
    }

    if (isInternalPayment || orderType.toLowerCase() === "free_data_claim") {
      console.log(`[verify-payment] Internal/Free payment confirmed for ${targetReference}`);
      verifiedAmount = Number(existingOrder?.amount || 0);
    } else {
      const PAYSTACK_SECRET_KEY = getFirstEnv("PAYSTACK_SECRET_KEY") || paystackSecretKey;
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
    
    // Attempt to claim the order for processing
    const { data: claimedOrder, error: claimError } = await supabaseAdmin
      .from("orders")
      .update({ 
        status: "processing", 
        paystack_verified_amount: verifiedAmount,
        paystack_fee: paystackFeeOnVerified,
        updated_at: new Date().toISOString()
      })
      .eq("id", targetReference)
      .in("status", ["pending", "paid", "fulfillment_failed", "processing"])
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


    // Standard Data/Airtime/Utility Fulfillment
    let providerCategory = "data";
    if (currentOrderType === "airtime") providerCategory = "airtime";
    else if (currentOrderType === "utility") providerCategory = "utility";
    
    const activeProviders = await getActiveProviders(supabaseAdmin, providerCategory);
    const { data: sysSettings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("auto_api_switch").eq("id", 1).maybeSingle();
    const autoApiSwitch = sysSettings?.auto_api_switch !== false;

    const network = claimedOrder.network || metadata?.network || "";
    const customerPhone = claimedOrder.customer_phone || metadata?.customer_phone || "";
    const packageSize = claimedOrder.package_size || metadata?.package_size || "";
    const recipient = normalizeRecipient(customerPhone);

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
      order_type: currentOrderType,
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
      if (ht === "justbuy") {
        if (currentOrderType === "utility") {
           if (metadata?.utility_provider === "ECG") {
              return { phoneNumber: recipient, accountNumber: metadata?.utility_account_number || recipient, amount: claimedOrder.amount, order_type: "utility", utility_provider: "ECG" };
           } else {
              return { customerNumber: metadata?.utility_account_number || recipient, billType: metadata?.utility_provider, amount: claimedOrder.amount, senderName: metadata?.utility_account_name || "CUSTOMER", order_type: "utility" };
           }
        }
        return { network: netKey, phone: recipient, amount: claimedOrder.amount, package_size: packageSize, request_id: targetReference, order_type: currentOrderType };
      }
      
      // Pass override network to standard request body if provided
      if (overrideNetKey) return { ...requestBody, networkKey: overrideNetKey };
      return requestBody;
    };

    // Auto-failover: try each active provider in priority order
    for (const provider of activeProviders) {
      const providerCallStart = Date.now();
      result = await callProviderApi(provider, buildDataPayload(provider), "purchase");
      
      // Auto-fallback for AirtelTigo: If AT_PREMIUM fails with "Bundle not available", try AT_BIGTIME
      if (!result.ok && /bundle not available|invalid bundle/i.test(result.reason) && (network.toUpperCase().includes("AIRTEL") || network.toUpperCase() === "AT")) {
        const ht = provider.handler_type || "standard";
        if (ht === "datamart" || ht === "spendless" || ht === "datahub" || ht === "bossu") {
          console.log(`[verify-payment] Retrying ${provider.name} with AT_BIGTIME/AT for AirtelTigo bundle...`);
          // Datamart/Datahub use AT_BIGTIME. Bossu uses AT.
          const fallbackNetKey = (ht === "bossu" || ht === "standard") ? "AT" : "AT_BIGTIME";
          result = await callProviderApi(provider, buildDataPayload(provider, fallbackNetKey), "purchase");
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
      // User requested fix: Treat ALL successful API pushes as fulfilled immediately to bypass unreliable status checks
      const targetStatus = "fulfilled";
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
      log(supabaseAdmin, { level: "info", source: "verify-payment", event: "order.fulfilled", message: `Order fulfilled — provider_order_id: ${result.id}`, order_id: targetReference, agent_id: claimedOrder.agent_id, provider_id: successfulProviderId, data: { provider_order_id: result.id, network, package_size: packageSize, amount: claimedOrder.amount } });
      return new Response(JSON.stringify({ status: targetStatus, provider_order_id: result.id }), { headers: corsHeaders });
    } else {
      // User requested fix: Automatically queue up failed API connections for retry processing loop
      await supabaseAdmin.from("orders").update({
        status: "processing",
        failure_reason: result.reason || "Provider connection refused"
      }).eq("id", targetReference);

      log(supabaseAdmin, { level: "warn", source: "verify-payment", event: "order.queued", message: `Order queued for retry: ${result.reason}`, order_id: targetReference, agent_id: claimedOrder.agent_id, data: { reason: result.reason, network, package_size: packageSize } });
      return new Response(JSON.stringify({
        status: "processing",
        reason: result.reason || "Queued for processing recovery"
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
