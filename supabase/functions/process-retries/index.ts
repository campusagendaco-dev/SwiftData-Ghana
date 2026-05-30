import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { sendWhatsAppMessage } from "../_shared/whatsapp.ts";

declare const Deno: any;

// const supabaseAdmin = createClient(...)

const DATA_PROVIDER_BASE_URL = (Deno as any).env.get("DATA_PROVIDER_BASE_URL") || "";
const DATA_PROVIDER_API_KEY = (Deno as any).env.get("DATA_PROVIDER_API_KEY") || "";
const DATA_PROVIDER_WEBHOOK_URL = (Deno as any).env.get("DATA_PROVIDER_WEBHOOK_URL") || "";
const PAYSTACK_SECRET_KEY = (Deno as any).env.get("PAYSTACK_SECRET_KEY") || "";

function buildProviderUrls(baseUrl: string, endpoint: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];
  const urls = new Set<string>();
  const aliases = endpoint === "purchase" ? ["purchase", "order", "airtime", "buy", "data-purchase"] : [endpoint];
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

async function verifyPaystack(supabaseAdmin: any, reference: string) {
  let paystackKey = "";
  try {
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();
    paystackKey = settings?.paystack_secret_key || "";
  } catch (dbErr) {
    console.error("Failed to fetch paystack_secret_key from DB in verifyPaystack:", dbErr);
  }

  if (!paystackKey) {
    paystackKey = (Deno as any).env.get("PAYSTACK_SECRET_KEY") || "";
  }

  if (!paystackKey) return { ok: false, reason: "Missing Paystack Key" };
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackKey}`, Accept: "application/json" },
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

async function sendWhatsAppFulfillmentNotification(to: string, type: string, net: string, pkg: string, phone: string) {
  try {
    const msg = [
      `✅ *Order Fulfilled!*`,
      ``,
      `Your *${net} ${pkg || type}* order for *${phone}* has been delivered successfully. 🚀`,
      ``,
      `Thank you for choosing SwiftData!`,
    ].join("\n");
    await sendWhatsAppMessage(to, msg);
  } catch (err) {
    console.error("[WhatsApp Retries] Notification error:", err);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
      const verification = await verifyPaystack(supabaseAdmin, order.id);

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
      .in("status", ["paid", "processing"])
      .gte("created_at", yesterday)
      .lt("retry_count", 3)
      .or(`last_retry_at.is.null,last_retry_at.lt.${twoMinutesAgo}`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (fetchError) throw fetchError;

    for (const order of ordersToRetry || []) {
      console.log(`[retry-orders] Delegating order ${order.id} (Retry ${order.retry_count + 1}/3) to verify-payment...`);
      
      // Increment retry count immediately to avoid double-processing
      await supabaseAdmin.from("orders").update({
        retry_count: (order.retry_count || 0) + 1,
        last_retry_at: new Date().toISOString()
      }).eq("id", order.id);

      try {
        const fulfillRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ reference: order.id }),
        });

        const fulfillData = await fulfillRes.json();
        if (fulfillData.status === "fulfilled") {
          results.push({ id: order.id, status: "fulfilled" });
        } else {
          // If this was the final retry and it didn't succeed, mark as permanently failed to trigger auto-refund!
          const newRetryCount = (order.retry_count || 0) + 1;
          if (newRetryCount >= 3) {
            console.log(`[retry-orders] Max retries reached for ${order.id}. Marking as fulfillment_failed to trigger refund.`);
            await supabaseAdmin.from("orders").update({
              status: "fulfillment_failed",
              failure_reason: fulfillData.reason || fulfillData.error || "Max retries reached"
            }).eq("id", order.id);
            results.push({ id: order.id, status: "fulfillment_failed", reason: "Max retries reached" });
          } else {
            results.push({ id: order.id, status: fulfillData.status || "failed", reason: fulfillData.reason || fulfillData.error });
          }
        }
      } catch (e) {
        console.error(`[retry-orders] Error processing ${order.id}:`, e);
        
        // Failsafe for crash on final retry
        const newRetryCount = (order.retry_count || 0) + 1;
        if (newRetryCount >= 3) {
           await supabaseAdmin.from("orders").update({
             status: "fulfillment_failed",
             failure_reason: "Max retries reached with internal crash"
           }).eq("id", order.id);
        }
        
        results.push({ id: order.id, status: "error", reason: e instanceof Error ? e.message : "Unknown error" });
      }

      // Small delay between calls
      await new Promise((r) => setTimeout(r, 200));
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
