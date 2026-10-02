declare const Deno: any;

import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";

async function verifyHmacSha256(bodyText: string, keyString: string, expectedSignature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(keyString);
    const messageData = encoder.encode(bodyText);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const computedSignature = signatureArray.map(b => b.toString(16).padStart(2, "0")).join("");

    const cleanExpected = expectedSignature.toLowerCase().replace(/^sha256=/, "").trim();
    return computedSignature.toLowerCase() === cleanExpected;
  } catch (err) {
    console.error("[provider-webhook] HMAC verification error:", err);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "online" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Read raw request body text first so we can verify the signature and parse it later
  const body = await req.text();
  if (!body || body.trim() === "") {
    return new Response(JSON.stringify({ message: "Empty body" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Security: Verify webhook secret, SKPlug HMAC, or Spendless HMAC signature
  const PROVIDER_WEBHOOK_SECRET = Deno.env.get("PROVIDER_WEBHOOK_SECRET");
  const XCEL_WEBHOOK_SECRET = Deno.env.get("XCEL_WEBHOOK_SECRET");
  
  const skplugSignature = req.headers.get("x-skplug-signature") || req.headers.get("X-SKPlug-Signature");
  const webhookSignature = req.headers.get("x-webhook-signature") || req.headers.get("X-Webhook-Signature");
  const bundlezoneSignature = req.headers.get("x-bundlezone-signature") || req.headers.get("X-BundleZone-Signature");
  const bundlezoneTimestamp = req.headers.get("x-bundlezone-timestamp") || req.headers.get("X-BundleZone-Timestamp");
  const xWebhookSecret = req.headers.get("x-webhook-secret");
  
  let isAuthorized = false;

  if (bundlezoneSignature) {
    try {
      if (bundlezoneTimestamp) {
        const tsNum = parseInt(bundlezoneTimestamp, 10);
        const nowSec = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSec - tsNum) > 300) {
          console.warn("[provider-webhook] Expired BundleZone webhook timestamp.");
          return new Response(JSON.stringify({ error: "Expired webhook timestamp" }), { 
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      const { data: bzProvider } = await supabaseAdmin
        .from("providers")
        .select("api_key, settings")
        .eq("handler_type", "bundlezone")
        .maybeSingle();

      const secretKey = Deno.env.get("BUNDLEZONE_WEBHOOK_SECRET") || bzProvider?.settings?.webhook_secret || bzProvider?.api_key || "";
      if (!secretKey) {
        console.warn("[provider-webhook] BundleZone signature verification failed: Secret not configured.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const signedPayload = bundlezoneTimestamp ? `${bundlezoneTimestamp}.${body}` : body;
      const signatureValid = await verifyHmacSha256(signedPayload, secretKey, bundlezoneSignature);
      if (!signatureValid) {
        console.warn("[provider-webhook] BundleZone signature verification failed: Signature mismatch.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      isAuthorized = true;
      console.log("[provider-webhook] BundleZone signature verified successfully.");
    } catch (err: any) {
      console.error("[provider-webhook] Error verifying BundleZone signature:", err.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } else if (skplugSignature) {
    try {
      const { data: skplugProvider } = await supabaseAdmin
        .from("providers")
        .select("api_key, settings")
        .eq("handler_type", "skdataplug")
        .maybeSingle();

      const secretKey = skplugProvider?.settings?.webhook_secret || skplugProvider?.api_key;
      if (!secretKey) {
        console.warn("[provider-webhook] SKPlug signature verification failed: Credentials/secret not found in database.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const signatureValid = await verifyHmacSha256(body, secretKey, skplugSignature);
      if (!signatureValid) {
        console.warn("[provider-webhook] SKPlug signature verification failed: Signature mismatch.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      isAuthorized = true;
      console.log("[provider-webhook] SKPlug signature verified successfully.");
    } catch (err: any) {
      console.error("[provider-webhook] Error verifying SKPlug signature:", err.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } else if (webhookSignature) {
    try {
      const { data: spendlessProvider } = await supabaseAdmin
        .from("providers")
        .select("api_key, settings")
        .eq("handler_type", "spendless")
        .maybeSingle();

      const secretKey = Deno.env.get("SPENDLESS_WEBHOOK_SECRET") || spendlessProvider?.settings?.webhook_secret || spendlessProvider?.api_key || "direct";
      const signatureValid = await verifyHmacSha256(body, secretKey, webhookSignature);

      if (!signatureValid) {
        console.warn("[provider-webhook] Spendless HMAC signature verification failed: Signature mismatch.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      isAuthorized = true;
      console.log("[provider-webhook] Spendless HMAC signature verified successfully.");
    } catch (err: any) {
      console.error("[provider-webhook] Error verifying Spendless HMAC signature:", err.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } else if (xWebhookSecret) {
    const expectedSecret = XCEL_WEBHOOK_SECRET || PROVIDER_WEBHOOK_SECRET;
    if (expectedSecret && xWebhookSecret !== expectedSecret) {
      console.warn("[provider-webhook] XCEL Unauthorized request blocked - Secret mismatch.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    isAuthorized = true;
  } else if (PROVIDER_WEBHOOK_SECRET) {
    const query = new URL(req.url).searchParams;
    const providedSecret = req.headers.get("X-Webhook-Secret") || query.get("key") || query.get("secret");
    if (providedSecret !== PROVIDER_WEBHOOK_SECRET) {
      console.warn("[provider-webhook] Unauthorized request blocked - Secret mismatch.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    isAuthorized = true;
  } else {
    // If no security controls are configured or required, allow the request
    isAuthorized = true;
  }

  if (!isAuthorized) {
    console.warn("[provider-webhook] Request blocked - Unauthorized execution path.");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const payload = JSON.parse(body);
    let reference = payload?.data?.reference || payload?.reference || payload?.data?.request_id || payload?.request_id || payload?.order_id || payload?.id || payload?.data?.id || payload?.data?.order_id || payload?.data?.transactionId || payload?.data?.orderId || payload?.orderId;
    
    if (payload?.data?.metadata) {
      try {
        const meta = typeof payload.data.metadata === "string" 
          ? JSON.parse(payload.data.metadata) 
          : payload.data.metadata;
        if (meta?.ref_no) {
          reference = meta.ref_no;
        }
      } catch (e) {
        console.warn("[provider-webhook] Failed to parse metadata JSON:", e);
      }
    }

    const refStr = String(reference || "").trim();
    if (!refStr || !/^[a-zA-Z0-9\-_]{1,64}$/.test(refStr)) {
      console.warn("[provider-webhook] Blocked webhook request with invalid reference format:", refStr);
      return new Response(JSON.stringify({ error: "Invalid reference format" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    reference = refStr;


    const rawStatus = (payload?.data?.status || payload?.status || "").toLowerCase();
    
    let systemStatus = "processing";
    if (["completed", "success", "successful", "delivered", "fulfilled"].includes(rawStatus)) systemStatus = "fulfilled";
    else if (["failed", "rejected", "error", "refunded", "refund", "cancelled", "reversed"].includes(rawStatus)) systemStatus = "fulfillment_failed";

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
    const filter = isUuid 
      ? `id.eq.${reference},provider_order_id.eq.${reference}`
      : `provider_order_id.eq.${reference}`;

    let { data: order, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .or(filter)
      .maybeSingle();

    if (!order && (payload?.orderId || payload?.data?.orderId || payload?.reference || payload?.data?.reference || payload?.data?.order_id || payload?.data?.request_id || payload?.request_id)) {
      const altRef = String(payload?.data?.request_id || payload?.request_id || payload?.data?.order_id || payload?.orderId || payload?.data?.orderId || payload?.reference || payload?.data?.reference || "");
      if (altRef && altRef !== reference && /^[a-zA-Z0-9\-_]{1,64}$/.test(altRef)) {
        const altFilter = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(altRef)
          ? `id.eq.${altRef},provider_order_id.eq.${altRef}`
          : `provider_order_id.eq.${altRef}`;
        const { data: altOrder } = await supabaseAdmin
          .from("orders")
          .select("*")
          .or(altFilter)
          .maybeSingle();
        if (altOrder) order = altOrder;
      }
    }

    // Smart fallback for providers (like BundleZone) that send internal references or recipient
    if (!order && (payload?.data?.recipient || payload?.recipient || payload?.data?.phone || payload?.phone)) {
      const rawPhone = String(payload?.data?.recipient || payload?.recipient || payload?.data?.phone || payload?.phone).replace(/\D/g, "");
      let localPhone = rawPhone;
      if (rawPhone.startsWith("233") && rawPhone.length === 12) localPhone = "0" + rawPhone.slice(3);
      else if (rawPhone.length === 9) localPhone = "0" + rawPhone;

      const { data: phoneOrders } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("status", "processing")
        .or(`customer_phone.eq.${localPhone},customer_phone.eq.${rawPhone}`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (phoneOrders && phoneOrders.length > 0) {
        order = phoneOrders[0];
        console.log(`[provider-webhook] Matched processing order ${order.id} via recipient fallback ${localPhone}.`);
      }
    }

    if (fetchError || !order) {
      console.warn("[provider-webhook] Order not found for reference:", reference);
      return new Response(JSON.stringify({ received: true, warning: "Order not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (order.status === "fulfilled" && systemStatus === "fulfilled") return new Response(JSON.stringify({ message: "Already fulfilled" }));

    // If provider reported failure, attempt automatic failover to the next active provider (e.g. SKPlug)
    if (systemStatus === "fulfillment_failed" && order.status !== "fulfilled") {
      const isPaid = order.payment_method === "wallet" || Number(order.paystack_verified_amount || 0) > 0 || order.status === "processing";
      const isTelecomOrder = !["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation"].includes(String(order.order_type || "data").toLowerCase());

      if (isPaid && isTelecomOrder) {
        console.log(`[provider-webhook] Order ${order.id} failed at provider ${order.provider_id}. Attempting automatic failover to next provider (SKPlug)...`);
        
        // Record failure in provider_errors
        const failReason = payload?.message || payload?.error || payload?.data?.reason || `Provider reported status: ${rawStatus}`;
        await Promise.resolve(supabaseAdmin.from("provider_errors").insert({
          provider_id: order.provider_id,
          order_id: order.id,
          error_message: failReason,
        })).catch(() => {});

        const failoverDispatch = await dispatchOrderWithFailover(supabaseAdmin, {
          ...order,
          provider_order_id: null, // Clear so resolveProvidersForOrder does not lock to failed provider
          status: "processing",
        });

        if (failoverDispatch.ok) {
          console.log(`[provider-webhook] Automatic failover SUCCESS for order ${order.id} via provider ${failoverDispatch.provider_id} (${failoverDispatch.status})`);
          await supabaseAdmin.from("orders").update({
            status: failoverDispatch.status,
            provider_id: failoverDispatch.provider_id || null,
            provider_order_id: failoverDispatch.provider_order_id || null,
            failure_reason: null,
            updated_at: new Date().toISOString()
          }).eq("id", order.id);

          if (failoverDispatch.status === "fulfilled") {
            await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
          }

          await notifyApiClient(supabaseAdmin, order.id, failoverDispatch.status);
          return new Response(JSON.stringify({ success: true, failover: true, status: failoverDispatch.status }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          console.warn(`[provider-webhook] All failover providers exhausted for order ${order.id}: ${failoverDispatch.reason}`);
          systemStatus = "fulfillment_failed";
        }
      }
    }

    await supabaseAdmin.from("orders").update({ 
      status: systemStatus,
      updated_at: new Date().toISOString()
    }).eq("id", order.id);

    if (systemStatus === "fulfilled") {
      await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
    }

    // ── Notify API Client ─────────────────────────────────────────────────────
    await notifyApiClient(supabaseAdmin, order.id, systemStatus);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[provider-webhook] Error:", error.message);
    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
  }
});
