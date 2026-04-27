import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const DATA_PROVIDER_BASE_URL = Deno.env.get("DATA_PROVIDER_BASE_URL") || "";
const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY") || "";
const DATA_PROVIDER_WEBHOOK_URL = Deno.env.get("DATA_PROVIDER_WEBHOOK_URL") || "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

function buildProviderUrls(baseUrl: string, endpoint: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];
  const urls = new Set<string>();
  const aliases = endpoint === "purchase" ? ["purchase", "order", "airtime", "buy"] : [endpoint];
  let rootUrl = "";
  try { const parsed = new URL(clean); rootUrl = parsed.origin; } catch { rootUrl = ""; }
  for (const alias of aliases) {
    urls.add(`${clean}/api/${alias}`);
    urls.add(`${clean}/${alias}`);
    if (rootUrl) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
    }
  }
  return Array.from(urls);
}

async function callProviderApi(baseUrl: string, apiKey: string, endpoint: string, data: any, webhookUrl?: string) {
  const urls = buildProviderUrls(baseUrl, endpoint);
  const payload = { ...data };
  if (webhookUrl) payload.webhook_url = webhookUrl;

  let lastError = "No provider URLs found";

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-API-Key": apiKey,
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await response.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { body }; }

      if (response.ok) {
        const ok = (parsed.status === "success" || parsed.status === "true" || parsed.status === true || parsed.ok === true || !parsed.status);
        if (ok) {
          return { ok: true, status: response.status, reason: "", data: parsed };
        }
        lastError = parsed.message || parsed.reason || body;
      } else {
        lastError = parsed.message || parsed.reason || body;
        if (response.status === 404) continue;
        return { ok: false, status: response.status, reason: lastError, data: parsed };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error";
    }
  }

  return { ok: false, status: 502, reason: lastError };
}

async function verifyPaystack(reference: string) {
  if (!PAYSTACK_SECRET_KEY) return { ok: false, reason: "Missing Paystack Key" };
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });
    const data = await response.json();
    return {
      ok: data.status && data.data.status === "success",
      amount: data.data?.amount / 100,
      metadata: data.data?.metadata || {},
      reason: data.message || "Unpaid"
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Network error" };
  }
}

function mapNetworkKey(network: string): string {
  const n = network.trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return "YELLO";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "TELECEL";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AT_PREMIUM") return "AT_PREMIUM";
  return n;
}

function normalizeRecipient(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  return (phone || "").trim();
}

function parseCapacity(packageSize: string): number {
  const match = (packageSize || "").replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[retry-orders] Starting maintenance cycle...");
    const results = [];

    // ── PHASE 1: VERIFY PENDING PAYMENTS ──────────────────────────────────────
    // Check orders stuck in 'pending' from the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pendingOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "pending")
      .gte("created_at", yesterday)
      .limit(10);

    for (const order of pendingOrders || []) {
      console.log(`[retry-orders] Verifying pending order: ${order.id}`);
      const verification = await verifyPaystack(order.id);

      if (verification.ok) {
        console.log(`[retry-orders] Payment confirmed for ${order.id}. Marking as PAID.`);
        await supabaseAdmin.from("orders").update({ status: "paid" }).eq("id", order.id);
        // We'll let Phase 2 pick it up in this same run or next
        order.status = "paid";
      }
    }

    // ── PHASE 2: FULFILL PAID/FAILED ORDERS ───────────────────────────────────
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: ordersToRetry, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["fulfillment_failed", "processing", "paid"])
      .lt("retry_count", 4)
      .or(`last_retry_at.is.null,last_retry_at.lt.${twoMinutesAgo}`)
      .limit(15);

    if (fetchError) throw fetchError;

    for (const order of ordersToRetry || []) {
      const createdAt = new Date(order.created_at).getTime();
      // Wait at least 2 mins for processing orders
      if (order.status === "processing" && (Date.now() - createdAt) < 120000) continue;

      console.log(`[retry-orders] Processing order ${order.id} (Type: ${order.order_type}, Attempt: ${order.retry_count + 1})`);

      await supabaseAdmin
        .from("orders")
        .update({
          retry_count: order.retry_count + 1,
          last_retry_at: new Date().toISOString(),
          status: "processing"
        })
        .eq("id", order.id);

      let success = false;
      let failureReason = "";

      if (order.order_type === "agent_activation") {
        // Special case: just activate them
        await supabaseAdmin.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", order.agent_id);
        success = true;
      } else if (order.order_type === "sub_agent_activation") {
        await supabaseAdmin.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          sub_agent_approved: true,
          onboarding_complete: true
        }).eq("user_id", order.agent_id);
        success = true;
      } else if (order.order_type === "wallet_topup") {
        await supabaseAdmin.rpc("credit_wallet", { p_agent_id: order.agent_id, p_amount: order.amount });
        success = true;
      } else if (order.order_type === "afa") {
        const result = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "afa-registration", {
          afa_full_name: order.afa_full_name,
          afa_ghana_card: order.afa_ghana_card,
          afa_occupation: order.afa_occupation,
          afa_email: order.afa_email,
          afa_residence: order.afa_residence,
          afa_date_of_birth: order.afa_date_of_birth,
        });
        success = result.ok;
        failureReason = result.reason;
      } else if (order.order_type === "airtime") {
        const verification = await verifyPaystack(order.id);
        const basePrice = Number(verification.metadata?.base_price) || order.amount;
        const networkKey = mapNetworkKey(order.network);
        const recipient = normalizeRecipient(order.customer_phone);
        const airtimeResult = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
          networkRaw: order.network,
          networkKey,
          recipient,
          capacity: basePrice,
          amount: basePrice,
          order_type: "airtime"
        }, DATA_PROVIDER_WEBHOOK_URL);
        success = airtimeResult.ok;
        failureReason = airtimeResult.reason;
      } else {
        // Data bundle purchase
        const networkKey = mapNetworkKey(order.network);
        const recipient = normalizeRecipient(order.customer_phone);
        const capacity = parseCapacity(order.package_size);
        const result = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
          networkRaw: order.network,
          networkKey,
          recipient,
          capacity,
          amount: order.amount,
          order_type: "data"
        }, DATA_PROVIDER_WEBHOOK_URL);
        success = result.ok;
        failureReason = result.reason;
      }

      if (success) {
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", order.id);
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
        if (order.customer_phone) await sendPaymentSms(supabaseAdmin, order.customer_phone, "payment_success");
        results.push({ id: order.id, status: "fulfilled" });
      } else {
        await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: failureReason }).eq("id", order.id);
        results.push({ id: order.id, status: "failed", reason: failureReason });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[retry-orders] Global Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
