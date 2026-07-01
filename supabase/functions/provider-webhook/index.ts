import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";

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

    return computedSignature.toLowerCase() === expectedSignature.toLowerCase();
  } catch (err) {
    console.error("[provider-webhook] HMAC verification error:", err);
    return false;
  }
}

serve(async (req) => {
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

  // Security: Verify webhook secret or SKPlug HMAC signature
  const PROVIDER_WEBHOOK_SECRET = Deno.env.get("PROVIDER_WEBHOOK_SECRET");
  const XCEL_WEBHOOK_SECRET = Deno.env.get("XCEL_WEBHOOK_SECRET");
  
  const skplugSignature = req.headers.get("x-skplug-signature") || req.headers.get("X-SKPlug-Signature");
  const xWebhookSecret = req.headers.get("x-webhook-secret");
  
  let isAuthorized = false;

  if (skplugSignature) {
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
    let reference = payload?.data?.reference || payload?.reference || payload?.order_id || payload?.id || payload?.data?.id || payload?.data?.transactionId;
    
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
    else if (["failed", "rejected", "error"].includes(rawStatus)) systemStatus = "fulfillment_failed";

    const { data: order, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("id, status, agent_id, order_type")
      .or(`id.eq.${reference},provider_order_id.eq.${reference}`)
      .maybeSingle();

    if (fetchError || !order) {
      console.warn("[provider-webhook] Order not found for reference:", reference);
      return new Response(JSON.stringify({ received: true, warning: "Order not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (order.status === "fulfilled" && systemStatus === "fulfilled") return new Response(JSON.stringify({ message: "Already fulfilled" }));

    await supabaseAdmin.from("orders").update({ 
      status: systemStatus,
      updated_at: new Date().toISOString()
    }).eq("id", order.id);

    if (systemStatus === "fulfilled") {
      await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
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
