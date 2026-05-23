import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// removed node:crypto
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DATAMART_WEBHOOK_SECRET = Deno.env.get("DATAMART_WEBHOOK_SECRET");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-datamart-signature");

    if (!signature) {
      console.error("[DataMart Webhook] Missing signature header");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Resolve Secret (Env Var or DB)
    let secret = DATAMART_WEBHOOK_SECRET;
    if (!secret) {
      const { data: provider } = await supabaseAdmin
        .from("providers")
        .select("settings")
        .eq("handler_type", "datamart")
        .eq("is_active", true)
        .maybeSingle();
      
      secret = provider?.settings?.webhook_secret;
    }

    // Verify Signature if secret is found
    if (secret) {
      const enc = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawBody));
      const expectedSignature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

      if (signature !== expectedSignature) {
        console.error("[DataMart Webhook] Invalid signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const payload = JSON.parse(rawBody);
    const { event, data } = payload;
    const reference = data?.orderReference || data?.reference || data?.orderId;
    const status = (data?.status || "").toLowerCase();

    if (!reference) {
      return new Response(JSON.stringify({ error: "No reference found" }), { status: 400 });
    }

    const isSuccess = ["completed", "success", "delivered", "fulfilled"].includes(status);
    const isFailed = ["failed", "rejected", "refunded"].includes(status);

    if (isSuccess) {
      const { data: order } = await supabaseAdmin.from("orders").select("status").eq("id", reference).maybeSingle();
      if (order && order.status !== "fulfilled") {
        await supabaseAdmin.from("orders").update({ 
          status: "fulfilled",
          updated_at: new Date().toISOString()
        }).eq("id", reference);
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
        await notifyApiClient(supabaseAdmin, reference, "fulfilled");
      }
    } else if (isFailed) {
      await supabaseAdmin.from("orders").update({ 
        status: "fulfillment_failed",
        failure_reason: `Provider reported failure: ${status}`,
        updated_at: new Date().toISOString()
      }).eq("id", reference);
      await notifyApiClient(supabaseAdmin, reference, "fulfillment_failed");
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[DataMart Webhook] Internal Error:", err);
    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
  }
});
