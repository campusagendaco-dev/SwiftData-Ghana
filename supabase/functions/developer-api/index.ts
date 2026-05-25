import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, sendSmsViaTxtConnect, getSmsConfig } from "../_shared/sms.ts";
import { getActiveProviders, logProviderError } from "../_shared/providers.ts";
import { notifyWalletCredit } from "../_shared/webhooks.ts";


declare const Deno: any;

function getEnv(...keys: string[]): string {
  for (const k of keys) { const v = (Deno as any).env.get(k)?.trim(); if (v) return v; }
  return "";
}

function mapNetworkKey(network: string): string {
  const n = network.trim().toUpperCase();
  if (n === "MTN" || n === "YELLO" || n === "MTN_XPRESS") return "YELLO";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "TELECEL";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AT_PREMIUM";
  if (n === "GLO") return "GLO";
  return n;
}

function parseCapacity(pkg: string): number {
  const m = pkg.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function normalizeRecipient(phone: string): string {
  const d = phone.replace(/\D+/g, "");
  if (d.startsWith("233") && d.length === 12) return `0${d.slice(3)}`;
  if (d.length === 9) return `0${d}`;
  if (d.length === 10 && d.startsWith("0")) return d;
  return phone.trim();
}

function isHtmlBody(ct: string | null, body: string): boolean {
  const p = body.trim().slice(0, 200).toLowerCase();
  return Boolean(ct?.includes("text/html") || p.startsWith("<!doctype") || p.startsWith("<html"));
}

function buildProviderUrls(baseUrl: string, endpoint: string = "purchase", handlerType?: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];

  const urls = new Set<string>();
  
  if (handlerType === "bossu") {
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

async function callProviderApi(
  provider: any,
  data: Record<string, unknown>,
  endpoint: string = "purchase"
): Promise<{ ok: boolean; reason: string; id?: string; body: string; status?: string }> {
  const handlerType = provider.handler_type || "standard";
  let payload = { ...data };
  if (handlerType === "bossu") {
    if (endpoint === "status") {
      payload = {
        action: "order_status",
        order_id: String(data.transaction_id || data.reference || data.order_id || ""),
        api_key: provider.api_key,
      };
    } else {
      payload = {
        action: "create_order",
        network: String(data.networkRaw || data.network || "").toLowerCase(),
        package_key: String(data.package_size || data.plan || data.package_key || "").replace(/\s+/g, "").toLowerCase(),
        recipient_phone: String(data.recipient || data.phoneNumber || data.recipient_phone || ""),
        external_reference: String(data.orderReference || data.reference || ""),
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/bossu-webhook`,
        api_key: provider.api_key,
      };
    }
  } else if (handlerType === "datahub" && endpoint === "status") {
    payload = {
      reference: String(data.reference || data.transaction_id || data.order_id || ""),
    };
  }

  const urls = buildProviderUrls(provider.base_url, endpoint, handlerType);
  let lastBody = "";
  let lastReason = "Provider error";

  for (const url of urls) {
    let attempt = 0;
    const maxAttempts = 3; // 1 initial attempt + 2 retries

    while (attempt < maxAttempts) {
      attempt++;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 25000);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
        headers["X-API-Key"] = provider.api_key;
        if (handlerType !== "datamart") headers["Authorization"] = `Bearer ${provider.api_key}`;
        headers["X-Idempotency-Key"] = String(data.orderReference || data.reference || "");
        headers["User-Agent"] = "SwiftDataGH/2.0";

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        const ct = res.headers.get("content-type");
        const text = await res.text();
        lastBody = text;

        let parsedMsg = "";
        try { parsedMsg = JSON.parse(text)?.message || JSON.parse(text)?.error || ""; } catch { /* ignore */ }
        
        const isAlreadyPlaced = /already placed/i.test(parsedMsg) || /currently being processed/i.test(parsedMsg);
        if (isAlreadyPlaced) {
          return { ok: true, reason: "", body: lastBody, status: "processing" };
        }

        if (res.ok && !isHtmlBody(ct, text)) {
          try {
            const p = JSON.parse(text);
            const s = String(p?.status ?? p?.success ?? "").toLowerCase();
            const ok = p?.success === true || s === "success" || s === "true" || p?.status === true || s === "completed" || s === "pending";
            const pStatus = String(p?.data?.status ?? p?.delivery_status ?? p?.status ?? "");
            if (ok) return { ok: true, reason: "", body: lastBody, id: String(p?.data?.orderNumber ?? p?.data?.reference ?? p?.data?.purchaseId ?? p?.transaction_id ?? p?.id ?? p?.order_id ?? ""), status: pStatus };
            lastReason = parsedMsg || "Provider rejected the order";
          } catch { return { ok: true, reason: "", body: lastBody, status: "" }; }
        } else {
          lastReason = parsedMsg || `HTTP ${res.status}`;
        }

        // Retry ONLY for server errors (5xx)
        if (res.status >= 500 && attempt < maxAttempts) {
          console.warn(`[developer-api] Provider URL ${url} returned 5xx (HTTP ${res.status}). Retrying attempt ${attempt}...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        if (res.status === 404 || isHtmlBody(ct, text)) break;
        break;
      } catch (e: any) {
        clearTimeout(tid);
        lastReason = e?.message || "Network error";

        // Retry for network errors and abort timeouts
        const isAbort = e?.name === "AbortError" || e?.message?.includes("aborted");
        const isNetwork = e?.message?.includes("fetch") || e?.message?.includes("network") || e?.message?.includes("connection");
        if ((isAbort || isNetwork) && attempt < maxAttempts) {
          console.warn(`[developer-api] Provider URL ${url} failed with ${lastReason}. Retrying attempt ${attempt}...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        break;
      }
    }
  }
  return { ok: false, reason: lastReason, body: lastBody };
}

// Timing-safe string comparison
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// SHA-256 hex digest
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// HMAC-SHA256 hex digest
async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v: string): boolean { return UUID_RE.test(v); }

const API_KEY_RE = /^swft_live_[0-9a-f]{32}$/;

// Block private/loopback/link-local destinations to prevent webhook SSRF
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc|fd)/i;
function isSafeWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (PRIVATE_IP_RE.test(parsed.hostname)) return false;
    if (parsed.hostname === "localhost") return false;
    return true;
  } catch { return false; }
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return json({ success: false, error: "Server misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  let currentUserId: string | null = null;
  const endpoint = new URL(req.url).pathname;

  try {
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
                   || req.headers.get("x-real-ip") 
                   || "0.0.0.0";

    const logAuthFailure = async (reason: string, attempt: string = "") => {
      try {
        await supabase.from("security_logs").insert({
          action: "api_auth_failure",
          ip_address: ipAddress,
          metadata: { reason, attempted_key_prefix: attempt.substring(0, 12), endpoint },
          user_id: null // Unknown user due to failed auth
        });
      } catch (e) {
        console.error("[developer-api] Failed to log security event", e);
      }
    };

    // ── 1. Extract and Validate API key ─────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    const xApiKey = req.headers.get("X-API-Key");
    
    let rawApiKey = "";
    if (authHeader?.startsWith("Bearer ")) {
      rawApiKey = authHeader.slice(7).trim();
    } else if (xApiKey) {
      rawApiKey = xApiKey.trim();
    }
    
    if (!rawApiKey) {
      await logAuthFailure("Missing or malformed Authorization header");
      return json({ success: false, error: "Missing or malformed Authorization header. Use 'Authorization: Bearer <your_key>' or 'X-API-Key: <your_key>'." }, 401);
    }

    // ── 2. Authenticate Client ──────────────────────────────────────────────────
    const isMasterKey = safeEqual(rawApiKey, SUPABASE_SERVICE_ROLE_KEY);
    let profile: any = null;

    if (isMasterKey) {
      const urlObj = new URL(req.url);
      const targetUserId = urlObj.searchParams.get("sudo_user_id");
      if (!targetUserId) return json({ success: false, error: "Master Key requires 'sudo_user_id' parameter." }, 400);
      
      const { data: sudoProfile } = await supabase.from("profiles").select("*").eq("user_id", targetUserId).maybeSingle();
      if (!sudoProfile) return json({ success: false, error: "Sudo profile not found." }, 404);
      profile = sudoProfile;
      currentUserId = sudoProfile.user_id;
    } else {
      if (!API_KEY_RE.test(rawApiKey)) {
        await logAuthFailure("Invalid API key format", rawApiKey);
        return json({ success: false, error: "Invalid API key format." }, 401);
      }
      
      const prefix = rawApiKey.slice(0, 12);
      const incomingHash = await sha256Hex(rawApiKey);
      
      // Use secure RPC for authentication (bypasses RLS safely)
      const { data: profileData, error: authError } = await supabase.rpc("authenticate_client", {
        p_prefix: prefix,
        p_hash: incomingHash
      });
      
      if (authError || !profileData || profileData.length === 0) {
        if (authError) console.error(`[AUTH ERROR]`, authError);
        await logAuthFailure("Invalid API key or Profile suspended", rawApiKey);
        return json({ success: false, error: "Authentication failed: Profile not found or API key invalid." }, 401);
      }
      
      profile = profileData[0];
      currentUserId = profile.user_id;
      
      // Map secret key for HMAC
      profile.secret_key_hash = profile.api_secret_key_hash || profile.secret_key_hash;
      
      // ── 3. HMAC Signature Verification (Optional, SKIPPED IN TEST MODE) ───────
      const signature = req.headers.get("X-Swift-Signature");
      const isTestMode = profile.test_mode;
      
      if (req.method === "POST" && signature && profile.secret_key_hash && !isTestMode) {
        const bodyText = await req.clone().text();
        const computedSig = await hmacSha256Hex(profile.secret_key_hash, bodyText);
        
        if (!safeEqual(computedSig, signature)) {
          return json({ success: false, error: "Invalid signature. Request body may have been tampered with." }, 401);
        }
      }
    }

    // ── 4. Access and IP Checks ─────────────────────────────────────────────────
    if (!profile.access_enabled) return json({ success: false, error: "API access is disabled." }, 403);
    
    // Optional IP Whitelisting: Enforce only if whitelist is configured (non-empty)
    const whitelist: string[] = Array.isArray(profile.ip_whitelist) ? profile.ip_whitelist : [];
    if (whitelist.length > 0 && !isMasterKey) {
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "";
      if (!whitelist.some((ip) => ip.trim() === clientIp)) {
        return json({ success: false, error: `IP ${clientIp} not whitelisted.` }, 403);
      }
    }

    // ── 5. Idempotency Check (Optional for client, mandatory for DB) ────────────
    const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();

    // ── 6. Rate Limiting ────────────────────────────────────────────────────────
    const rateLimit = profile.rate_limit || 30;
    const { data: withinLimit } = await supabase.rpc("check_and_increment_rate_limit", {
      p_user_id: currentUserId,
      p_rate_limit: rateLimit,
    });
    if (!withinLimit) return json({ success: false, error: "Rate limit exceeded." }, 429);

    // ── 7. Action Mapping ───────────────────────────────────────────────────────
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const action = url.searchParams.get("action") || "";
    let finalAction = action;
    const p = path.toLowerCase();
    
    if (p.endsWith("/balance")) finalAction = "balance";
    else if (p.endsWith("/account")) finalAction = "account";
    else if (p.endsWith("/plans")) finalAction = "plans";
    else if (p.endsWith("/buy")) finalAction = "buy";
    else if (p.endsWith("/sms")) finalAction = "sms";
    else if (p.endsWith("/orders")) finalAction = "orders";
    else if (p.endsWith("/status")) finalAction = "status";
    else if (p.endsWith("/wallets")) finalAction = "wallets";
    else if (p.endsWith("/wallet/transfer")) finalAction = "wallet_transfer";
    else if (p.endsWith("/afa-registration")) finalAction = "afa_registration";
    else if (p.endsWith("/results-checker")) finalAction = "results_checker";
    else if (p.endsWith("/payment/bills/validate")) finalAction = "validate_bill";
    else if (p.endsWith("/payment/bills/pay")) finalAction = "pay_bill";
    else if (p.endsWith("/payment/ecg/lookup")) finalAction = "ecg_lookup";
    else if (p.endsWith("/payment/ecg")) finalAction = "ecg_pay";
    else if (p === "" || p === "/" || p.endsWith("/developer-api")) finalAction = action || "index";

    const allowedActions: string[] = profile.allowed_actions || ["balance", "plans", "account", "buy", "orders", "status", "wallets", "wallet_transfer", "afa_registration", "results_checker", "validate_bill", "pay_bill", "ecg_lookup", "ecg_pay"];
    if (!allowedActions.includes(finalAction) && !["index", "account", "balance", "plans", "buy", "orders", "status", "wallets", "wallet_transfer", "afa_registration", "results_checker", "validate_bill", "pay_bill", "ecg_lookup", "ecg_pay"].includes(finalAction)) {
      return json({ success: false, error: `Action '${finalAction}' not permitted.` }, 403);
    }

    // ── 8. Execute Logic via RPCs ──────────────────────────────────────────────
    
    if (finalAction === "balance") {
      const { data: wallet } = await supabase.schema("api").from("v_wallets").select("balance, api_balance").eq("agent_id", currentUserId).maybeSingle();
      return json({
        success: true,
        balance: Number(wallet?.balance ?? 0),
        api_balance: Number(wallet?.api_balance ?? 0),
        currency: "GHS"
      });
    }

    if (finalAction === "account") {
      const { data: wallet } = await supabase.schema("api").from("v_wallets").select("balance").eq("agent_id", currentUserId).maybeSingle();
      return json({
        success: true,
        name: profile.full_name || "API User",
        balance: Number(wallet?.balance ?? 0),
        apiKey: rawApiKey,
        active: profile.access_enabled
      });
    }

    if (finalAction === "wallets") {
      const { data: wallet } = await supabase.schema("api").from("v_wallets").select("balance, api_balance").eq("agent_id", currentUserId).maybeSingle();
      return json({
        success: true,
        wallets: {
          main: { balance: Number(wallet?.balance ?? 0), currency: "GHS" },
          api: { balance: Number(wallet?.api_balance ?? 0), currency: "GHS" }
        }
      });
    }

    if (finalAction === "wallet_transfer" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { amount, from, to } = payload;
      if (!amount || !from || !to) return json({ success: false, error: "Missing amount, from, or to." }, 400);

      const { data: result, error: rpcError } = await supabase.rpc("api.transfer_funds", {
        p_user_id: currentUserId,
        p_amount: Number(amount),
        p_from: from,
        p_to: to
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      // Trigger webhook if API wallet was funded
      if (to === "api") {
        await notifyWalletCredit(supabase, currentUserId, Number(amount), "api");
      }

      return json(result);
    }

    if (finalAction === "account") {
      const { data: wallet } = await supabase.schema("api").from("v_wallets").select("balance").eq("agent_id", currentUserId).maybeSingle();
      return json({
        success: true,
        name: profile.full_name || profile.name || "User",
        balance: Number(wallet?.balance ?? 0),
        active: profile.access_enabled
      });
    }

    if (finalAction === "plans") {
      const { data: plans } = await supabase.schema("api").from("v_plans").select("*").eq("is_unavailable", false).order("network").order("package_size");
      return json({ success: true, plans: plans ?? [] });
    }

    if (finalAction === "buy" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { network, phone, amount, package_size, request_id } = payload;
      if (!network || !phone || (!amount && !package_size))
        return json({ success: false, error: "Missing required fields." }, 400);

      // Anti-Duplicate Protection (Smart Idempotency & 2-Minute Window)
      const allowDuplicate = payload?.allow_duplicate === true || payload?.bypass_duplicate_check === true || req.headers.get("X-Bypass-Duplicate-Check") === "true";
      const normalizedPhone = normalizeRecipient(phone);
      const clientRef = request_id || payload?.client_reference || req.headers.get("X-Idempotency-Key");

      if (!allowDuplicate) {
        let duplicateOrder = null;

        // 1. Strict Idempotency Check (if client provided a reference)
        if (clientRef) {
           // We use textSearch or raw eq if we can't do json path easily, but PostgREST supports metadata->>client_reference 
           // However, let's just check the last 1 hour of orders for this agent to be safe and fast
           const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
           const { data } = await supabase
             .from("orders")
             .select("id, status, metadata")
             .eq("agent_id", currentUserId)
             .gte("created_at", oneHourAgo)
             .limit(100);
             
           duplicateOrder = data?.find(o => o.metadata?.client_reference === clientRef);
        }

        // 2. Fallback Time-Window Check (60 Seconds for exact same parameters)
        if (!duplicateOrder) {
          const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
          let query = supabase
            .from("orders")
            .select("id, created_at")
            .eq("agent_id", currentUserId) // MUST scope to the specific API user
            .eq("customer_phone", normalizedPhone)
            .eq("network", network)
            .in("status", ["paid", "processing", "pending", "fulfilled", "completed"])
            .gte("created_at", oneMinuteAgo)
            .order("created_at", { ascending: false })
            .limit(1);
            
          if (package_size) {
            query = query.eq("package_size", package_size);
          } else {
            query = query.eq("amount", amount);
          }

          const { data } = await query.maybeSingle();
          duplicateOrder = data;
        }

        if (duplicateOrder) {
          console.warn(`[DUPLICATE] Rejected developer duplicate order for ${normalizedPhone} by ${currentUserId}`);
          return json({ 
            success: false, 
            error: "Duplicate request detected. An identical order or reference was processed recently. Please wait 60 seconds or provide a unique 'request_id'." 
          }, 409);
        }
      }

      // CALL SECURE RPC
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: network,
        p_package_size: package_size || "AIRTIME",
        p_phone: normalizeRecipient(phone),
        p_amount: amount || 0,
        p_request_id: request_id || idemKey,
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      // Sync custom request ID to order metadata for webhook tracking
      const finalClientRef = request_id || payload?.client_reference || idemKey;
      await supabase.from("orders").update({
        metadata: { client_reference: finalClientRef }
      }).eq("id", orderId);
      
      // ── 9. Fulfillment Logic (SKIP IF TEST MODE) ──────────────────────────
      if (profile.test_mode) {
        console.log(`[TEST MODE] Skipping real fulfillment for order ${orderId}`);
        return json(result);
      }

      // ASYNC BACKGROUND FULFILLMENT START
      // By calling verify-payment asynchronously, we guarantee the developer API never hits a 504 Gateway Timeout.
      // The order will be processed in the background, and if it ultimately fails, the background worker will 
      // trigger the auto-refund trigger, returning the funds to the user's API wallet.
      fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ reference: orderId })
      }).catch(e => console.error("[developer-api] Background verification trigger failed:", e));

      return json(result);
    }

    if (finalAction === "afa_registration" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { afa_full_name, afa_ghana_card, customer_phone, amount, request_id } = payload;
      if (!customer_phone || !amount || !afa_full_name || !afa_ghana_card)
        return json({ success: false, error: "Missing required fields: customer_phone, amount, afa_full_name, afa_ghana_card" }, 400);

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: "AFA",
        p_package_size: "BUNDLE",
        p_phone: normalizeRecipient(customer_phone),
        p_amount: amount,
        p_request_id: request_id || idemKey,
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      await supabase.from("orders").update({
        order_type: "afa",
        metadata: {
          client_reference: request_id || idemKey,
          afa_full_name,
          afa_ghana_card,
          afa_occupation: payload.afa_occupation,
          afa_email: payload.afa_email,
          afa_residence: payload.afa_residence,
          afa_date_of_birth: payload.afa_date_of_birth
        }
      }).eq("id", orderId);

      if (profile.test_mode) {
        console.log(`[TEST MODE] Skipping real AFA registration for ${orderId}`);
        return json(result);
      }

      fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ reference: orderId })
      }).catch(e => console.error("[developer-api] Background AFA trigger failed:", e));

      return json(result);
    }

    if (finalAction === "results_checker" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { checker_type, quantity, amount, customer_phone, request_id } = payload;
      if (!checker_type || !quantity || !amount)
        return json({ success: false, error: "Missing required fields: checker_type, quantity, amount" }, 400);

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: checker_type,
        p_package_size: String(quantity),
        p_phone: normalizeRecipient(customer_phone || "0000000000"),
        p_amount: amount,
        p_request_id: request_id || idemKey,
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      await supabase.from("orders").update({
        order_type: "results_checker",
        metadata: {
          client_reference: request_id || idemKey,
          checker_type,
          quantity
        }
      }).eq("id", orderId);

      if (profile.test_mode) {
        console.log(`[TEST MODE] Skipping real Results Checker for ${orderId}`);
        return json(result);
      }

      fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ reference: orderId })
      }).catch(e => console.error("[developer-api] Background Checker trigger failed:", e));

      return json(result);
    }

    if (finalAction === "validate_bill" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { customerNumber, billType } = payload;
      if (!customerNumber || !billType)
        return json({ success: false, error: "Missing required fields: customerNumber, billType" }, 400);

      // We mock the validation for now. When the 3rd party API is integrated, we will fetch the real name.
      return json({
        success: true,
        customerName: "TEST CUSTOMER - " + customerNumber,
        validatedAmount: 41.00
      });
    }

    if (finalAction === "pay_bill" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { customerNumber, billType, amount, senderName } = payload;
      if (!customerNumber || !billType || !amount || !senderName)
        return json({ success: false, error: "Missing required fields: customerNumber, billType, amount, senderName" }, 400);

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: billType,
        p_package_size: "UTILITY",
        p_phone: normalizeRecipient(customerNumber),
        p_amount: amount,
        p_request_id: idemKey,
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      await supabase.from("orders").update({
        order_type: "utility",
        metadata: {
          client_reference: idemKey,
          utility_account_number: customerNumber,
          utility_provider: billType,
          utility_type: "bill_payment",
          utility_account_name: senderName
        }
      }).eq("id", orderId);

      if (profile.test_mode) {
        console.log(`[TEST MODE] Skipping real utility payment for ${orderId}`);
        return json({
          success: true,
          transaction_id: orderId,
          cost: amount,
          balance: result.balance
        });
      }

      fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ reference: orderId })
      }).catch(e => console.error("[developer-api] Background Utility trigger failed:", e));

      return json({
        success: true,
        transaction_id: orderId,
        cost: amount,
        balance: result.balance
      });
    }

    if (finalAction === "ecg_lookup" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { accountNumber } = payload;
      if (!accountNumber)
        return json({ success: false, error: "Missing required field: accountNumber" }, 400);

      // Mock validation
      return json({
        success: true,
        customerName: "ECG CUSTOMER - " + accountNumber,
        validatedAmount: 0
      });
    }

    if (finalAction === "ecg_pay" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { phoneNumber, accountNumber, amount } = payload;
      if (!phoneNumber || !accountNumber || !amount)
        return json({ success: false, error: "Missing required fields: phoneNumber, accountNumber, amount" }, 400);

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: "ECG",
        p_package_size: "UTILITY",
        p_phone: normalizeRecipient(phoneNumber),
        p_amount: amount,
        p_request_id: idemKey,
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      await supabase.from("orders").update({
        order_type: "utility",
        metadata: {
          client_reference: idemKey,
          utility_account_number: accountNumber,
          utility_provider: "ECG",
          utility_type: "bill_payment",
          customer_phone: phoneNumber
        }
      }).eq("id", orderId);

      if (profile.test_mode) {
        return json({
          success: true,
          transaction_id: orderId,
          cost: amount,
          balance: result.balance
        });
      }

      fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ reference: orderId })
      }).catch(e => console.error(e));

      return json({
        success: true,
        transaction_id: orderId,
        cost: amount,
        balance: result.balance
      });
    }

    if (finalAction === "orders") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
      const { data: orders } = await supabase.schema("api").from("v_orders").select("*").eq("agent_id", currentUserId).order("created_at", { ascending: false }).limit(limit);
      return json({ success: true, orders: orders ?? [] });
    }

    if (finalAction === "status") {
      const orderId = url.searchParams.get("order_id") || url.searchParams.get("id");
      if (!orderId) return json({ success: false, error: "Missing order_id" }, 400);
      
      const { data: order, error } = await supabase.schema("api").from("v_orders").select("*").eq("agent_id", currentUserId).eq("id", orderId).maybeSingle();
      if (error || !order) return json({ success: false, error: "Order not found" }, 404);
      
      return json({ success: true, order });
    }

    if (finalAction === "index") {
      return json({ success: true, message: "SwiftData API v2.0", docs: "https://swiftdatagh.shop/api-docs" });

    }

    return json({ success: false, error: "Endpoint not found." }, 404);

  } catch (err: any) {
    // ── 9. Zero-Knowledge Error Handling ────────────────────────────────────────
    const logRef = await supabase.rpc("api.log_internal_error", {
      p_user_id: currentUserId,
      p_endpoint: endpoint,
      p_method: req.method,
      p_payload: {},
      p_error: err.message || String(err),
      p_stack: err.stack || ""
    });

    return json({ 
      success: false, 
      error: "Internal Server Error", 
      reference: logRef.data || "ERR-UNKNOWN" 
    }, 500);
  }
});
