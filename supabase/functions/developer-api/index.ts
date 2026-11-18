declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, sendSmsViaTxtConnect, getSmsConfig } from "../_shared/sms.ts";
import { getActiveProviders, logProviderError } from "../_shared/providers.ts";
import { notifyWalletCredit, notifyApiClient } from "../_shared/webhooks.ts";
import { StandardAdapter } from "../_shared/providers/standard.ts";

function getEnv(...keys: string[]): string {
  for (const k of keys) { const v = (Deno as any).env.get(k)?.trim(); if (v) return v; }
  return "";
}

function mapNetworkKey(network: string): string {
  const raw = (network || "").trim().toUpperCase();
  const cleaned = raw.replace(/[\s\-_]+/g, "_");

  if (cleaned.includes("MTN") && cleaned.includes("XPRESS")) return "MTN_XPRESS";
  if (cleaned === "MTN_XPRESS" || cleaned === "XPRESS") return "MTN_XPRESS";

  if (cleaned.includes("BIGTIME") || cleaned.includes("BIG_TIME")) return "AT_BIGTIME";
  if (cleaned === "AT_BIGTIME" || cleaned === "BIGTIME") return "AT_BIGTIME";

  if (cleaned === "YELLO" || cleaned.includes("MTN")) return "YELLO";

  if (cleaned.includes("TELECEL") || cleaned.includes("VODAFONE") || cleaned === "VOD") return "TELECEL";

  if (cleaned.includes("AIRTEL") || cleaned.includes("TIGO") || cleaned === "AT" || cleaned.includes("AT_PREMIUM")) return "AT_PREMIUM";

  if (cleaned === "GLO") return "GLO";

  return raw;
}

const mapDataNetworkKey = mapNetworkKey;

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
  const hType = String(handlerType || "").toLowerCase();

  if (hType === "hyspeeddata" || hType === "swiftreseller" || hType === "hyspeed") {
    const cleanRoot = clean.replace(/\/v1$/i, "");
    if (endpoint === "status") {
      return [`${cleanRoot}/v1/orders`];
    }
    if (endpoint === "purchase") {
      return [`${cleanRoot}/v1/buy-data`];
    }
    return [`${cleanRoot}/v1/${endpoint}`];
  }
  
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
    const alias = endpoint === "purchase" ? "data-purchase" : (endpoint === "status" ? "order-status" : (endpoint === "refund" || endpoint === "order-refund" ? "order-refund" : endpoint));
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
  const handlerUpper = String(handlerType || provider.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const resolvedApiKey =
    ((handlerType === "hyspeeddata" || handlerType === "swiftreseller" || handlerType === "hyspeed") && getEnv("HYSPEEDDATA_API_KEY", "SWIFTRESELLER_API_KEY")) ||
    (handlerType === "datahub" && getEnv("DATAHUB_API_KEY")) ||
    (handlerType === "datamart" && getEnv("DATAMART_API_KEY", "DATAMARTGH_API_KEY")) ||
    (handlerType === "skdataplug" && getEnv("SKDATAPLUG_API_KEY", "SKPLUG_API_KEY")) ||
    (handlerType === "spendless" && getEnv("SPENDLESS_API_KEY")) ||
    (handlerType === "bundlezone" && getEnv("BUNDLEZONE_API_KEY")) ||
    (handlerType === "superbdatafy" && getEnv("SUPERBDATAFY_API_KEY")) ||
    (handlerType === "qhowmenzconsult" && getEnv("QHOWMENZCONSULT_API_KEY")) ||
    (handlerType === "bossu" && getEnv("BOSSU_API_KEY")) ||
    getEnv(`${handlerUpper}_API_KEY`) ||
    provider.api_key ||
    "";
  const resolvedBaseUrl =
    ((handlerType === "hyspeeddata" || handlerType === "swiftreseller" || handlerType === "hyspeed") && getEnv("HYSPEEDDATA_BASE_URL", "SWIFTRESELLER_BASE_URL")) ||
    (handlerType === "datahub" && getEnv("DATAHUB_BASE_URL")) ||
    (handlerType === "datamart" && getEnv("DATAMART_BASE_URL", "DATAMARTGH_BASE_URL")) ||
    (handlerType === "skdataplug" && getEnv("SKDATAPLUG_BASE_URL", "SKPLUG_BASE_URL")) ||
    (handlerType === "spendless" && getEnv("SPENDLESS_BASE_URL")) ||
    (handlerType === "bundlezone" && getEnv("BUNDLEZONE_BASE_URL")) ||
    (handlerType === "superbdatafy" && getEnv("SUPERBDATAFY_BASE_URL")) ||
    (handlerType === "qhowmenzconsult" && getEnv("QHOWMENZCONSULT_BASE_URL")) ||
    (handlerType === "bossu" && getEnv("BOSSU_BASE_URL")) ||
    getEnv(`${handlerUpper}_BASE_URL`) ||
    provider.base_url ||
    "";
  let payload = { ...data };
  const isHySpeed = handlerType === "hyspeeddata" || handlerType === "swiftreseller" || handlerType === "hyspeed";
  if (isHySpeed && endpoint === "purchase") {
    const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
    let hyNet = "yello";
    if (rawNet.includes("BIGTIME") || rawNet.includes("BIG_TIME")) hyNet = "at_bigtime";
    else if (rawNet.includes("AT") || rawNet.includes("AIRTEL") || rawNet.includes("TIGO") || rawNet.includes("ISHARE")) hyNet = "at_ishare";
    else if (rawNet.includes("TELECEL") || rawNet.includes("VODAFONE") || rawNet === "VOD") hyNet = "telecel";
    else hyNet = "yello";

    const rawPkgStr = String(data.package_size || data.plan || data.package || data.bundle || data.package_name || data.capacity || "").trim();
    const parsedCap = parseCapacity(rawPkgStr);
    const sizeGb = parsedCap > 0 ? parsedCap : (Number(rawPkgStr.replace(/[^0-9.]/g, "")) || 1);
    const recipientPhone = normalizeRecipient(String(
      data.recipient ||
      data.phoneNumber ||
      data.phone ||
      data.customer_phone ||
      data.phone_number ||
      data.mobile ||
      data.customerPhone ||
      ""
    ));

    payload = {
      phone: recipientPhone,
      network: hyNet,
      size_gb: sizeGb,
      reference: String(data.reference || data.order_id || data.orderReference || "")
    };
  }
  if (handlerType === "skdataplug" && endpoint === "purchase") {
    let providerNetwork = "MTN";
    const rawPkgStr = String(data.package_size || data.plan || data.package || data.bundle || data.package_name || data.capacity || "").trim();
    const cleanPkgName = rawPkgStr.replace(/\s+/g, "");
    const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
    const mappedDbNet = mapDataNetworkKey(rawNet);
    let gbSize = String(parseCapacity(rawPkgStr));

    if (supabaseAdmin) {
      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("raw_data, capacity_gb")
          .eq("provider_id", provider.id)
          .or(`network.eq.${mappedDbNet},network.eq.${rawNet}`)
          .or(`package_name.eq.${rawPkgStr},package_name.eq.${cleanPkgName}`)
          .limit(1)
          .maybeSingle();

        if (pkgMapping?.raw_data) {
          providerNetwork = pkgMapping.raw_data.network || providerNetwork;
          gbSize = String(pkgMapping.raw_data.gb_size || pkgMapping.capacity_gb || gbSize);
        } else {
          if (rawNet.includes("VOD") || rawNet.includes("TELECEL")) {
            providerNetwork = "TELECEL";
          } else if (rawNet.includes("AT") || rawNet.includes("AIRTEL")) {
            const isNoExpiry = /no[- ]?expiry|non[- ]?expiry/i.test(rawPkgStr);
            providerNetwork = isNoExpiry ? "AT_NOEXPIRY" : "AT_EXPIRY";
          } else {
            providerNetwork = "MTN";
          }
        }
      } catch (e) {
        console.error("[skdataplug-payload-resolve] Error:", e);
      }
    }

    if (!gbSize || gbSize === "0" || gbSize === "0.0" || gbSize === "undefined" || gbSize === "null") {
      const parsedCap = parseCapacity(rawPkgStr);
      if (parsedCap > 0) {
        gbSize = String(parsedCap);
      } else {
        const numMatch = rawPkgStr.match(/(\d+(?:\.\d+)?)/);
        gbSize = numMatch ? numMatch[1] : "1";
      }
    }

    const recipientPhone = normalizeRecipient(String(
      data.recipient ||
      data.phoneNumber ||
      data.phone ||
      data.customer_phone ||
      data.phone_number ||
      data.mobile ||
      data.customerPhone ||
      ""
    ));

    payload = {
      recipient: recipientPhone,
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
        const bundleRes = await fetch(`${resolvedBaseUrl}/bundles?network=${sbNetwork}`, {
          headers: { "Authorization": `Bearer ${resolvedApiKey}`, "Accept": "application/json" }
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

  const urls = buildProviderUrls(resolvedBaseUrl, endpoint, handlerType);
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
        if (!isHySpeed) headers["X-API-Key"] = resolvedApiKey;
        if (handlerType !== "datamart" && handlerType !== "qhowmenzconsult") headers["Authorization"] = `Bearer ${resolvedApiKey}`;
        if (!isHySpeed) headers["X-Idempotency-Key"] = String(data.orderReference || data.reference || "");
        headers["User-Agent"] = "SwiftDataGH/2.0";

        const isGet = (handlerType === "datamart" && endpoint === "status") || 
                      (handlerType === "superbdatafy" && endpoint === "status") ||
                      (handlerType === "qhowmenzconsult" && endpoint === "status") ||
                      (handlerType === "skdataplug" && endpoint === "status") ||
                      (isHySpeed && endpoint === "status");
        
        let reqUrl = url;
        if (isHySpeed && endpoint === "status") {
          const ref = String(data.transaction_id || data.reference || data.order_id || "");
          reqUrl = `${url.replace(/\/+$/, "")}/${encodeURIComponent(ref)}`;
        } else if (handlerType === "skdataplug") {
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
            const pStatus = String(p?.order?.status ?? p?.transaction?.status ?? p?.data?.status ?? p?.delivery_status ?? p?.status ?? "");
            if (ok) return { ok: true, reason: "", body: lastBody, id: String(p?.order?.reference ?? p?.transaction?.reference ?? p?.data?.orderNumber ?? p?.data?.reference ?? p?.data?.purchaseId ?? p?.transaction_id ?? p?.id ?? p?.order_id ?? ""), status: pStatus };
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

function isKorbaDataPackagePattern(network: string | null | undefined, packageSize: string | null | undefined): boolean {
  const netUpper = String(network || "").trim().toUpperCase();
  const pkgUpper = String(packageSize || "").trim().toUpperCase();
  if (netUpper.includes("KORBA")) return true;
  if (
    pkgUpper.startsWith("GHS") ||
    pkgUpper.includes("RACT_DATA") ||
    pkgUpper.includes("KOKROKOO") ||
    pkgUpper.includes("MIDNIGHT") ||
    pkgUpper.includes("SOCIAL") ||
    pkgUpper.includes("VIDEO") ||
    pkgUpper.includes("IDD")
  ) {
    return true;
  }
  return false;
}

async function getKorbaPackageSet(supabase: any): Promise<Set<string>> {
  const defaultKorbaId = "1177b72a-a2d7-462d-9366-9dde6e83ccd7";
  const { data: korbaProviders } = await supabase
    .from("providers")
    .select("id")
    .or(`id.eq.${defaultKorbaId},handler_type.eq.korba`);
  const providerIds = Array.from(
    new Set([defaultKorbaId, ...(korbaProviders ?? []).map((p: any) => p.id).filter(Boolean)])
  );
  const { data: korbaMappings, error: mappingsErr } = await supabase
    .from("provider_packages")
    .select("package_name, network")
    .in("provider_id", providerIds);
  if (mappingsErr) console.error("Error fetching Korba package mappings:", mappingsErr);
  return new Set(
    (korbaMappings ?? []).map(
      (m: any) => `${String(m.network || "").toLowerCase()}-${String(m.package_name || "").replace(/\s+/g, "").toLowerCase()}`
    )
  );
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
    
    // Paystack checkout / collection routes for API users' own customers (checked first: "/checkout/status" also contains "/status")
    if (p.endsWith("/checkout/otp") || action === "checkout_otp") finalAction = "checkout_otp";
    else if (p.includes("/checkout/status") || action === "checkout_status") finalAction = "checkout_status";
    else if (p.endsWith("/checkout") || action === "checkout") finalAction = "checkout";
    else if (p.endsWith("/collect") || action === "collect") finalAction = "collect";
    else if (p.endsWith("/balance")) finalAction = "balance";
    else if (p.endsWith("/account")) finalAction = "account";
    else if (p.endsWith("/plans") || p.endsWith("/packages") || action === "packages") finalAction = "plans";
    else if (p.endsWith("/buy") || p.endsWith("/purchase") || p.endsWith("/order") || p.endsWith("/buy-data") || p.includes("/buy-data") || p.endsWith("/payment/airtime") || p.endsWith("/payment/data") || action === "purchase" || action === "bulk_buy" || action === "airtime") finalAction = "buy";
    else if (p.endsWith("/sms") || p.endsWith("/api/sms")) finalAction = "sms";
    else if (p.includes("/orders-summary") || p.includes("/orders_summary")) finalAction = "orders_summary";
    else if (p.endsWith("/orders") || action === "transactions") finalAction = "orders";
    else if (p.includes("/callback")) finalAction = "callback";
    else if (p.includes("/status") || action === "order_status" || action === "verify_claim") finalAction = "status";
    else if (p.endsWith("/wallets")) finalAction = "wallets";
    else if (p.endsWith("/wallet/transfer")) finalAction = "wallet_transfer";
    else if (p.endsWith("/afa-registration")) finalAction = "afa_registration";
    else if (p.endsWith("/results-checker")) finalAction = "results_checker";
    else if (p.endsWith("/payment/bills/validate")) finalAction = "validate_bill";
    else if (p.endsWith("/payment/bills/pay")) finalAction = "pay_bill";
    else if (p.endsWith("/payment/ecg/lookup")) finalAction = "ecg_lookup";
    else if (p.endsWith("/payment/ecg")) finalAction = "ecg_pay";
    else if (p.endsWith("/purchases/submit-numbers") || p.endsWith("/submit-numbers")) finalAction = "submit_numbers";
    else if (
      p.endsWith("/order-refund") ||
      p.endsWith("/order_refund") ||
      p.endsWith("/cancel-order") ||
      p.endsWith("/cancel_order") ||
      /\/orders\/[^/]+\/cancel$/i.test(path) ||
      action === "order-refund" ||
      action === "cancel-order" ||
      action === "cancel_order"
    ) finalAction = "order_refund";
    else if (p.endsWith("/service-status")) finalAction = "service_status";
    else if (p === "" || p === "/" || p.endsWith("/developer-api")) finalAction = action || "index";

    // The anonymous web profile (no API key) may only submit numbers; the
    // generic allow-list below would otherwise let it call any action.
    if (currentUserId === "public-web-user" && !["submit_numbers", "index", "service_status"].includes(finalAction)) {
      return json({ success: false, error: `Action '${finalAction}' requires an API key.` }, 401);
    }

    const ACTION_PERMISSION_MAP: Record<string, string> = {
      balance: "balance",
      account: "balance",
      wallets: "balance",
      wallet_transfer: "balance",
      plans: "plans",
      packages: "plans",
      buy: "buy",
      purchase: "buy",
      bulk_buy: "buy",
      airtime: "buy",
      validate_bill: "buy",
      pay_bill: "buy",
      ecg_lookup: "buy",
      ecg_pay: "buy",
      afa_registration: "buy",
      results_checker: "buy",
      submit_numbers: "buy",
      orders: "orders",
      orders_summary: "orders",
      status: "orders",
      order_status: "orders",
      transactions: "orders",
      order_refund: "orders",
      verify_claim: "orders",
      callback: "orders",
      checkout: "checkout",
      checkout_otp: "checkout",
      checkout_status: "checkout",
      collect: "collect",
    };

    const rawAllowed = profile.allowed_actions ?? profile.api_allowed_actions;
    const allowedActions: string[] = Array.isArray(rawAllowed)
      ? rawAllowed
      : ["balance", "plans", "buy", "orders"];
    const canonicalAction = ACTION_PERMISSION_MAP[finalAction] || finalAction;
    if (
      !allowedActions.includes(finalAction) &&
      !allowedActions.includes(canonicalAction) &&
      !["index", "service_status"].includes(finalAction)
    ) {
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
        return !korbaSet.has(sizeKey) && !isKorbaDataPackagePattern(p.network, p.package_size);
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
      if (payload.size_gb != null && !package_size && !package_id) {
        package_size = String(payload.size_gb) + "GB";
      }
      if (payload.capacity != null && !package_size && !package_id) {
        package_size = String(payload.capacity).toUpperCase().includes("GB") ? String(payload.capacity) : (String(payload.capacity) + "GB");
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

      // Enforce SME Korba Exclusion & Strict Server-Side Pricing for Data Bundles
      const isAirtimeOrder =
        p.endsWith("/payment/airtime") ||
        (!package_id && (!package_size || String(package_size).trim().toUpperCase() === "AIRTIME"));

      let serverValidatedAmount = Number(amount || 0);

      if (!isAirtimeOrder) {
        if (
          isKorbaDataPackagePattern(network, package_size) ||
          String(payload?.provider_type || "").toLowerCase() === "korba" ||
          String(payload?.category || "").toLowerCase() === "korba"
        ) {
          return json({ success: false, error: "SME data bundles cannot be routed to Korba." }, 400);
        }

        const korbaSet = await getKorbaPackageSet(supabase);
        const normalizedKey = `${String(network).toLowerCase()}-${String(package_size).replace(/\s+/g, "").toLowerCase()}`;
        if (korbaSet.has(normalizedKey)) {
          return json({ success: false, error: "Selected package is excluded from SME developer API." }, 400);
        }

        const { data: matchedPlans } = await supabase
          .from("global_package_settings")
          .select("*")
          .eq("is_unavailable", false)
          .ilike("network", String(network).trim());

        const cleanTargetSize = String(package_size).replace(/\s+/g, "").toLowerCase();
        const matchedPlan = (matchedPlans ?? []).find(
          (pl: any) => String(pl.package_size || "").replace(/\s+/g, "").toLowerCase() === cleanTargetSize
        );

        if (!matchedPlan) {
          return json({ success: false, error: "Invalid or unavailable data bundle." }, 400);
        }

        network = matchedPlan.network;
        package_size = matchedPlan.package_size;
        serverValidatedAmount = Number(
          matchedPlan.agent_price || matchedPlan.api_price || matchedPlan.public_price || matchedPlan.price || 0
        );

        if (!Number.isFinite(serverValidatedAmount) || serverValidatedAmount <= 0) {
          return json({ success: false, error: "Server-side bundle pricing unavailable for selected plan." }, 400);
        }
      } else {
        if (!Number.isFinite(serverValidatedAmount) || serverValidatedAmount <= 0) {
          return json({ success: false, error: "Valid positive airtime amount is required." }, 400);
        }
      }

      // Anti-Duplicate Protection (Smart Idempotency & 2-Minute Window)
      const { data: sysSettings } = await supabase
        .from("system_settings")
        .select("allow_duplicate_purchases")
        .eq("id", 1)
        .maybeSingle();

      const allowDuplicate = payload?.allow_duplicate === true || 
                             payload?.bypass_duplicate_check === true || 
                             req.headers.get("X-Bypass-Duplicate-Check") === "true" ||
                             (getEnv("ALLOW_DUPLICATE_PURCHASES") !== "" ? getEnv("ALLOW_DUPLICATE_PURCHASES").toLowerCase() === "true" : sysSettings?.allow_duplicate_purchases === true);
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
           if (!duplicateOrder) {
             const { data: exactClientRefOrder } = await supabase
               .from("orders")
               .select("id, status, metadata")
               .eq("agent_id", currentUserId ?? "")
               .eq("metadata->>client_reference", String(clientRef).trim())
               .limit(1)
               .maybeSingle();
             if (exactClientRefOrder) duplicateOrder = exactClientRefOrder;
           }
        }

        // 2. Fallback Time-Window Check (Only block if identical package size is CURRENTLY IN PROGRESS)
        if (!duplicateOrder) {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, created_at")
            .eq("agent_id", currentUserId ?? "")
            .eq("customer_phone", normalizedPhone)
            .gte("created_at", tenMinutesAgo);

          if (recentOrders && recentOrders.length > 0) {
            const activeStatuses = ["paid", "processing", "pending", "awaiting_payment"];
            const match = recentOrders.find((o: any) => {
              if (!activeStatuses.includes(o.status)) return false;

              // Compare network / offer type strictly
              const n1 = String(o.network || "").trim().toUpperCase();
              const n2 = String(network || "").trim().toUpperCase();
              if (n1 !== n2) return false;

              // Compare package_size or amount
              if (package_size) {
                const p1 = String(o.package_size || "").replace(/\s+/g, "").toUpperCase();
                const p2 = String(package_size || "").replace(/\s+/g, "").toUpperCase();
                if (p1 !== p2) return false;
              } else {
                if (Math.abs(Number(o.amount) - Number(serverValidatedAmount)) > 0.01) return false;
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
        p_amount: serverValidatedAmount,
        p_request_id: String(payload?.client_reference || request_id || idemKey).trim(),
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      // Sync custom request ID to order metadata for webhook tracking
      const finalClientRef = request_id || payload?.client_reference || idemKey;
      await supabase.from("orders").update({
        metadata: {
          client_reference: finalClientRef,
          idempotency_key: String(clientRef || idemKey).trim(),
          server_priced: true,
          wallet_debit_mode: "debit_api_wallet_or_debit_wallet_atomic",
          ...(!isAirtimeOrder
            ? {
                category: String(network || "").toLowerCase().includes("mash") ? "mashup" : "sme",
                package_category: String(network || "").toLowerCase().includes("mash") ? "mashup" : "sme",
                exclude_korba: true,
              }
            : {}),
        }
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

    // ── Paystack Checkout & Collection (API user's customers pay via SwiftData Paystack) ──
    if (["checkout", "collect", "checkout_otp", "checkout_status"].includes(finalAction)) {
      const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Env first, DB fallback (workspace credential rule)
      let PAYSTACK_KEY = getEnv("PAYSTACK_SECRET_KEY");
      if (!PAYSTACK_KEY) {
        const { data: sec } = await supabase
          .from("v_system_settings_with_secrets")
          .select("paystack_secret_key")
          .eq("id", 1)
          .maybeSingle();
        PAYSTACK_KEY = String(sec?.paystack_secret_key || "").trim();
      }
      if (!PAYSTACK_KEY) return json({ success: false, error: "Payment gateway is not configured." }, 503);

      const paystackPost = async (pathName: string, body: Record<string, unknown>) => {
        try {
          const res = await fetch(`https://api.paystack.co${pathName}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${PAYSTACK_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
          });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok && data?.status === true, data };
        } catch (e: any) {
          return { ok: false, data: { message: e?.message || "Could not reach payment gateway" } };
        }
      };

      const mapMomoProvider = (raw: unknown): string => {
        const v = String(raw || "").toLowerCase().trim();
        if (!v) return "";
        if (v.includes("mtn") || v === "yello") return "mtn";
        if (v.includes("telecel") || v.includes("voda") || v === "vod") return "vod";
        if (v.includes("airtel") || v.includes("tigo") || v === "at" || v === "atl") return "atl";
        return "";
      };

      const isValidGhPhone = (raw: string) => /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(raw);

      const { data: feeSettings } = await supabase
        .from("system_settings")
        .select("paystack_deposit_fee_percent")
        .eq("id", 1)
        .maybeSingle();
      const rawRate = Number(feeSettings?.paystack_deposit_fee_percent);
      const feeRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate < 0.2 ? rawRate : 0.03;
      const calcFee = (base: number) => parseFloat(Math.min(base * feeRate, 100).toFixed(2));
      const round2 = (n: number) => parseFloat(Number(n).toFixed(2));

      const describeOrder = (order: any) => {
        const meta = order?.metadata || {};
        const st = String(order?.status || "");
        const paid = Number(order?.paystack_verified_amount || 0) > 0;
        let paymentStatus = "pending";
        if (paid || ["paid", "processing", "fulfilled", "completed"].includes(st)) paymentStatus = "paid";
        else if (["fulfillment_failed", "failed", "cancelled"].includes(st)) paymentStatus = "failed";
        const isCollection = order?.order_type === "wallet_topup";
        let deliveryStatus = "awaiting_payment";
        if (st === "fulfilled" || st === "completed") deliveryStatus = isCollection ? "credited" : "delivered";
        else if (st === "processing" || st === "paid") deliveryStatus = isCollection ? "crediting" : "processing";
        else if (st === "refunded") deliveryStatus = "refunded";
        else if (paymentStatus === "failed") deliveryStatus = "failed";
        return {
          reference: order.id,
          client_reference: meta.client_reference || null,
          type: isCollection ? "collection" : "purchase",
          payment_status: paymentStatus,
          delivery_status: deliveryStatus,
          status: st,
          network: isCollection ? null : order.network,
          package_size: isCollection ? null : order.package_size,
          customer_phone: order.customer_phone,
          amount: {
            base: Number(meta.selling_price ?? meta.wallet_credit ?? order.amount),
            fee: Number(meta.fee ?? 0),
            total: Number(meta.amount_charged ?? order.amount),
            currency: "GHS",
          },
          failure_reason: paymentStatus === "failed" || st === "refunded" ? (order.failure_reason || null) : null,
          created_at: order.created_at,
          updated_at: order.updated_at,
        };
      };

      const findCheckoutOrder = async (ref: string) => {
        const cleanRef = String(ref || "").trim();
        if (!cleanRef) return null;
        const cols = "id, agent_id, order_type, network, package_size, customer_phone, amount, status, failure_reason, paystack_verified_amount, metadata, created_at, updated_at";
        if (UUID_RX.test(cleanRef)) {
          const { data } = await supabase.from("orders").select(cols)
            .eq("id", cleanRef).eq("agent_id", currentUserId ?? "").eq("metadata->>api_checkout", "true").maybeSingle();
          if (data) return data;
        }
        const { data: byClientRef } = await supabase.from("orders").select(cols)
          .eq("agent_id", currentUserId ?? "").eq("metadata->>api_checkout", "true")
          .eq("metadata->>client_reference", cleanRef)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        return byClientRef || null;
      };

      // ── GET/POST /checkout/status ─────────────────────────────────────────
      if (finalAction === "checkout_status") {
        let ref = url.searchParams.get("reference") || url.searchParams.get("client_reference") || url.searchParams.get("order_id") || "";
        if (!ref) {
          const tail = path.split("/checkout/status/")[1];
          if (tail) ref = decodeURIComponent(tail.split("/")[0]);
        }
        if (!ref && req.method === "POST") {
          const b = await req.json().catch(() => ({}));
          ref = String(b?.reference || b?.client_reference || b?.order_id || "");
        }
        if (!ref) return json({ success: false, error: "reference is required." }, 400);

        let order = await findCheckoutOrder(ref);
        if (!order) return json({ success: false, error: "Checkout not found." }, 404);

        // If still awaiting payment, actively re-verify with the gateway (covers delayed webhooks)
        if (["awaiting_payment", "pending"].includes(String(order.status))) {
          const beforeStatus = order.status;
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ reference: order.id }),
              signal: AbortSignal.timeout(25000),
            });
          } catch (e) {
            console.warn("[developer-api] checkout_status verify trigger failed:", e);
          }
          const refreshed = await findCheckoutOrder(order.id);
          if (refreshed) order = refreshed;
          if (order.status !== beforeStatus) {
            if (order.order_type === "wallet_topup") {
              if (order.status === "fulfilled") await notifyWalletCredit(supabase, currentUserId || "", Number(order.amount), "api");
            } else {
              await notifyApiClient(supabase, order.id, order.status);
            }
          }
        }

        return json({ success: true, data: describeOrder(order) });
      }

      // ── POST /checkout/otp ────────────────────────────────────────────────
      if (finalAction === "checkout_otp") {
        if (req.method !== "POST") return json({ success: false, error: "Use POST." }, 405);
        const b = await req.json().catch(() => ({}));
        const otp = String(b?.otp || "").trim();
        if (!otp || !/^[0-9A-Za-z]{3,12}$/.test(otp)) return json({ success: false, error: "A valid otp is required." }, 400);
        const order = await findCheckoutOrder(String(b?.reference || b?.client_reference || ""));
        if (!order) return json({ success: false, error: "Checkout not found." }, 404);
        if (!["awaiting_payment", "pending"].includes(String(order.status))) {
          return json({ success: false, error: "This checkout is no longer awaiting payment.", data: describeOrder(order) }, 409);
        }
        const r = await paystackPost("/charge/submit_otp", { otp, reference: order.id });
        if (!r.ok) return json({ success: false, error: r.data?.message || "OTP submission failed." }, 400);
        const ps = String(r.data?.data?.status || "");
        return json({
          success: true,
          data: {
            reference: order.id,
            client_reference: order.metadata?.client_reference || null,
            payment_status: ps === "success" ? "paid" : "pending",
            next_action: ps === "send_otp" ? "submit_otp" : (ps === "success" ? "none" : "approve_on_phone"),
            message: r.data?.data?.display_text || r.data?.message || "OTP submitted.",
          },
        });
      }

      // ── POST /checkout and POST /collect ──────────────────────────────────
      if (req.method !== "POST") return json({ success: false, error: "Use POST." }, 405);
      if (profile.test_mode) return json({ success: false, error: "Paystack checkout is not available in test mode." }, 400);

      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);
      requestPayload = payload;

      const clientRef = String(payload.client_reference || payload.reference || payload.request_id || req.headers.get("X-Idempotency-Key") || "").trim();
      if (!clientRef) return json({ success: false, error: "client_reference is required (a unique ID from your system)." }, 400);
      if (clientRef.length > 100) return json({ success: false, error: "client_reference is too long (max 100 chars)." }, 400);

      // Idempotency: one checkout per client_reference
      const existingCheckout = await findCheckoutOrder(clientRef);
      if (existingCheckout) {
        return json({ success: false, error: "A checkout with this client_reference already exists.", data: describeOrder(existingCheckout) }, 409);
      }

      const paymentPhoneRaw = String(payload.payment_phone || (finalAction === "checkout" ? (payload.customer_phone || payload.phone || "") : "")).trim();
      const paymentPhone = paymentPhoneRaw ? normalizeRecipient(paymentPhoneRaw) : "";
      if (paymentPhone && !isValidGhPhone(paymentPhone)) return json({ success: false, error: "payment_phone must be a valid Ghana mobile number." }, 400);
      const momoProvider = mapMomoProvider(payload.payment_network);
      if (payload.payment_network && !momoProvider) {
        return json({ success: false, error: "payment_network must be one of: MTN, TELECEL, AIRTELTIGO." }, 400);
      }
      const usePrompt = Boolean(paymentPhone && momoProvider);

      let redirectUrl = "";
      if (payload.redirect_url) {
        try {
          const ru = new URL(String(payload.redirect_url));
          if (ru.protocol !== "https:") throw new Error("not https");
          redirectUrl = ru.toString();
        } catch {
          return json({ success: false, error: "redirect_url must be a valid https URL." }, 400);
        }
      }
      if (!usePrompt && !redirectUrl) {
        return json({ success: false, error: "Provide payment_phone + payment_network for a MoMo prompt, or redirect_url for a hosted payment page." }, 400);
      }

      // Velocity guards: per API user and per paying phone
      const { data: userOk } = await supabase.rpc("check_generic_rate_limit", { p_key: `api_checkout:${currentUserId}`, p_rate_limit: 30 });
      if (userOk === false) return json({ success: false, error: "Too many checkout requests. Please slow down." }, 429);
      if (paymentPhone) {
        const { data: phoneOk } = await supabase.rpc("check_generic_rate_limit", { p_key: `api_checkout_phone:${paymentPhone}`, p_rate_limit: 2 });
        if (phoneOk === false) return json({ success: false, error: "A payment prompt was sent to this number recently. Please wait a minute." }, 429);
      }

      const orderId = crypto.randomUUID();
      const customerEmail = (() => {
        const e = String(payload.customer_email || "").trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120 ? e : `${paymentPhone || "customer"}.${orderId.slice(0, 8)}@pay.swiftdatagh.shop`;
      })();

      let orderRow: Record<string, unknown>;
      let paystackOrderType: string;
      let baseAmount: number;
      let fee: number;
      let total: number;

      if (finalAction === "collect") {
        const amountNum = round2(Number(payload.amount));
        if (!Number.isFinite(amountNum) || amountNum < 1) return json({ success: false, error: "amount must be at least GHS 1.00." }, 400);
        if (amountNum > 2000) return json({ success: false, error: "amount cannot exceed GHS 2,000.00 per collection." }, 400);
        baseAmount = amountNum;
        fee = calcFee(baseAmount);
        total = round2(baseAmount + fee);
        paystackOrderType = "wallet_topup";
        const description = String(payload.description || "").slice(0, 140);
        orderRow = {
          id: orderId,
          agent_id: currentUserId,
          order_type: "wallet_topup",
          amount: baseAmount, // credited to the API user's API wallet once paid
          paystack_fee: fee,
          status: "awaiting_payment",
          payment_method: "paystack",
          customer_phone: paymentPhone || null,
          metadata: {
            api_checkout: true,
            collection: true,
            wallet_type: "api",
            wallet_credit: baseAmount,
            fee,
            amount_charged: total,
            client_reference: clientRef,
            description,
            payment_phone: paymentPhone || null,
          },
        };
      } else {
        let network = String(payload.network || "").trim();
        let packageSize = String(payload.package_size || payload.package || "").trim();
        const recipient = normalizeRecipient(String(payload.customer_phone || payload.phone || ""));
        if (!network || !recipient) return json({ success: false, error: "network and customer_phone are required." }, 400);
        if (!isValidGhPhone(recipient)) return json({ success: false, error: "customer_phone must be a valid Ghana mobile number." }, 400);

        const netLower = network.toLowerCase();
        if (netLower === "yello" || netLower === "mtn") network = "MTN";
        else if (["blue", "at", "airteltigo"].includes(netLower)) network = "AT";
        else if (["red", "telecel", "vodafone"].includes(netLower)) network = "TELECEL";
        else if (["mashup", "mtn mash up", "mtn_mash_up"].includes(netLower)) network = "MTN Mash Up";
        else network = network.toUpperCase();

        const isAirtime = !packageSize || packageSize.toUpperCase() === "AIRTIME";
        let cost = 0;
        let costPrice = 0;
        const extraMeta: Record<string, unknown> = {};

        if (isAirtime) {
          cost = round2(Number(payload.amount));
          if (!Number.isFinite(cost) || cost < 1 || cost > 500) return json({ success: false, error: "Airtime amount must be between GHS 1.00 and GHS 500.00." }, 400);
          packageSize = "AIRTIME";
        } else {
          if (isKorbaDataPackagePattern(network, packageSize)) return json({ success: false, error: "Selected package is not available on the developer API." }, 400);
          const korbaSet = await getKorbaPackageSet(supabase);
          if (korbaSet.has(`${network.toLowerCase()}-${packageSize.replace(/\s+/g, "").toLowerCase()}`)) {
            return json({ success: false, error: "Selected package is not available on the developer API." }, 400);
          }
          const { data: plans } = await supabase.from("global_package_settings").select("*")
            .eq("is_unavailable", false).ilike("network", network);
          const cleanTarget = packageSize.replace(/\s+/g, "").toLowerCase();
          const plan = (plans ?? []).find((pl: any) => String(pl.package_size || "").replace(/\s+/g, "").toLowerCase() === cleanTarget);
          if (!plan) return json({ success: false, error: "Invalid or unavailable data bundle." }, 400);
          network = plan.network;
          packageSize = plan.package_size;
          cost = round2(Number(plan.agent_price || plan.api_price || plan.public_price || plan.price || 0));
          costPrice = Number(plan.cost_price || 0);
          if (!(cost > 0)) return json({ success: false, error: "Pricing unavailable for selected bundle." }, 400);
          const isMash = String(network).toLowerCase().includes("mash");
          Object.assign(extraMeta, {
            category: isMash ? "mashup" : "sme",
            package_category: isMash ? "mashup" : "sme",
            exclude_korba: true,
          });
        }

        const selling = payload.selling_price !== undefined && payload.selling_price !== null && payload.selling_price !== ""
          ? round2(Number(payload.selling_price))
          : cost;
        if (!Number.isFinite(selling) || selling < cost) {
          return json({ success: false, error: `selling_price cannot be below your API price (GHS ${cost.toFixed(2)}).` }, 400);
        }
        if (selling > round2(cost * 2 + 20)) {
          return json({ success: false, error: "selling_price is unreasonably high for this product." }, 400);
        }

        baseAmount = selling;
        fee = calcFee(baseAmount);
        total = round2(baseAmount + fee);
        paystackOrderType = isAirtime ? "airtime" : "data";

        orderRow = {
          id: orderId,
          agent_id: currentUserId,
          order_type: "api",
          network,
          package_size: packageSize,
          customer_phone: recipient,
          amount: total, // what the customer pays (bundle price + fee)
          paystack_fee: fee,
          cost_price: costPrice > 0 ? costPrice : undefined,
          profit: round2(selling - cost), // API user's margin, credited only after delivery
          status: "awaiting_payment",
          payment_method: "paystack",
          metadata: {
            ...extraMeta,
            api_checkout: true,
            server_priced: true,
            client_reference: clientRef,
            idempotency_key: clientRef,
            base_price: cost, // value delivered to the provider
            selling_price: selling,
            fee,
            amount_charged: total,
            payment_phone: paymentPhone || null,
          },
        };
      }

      const { error: insertErr } = await supabase.from("orders").insert(orderRow);
      if (insertErr) {
        console.error("[developer-api] checkout order insert failed:", insertErr);
        return json({ success: false, error: "Could not create checkout. Please try again." }, 500);
      }

      const paystackMetadata = {
        order_id: orderId,
        order_type: paystackOrderType,
        api_checkout: true,
        api_user_id: currentUserId,
        wallet_type: finalAction === "collect" ? "api" : undefined,
        client_reference: clientRef,
        custom_fields: [{ display_name: "Payment For", variable_name: "payment_for", value: profile.full_name || "SwiftData Partner" }],
      };

      const amountPesewas = Math.round(total * 100);
      const psResult = usePrompt
        ? await paystackPost("/charge", {
            email: customerEmail,
            amount: amountPesewas,
            currency: "GHS",
            reference: orderId,
            metadata: paystackMetadata,
            mobile_money: { phone: paymentPhone, provider: momoProvider },
          })
        : await paystackPost("/transaction/initialize", {
            email: customerEmail,
            amount: amountPesewas,
            currency: "GHS",
            reference: orderId,
            callback_url: redirectUrl,
            channels: ["mobile_money"],
            metadata: paystackMetadata,
          });

      if (!psResult.ok) {
        const reason = psResult.data?.message || "Payment gateway rejected the request.";
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: `Payment initiation failed: ${reason}` }).eq("id", orderId);
        return json({ success: false, error: reason, reference: orderId }, 502);
      }

      const chargeStatus = String(psResult.data?.data?.status || "");
      const nextAction = !usePrompt
        ? "redirect"
        : chargeStatus === "send_otp" ? "submit_otp" : chargeStatus === "success" ? "none" : "approve_on_phone";

      return json({
        success: true,
        data: {
          reference: orderId,
          client_reference: clientRef,
          type: finalAction === "collect" ? "collection" : "purchase",
          payment_status: chargeStatus === "success" ? "paid" : "pending",
          next_action: nextAction,
          authorization_url: usePrompt ? null : psResult.data?.data?.authorization_url || null,
          message: usePrompt
            ? (psResult.data?.data?.display_text || psResult.data?.data?.otp_message || "A payment prompt has been sent to the customer's phone. Ask them to approve it.")
            : "Redirect the customer to authorization_url to pay.",
          amount: { base: baseAmount, fee, total, currency: "GHS" },
        },
      }, 201);
    }

    if (finalAction === "afa_registration" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ success: false, error: "Invalid JSON body" }, 400);

      const { afa_full_name, afa_ghana_card, customer_phone, amount, request_id } = payload;
      if (!customer_phone || !afa_full_name || !afa_ghana_card)
        return json({ success: false, error: "Missing required fields: customer_phone, afa_full_name, afa_ghana_card" }, 400);

      const [{ data: afaSysSettings }, { data: afaPkgSetting }] = await Promise.all([
        supabase.from("system_settings").select("*").eq("id", 1).maybeSingle(),
        supabase
          .from("global_package_settings")
          .select("agent_price, api_price, public_price")
          .eq("network", "AFA")
          .eq("package_size", "BUNDLE")
          .maybeSingle(),
      ]);

      const sysAfaPrice = Number((afaSysSettings as any)?.afa_price ?? (afaSysSettings as any)?.afa_registration_price ?? 0);
      const pkgAfaPrice = Number(afaPkgSetting?.api_price ?? afaPkgSetting?.agent_price ?? afaPkgSetting?.public_price ?? 0);
      const configuredAfaPrice = sysAfaPrice > 0 ? sysAfaPrice : (pkgAfaPrice > 0 ? pkgAfaPrice : 15);
      const minAfaAmount = Math.max(15, Number.isFinite(configuredAfaPrice) ? configuredAfaPrice : 15);
      const clientAfaAmount = Number(amount);
      const resolvedAfaAmount = Number.isFinite(clientAfaAmount) && clientAfaAmount > minAfaAmount
        ? parseFloat(clientAfaAmount.toFixed(2))
        : minAfaAmount;

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: "AFA",
        p_package_size: "BUNDLE",
        p_phone: normalizeRecipient(customer_phone),
        p_amount: resolvedAfaAmount,
        p_request_id: String(payload?.client_reference || request_id || idemKey).trim(),
        p_idem_key: idemKey,
        p_test_mode: profile.test_mode
      });

      if (rpcError) throw rpcError;
      if (!result.success) return json(result, 400);

      const orderId = result.order_id;

      await supabase.from("orders").update({
        order_type: "afa",
        afa_full_name,
        afa_ghana_card,
        afa_occupation: payload.afa_occupation,
        afa_email: payload.afa_email,
        afa_residence: payload.afa_residence,
        afa_date_of_birth: payload.afa_date_of_birth,
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
      if (!checker_type || !quantity)
        return json({ success: false, error: "Missing required fields: checker_type, quantity" }, 400);

      const parsedQty = Math.floor(Number(quantity));
      if (!Number.isFinite(parsedQty) || parsedQty < 1 || parsedQty > 100) {
        return json({ success: false, error: "Invalid quantity. Must be an integer between 1 and 100." }, 400);
      }

      const { data: checkerSettings } = await supabase
        .from("system_settings")
        .select("wassce_price, bece_price")
        .eq("id", 1)
        .maybeSingle();

      const isBece = String(checker_type).trim().toUpperCase().includes("BECE");
      const rawUnitPrice = Number(isBece ? (checkerSettings?.bece_price ?? 15) : (checkerSettings?.wassce_price ?? 18));
      const minUnitFloor = isBece ? 15 : 18;
      const unitPrice = Number.isFinite(rawUnitPrice) && rawUnitPrice >= minUnitFloor ? rawUnitPrice : minUnitFloor;
      const minTotalAmount = parseFloat((unitPrice * parsedQty).toFixed(2));
      const clientAmount = Number(amount);
      const resolvedCheckerAmount = Number.isFinite(clientAmount) && clientAmount > minTotalAmount
        ? parseFloat(clientAmount.toFixed(2))
        : minTotalAmount;

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: checker_type,
        p_package_size: String(parsedQty),
        p_phone: normalizeRecipient(customer_phone || "0000000000"),
        p_amount: resolvedCheckerAmount,
        p_request_id: String(payload?.client_reference || request_id || idemKey).trim(),
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
          quantity: parsedQty
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
      if (!customerNumber || !billType || amount === undefined || amount === null || !senderName)
        return json({ success: false, error: "Missing required fields: customerNumber, billType, amount, senderName" }, 400);

      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount < 1) {
        return json({ success: false, error: "Invalid amount. Minimum bill payment amount is GHS 1.00." }, 400);
      }

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: billType,
        p_package_size: "AIRTIME", // Use AIRTIME internally so it bypasses strict data bundle checks
        p_phone: normalizeRecipient(customerNumber),
        p_amount: numericAmount,
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
          cost: numericAmount,
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
        cost: numericAmount,
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
      if (!phoneNumber || !accountNumber || amount === undefined || amount === null)
        return json({ success: false, error: "Missing required fields: phoneNumber, accountNumber, amount" }, 400);

      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount < 1) {
        return json({ success: false, error: "Invalid amount. Minimum ECG payment amount is GHS 1.00." }, 400);
      }

      const idemKey = req.headers.get("X-Idempotency-Key") || crypto.randomUUID();
      
      const { data: result, error: rpcError } = await supabase.schema("api").rpc("create_order_rpc", {
        p_user_id: currentUserId,
        p_network: "ECG",
        p_package_size: "AIRTIME", // Use AIRTIME internally so it bypasses strict data bundle checks
        p_phone: normalizeRecipient(phoneNumber),
        p_amount: numericAmount,
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
          cost: numericAmount,
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
        cost: numericAmount,
        balance: result.balance
      });
    }

    if (finalAction === "orders") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
      const { data: orders } = await supabase.schema("api").from("v_orders").select("*").eq("agent_id", currentUserId).order("created_at", { ascending: false }).limit(limit);
      return json({ success: true, orders: orders ?? [] });
    }

    if (finalAction === "orders_summary") {
      const { data: allOrders, error: ordErr } = await supabase
        .from("orders")
        .select("id, network, customer_phone, package_size, amount, status, created_at, metadata")
        .eq("agent_id", currentUserId)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (ordErr) {
        console.error("[developer-api/orders-summary] Error fetching orders:", ordErr);
        return json({ success: false, error: "Failed to fetch orders summary" }, 500);
      }

      const waitingList: any[] = [];
      const refundedList: any[] = [];
      const refundRequestedList: any[] = [];

      let waitingSum = 0;
      let refundedSum = 0;
      let refundReqSum = 0;

      for (const o of allOrders || []) {
        const orderId = String(o.metadata?.client_reference || o.id);
        const amountNum = Number(o.amount || 0);
        const amountStr = amountNum.toFixed(2);
        const gbSizeNum = parseCapacity(o.package_size);
        const gbSizeStr = gbSizeNum > 0 ? gbSizeNum.toFixed(2) : "1.00";
        const netStr = String(o.network || "").toUpperCase();
        const recipientStr = String(o.customer_phone || "");
        const statusStr = String(o.status || "").toLowerCase();

        const orderObj = {
          order_id: orderId,
          network: netStr,
          recipient: recipientStr,
          gb_size: gbSizeStr,
          price_paid: amountStr,
          amount_owed: amountStr,
          status: ["pending", "processing", "waiting", "awaiting_payment"].includes(statusStr) ? "waiting" : statusStr,
          created_at: o.created_at
        };

        if (["pending", "processing", "waiting", "awaiting_payment"].includes(statusStr)) {
          waitingList.push(orderObj);
          waitingSum += amountNum;
        } else if (["refunded", "cancelled"].includes(statusStr)) {
          refundedList.push(orderObj);
          refundedSum += amountNum;
        } else if (["refund_requested", "disputed"].includes(statusStr)) {
          refundRequestedList.push({ ...orderObj, paid: false });
          refundReqSum += amountNum;
        }
      }

      return json({
        waiting: {
          count: waitingList.length,
          total: waitingSum === 0 ? "0" : waitingSum.toFixed(2),
          orders: waitingList
        },
        refunded: {
          count: refundedList.length,
          total: refundedSum === 0 ? "0" : refundedSum.toFixed(2),
          orders: refundedList
        },
        refund_requested: {
          count: refundRequestedList.length,
          total: refundReqSum === 0 ? "0" : refundReqSum.toFixed(2),
          orders: refundRequestedList
        }
      });
    }

    if (finalAction === "callback") {
      if (req.method === "POST") {
        const payload = await req.json().catch(() => null);
        const callbackUrl = String(payload?.callback_url || payload?.url || "").trim();

        if (!callbackUrl) {
          return json({ success: false, error: "Missing required field: callback_url" }, 400);
        }

        if (!isSafeWebhookUrl(callbackUrl)) {
          return json({
            success: false,
            error: "Invalid or unsafe callback_url. Must be a public HTTPS URL."
          }, 400);
        }

        const { error: updateErr } = await supabase
          .from("profiles")
          .update({ api_webhook_url: callbackUrl })
          .eq("user_id", currentUserId);

        if (updateErr) {
          console.error("[developer-api/callback] Error updating callback URL:", updateErr);
          return json({ success: false, error: "Failed to register callback URL" }, 500);
        }

        return json({
          message: "Callback URL registered successfully.",
          callback_url: callbackUrl,
          note: "We will POST to this URL when your orders are delivered."
        });
      }

      // GET request
      const { data: prof } = await supabase
        .from("profiles")
        .select("api_webhook_url")
        .eq("user_id", currentUserId)
        .maybeSingle();

      return json({
        callback_url: prof?.api_webhook_url || ""
      });
    }

    if (finalAction === "status") {
      let orderId = "";
      const pathParts = p.split("/status/");
      if (pathParts.length > 1 && pathParts[1].trim() !== "") {
        orderId = pathParts[1].split("/")[0].trim();
      }

      orderId = orderId || 
                url.searchParams.get("order_id") || 
                url.searchParams.get("id") || 
                url.searchParams.get("reference") || 
                url.searchParams.get("orderNumber") || "";

      if (req.method === "POST" && !orderId) {
        try {
          const payload = await req.json().catch(() => null);
          if (payload) {
            orderId = payload.order_id || payload.id || payload.reference || payload.orderNumber || "";
          }
        } catch { /* ignore */ }
      }

      if (!orderId) {
        return json({ success: false, error: "Order ID or reference is required" }, 400);
      }

      let query = supabase
        .from("orders")
        .select("*")
        .eq("agent_id", currentUserId);

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(orderId)) {
        query = query.or(`id.eq.${orderId},metadata->>client_reference.eq.${orderId}`);
      } else {
        const cleanOrderId = orderId.replace(/[^a-zA-Z0-9._:-]/g, "");
        if (!cleanOrderId) {
          return json({ success: false, error: "Invalid order reference format" }, 400);
        }
        query = query.eq("metadata->>client_reference", cleanOrderId);
      }

      const { data: order, error } = await query.maybeSingle();

      if (error || !order) {
        return json({ success: false, error: `Order not found with reference: ${orderId}` }, 404);
      }

      let latestOrder = order;
      if (order.status === "processing") {
        try {
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

      let simpleStatus = "processing";
      const s = String(latestOrder.status || "").toLowerCase();
      if (s === "fulfilled" || s === "completed" || s === "success" || s === "delivered") {
        simpleStatus = "delivered";
      } else if (s === "failed" || s === "failure" || s === "fulfillment_failed" || s === "cancelled") {
        simpleStatus = "failed";
      } else if (s === "pending" || s === "awaiting_payment") {
        simpleStatus = "pending";
      } else if (s === "refunded") {
        simpleStatus = "refunded";
      }

      const clientRef = latestOrder.metadata?.client_reference || latestOrder.id;

      if (p.includes("/status/") || url.searchParams.get("format") === "simple") {
        return json({
          order_id: clientRef,
          status: simpleStatus
        });
      }

      let statusUpper = "PROCESSING";
      if (simpleStatus === "delivered") statusUpper = "SUCCESS";
      else if (simpleStatus === "failed" || simpleStatus === "refunded") statusUpper = "FAILED";

      let statusDescription = "Order sent to network provider, awaiting completion";
      if (statusUpper === "SUCCESS") statusDescription = "Order completed successfully";
      else if (statusUpper === "FAILED") statusDescription = latestOrder.failure_reason || "Order failed to deliver";

      return json({
        order_id: clientRef,
        status: simpleStatus,
        success: true,
        message: "Order status retrieved successfully",
        data: {
          orderNumber: latestOrder.id,
          reference: clientRef,
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

    if (finalAction === "order_refund") {
      if (req.method !== "GET" && req.method !== "POST") {
        return json({ success: false, error: "Method not allowed. Use GET or POST." }, 405);
      }

      const pathCancelMatch = path.match(/\/orders\/([^/]+)\/cancel$/i);
      const pathReference = pathCancelMatch ? decodeURIComponent(pathCancelMatch[1]).trim() : "";
      const isCancelEndpoint =
        p.endsWith("/cancel-order") ||
        p.endsWith("/cancel_order") ||
        Boolean(pathCancelMatch) ||
        action === "cancel-order" ||
        action === "cancel_order";

      let refParam = (url.searchParams.get("reference") || pathReference || "").trim();
      let orderNumberParam = (url.searchParams.get("orderNumber") || "").trim();
      let cancelReason = (url.searchParams.get("reason") || "").trim();

      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (body && typeof body === "object") {
          requestPayload = body;
          if (body.reference !== undefined && body.reference !== null && String(body.reference).trim() !== "") {
            refParam = String(body.reference).trim();
          }
          if (body.orderNumber !== undefined && body.orderNumber !== null && String(body.orderNumber).trim() !== "") {
            orderNumberParam = String(body.orderNumber).trim();
          }
          if (body.reason !== undefined && body.reason !== null && String(body.reason).trim() !== "") {
            cancelReason = String(body.reason).trim();
          }
        }
      }

      const targetIdentifier = refParam || orderNumberParam;
      if (!targetIdentifier) {
        return json({
          success: false,
          status: "error",
          error: "Either 'reference' or 'orderNumber' is required",
          message: "Either 'reference' or 'orderNumber' is required"
        }, 400);
      }

      let orderQuery = supabase
        .from("orders")
        .select("*")
        .eq("agent_id", currentUserId);

      const sanitizedTargetId = targetIdentifier.replace(/[^a-zA-Z0-9._:-]/g, "");
      if (!sanitizedTargetId) {
        return json({
          success: false,
          status: "error",
          error: "Invalid reference or orderNumber format",
          message: "Invalid reference or orderNumber format"
        }, 400);
      }

      if (UUID_RE.test(sanitizedTargetId)) {
        orderQuery = orderQuery.or(`id.eq.${sanitizedTargetId},provider_order_id.eq.${sanitizedTargetId},metadata->>client_reference.eq.${sanitizedTargetId}`);
      } else {
        orderQuery = orderQuery.or(`provider_order_id.eq.${sanitizedTargetId},metadata->>client_reference.eq.${sanitizedTargetId}`);
      }

      const { data: order, error: ordErr } = await orderQuery.limit(1).maybeSingle();
      if (ordErr || !order) {
        return json({
          success: false,
          status: "error",
          code: "ORDER_NOT_FOUND",
          error: "Order not found",
          message: "No order of yours has that reference."
        }, 404);
      }

      // Cancelling the same order twice is safe on /cancel-order: the second call answers success with alreadyCancelled: true and refunds nothing more.
      if (isCancelEndpoint && (order.status === "refunded" || order.auto_refunded === true)) {
        const { data: walletRow } = await supabase
          .from("wallets")
          .select("balance, api_balance")
          .eq("agent_id", currentUserId)
          .maybeSingle();
        const curBal = Number(walletRow?.balance ?? walletRow?.api_balance ?? 0);
        const clientReference = String(order.metadata?.client_reference || order.id);
        return json({
          success: true,
          status: "success",
          alreadyCancelled: true,
          message: "Order was already cancelled.",
          data: {
            reference: clientReference,
            orderId: order.provider_order_id && order.provider_order_id !== "refunded" ? order.provider_order_id : order.id,
            orderStatus: "cancelled",
            previousStatus: "cancelled",
            alreadyCancelled: true,
            refunded: false,
            refundAmount: 0,
            balanceAfter: curBal,
            cancelledAt: order.refunded_at || order.metadata?.datamart_cancelled_at || order.updated_at,
          }
        }, 200);
      }

      // Only orders owned by the account that are in PROCESSING / PENDING can be cancelled/refunded.
      if (order.status !== "processing" || order.auto_refunded === true) {
        return json({
          success: false,
          status: "error",
          code: "ORDER_NOT_CANCELLABLE",
          error: "Order is not eligible for refund",
          message: "The order is processing, completed, failed or in any status other than pending / waiting."
        }, isCancelEndpoint ? 409 : 400);
      }

      const hasProviderRef = Boolean(
        order.provider_order_id &&
        order.provider_order_id !== "" &&
        order.provider_order_id !== "failed_api_call" &&
        order.provider_order_id !== "timeout" &&
        order.provider_order_id !== "dispatching" &&
        order.provider_order_id !== "routed" &&
        order.provider_order_id !== "duplicate_cooldown" &&
        order.provider_order_id !== "paused_by_admin" &&
        order.provider_order_id !== "manual_fulfillment_mode" &&
        order.provider_order_id !== "refunded"
      );

      let upstreamRefundData: any = null;
      let isDataMartOrder = false;
      if (order.provider_id || hasProviderRef) {
        let assignedProvider: any = null;
        if (order.provider_id) {
          const { data: provRow } = await supabase
            .from("providers")
            .select("*")
            .eq("id", order.provider_id)
            .maybeSingle();
          assignedProvider = provRow;
        }
        const handlerType = String(assignedProvider?.handler_type || "").toLowerCase();
        const isDataHub = handlerType === "datahub" || String(assignedProvider?.name || "").toLowerCase().includes("datahub");
        const isDataMart = handlerType === "datamart" || String(assignedProvider?.name || "").toLowerCase().includes("datamart");
        isDataMartOrder = isDataMart;

        if ((!isDataHub && !isDataMart) || !assignedProvider) {
          return json({
            success: false,
            status: "error",
            code: "ORDER_NOT_CANCELLABLE",
            error: "Order is not eligible for refund",
            message: "This order has already been picked up for delivery and can no longer be cancelled."
          }, isCancelEndpoint ? 409 : 400);
        }

        const standardAdapter = new StandardAdapter();
        if (isDataMart) {
          const dmCancel = await standardAdapter.cancelDataMartOrder(supabase, assignedProvider, {
            reference: order.id,
            providerOrderId: order.provider_order_id,
            orderNumber: orderNumberParam || order.provider_order_id,
            clientReference: order.metadata?.client_reference,
            reason: cancelReason || "Customer requested order cancellation via API",
          });

          if (!dmCancel.ok) {
            const httpStatus =
              dmCancel.status === "not_found"
                ? 404
                : dmCancel.status === "unauthorized"
                ? 401
                : 409;
            const refusalCode =
              dmCancel.raw?.code ||
              (dmCancel.status === "order_in_progress"
                ? "ORDER_IN_PROGRESS"
                : dmCancel.status === "not_refundable_here"
                ? "ORDER_NOT_REFUNDABLE_HERE"
                : dmCancel.status === "not_found"
                ? "ORDER_NOT_FOUND"
                : dmCancel.status === "unauthorized"
                ? "API_KEY_REQUIRED"
                : "ORDER_NOT_CANCELLABLE");

            return json({
              success: false,
              status: "error",
              code: refusalCode,
              error: dmCancel.reason || "Order is not eligible for cancellation",
              message: dmCancel.reason || "Order can be cancelled only while its status is pending or waiting.",
              data: dmCancel.raw?.data || {
                reference: String(order.metadata?.client_reference || order.id),
                orderStatus: "pending",
              }
            }, httpStatus);
          }

          upstreamRefundData = dmCancel.raw || null;
        } else {
          const dhRefund = await standardAdapter.refundDataHubOrder(supabase, assignedProvider, {
            reference: order.id,
            orderNumber: orderNumberParam || order.provider_order_id,
            method: req.method === "GET" ? "GET" : "POST",
          });

          if (!dhRefund.ok) {
            const status = dhRefund.status === "not_found" ? 404 : dhRefund.status === "unauthorized" ? 401 : 400;
            return json({
              success: false,
              error: dhRefund.reason || "Order is not eligible for refund"
            }, status);
          }

          upstreamRefundData = dhRefund.raw || null;
        }
      }

      await supabase
        .from("orders")
        .update({
          provider_order_id: "refunded",
          failure_reason: isDataMartOrder ? "Cancelled via DataMart /cancel-order" : "Self-refunded via /order-refund",
          metadata: {
            ...(order.metadata || {}),
            self_refunded_at: new Date().toISOString(),
            ...(isDataMartOrder && upstreamRefundData
              ? {
                  datamart_cancelled_at: upstreamRefundData.cancelledAt || new Date().toISOString(),
                  datamart_cancel_data: upstreamRefundData,
                }
              : upstreamRefundData
              ? { datahub_refund_data: upstreamRefundData }
              : {}),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      const { data: refundSuccess, error: rpcErr } = await supabase.rpc("refund_failed_order", {
        p_order_id: order.id,
      });

      if (rpcErr || !refundSuccess) {
        return json({
          success: false,
          status: "error",
          code: "ORDER_NOT_CANCELLABLE",
          error: "Order is not eligible for refund"
        }, isCancelEndpoint ? 409 : 400);
      }

      const { data: walletRow } = await supabase
        .from("wallets")
        .select("balance, api_balance")
        .eq("agent_id", currentUserId)
        .maybeSingle();

      const updatedAtIso = new Date().toISOString();
      const paidAmt = Number(order.amount || 0);
      const clientReference = String(order.metadata?.client_reference || order.id);
      const resolvedOrderNum = upstreamRefundData?.orderNumber
        ?? upstreamRefundData?.orderId
        ?? (/^\d+$/.test(String(order.provider_order_id || "")) ? Number(order.provider_order_id) : order.id);
      const newBalanceVal = Number(walletRow?.balance ?? walletRow?.api_balance ?? 0);

      return json({
        success: true,
        status: "success",
        message: isDataMartOrder || isCancelEndpoint
          ? `Order cancelled. GHS ${paidAmt.toFixed(2)} has been returned to your wallet.`
          : "Refund credited to your wallet",
        data: {
          orderNumber: resolvedOrderNum,
          orderId: upstreamRefundData?.orderId || order.provider_order_id || order.id,
          reference: clientReference,
          status: "REFUNDED",
          orderStatus: "cancelled",
          previousStatus: upstreamRefundData?.previousStatus || "pending",
          refunded: true,
          refundAmount: paidAmt,
          refundedAmount: paidAmt,
          refundReference: upstreamRefundData?.refundReference || `API-CANCEL-${order.id}`,
          balanceAfter: newBalanceVal,
          newBalance: newBalanceVal,
          cancelledAt: upstreamRefundData?.cancelledAt || updatedAtIso,
          network: String(order.network || "").toUpperCase(),
          recipient: String(order.customer_phone || ""),
          dataAmount: String(order.package_size || ""),
          amountPaid: paidAmt,
          orderDate: order.created_at,
          updatedAt: updatedAtIso,
          completedAt: null,
        }
      }, 200);
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
