declare const Deno: any;

import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { mapAfaStatus } from "../_shared/providers/afaregistration.ts";

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
  const afaSignature = req.headers.get("x-afa-signature");
  const afaTimestamp = req.headers.get("x-afa-timestamp");
  
  let isAuthorized = false;
  let isAfaEvent = false;

  if (afaSignature) {
    // AFARegistration.com: signature = "sha256=" + HMAC_SHA256(timestamp + "." + raw_body, AFA_WEBHOOK_SECRET)
    const tsNum = /^\d+$/.test(afaTimestamp || "") ? parseInt(afaTimestamp!, 10) : NaN;
    if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
      console.warn("[provider-webhook] AFARegistration webhook rejected: missing or expired timestamp.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: afaProvider } = await supabaseAdmin
      .from("providers")
      .select("settings")
      .eq("handler_type", "afaregistration")
      .maybeSingle();
    const afaSecret = Deno.env.get("AFA_WEBHOOK_SECRET") || afaProvider?.settings?.webhook_secret || "";
    if (!afaSecret || !(await verifyHmacSha256(`${afaTimestamp}.${body}`, afaSecret, afaSignature))) {
      console.warn("[provider-webhook] AFARegistration signature verification failed.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    isAuthorized = true;
    isAfaEvent = true;
    console.log("[provider-webhook] AFARegistration signature verified successfully.");
  } else if (bundlezoneSignature) {
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
        .order("is_active", { ascending: false })
        .limit(1)
        .maybeSingle();

      const secretKey = Deno.env.get("BUNDLEZONE_WEBHOOK_SECRET") || bzProvider?.settings?.webhook_secret || bzProvider?.api_key || "";
      if (!secretKey) {
        console.warn("[provider-webhook] BundleZone signature verification failed: Secret not configured.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let signatureValid = false;
      if (bundlezoneTimestamp) {
        signatureValid = await verifyHmacSha256(`${bundlezoneTimestamp}.${body}`, secretKey, bundlezoneSignature);
      }
      if (!signatureValid) {
        signatureValid = await verifyHmacSha256(body, secretKey, bundlezoneSignature);
      }

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

      const secretKey = Deno.env.get("SPENDLESS_WEBHOOK_SECRET") || spendlessProvider?.settings?.webhook_secret || spendlessProvider?.api_key;
      if (!secretKey) {
        console.warn("[provider-webhook] Spendless HMAC signature verification failed: Credentials not configured.");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
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
    // Fail closed: Webhook request missing any recognized authentication header or secret
    console.warn("[provider-webhook] Blocked unauthorized request missing authentication headers.");
    isAuthorized = false;
  }

  if (!isAuthorized) {
    console.warn("[provider-webhook] Request blocked - Unauthorized execution path.");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    let payload = JSON.parse(body);

    // Normalize AFARegistration events (registration.updated / airtime.updated) to the generic shape
    let afaExpectedProviderOrderId: string | null = null;
    if (isAfaEvent) {
      const isReg = Boolean(payload?.data?.registration);
      const rec = payload?.data?.registration || payload?.data?.airtime || {};
      const mapped = mapAfaStatus(rec.status);
      afaExpectedProviderOrderId = rec.id !== undefined ? `${isReg ? "reg" : "air"}_${rec.id}` : null;
      console.log(`[provider-webhook] AFARegistration event ${payload?.type} (${payload?.id}): ${afaExpectedProviderOrderId} -> ${rec.status}`);
      payload = {
        reference: rec.external_order_id || afaExpectedProviderOrderId,
        status: mapped === "fulfilled" ? "completed" : (mapped === "fulfillment_failed" ? "failed" : "processing"),
        message: rec.failure_reason || rec.reason || `AFARegistration ${isReg ? "registration" : "airtime"} ${rec.status}`,
      };
    }

    // Collect all possible candidate references sent by the webhook
    const candidateRefs: string[] = [];
    const addCandidate = (val: any) => {
      if (val !== undefined && val !== null) {
        const s = String(val).trim();
        if (s && /^[a-zA-Z0-9\-_]{1,64}$/.test(s) && !candidateRefs.includes(s)) {
          candidateRefs.push(s);
        }
      }
    };

    if (payload?.data?.metadata) {
      try {
        const meta = typeof payload.data.metadata === "string" 
          ? JSON.parse(payload.data.metadata) 
          : payload.data.metadata;
        if (meta?.ref_no) addCandidate(meta.ref_no);
        if (meta?.reference) addCandidate(meta.reference);
        if (meta?.order_id) addCandidate(meta.order_id);
        if (meta?.client_reference) addCandidate(meta.client_reference);
      } catch (e) {
        console.warn("[provider-webhook] Failed to parse metadata JSON:", e);
      }
    }

    addCandidate(payload?.data?.reference);
    addCandidate(payload?.reference);
    addCandidate(payload?.data?.order_id);
    addCandidate(payload?.order_id);
    addCandidate(payload?.data?.request_id);
    addCandidate(payload?.request_id);
    addCandidate(payload?.data?.transactionId);
    addCandidate(payload?.data?.transaction_id);
    addCandidate(payload?.data?.orderId);
    addCandidate(payload?.orderId);
    addCandidate(payload?.id);
    addCandidate(payload?.data?.id);

    if (candidateRefs.length === 0) {
      console.warn("[provider-webhook] Blocked webhook request with missing reference.");
      return new Response(JSON.stringify({ error: "Missing or invalid reference" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const reference = candidateRefs[0];

    const rawStatus = (payload?.data?.status || payload?.status || "").toLowerCase();
    
    let systemStatus = "processing";
    if (["completed", "success", "successful", "delivered", "fulfilled"].includes(rawStatus)) systemStatus = "fulfilled";
    else if (["failed", "rejected", "error", "refunded", "refund", "cancelled", "reversed"].includes(rawStatus)) systemStatus = "fulfillment_failed";

    let order: any = null;
    let fetchError: any = null;

    // 1. Try finding by UUID id
    const uuidCandidates = candidateRefs.filter(c => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c));
    if (uuidCandidates.length > 0) {
      const { data: ordById, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .in("id", uuidCandidates)
        .limit(1)
        .maybeSingle();
      if (ordById) order = ordById;
      fetchError = error;
    }

    // 2. Try finding by provider_order_id
    if (!order) {
      const { data: ordByProvId } = await supabaseAdmin
        .from("orders")
        .select("*")
        .in("provider_order_id", candidateRefs)
        .limit(1)
        .maybeSingle();
      if (ordByProvId) order = ordByProvId;
    }

    // 3. Try finding by metadata client_reference or reference
    if (!order) {
      for (const cand of candidateRefs) {
        const { data: ordByMeta } = await supabaseAdmin
          .from("orders")
          .select("*")
          .or(`metadata->>client_reference.eq.${cand},metadata->>reference.eq.${cand},metadata->>order_reference.eq.${cand}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ordByMeta) {
          order = ordByMeta;
          break;
        }
      }
    }

    // 4. Smart fallback for providers (like BundleZone) that send internal references or recipient
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
      console.warn("[provider-webhook] Order not found for references:", candidateRefs);
      return new Response(JSON.stringify({ received: true, warning: "Order not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Idempotency: avoid re-processing identical terminal states
    if (order.status === systemStatus) {
      console.log(`[provider-webhook] Order ${order.id} is already in state '${systemStatus}'. Acknowledged idempotently.`);
      return new Response(JSON.stringify({ success: true, message: `Already ${systemStatus}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // If order was already fulfilled, never downgrade to failed due to late/stale callbacks
    if (order.status === "fulfilled") {
      console.log(`[provider-webhook] Order ${order.id} is already fulfilled. Ignoring callback '${systemStatus}'.`);
      return new Response(JSON.stringify({ received: true, ignored: true, reason: "Order already fulfilled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // AFARegistration: ignore stale/duplicate events for orders that have since moved to another provider
    if (
      isAfaEvent && afaExpectedProviderOrderId &&
      order.provider_order_id &&
      !["failed_api_call", "timeout", "manual_fulfillment_mode"].includes(String(order.provider_order_id)) &&
      order.provider_order_id !== afaExpectedProviderOrderId
    ) {
      console.warn(`[provider-webhook] Ignoring AFARegistration event ${afaExpectedProviderOrderId} for order ${order.id} (current provider_order_id: ${order.provider_order_id}).`);
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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

        const failedIds = Array.isArray(order.metadata?.failed_provider_ids)
          ? [...order.metadata.failed_provider_ids]
          : [];
        if (order.provider_id && !failedIds.includes(order.provider_id)) {
          failedIds.push(order.provider_id);
        }

        const failoverDispatch = await dispatchOrderWithFailover(supabaseAdmin, {
          ...order,
          provider_order_id: null, // Clear so resolveProvidersForOrder does not lock to failed provider
          status: "processing",
          metadata: {
            ...(order.metadata || {}),
            failed_provider_ids: failedIds,
          },
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
