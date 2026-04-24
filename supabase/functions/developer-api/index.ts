import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
};

function getEnv(...keys: string[]): string {
  for (const k of keys) { const v = Deno.env.get(k)?.trim(); if (v) return v; }
  return "";
}

function mapNetworkKey(network: string): string {
  const n = network.trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE") return "TELECEL";
  if (n === "MTN") return "YELLO";
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

async function callProvider(
  baseUrl: string, apiKey: string,
  network: string, packageSize: string, phone: string, webhookUrl: string,
): Promise<{ ok: boolean; reason: string }> {
  const clean = baseUrl.replace(/\/+$/, "");
  const urls: string[] = [];
  try {
    const { origin } = new URL(clean);
    urls.push(`${clean}/api/purchase`, `${clean}/purchase`, `${origin}/api/purchase`);
  } catch { urls.push(`${clean}/api/purchase`, `${clean}/purchase`); }

  const body: Record<string, unknown> = {
    networkRaw: network,
    networkKey: mapNetworkKey(network),
    recipient: normalizeRecipient(phone),
    capacity: parseCapacity(packageSize),
  };
  if (webhookUrl) body.webhook_url = webhookUrl;

  for (const url of [...new Set(urls)]) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const text = await res.text();
      if (res.ok && !isHtmlBody(res.headers.get("content-type"), text)) {
        try {
          const p = JSON.parse(text);
          const s = String(p?.status ?? "").toLowerCase();
          if (s === "false" || s === "error" || s === "failed")
            return { ok: false, reason: p?.message || "Provider rejected the order" };
        } catch { /* non-JSON 2xx = ok */ }
        return { ok: true, reason: "" };
      }
      if (res.status === 404 || isHtmlBody(res.headers.get("content-type"), text)) continue;
      return { ok: false, reason: `Provider error ${res.status}` };
    } catch (e) {
      clearTimeout(tid);
      if (url === [...new Set(urls)].at(-1))
        return { ok: false, reason: e instanceof Error ? e.message : "Provider unreachable" };
    }
  }
  return { ok: false, reason: "All provider endpoints failed" };
}

// Timing-safe string comparison to prevent timing attacks on API keys
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return json({ error: "Server misconfigured" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Extract API key ─────────────────────────────────────────────────────
  const rawApiKey = (req.headers.get("x-api-key") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!rawApiKey) return json({ error: "Missing API key. Supply via x-api-key header." }, 401);

  // ── 2. Authenticate (timing-safe lookup) ─────────────────────────────────
  // Fetch profiles that start with the same prefix to avoid full-table scan,
  // then use safeEqual to prevent timing attacks.
  const prefix = rawApiKey.slice(0, 12); // "sdg_live_xxxx"
  const { data: candidates } = await supabase
    .from("profiles")
    .select("user_id, full_name, api_key, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, agent_approved, sub_agent_approved, api_custom_prices")
    .like("api_key", `${prefix}%`);

  type ProfileRow = {
    user_id: string;
    full_name: string;
    api_key: string | null;
    api_access_enabled: boolean;
    api_rate_limit: number | null;
    api_allowed_actions: string[] | null;
    api_ip_whitelist: string[] | null;
    api_webhook_url: string | null;
    agent_approved: boolean;
    sub_agent_approved: boolean;
    api_custom_prices: Record<string, Record<string, number>> | null;
  };
  const profile = (candidates as ProfileRow[] ?? []).find((p) => p.api_key && safeEqual(p.api_key, rawApiKey));
  if (!profile) return json({ error: "Invalid API key" }, 401);

  // ── 3. Access checks ──────────────────────────────────────────────────────
  if (!profile.api_access_enabled)
    return json({ error: "API access has been revoked for this account. Contact support." }, 403);

  const isApproved = profile.agent_approved || profile.sub_agent_approved;
  if (!isApproved)
    return json({ error: "Account is not an approved agent. API access requires agent approval." }, 403);

  // ── 4. IP whitelist ───────────────────────────────────────────────────────
  const whitelist: string[] = Array.isArray(profile.api_ip_whitelist) ? profile.api_ip_whitelist : [];
  if (whitelist.length > 0) {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") || "";
    if (!whitelist.some((ip) => ip.trim() === clientIp)) {
      return json({ error: `IP ${clientIp} is not whitelisted for this account.` }, 403);
    }
  }

  // ── 5. Rate limiting (DB-backed sliding window) ──────────────────────────
  const rateLimit = Number(profile.api_rate_limit) || 30;
  // Count requests in the last 60 seconds via the profile counters reset daily.
  // For per-minute rate limiting we use a lightweight window check via the orders table.
  // Simple approach: count orders created by this user in the last 60 seconds.
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", profile.user_id)
    .gte("created_at", oneMinuteAgo);

  if ((recentCount ?? 0) >= rateLimit) {
    return json({ error: `Rate limit exceeded: max ${rateLimit} requests/minute.` }, 429);
  }

  // ── 6. Increment usage counters ──────────────────────────────────────────
  await supabase.rpc("increment_api_usage", { p_user_id: profile.user_id });

  // ── 7. Parse action ───────────────────────────────────────────────────────
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const allowedActions: string[] = Array.isArray(profile.api_allowed_actions)
    ? profile.api_allowed_actions
    : ["balance", "plans"];

  if (!allowedActions.includes(action)) {
    return json({
      error: `Action '${action}' is not permitted for this API key. Allowed: ${allowedActions.join(", ")}`,
    }, 403);
  }

  try {
    // ── balance ─────────────────────────────────────────────────────────────
    if (action === "balance") {
      const { data: wallet } = await supabase
        .from("wallets").select("balance").eq("agent_id", profile.user_id).maybeSingle();
      return json({ success: true, balance: Number(wallet?.balance ?? 0) });
    }

    // ── plans ────────────────────────────────────────────────────────────────
    if (action === "plans") {
      const { data: plans } = await supabase
        .from("global_package_settings")
        .select("network, package_size, agent_price, public_price, api_price, is_unavailable")
        .eq("is_unavailable", false)
        .order("network").order("package_size");

      // Apply custom overrides for this user
      const customPrices = profile.api_custom_prices || {};
      const customizedPlans = (plans || []).map(p => {
        const override = customPrices[p.network]?.[p.package_size];
        if (override && override > 0) {
          return { ...p, api_price: override, is_custom: true };
        }
        return p;
      });

      return json({ success: true, plans: customizedPlans });
    }

    // ── buy ──────────────────────────────────────────────────────────────────
    if (action === "buy" && req.method === "POST") {
      const payload = await req.json().catch(() => null);
      if (!payload) return json({ error: "Invalid JSON body" }, 400);

      const { network, package_size, phone, request_id } = payload as Record<string, string>;
      if (!network || !package_size || !phone)
        return json({ error: "Missing required fields: network, package_size, phone" }, 400);

      const ALLOWED_NETWORKS = ["MTN", "Telecel", "AirtelTigo"];
      if (!ALLOWED_NETWORKS.includes(network))
        return json({ error: `Invalid network. Allowed: ${ALLOWED_NETWORKS.join(", ")}` }, 400);

      // Idempotency via request_id
      if (request_id) {
        const { data: dup } = await supabase
          .from("orders")
          .select("id, status")
          .eq("id", request_id)
          .maybeSingle();
        if (dup) return json({ success: true, order_id: dup.id, status: dup.status, duplicate: true }, 200);
      }

      // Check system settings
      const { data: sys } = await supabase.from("system_settings").select("disable_ordering, holiday_message").eq("id", 1).maybeSingle();
      if (sys?.disable_ordering) return json({ error: sys.holiday_message || "Ordering is currently disabled." }, 503);

      // Resolve price
      const normalizedPkg = package_size.replace(/\s+/g, "").toUpperCase();
      const { data: pkgRow } = await supabase
        .from("global_package_settings")
        .select("agent_price, public_price, api_price, is_unavailable")
        .eq("network", network)
        .eq("package_size", normalizedPkg)
        .maybeSingle();

      if (pkgRow?.is_unavailable) return json({ error: "Package is unavailable" }, 400);

      // Priority: user_custom_price > global_api_price > global_agent_price > global_public_price
      let expectedPrice = 0;
      const customOverride = profile.api_custom_prices?.[network]?.[package_size];
      
      if (Number(customOverride) > 0) {
        expectedPrice = Number(customOverride);
      } else if (Number(pkgRow?.api_price) > 0) {
        expectedPrice = Number(pkgRow!.api_price);
      } else if (Number(pkgRow?.agent_price) > 0) {
        expectedPrice = Number(pkgRow!.agent_price);
      } else {
        expectedPrice = Number(pkgRow?.public_price);
      }

      if (!(Number.isFinite(expectedPrice) && expectedPrice > 0))
        return json({ error: "Package price not configured" }, 400);

      // Ensure wallet row exists
      const { data: existingWallet } = await supabase.from("wallets").select("id").eq("agent_id", profile.user_id).maybeSingle();
      if (!existingWallet) await supabase.from("wallets").insert({ agent_id: profile.user_id, balance: 0 });

      // Atomic wallet debit
      const { data: debitResult, error: debitError } = await supabase.rpc("debit_wallet", {
        p_agent_id: profile.user_id,
        p_amount: expectedPrice,
      });
      if (debitError || !debitResult?.success) {
        const bal = Number(debitResult?.balance ?? 0);
        return json({
          error: debitResult?.error === "Insufficient balance"
            ? `Insufficient wallet balance. Available: GHS ${bal.toFixed(2)}, required: GHS ${expectedPrice.toFixed(2)}`
            : (debitResult?.error || "Wallet debit failed"),
        }, 402);
      }

      // Create order
      const orderId = request_id || crypto.randomUUID();
      await supabase.from("orders").insert({
        id: orderId,
        agent_id: profile.user_id,
        order_type: "data",
        network,
        package_size,
        customer_phone: normalizeRecipient(phone),
        amount: expectedPrice,
        profit: 0,
        status: "paid",
      });

      // Fulfill
      const DATA_PROVIDER_API_KEY = getEnv("PRIMARY_DATA_PROVIDER_API_KEY", "DATA_PROVIDER_API_KEY");
      const DATA_PROVIDER_BASE_URL = getEnv("PRIMARY_DATA_PROVIDER_BASE_URL", "DATA_PROVIDER_BASE_URL");
      const WEBHOOK_URL = profile.api_webhook_url || getEnv("DATA_PROVIDER_WEBHOOK_URL");

      if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Data provider not configured" }).eq("id", orderId);
        return json({ success: false, order_id: orderId, status: "fulfillment_failed", error: "Data provider not configured" }, 503);
      }

      const result = await callProvider(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, network, package_size, phone, WEBHOOK_URL);

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        return json({ success: true, order_id: orderId, status: "fulfilled" });
      }

      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
      return json({ success: false, order_id: orderId, status: "fulfillment_failed", error: result.reason, retryable: true });
    }

    // ── orders (read own orders) ─────────────────────────────────────────────
    if (action === "orders") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
      const { data: orders } = await supabase
        .from("orders")
        .select("id, created_at, network, package_size, customer_phone, amount, status, failure_reason")
        .eq("agent_id", profile.user_id)
        .order("created_at", { ascending: false })
        .limit(limit);
      return json({ success: true, orders: orders ?? [] });
    }

    return json({ error: `Unknown action '${action}'. Allowed: ${allowedActions.join(", ")}` }, 400);

  } catch (err) {
    console.error("developer-api error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
