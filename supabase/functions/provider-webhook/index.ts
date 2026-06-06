import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Security: Verify webhook secret if configured in Supabase vault
  const PROVIDER_WEBHOOK_SECRET = Deno.env.get("PROVIDER_WEBHOOK_SECRET");
  const XCEL_WEBHOOK_SECRET = Deno.env.get("XCEL_WEBHOOK_SECRET");
  
  const xWebhookSecret = req.headers.get("x-webhook-secret");
  
  if (xWebhookSecret) {
    const expectedSecret = XCEL_WEBHOOK_SECRET || PROVIDER_WEBHOOK_SECRET;
    if (expectedSecret && xWebhookSecret !== expectedSecret) {
      console.warn("[provider-webhook] XCEL Unauthorized request blocked - Secret mismatch.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
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
  }


  try {
    if (req.method === "GET") {
      return new Response(JSON.stringify({ status: "online" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.text();
    if (!body || body.trim() === "") {
      return new Response(JSON.stringify({ message: "Empty body" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = JSON.parse(body);
    let reference = payload?.data?.reference || payload?.reference || payload?.order_id || payload?.data?.transactionId;
    
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

    const rawStatus = (payload?.data?.status || payload?.status || "").toLowerCase();
    
    let systemStatus = "processing";
    if (["completed", "success", "delivered", "fulfilled"].includes(rawStatus)) systemStatus = "fulfilled";
    else if (["failed", "rejected", "error"].includes(rawStatus)) systemStatus = "fulfillment_failed";

    const { data: order, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("id, status, agent_id, order_type")
      .or(`id.eq.${reference},provider_order_id.eq.${reference}`)
      .maybeSingle();

    if (fetchError || !order) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
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
