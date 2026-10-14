import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { normalizeRecipient } from "./utils.ts";

/**
 * AFARegistration.com adapter (https://afaregistration.com/api)
 *
 * Supports two products:
 *  - AFA registrations  -> POST /v1/registrations, GET /v1/registrations/{id}
 *  - Airtime            -> POST /v1/airtime,       GET /v1/airtime/{id}
 *
 * Auth: `X-API-Key` header. Every POST carries an `Idempotency-Key` equal to our order ID so a
 * timeout/retry can never double-debit the AFA wallet (the API returns the original request).
 *
 * provider_order_id format: `reg_<id>` or `air_<id>` so checkStatus knows which endpoint to poll.
 * Status updates arrive via signed webhooks (X-AFA-Timestamp / X-AFA-Signature) at provider-webhook.
 */

const DEFAULT_BASE_URL = "https://afaregistration.com/api";

const DELIVERED_STATUSES = ["completed", "approved", "delivered", "success", "successful"];
const FAILED_STATUSES = ["failed", "rejected", "cancelled", "canceled", "refunded", "reversed"];

type AfaKind = "registration" | "airtime";

function getCredentials(provider: any) {
  // Environment secrets take priority over DB configuration (workspace rule)
  const apiKey = Deno.env.get("AFA_API_KEY") || provider?.api_key || provider?.settings?.api_key || "";
  const baseUrl = (Deno.env.get("AFA_BASE_URL") || provider?.base_url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

function pick(data: any, ...keys: string[]): string {
  const meta = data?.metadata || {};
  for (const k of keys) {
    const v = data?.[k] ?? meta?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Normalises DOB to YYYY-MM-DD (accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY). */
export function normalizeDob(raw: string): string {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return s;
}

/** Normalises Ghana Card numbers to GHA-XXXXXXXXX-X (accepts spacing/dash/case variants). */
export function normalizeGhanaCard(raw: string): string {
  const compact = String(raw || "").toUpperCase().replace(/[\s-]+/g, "");
  const m = compact.match(/^GHA(\d{9})(\d)$/);
  return m ? `GHA-${m[1]}-${m[2]}` : String(raw || "").trim().toUpperCase();
}

function isAfaRegistration(data: any): boolean {
  const orderType = String(data?.order_type || "").toLowerCase();
  const net = String(data?.networkKey || data?.networkRaw || data?.network || "").toUpperCase();
  return orderType === "afa" || net === "AFA" || net.startsWith("AFA") ||
    Boolean(data?.fullName || data?.full_name || data?.afa_full_name || data?.metadata?.afa_full_name);
}

/** Maps the AFA status string to our unified ProviderResponse status. */
export function mapAfaStatus(rawStatus: string): "fulfilled" | "fulfillment_failed" | "processing" {
  const s = String(rawStatus || "").toLowerCase();
  if (DELIVERED_STATUSES.includes(s)) return "fulfilled";
  if (FAILED_STATUSES.includes(s)) return "fulfillment_failed";
  return "processing"; // pending, processing, review
}

function extractMessage(json: any, status: number): string {
  if (json?.errors && typeof json.errors === "object") {
    const first = Object.values(json.errors).flat()[0];
    if (first) return `${json.message || "Validation failed"}: ${first}`;
  }
  const msg = json?.message || json?.error || json?.data?.message;
  if (msg) return String(msg);
  switch (status) {
    case 400: return "AFARegistration: invalid request or missing Idempotency-Key";
    case 401: return "AFARegistration: invalid API key";
    case 402: return "AFARegistration: insufficient wallet balance";
    case 403: return "AFARegistration: key suspended, account inactive or IP blocked";
    case 409: return "AFARegistration: duplicate data or idempotency conflict";
    case 422: return "AFARegistration: validation failed";
    case 429: return "AFARegistration: rate limit exceeded";
    case 503: return "AFARegistration: airtime temporarily unavailable";
    default: return `AFARegistration: HTTP ${status}`;
  }
}

export class AfaRegistrationAdapter implements ProviderAdapter {
  mapNetwork(rawNetwork: string): string {
    const n = String(rawNetwork || "").toUpperCase().trim();
    if (n.includes("TELECEL") || n.includes("VODA")) return "telecel";
    if (n.includes("AIRTEL") || n.includes("TIGO") || n === "AT" || n.startsWith("AT ") || n.startsWith("AT_")) return "airteltigo";
    return "mtn";
  }

  private resolveNetwork(provider: any, rawNetwork: string): string {
    const mapped = this.mapNetwork(rawNetwork);
    // Optional override from Admin → Providers settings, e.g. {"network_map": {"airteltigo": "at"}}
    const override = provider?.settings?.network_map?.[mapped];
    return override ? String(override) : mapped;
  }

  private async post(baseUrl: string, apiKey: string, path: string, idempotencyKey: string, body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { res, text, json };
  }

  private toResponse(kind: AfaKind, res: Response, text: string, json: any): ProviderResponse {
    const record = json?.data?.registration || json?.data?.airtime || json?.data || {};
    const accepted = (res.status === 200 || res.status === 201) && json?.success !== false && record?.id !== undefined;

    if (!accepted) {
      return { ok: false, reason: extractMessage(json, res.status), rawBody: text, raw: json };
    }

    const mapped = mapAfaStatus(record.status);
    const prefix = kind === "registration" ? "reg_" : "air_";
    if (mapped === "fulfillment_failed") {
      // Idempotent replay of a previously failed request — treat as a rejection so failover can continue
      return {
        ok: false,
        id: `${prefix}${record.id}`,
        reason: record.failure_reason || record.reason || record.status_label || `AFARegistration ${kind} ${record.status}`,
        rawBody: text,
        raw: json,
      };
    }

    return {
      ok: true,
      id: `${prefix}${record.id}`,
      status: mapped === "fulfilled" ? "delivered" : "processing",
      reason: record.status_label || undefined,
      rawBody: text,
      raw: json,
    };
  }

  async purchase(supabaseAdmin: any, provider: any, data: PurchaseData): Promise<ProviderResponse> {
    const { apiKey, baseUrl } = getCredentials(provider);
    if (!apiKey) {
      return { ok: false, reason: "AFARegistration API key not configured (set AFA_API_KEY secret)." };
    }

    const orderId = pick(data, "reference", "orderReference", "order_id", "id");
    if (!orderId) {
      return { ok: false, reason: "AFARegistration: missing order reference for Idempotency-Key." };
    }

    const recipient = normalizeRecipient(pick(data, "recipient", "phoneNumber", "phone", "customer_phone", "phone_number", "customerNumber", "payment_phone"));
    if (!/^0\d{9}$/.test(recipient)) {
      return { ok: false, reason: `Invalid recipient number: ${recipient || "(empty)"}` };
    }

    const orderType = String(data?.order_type || data?.metadata?.order_type || "").toLowerCase();

    try {
      // ── AFA Registration ───────────────────────────────────────────────
      if (isAfaRegistration(data)) {
        const body = {
          external_order_id: orderId,
          full_name: pick(data, "full_name", "fullName", "afa_full_name", "name"),
          phone_number: recipient,
          id_type: pick(data, "id_type", "afa_id_type") || "Ghana Card",
          id_number: normalizeGhanaCard(pick(data, "id_number", "ghana_card", "ghanaCardNumber", "afa_ghana_card")),
          location: pick(data, "location", "placeOfResidence", "afa_residence", "residence"),
          dob: normalizeDob(pick(data, "dob", "date_of_birth", "dateOfBirth", "afa_date_of_birth")),
          occupation: pick(data, "occupation", "afa_occupation"),
        };

        const missing = Object.entries(body).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length > 0) {
          return { ok: false, reason: `AFA registration missing fields: ${missing.join(", ")}` };
        }

        console.log(`[AfaRegistrationAdapter] Creating AFA registration for order ${orderId} (${recipient})`);
        const { res, text, json } = await this.post(baseUrl, apiKey, "/v1/registrations", orderId, body);
        console.log(`[AfaRegistrationAdapter] Registration response ${res.status}: ${text.slice(0, 500)}`);
        return this.toResponse("registration", res, text, json);
      }

      // ── Airtime ────────────────────────────────────────────────────────
      if (orderType === "airtime" || String(data?.package_size || "").toUpperCase() === "AIRTIME") {
        // Deliver the base price (excluding payment fees) — never the gross charged amount
        const amount = Number(data?.metadata?.base_price || data?.amount || 0);
        if (!(amount > 0)) {
          return { ok: false, reason: "AFARegistration: invalid airtime amount." };
        }

        const body = {
          external_order_id: orderId,
          network: this.resolveNetwork(provider, String(data.networkRaw || data.network || data.networkKey || "")),
          recipient,
          amount: amount.toFixed(2),
        };

        console.log(`[AfaRegistrationAdapter] Sending GHS ${body.amount} ${body.network} airtime to ${recipient} (order ${orderId})`);
        const { res, text, json } = await this.post(baseUrl, apiKey, "/v1/airtime", orderId, body);
        console.log(`[AfaRegistrationAdapter] Airtime response ${res.status}: ${text.slice(0, 500)}`);
        return this.toResponse("airtime", res, text, json);
      }

      return { ok: false, reason: `AFARegistration only supports AFA registrations and airtime (got '${orderType || "data"}').` };
    } catch (err: any) {
      console.error("[AfaRegistrationAdapter] Purchase error:", err);
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      return { ok: false, reason: isTimeout ? "AFARegistration request timeout" : (err?.message || "AFARegistration network error") };
    }
  }

  async checkStatus(supabaseAdmin: any, provider: any, providerOrderId: string, reference: string): Promise<ProviderResponse> {
    const { apiKey, baseUrl } = getCredentials(provider);
    if (!apiKey) return { ok: false, reason: "AFARegistration API key not configured." };

    const pid = String(providerOrderId || "").trim();
    const match = pid.match(/^(reg|air)_(\d+)$/);
    const candidates: string[] = match
      ? [`/v1/${match[1] === "reg" ? "registrations" : "airtime"}/${match[2]}`]
      : (/^\d+$/.test(pid) ? [`/v1/airtime/${pid}`, `/v1/registrations/${pid}`] : []);

    if (candidates.length === 0) {
      return { ok: false, reason: `AFARegistration: cannot check status without a provider order ID (ref ${reference}).` };
    }

    for (const path of candidates) {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { "X-API-Key": apiKey, "Accept": "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        let json: any = {};
        try { json = JSON.parse(text); } catch { /* ignore */ }
        if (res.status === 404) continue;

        const record = json?.data?.registration || json?.data?.airtime || json?.data || {};
        if (!res.ok || !record?.status) {
          return { ok: false, reason: extractMessage(json, res.status), rawBody: text, raw: json };
        }

        const mapped = mapAfaStatus(record.status);
        return {
          ok: mapped !== "fulfillment_failed",
          id: pid,
          status: mapped === "fulfilled" ? "delivered" : (mapped === "fulfillment_failed" ? "failed" : "processing"),
          reason: record.status_label || record.status,
          rawBody: text,
          raw: json,
        };
      } catch (err: any) {
        console.error(`[AfaRegistrationAdapter] Status check error (${path}):`, err);
        return { ok: false, reason: err?.message || "AFARegistration status check failed" };
      }
    }

    return { ok: false, reason: "AFARegistration: order not found" };
  }
}
