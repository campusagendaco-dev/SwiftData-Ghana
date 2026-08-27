declare const Deno: any;

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
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

function parseCapacity(pkg: string | null | undefined): number {
  if (!pkg) return 0;
  const cleaned = pkg.replace(/\s+/g, "").toUpperCase();
  
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
  
  if (handlerType === "skdataplug") {
    let cleanBase = clean.replace(/\/order\/?$/, "").replace(/\/status\/?$/, "").replace(/\/balance\/?$/, "").replace(/\/bundles\/?$/, "");
    if (!cleanBase.endsWith("/api/v1")) {
      if (cleanBase.endsWith("/api")) cleanBase += "/v1";
      else cleanBase += "/api/v1";
    }

    if (endpoint === "status") {
      return [`${cleanBase}/status`];
    }
    if (endpoint === "purchase") {
      return [`${cleanBase}/order/`];
    }
  }

  if (handlerType === "bossu" || handlerType === "superbdatafy" || handlerType === "qhowmenzconsult") {
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
  endpoint: string = "purchase",
  supabaseAdmin: any = null
): Promise<{ ok: boolean; reason: string; id?: string; body: string; status?: string }> {
  const handlerType = provider.handler_type || "standard";
  let payload = { ...data };
  if (handlerType === "skdataplug" && endpoint === "purchase") {
    let providerNetwork = "MTN";
    let gbSize = String(parseCapacity(String(data.package_size || data.plan || "")));

    if (supabaseAdmin) {
      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("raw_data")
          .eq("provider_id", provider.id)
          .eq("network", data.networkRaw || data.network || "")
          .eq("package_name", data.package_size || data.plan || "")
          .maybeSingle();

        if (pkgMapping?.raw_data) {
          providerNetwork = pkgMapping.raw_data.network || providerNetwork;
          gbSize = String(pkgMapping.raw_data.gb_size || gbSize);
        } else {
          const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
          if (rawNet.includes("VOD") || rawNet.includes("TELECEL")) {
            providerNetwork = "TELECEL";
          } else if (rawNet.includes("AT") || rawNet.includes("AIRTEL")) {
            const isNoExpiry = /no[- ]?expiry|non[- ]?expiry/i.test(String(data.package_size || data.plan || ""));
            providerNetwork = isNoExpiry ? "AT_NOEXPIRY" : "AT_EXPIRY";
          } else {
            providerNetwork = "MTN";
          }
        }
      } catch (e) {
        console.error("[skdataplug-payload-resolve] Error:", e);
      }
    }

    payload = {
      recipient: String(data.recipient || data.phoneNumber || ""),
      network: providerNetwork,
      gb_size: gbSize,
      reference: String(data.reference || data.order_id || data.orderReference || "")
    };
  }
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
        const bundleRes = await fetch(`${provider.base_url}/bundles?network=${sbNetwork}`, {
          headers: { "Authorization": `Bearer ${provider.api_key}`, "Accept": "application/json" }
        });
        if (bundleRes.ok) {
           const bData = await bundleRes.json();
           const bundles = bData?.bundles || [];
           const match = bundles.find((b: any) => String(b.capacity).replace(/\s+/g, "").toLowerCase() === pkgSize);
           if (match) {
             payload = { bundle_id: match.id, phone_number: phone };
           } else {
             return { ok: false, reason: `SuperbDatafy: Bundle ${pkgSize} not found for ${sbNetwork}`, body: "" };
           }
        } else {
           return { ok: false, reason: `SuperbDatafy: Failed to fetch bundles (HTTP ${bundleRes.status})`, body: "" };
        }
      } catch (e: any) {
         return { ok: false, reason: `SuperbDatafy: Network error fetching bundles - ${e.message}`, body: "" };
      }
    }
  } else if (handlerType === "datahub" && endpoint === "status") {
    payload = {
      reference: String(data.reference || data.transaction_id || data.order_id || ""),
    };
  } else if (handlerType === "qhowmenzconsult" && endpoint === "purchase") {
    let packageId = String(data.plan || data.package_size || "");
    if (supabaseAdmin) {
      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("external_id")
          .eq("provider_id", provider.id)
          .eq("network", data.networkRaw || data.network || "")
          .eq("package_name", data.package_size || data.plan || "")
          .maybeSingle();
        if (pkgMapping?.external_id) {
          packageId = pkgMapping.external_id;
        }
      } catch (e) {
        console.error("[qhowmenzconsult-payload-resolve] Error:", e);
      }
    }

    const network = String(data.networkRaw || data.network || "").toUpperCase();
    let netKey = network;
    if (network.includes("MTN") || network === "YELLO") netKey = "MTN";
    else if (network.includes("TELECEL") || network.includes("VODA")) netKey = "Telecel";
    else if (network.includes("AIRTEL") || network.includes("TIGO") || network === "AT") netKey = "AirtelTigo";

    payload = {
      network: netKey,
      recipient: String(data.recipient || data.phoneNumber || ""),
      plan_id: packageId,
      package_id: packageId,
      product_id: packageId,
      external_id: packageId,
      amount: Number(data.amount || 0),
      reference: String(data.reference || data.order_id || ""),
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
        if (handlerType !== "datamart" && handlerType !== "qhowmenzconsult") headers["Authorization"] = `Bearer ${provider.api_key}`;
        headers["X-Idempotency-Key"] = String(data.orderReference || data.reference || "");
        headers["User-Agent"] = "SwiftDataGH/2.0";

        const isGet = (handlerType === "datamart" && endpoint === "status") || 
                      (handlerType === "superbdatafy" && endpoint === "status") ||
                      (handlerType === "qhowmenzconsult" && endpoint === "status") ||
                      (handlerType === "skdataplug" && endpoint === "status");
        
        let reqUrl = url;
        if (handlerType === "skdataplug") {
          const cleanBase = url.replace(/\/+$/, "").replace(/\/order\/?$/, "").replace(/\/status\/?$/, "");
          if (endpoint === "status") {
             const ref = String(data.transaction_id || data.reference || data.order_id || "");
             reqUrl = `${cleanBase}/status/${ref}/`;
          } else {
             reqUrl = `${cleanBase}/order/`;
          }
        } else if (handlerType === "superbdatafy") {
          if (endpoint === "status") {
             const ref = String(data.transaction_id || data.reference || data.order_id || "");
             reqUrl = `${url}/transaction/${ref}`;
          } else {
             reqUrl = `${url}/buy-data`;
          }
        } else if (handlerType === "qhowmenzconsult") {
          if (endpoint === "purchase") {
             reqUrl = `${url}/orders`;
          } else if (endpoint === "status") {
             const ref = String(data.transaction_id || data.reference || data.order_id || "");
             reqUrl = `${url}/orders/${ref}`;
          }
        }

        const res = await fetch(reqUrl, {
          method: isGet ? "GET" : "POST",
          headers,
          body: isGet ? undefined : JSON.stringify(payload),
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
            const ok = p?.success === true || s === "success" || s === "true" || p?.status === true || s === "completed" || s === "delivered" || s === "pending";
            const pStatus = String(p?.transaction?.status ?? p?.data?.status ?? p?.delivery_status ?? p?.status ?? "");
            if (ok) return { ok: true, reason: "", body: lastBody, id: String(p?.transaction?.reference ?? p?.data?.orderNumber ?? p?.data?.reference ?? p?.data?.purchaseId ?? p?.transaction_id ?? p?.id ?? p?.order_id ?? ""), status: pStatus };
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
  let requestPayload: any = {};

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

    const reqUrl = new URL(req.url);
    const reqPath = reqUrl.pathname.toLowerCase();
    const reqHref = reqUrl.href.toLowerCase();
    const actionParam = (reqUrl.searchParams.get("action") || "").toLowerCase();
    const isSubmitNumbersPath = reqHref.includes("submit-numbers") || reqPath.includes("submit-numbers") || actionParam === "submit_numbers";
    
    if (!rawApiKey && !isSubmitNumbersPath) {
      await logAuthFailure("Missing or malformed Authorization header");
      return json({ success: false, error: "Missing or malformed Authorization header. Use 'Authorization: Bearer <your_key>' or 'X-API-Key: <your_key>'." }, 401);
    }
    
    if (!rawApiKey && isSubmitNumbersPath) {
      rawApiKey = (Deno as any).env.get("SUPABASE_ANON_KEY") || "public-anon-key";
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
      const isAnonOrJwt = rawApiKey === (Deno as any).env.get("SUPABASE_ANON_KEY") || rawApiKey.startsWith("eyJ") || rawApiKey.length > 50 || rawApiKey === "public-anon-key";

      if (isSubmitNumbersPath && (isAnonOrJwt || !API_KEY_RE.test(rawApiKey))) {
        profile = {
          user_id: "public-web-user",
          full_name: "Web User",
          access_enabled: true,
          rate_limit: 100,
          allowed_actions: ["submit_numbers"]
        };
        currentUserId = "public-web-user";
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
      }
      
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
    else if (p.endsWith("/buy") || p.endsWith("/purchase") || p.endsWith("/payment/airtime") || p.endsWith("/payment/data")) finalAction = "buy";
    else if (p.endsWith("/sms") || p.endsWith("/api/sms")) finalAction = "sms";
    else if (p.endsWith("/orders")) finalAction = "orders";
    else if (p.endsWith("/status") || p.endsWith("/order-status")) finalAction = "status";
    else if (p.endsWith("/wallets")) finalAction = "wallets";
    else if (p.endsWith("/wallet/transfer")) finalAction = "wallet_transfer";
    else if (p.endsWith("/afa-registration")) finalAction = "afa_registration";
    else if (p.endsWith("/results-checker")) finalAction = "results_checker";
    else if (p.endsWith("/payment/bills/validate")) finalAction = "validate_bill";
    else if (p.endsWith("/payment/bills/pay")) finalAction = "pay_bill";
    else if (p.endsWith("/payment/ecg/lookup")) finalAction = "ecg_lookup";
    else if (p.endsWith("/payment/ecg")) finalAction = "ecg_pay";
    else if (p.endsWith("/purchases/submit-numbers") || p.endsWith("/submit-numbers")) finalAction = "submit_numbers";
    else if (p.endsWith("/service-status")) finalAction = "service_status";
    else if (p === "" || p === "/" || p.endsWith("/developer-api")) finalAction = action || "index";

    const allowedActions: string[] = profile.allowed_actions || ["balance", "plans", "account", "buy", "orders", "status", "wallets", "wallet_transfer", "afa_registration", "results_checker", "validate_bill", "pay_bill", "ecg_lookup", "ecg_pay", "service_status", "submit_numbers"];
    if (!allowedActions.includes(finalAction) && !["index", "account", "balance", "plans", "buy", "orders", "status", "wallets", "wallet_transfer", "afa_registration", "results_checker", "validate_bill", "pay_bill", "ecg_lookup", "ecg_pay", "service_status", "submit_numbers"].includes(finalAction)) {
      return json({ success: false, error: `Action '${finalAction}' not permitted.` }, 403);
    }

    // ── 8. Execute Logic via RPCs ──────────────────────────────────────────────
    
    if (finalAction === "submit_numbers") {
      let payload: any = {};
      try {
        payload = await req.json();
      } catch {
        return json({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }'
        }, 400);
      }

      const rawNumbers = payload.numbers;
      if (!rawNumbers) {
        return json({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }'
        }, 400);
      }

      let items: string[] = [];
      if (Array.isArray(rawNumbers)) {
        items = rawNumbers.map((n: any) => String(n).trim()).filter(Boolean);
      } else if (typeof rawNumbers === "string") {
        items = rawNumbers.split(/[\n,\s]+/).map((n: string) => n.trim()).filter(Boolean);
      } else {
        return json({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }'
        }, 400);
      }

      if (items.length === 0) {
        return json({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }'
        }, 400);
      }

      if (items.length > 30) {
        return json({
          success: false,
          error: `Maximum 30 numbers allowed per request (got ${items.length})`
        }, 400);
      }

      const validNumbers: string[] = [];
      const invalidNumbers: string[] = [];

      for (const item of items) {
        const raw = String(item).trim();
        const digits = raw.replace(/\D/g, "");
        let normalized = "";
        if (digits.startsWith("233") && digits.length === 12) {
          normalized = "0" + digits.slice(3);
        } else if (digits.length === 9) {
          normalized = "0" + digits;
        } else if (digits.startsWith("0") && digits.length === 10) {
          normalized = digits;
        }

        const isValid = /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(normalized);
        if (isValid) {
          if (!validNumbers.includes(normalized)) validNumbers.push(normalized);
        } else {
          if (!invalidNumbers.includes(raw)) invalidNumbers.push(raw);
        }
      }

      if (validNumbers.length === 0) {
        return json({
          success: false,
          error: "No valid phone numbers found",
          invalid: invalidNumbers
        }, 400);
      }

      const { data: provider } = await supabase
        .from("providers")
        .select("*")
        .eq("handler_type", "datahub")
        .eq("is_active", true)
        .maybeSingle();

      const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
      const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external";
      const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");

      const targetUrl = cleanUrl.endsWith("/purchases/submit-numbers")
        ? cleanUrl
        : cleanUrl.includes("/purchases")
        ? `${cleanUrl}/submit-numbers`
        : `${cleanUrl}/purchases/submit-numbers`;

      try {
        const dhRes = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({ numbers: validNumbers.join(", ") })
        });

        const resText = await dhRes.text();
        let parsed: any = null;
        try { parsed = JSON.parse(resText); } catch (e) { /* ignore parse error */ }

        if (dhRes.ok) {
          const resData = parsed?.data || {
            submitted: validNumbers.length,
            numbers: validNumbers,
            invalid: invalidNumbers,
            message: `${validNumbers.length} number(s) submitted for beneficiary approval`
          };
          return json({
            success: true,
            data: {
              submitted: resData.submitted ?? validNumbers.length,
              numbers: resData.numbers ?? validNumbers,
              invalid: [...(resData.invalid || []), ...invalidNumbers],
              message: resData.message ?? `${validNumbers.length} number(s) submitted for beneficiary approval`
            }
          });
        }

        if (parsed) return json(parsed, dhRes.status);
        return json({
          success: false,
          error: "Failed to submit numbers for approval. Please try again later.",
          data: { submitted: 0, invalid: invalidNumbers }
        }, 502);
      } catch (err: any) {
        console.error("[developer-api/submit-numbers] Error:", err);
        return json({
          success: false,
          error: "Failed to submit numbers for approval. Please try again later.",
          data: { submitted: 0, invalid: invalidNumbers }
        }, 502);
      }
    }

    if (finalAction === "service_status") {
      const { data: statusList, error: err } = await supabase
        .from("service_status")
        .select("network, display_name, status, updated_at")
        .order("network");
      if (err) {
        console.error("Error fetching service status:", err);
        return json({ success: false, error: "Failed to fetch service status" }, 500);
      }
      return json({
        success: true,
        services: statusList ?? []
      });
    }

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

      const { data: result, error: rpcError } = await supabase.schema("api").rpc("transfer_funds", {
        p_user_id: currentUserId,
        p_amount: Number(amount),
        p_from: from,
        p_to: to
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      // Trigger webhook if API wallet was funded
      if (to === "api") {
        await notifyWalletCredit(supabase, currentUserId || "", Number(amount), "api");
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
      const { data: plans, error: plansErr } = await supabase.from("global_package_settings").select("*").eq("is_unavailable", false).order("network").order("package_size");
      if (plansErr) console.error("Error fetching plans:", plansErr);
      
      // Fetch Korba provider package mappings to exclude them
      const korbaProviderId = "1177b72a-a2d7-462d-9366-9dde6e83ccd7";
      const { data: korbaMappings, error: mappingsErr } = await supabase
        .from("provider_packages")
        .select("package_name, network")
        .eq("provider_id", korbaProviderId);
      
      if (mappingsErr) console.error("Error fetching Korba package mappings:", mappingsErr);

      const korbaSet = new Set(
        (korbaMappings ?? []).map((m: any) => `${m.network.toLowerCase()}-${String(m.package_name).replace(/\s+/g, "").toLowerCase()}`)
      );

      const filteredPlans = (plans ?? []).filter((p: any) => {
        const net = p.network.toLowerCase();
        const sizeKey = `${net}-${String(p.package_size).replace(/\s+/g, "").toLowerCase()}`;
        return !korbaSet.has(sizeKey);
      });

      const plansWithId = filteredPlans.map((p: any) => {
        let prefix = "pkg_";
        let displayNet = p.network;
        const net = String(p.network).toLowerCase();
        
        if (net === "mtn") { prefix = "yellow_"; displayNet = "YELLO"; }
        else if (net.includes("mash") || net.includes("mashup")) { prefix = "mashup_"; displayNet = "MTN Mash Up"; }
        else if (net === "at" || net === "airteltigo" || net === "at_premium") { prefix = "at_"; displayNet = "AT"; }
        else if (net === "telecel" || net === "vodafone") { prefix = "telecel_"; displayNet = "TELECEL"; }
        
        return {
          package_id: `${prefix}${String(p.package_size).toLowerCase().replace(/\s+/g, "")}`,
          network: displayNet,
          package_size: p.package_size,
          api_price: Number(p.agent_price || p.api_price || p.public_price || 0),
          is_unavailable: p.is_unavailable
        };
      });

      // Group into categories
      const categories: Record<string, any[]> = {};
      plansWithId.forEach((p: any) => {
        const cat = p.network;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({
          package_id: p.package_id,
          package_size: p.package_size,
          api_price: p.api_price,
          is_unavailable: p.is_unavailable
        });
      });

      return json({ success: true, plans: plansWithId, categories });
    }

    if (finalAction === "buy" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);
      requestPayload = payload;

      const { phone, amount, package_id } = payload;
      let { request_id } = payload;
      let { network, package_size } = payload;

      // Map parameters from Agent API docs compatibility
      if (payload.package && !package_size && !package_id) {
        package_size = payload.package;
      }
      if (payload.reference && !request_id) {
        request_id = payload.reference;
      }

      // Map smart network names back to DB names and normalize casing
      if (network) {
        const netLower = String(network).toLowerCase().trim();
        if (netLower === "yello" || netLower === "mtn") network = "MTN";
        else if (netLower === "blue" || netLower === "at" || netLower === "airteltigo") network = "AT";
        else if (netLower === "red" || netLower === "telecel" || netLower === "vodafone") network = "TELECEL";
        else if (netLower === "mashup" || netLower === "mtn mash up" || netLower === "mtn_mash_up") network = "MTN Mash Up";
        else {
          // Fallback: uppercase whatever they sent (e.g. "MTN")
          network = String(network).toUpperCase().trim();
        }
      }

      // Smart Package ID Resolution
      if (package_id) {
        const { data: plans, error: pErr } = await supabase.from("global_package_settings").select("*").eq("is_unavailable", false);
        if (pErr) console.error("Error fetching packages:", pErr);
        const match = (plans ?? []).find((p: any) => {
          let prefix = "pkg_";
          const net = String(p.network).toLowerCase();
          if (net === "mtn") prefix = "yellow_";
          else if (net.includes("mash") || net.includes("mashup")) prefix = "mashup_";
          else if (net === "at" || net === "airteltigo" || net === "at_premium") prefix = "at_";
          else if (net === "telecel" || net === "vodafone") prefix = "telecel_";
          const pId = `${prefix}${String(p.package_size).toLowerCase().replace(/\s+/g, "")}`;

          // Keep legacy support for red_ and blue_ prefixes
          let legacyPrefix = "pkg_";
          if (net === "mtn") legacyPrefix = "yellow_";
          else if (net.includes("mash") || net.includes("mashup")) legacyPrefix = "mashup_";
          else if (net === "at" || net === "airteltigo" || net === "at_premium") legacyPrefix = "blue_";
          else if (net === "telecel" || net === "vodafone") legacyPrefix = "red_";
          const legacyPId = `${legacyPrefix}${String(p.package_size).toLowerCase().replace(/\s+/g, "")}`;

          const inputId = String(package_id).toLowerCase().trim();
          return pId === inputId || legacyPId === inputId;
        });

        if (match) {
          network = match.network;
          package_size = match.package_size;
        } else {
          return json({ success: false, error: "Invalid package_id provided." }, 400);
        }
      }

      // Case-insensitive database lookup for package_size if a string is provided
      if (package_size && network && !package_id) {
        const cleanPkg = String(package_size).trim();
        const { data: plans } = await supabase
          .from("global_package_settings")
          .select("package_size")
          .eq("network", network)
          .ilike("package_size", cleanPkg);
        
        if (plans && plans.length > 0) {
          package_size = plans[0].package_size; // Normalize to exact database case (e.g. "1GB")
        }
      }

      if (!network || !phone || (!amount && !package_size))
        return json({ success: false, error: "Missing required fields." }, 400);

      // Anti-Duplicate Protection (Smart Idempotency & 2-Minute Window)
      const { data: sysSettings } = await supabase
        .from("system_settings")
        .select("allow_duplicate_purchases")
        .eq("id", 1)
        .maybeSingle();

      const allowDuplicate = payload?.allow_duplicate === true || 
                             payload?.bypass_duplicate_check === true || 
                             req.headers.get("X-Bypass-Duplicate-Check") === "true" ||
                             sysSettings?.allow_duplicate_purchases === true;
      const normalizedPhone = normalizeRecipient(phone);
      const clientRef = request_id || payload?.client_reference || req.headers.get("X-Idempotency-Key");

      if (!allowDuplicate) {
        let duplicateOrder = null;

        // 1. Strict Idempotency Check (if client provided a reference)
        if (clientRef) {
           const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
           const { data } = await supabase
             .from("orders")
             .select("id, status, metadata")
             .eq("agent_id", currentUserId ?? "")
             .gte("created_at", oneHourAgo)
             .limit(100);
             
           duplicateOrder = data?.find((o: any) => o.metadata?.client_reference === clientRef);
        }

        // 2. Fallback Time-Window Check (60 Minutes for exact same parameters)
        if (!duplicateOrder) {
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, created_at")
            .eq("agent_id", currentUserId ?? "")
            .eq("customer_phone", normalizedPhone)
            .gte("created_at", oneHourAgo);

          if (recentOrders && recentOrders.length > 0) {
            const statusesToCheck = ["paid", "processing", "pending", "fulfilled", "completed", "failed", "fulfillment_failed", "refunded"];
            const match = recentOrders.find((o: any) => {
              if (!statusesToCheck.includes(o.status)) return false;

              // Compare network case-insensitively with alias support
              const n1 = String(o.network || "").trim().toUpperCase();
              const n2 = String(network || "").trim().toUpperCase();
              const networksMatch = n1 === n2 ||
                ((n1 === "MTN" || n1 === "YELLO") && (n2 === "MTN" || n2 === "YELLO")) ||
                ((n1 === "TELECEL" || n1 === "VODAFONE" || n1 === "RED") && (n2 === "TELECEL" || n2 === "VODAFONE" || n2 === "RED")) ||
                ((n1 === "AT" || n1 === "AIRTELTIGO" || n1 === "BLUE") && (n2 === "AT" || n2 === "AIRTELTIGO" || n2 === "BLUE"));
              if (!networksMatch) return false;

              // Compare package_size or amount
              if (package_size) {
                const p1 = String(o.package_size || "").replace(/\s+/g, "").toUpperCase();
                const p2 = String(package_size || "").replace(/\s+/g, "").toUpperCase();
                if (p1 !== p2) return false;
              } else {
                if (Math.abs(Number(o.amount) - Number(amount)) > 0.01) return false;
              }

              return true;
            });

            if (match) {
              duplicateOrder = match;
            }
          }
        }

        if (duplicateOrder) {
          console.warn(`[DUPLICATE] Rejected developer duplicate order for ${normalizedPhone} by ${currentUserId}`);
          return json({ 
            success: false, 
            error: "Duplicate request detected. An identical order or reference was processed recently. Please wait 60 minutes or provide a unique 'request_id'." 
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
        p_package_size: "AIRTIME", // Use AIRTIME internally so it bypasses strict data bundle checks
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
        p_package_size: "AIRTIME", // Use AIRTIME internally so it bypasses strict data bundle checks
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
      let orderId = url.searchParams.get("order_id") || 
                    url.searchParams.get("id") || 
                    url.searchParams.get("reference") || 
                    url.searchParams.get("orderNumber");

      if (req.method === "POST") {
        try {
          const payload = await req.json().catch(() => null);
          if (payload) {
            orderId = orderId || payload.order_id || payload.id || payload.reference || payload.orderNumber;
          }
        } catch { /* ignore */ }
      }

      if (!orderId) {
        return json({ success: false, error: "Either 'reference' or 'orderNumber' is required" }, 400);
      }

      let query = supabase
        .from("orders")
        .select("*")
        .eq("agent_id", currentUserId);

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(orderId)) {
        query = query.or(`id.eq.${orderId},metadata->>client_reference.eq.${orderId}`);
      } else {
        query = query.eq("metadata->>client_reference", orderId);
      }

      const { data: order, error } = await query.maybeSingle();

      if (error || !order) {
        return json({ success: false, error: `Order not found with reference: ${orderId}` }, 404);
      }

      let latestOrder = order;
      if (order.status === "processing") {
        try {
          console.log(`[developer-api/status] Order ${order.id} is processing. Fetching live status via verify-payment...`);
          const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ reference: order.id })
          });
          if (verifyRes.ok) {
            const { data: refreshed } = await supabase
              .from("orders")
              .select("*")
              .eq("id", order.id)
              .maybeSingle();
            if (refreshed) {
              latestOrder = refreshed;
            }
          }
        } catch (e) {
          console.error("[developer-api/status] Error fetching live status:", e);
        }
      }

      // Map internal status to DataHub status format (PROCESSING, SUCCESS, FAILED)
      let statusUpper = "PROCESSING";
      const s = String(latestOrder.status || "").toLowerCase();
      if (s === "fulfilled" || s === "completed" || s === "success") {
        statusUpper = "SUCCESS";
      } else if (s === "failed" || s === "failure" || s === "refunded") {
        statusUpper = "FAILED";
      }

      // Build friendly status description
      let statusDescription = "Order sent to network provider, awaiting completion";
      if (statusUpper === "SUCCESS") {
        statusDescription = "Order completed successfully";
      } else if (statusUpper === "FAILED") {
        statusDescription = latestOrder.failure_reason || "Order failed to deliver";
      }

      return json({
        success: true,
        message: "Order status retrieved successfully",
        data: {
          orderNumber: latestOrder.id,
          reference: latestOrder.metadata?.client_reference || latestOrder.id,
          status: statusUpper,
          network: String(latestOrder.network || "").toUpperCase(),
          recipient: latestOrder.customer_phone,
          dataAmount: latestOrder.package_size,
          amountPaid: Number(latestOrder.amount || 0),
          orderDate: latestOrder.created_at,
          statusDescription
        }
      });
    }

    if (finalAction === "index") {
      return json({ success: true, message: "SwiftData API v2.0", docs: "https://swiftdatagh.shop/api-docs" });

    }

    return json({ success: false, error: "Endpoint not found." }, 404);

  } catch (err: any) {
    // ── 9. Zero-Knowledge Error Handling ────────────────────────────────────────
    const logRef = await supabase.schema("api").rpc("log_internal_error", {
      p_user_id: currentUserId,
      p_endpoint: endpoint,
      p_method: req.method,
      p_payload: requestPayload || {},
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
