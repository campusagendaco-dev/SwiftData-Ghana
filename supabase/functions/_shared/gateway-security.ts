// High-Security Payment Gateway helpers (Web Crypto API — works in Deno & Node/Vitest)

export const GATEWAY_TIMESTAMP_WINDOW_SEC = 300; // ±5 minutes
export const GATEWAY_MAX_FEE_GHS = 100;

const PRIVATE_IPV4_OR_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)/i;
const PRIVATE_IPV6_RE = /^(::1?$|0:0:0:0:0:0:0:1$|::ffff:|fc|fd|fe[89ab])/i;

function isPrivateOrLoopbackHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host.includes(":")) return PRIVATE_IPV6_RE.test(host);
  return PRIVATE_IPV4_OR_HOST_RE.test(host);
}

/** Constant-time string comparison to prevent timing side-channels. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const maxLen = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** SHA-256 hex digest using Web Crypto API. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256 hex digest using Web Crypto API. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical signing string for inbound merchant API requests:
 * `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${rawBody}`
 */
export function buildRequestSigningString(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${rawBody}`;
}

export async function signGatewayRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: string,
): Promise<string> {
  const msg = buildRequestSigningString(timestamp, nonce, method, path, rawBody);
  return hmacSha256Hex(secret, msg);
}

export function isTimestampFresh(
  timestampHeader: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  windowSec = GATEWAY_TIMESTAMP_WINDOW_SEC,
): boolean {
  if (!timestampHeader) return false;
  if (!/^\d{9,12}$/.test(timestampHeader.trim())) return false;
  const ts = Number(timestampHeader.trim());
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSec - ts) <= windowSec;
}

export async function verifyGatewayRequestSignature(params: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  rawBody: string;
  providedSignature: string;
  nowSec?: number;
}): Promise<{ valid: boolean; reason?: string }> {
  if (!isTimestampFresh(params.timestamp, params.nowSec)) {
    return { valid: false, reason: "Request timestamp is missing or outside the ±5 minute window." };
  }
  if (!params.nonce || params.nonce.trim().length < 8 || params.nonce.trim().length > 128) {
    return { valid: false, reason: "X-Swift-Nonce must be a unique string (8-128 chars)." };
  }
  if (!params.providedSignature || !/^[0-9a-f]{64}$/i.test(params.providedSignature.trim())) {
    return { valid: false, reason: "X-Swift-Signature must be a valid 64-char hex HMAC-SHA256 digest." };
  }
  const expected = await signGatewayRequest(
    params.secret,
    params.timestamp.trim(),
    params.nonce.trim(),
    params.method,
    params.path,
    params.rawBody,
  );
  if (!timingSafeEqual(expected, params.providedSignature.trim().toLowerCase())) {
    return { valid: false, reason: "Invalid request signature." };
  }
  return { valid: true };
}

/** SSRF-safe HTTPS webhook URL check (blocks loopback, private IPs, metadata, credentials, non-HTTPS). */
export function isSafeGatewayWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || isPrivateOrLoopbackHost(host)) return false;
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
    if (parsed.port && parsed.port !== "443") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that a redirect/callback URL is HTTPS, has no embedded credentials,
 * and matches one of the merchant's allowed_domains (exact host or subdomain).
 */
export function isAllowedRedirectUrl(rawUrl: string, allowedDomains: string[]): boolean {
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || isPrivateOrLoopbackHost(host)) return false;

    return allowedDomains.some((rawDomain) => {
      const domain = String(rawDomain || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^\*\./, "");
      if (!domain || !domain.includes(".")) return false;
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

/** Checks client IP against merchant allowed_ips (if configured). Empty list allows all IPs. */
export function isAllowedClientIp(clientIp: string, allowedIps: string[] | null | undefined): boolean {
  if (!Array.isArray(allowedIps) || allowedIps.length === 0) return true;
  const cleaned = allowedIps.map((ip) => String(ip || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return true;
  const candidate = String(clientIp || "").trim();
  if (!candidate) return false;
  return cleaned.includes(candidate);
}

/** Extracts the real client IP from standard proxy headers. */
export function extractClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return "";
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Normalizes a fee rate stored either as a decimal fraction (e.g. `0.03` for 3%)
 * or as a percentage (e.g. `3` for 3%) into a percentage value (0..100).
 */
export function normalizeFeePercent(raw: unknown, defaultPercent = 3): number {
  if (raw === null || raw === undefined || raw === "") return defaultPercent;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return defaultPercent;
  return n > 0 && n <= 1 ? round2(n * 100) : n;
}

/**
 * Computes customer-paid fee, total charged, platform fee, and merchant net settlement.
 * Customer always pays base + fee (capped at GHS 100).
 */
export function calculateCollectionAmounts(params: {
  baseAmount: number;
  feePercent: number;
  platformFeePercent?: number;
  maxFee?: number;
}): {
  baseAmount: number;
  customerFee: number;
  platformFee: number;
  totalCharged: number;
  netSettlement: number;
} {
  const base = round2(params.baseAmount);
  const feePct = Math.max(0, Number(params.feePercent) || 0);
  const platPct = Math.max(0, Number(params.platformFeePercent) || 0);
  const cap = params.maxFee ?? GATEWAY_MAX_FEE_GHS;

  const customerFee = round2(Math.min(base * (feePct / 100), cap));
  const platformFee = round2(base * (platPct / 100));
  const totalCharged = round2(base + customerFee);
  const netSettlement = round2(Math.max(0.01, base - platformFee));

  return { baseAmount: base, customerFee, platformFee, totalCharged, netSettlement };
}

/** Generates a Stripe-style webhook signature header: `t=<unix_sec>,v1=<hmac_sha256>`. */
export async function buildWebhookSignatureHeader(
  webhookSecret: string,
  payloadString: string,
  timestampSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const sig = await hmacSha256Hex(webhookSecret, `${timestampSec}.${payloadString}`);
  return `t=${timestampSec},v1=${sig}`;
}

/**
 * Dispatches a signed webhook to a gateway merchant and records the attempt in
 * `gateway_webhook_deliveries` with exponential backoff retry scheduling on failure.
 */
export async function dispatchGatewayWebhook(
  supabaseAdmin: any,
  params: {
    collectionId: string;
    merchantId: string;
    event: string;
    data: Record<string, unknown>;
    existingDeliveryId?: string;
  },
): Promise<{ delivered: boolean; status?: number; error?: string; deliveryId?: string }> {
  try {
    const { data: merchant } = await supabaseAdmin
      .from("gateway_merchants")
      .select("id, webhook_url, webhook_secret")
      .eq("id", params.merchantId)
      .maybeSingle();

    if (!merchant?.webhook_url || !merchant?.webhook_secret) {
      return { delivered: false, error: "Merchant webhook URL or secret not configured" };
    }

    if (!isSafeGatewayWebhookUrl(merchant.webhook_url)) {
      console.warn(`[gateway-webhook] Blocked unsafe webhook URL for merchant ${params.merchantId}`);
      return { delivered: false, error: "Blocked unsafe webhook URL" };
    }

    const bodyObj = {
      event: params.event,
      timestamp: new Date().toISOString(),
      data: params.data,
    };
    const payloadStr = JSON.stringify(bodyObj);

    let deliveryId = params.existingDeliveryId;
    let attemptCount = 1;
    let maxAttempts = 5;

    if (deliveryId) {
      const { data: existing } = await supabaseAdmin
        .from("gateway_webhook_deliveries")
        .select("attempt_count, max_attempts")
        .eq("id", deliveryId)
        .maybeSingle();
      attemptCount = Number(existing?.attempt_count || 0) + 1;
      maxAttempts = Number(existing?.max_attempts || 5);
    } else {
      const { data: inserted } = await supabaseAdmin
        .from("gateway_webhook_deliveries")
        .insert({
          collection_id: params.collectionId,
          merchant_id: params.merchantId,
          event: params.event,
          target_url: merchant.webhook_url,
          payload: bodyObj,
          attempt_count: 1,
          status: "pending",
        })
        .select("id")
        .single();
      deliveryId = inserted?.id;
    }

    const sigHeader = await buildWebhookSignatureHeader(merchant.webhook_secret, payloadStr);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let httpStatus: number | null = null;
    let errMsg: string | null = null;
    let delivered = false;

    try {
      const res = await fetch(merchant.webhook_url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Swift-Webhook-Signature": sigHeader,
          "X-Swift-Event": params.event,
          "X-Swift-Delivery-Id": deliveryId || "",
          "User-Agent": "SwiftData-PaymentGateway/1.0",
        },
        body: payloadStr,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      httpStatus = res.status;
      if (res.status >= 300 && res.status < 400) {
        errMsg = `HTTP ${res.status}: Redirects are not permitted for webhooks`;
      } else if (res.ok) {
        delivered = true;
      } else {
        const text = await res.text().catch(() => "");
        errMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      }
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      errMsg = fetchErr?.name === "AbortError" ? "Webhook request timed out (8s)" : String(fetchErr?.message || fetchErr);
    }

    if (deliveryId) {
      // Exponential backoff: 1m, 5m, 15m, 60m
      const backoffMins = [1, 5, 15, 60, 180][Math.min(attemptCount - 1, 4)];
      const nextRetryAt =
        !delivered && attemptCount < maxAttempts
          ? new Date(Date.now() + backoffMins * 60 * 1000).toISOString()
          : null;

      await supabaseAdmin
        .from("gateway_webhook_deliveries")
        .update({
          attempt_count: attemptCount,
          last_http_status: httpStatus,
          last_error: errMsg,
          status: delivered ? "delivered" : attemptCount >= maxAttempts ? "failed" : "pending",
          delivered_at: delivered ? new Date().toISOString() : null,
          next_retry_at: nextRetryAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);
    }

    return { delivered, status: httpStatus ?? undefined, error: errMsg ?? undefined, deliveryId };
  } catch (err: any) {
    console.error("[gateway-webhook] Unexpected error:", err?.message || err);
    return { delivered: false, error: String(err?.message || err) };
  }
}
