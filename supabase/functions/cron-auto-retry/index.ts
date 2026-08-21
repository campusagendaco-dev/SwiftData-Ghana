import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing environment credentials" }), { status: 500 });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    console.log("[cron-auto-retry] Running hybrid self-healing background worker...");

    // Find stuck paid orders older than 2 minutes that were not dispatched
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stuckOrders, error: fetchErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["paid", "pending"])
      .neq("network", "MTN Mash Up")
      .lte("created_at", twoMinutesAgo)
      .gte("created_at", oneDayAgo)
      .limit(20);

    if (fetchErr) {
      throw fetchErr;
    }

    const results = {
      attempted: (stuckOrders || []).length,
      fulfilled: 0,
      processing: 0,
      failed: 0,
    };

    for (const order of stuckOrders || []) {
      console.log(`[cron-auto-retry] Auto-healing order ${order.id} (${order.network} ${order.package_size})...`);
      
      const dispatch = await dispatchOrderWithFailover(supabaseAdmin, order);

      if (dispatch.status === "fulfilled") {
        await supabaseAdmin.from("orders").update({
          status: "fulfilled",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          failure_reason: null,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);

        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
        results.fulfilled++;
      } else if (dispatch.status === "processing") {
        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);
        results.processing++;
      } else {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: dispatch.reason || "Auto-retry failed across available providers",
          updated_at: new Date().toISOString()
        }).eq("id", order.id);
        results.failed++;
      }
    }

    log(supabaseAdmin, {
      level: "info",
      source: "cron-auto-retry",
      event: "self_heal.completed",
      message: `Self-heal worker processed ${results.attempted} orders (Fulfilled: ${results.fulfilled}, Processing: ${results.processing}, Failed: ${results.failed})`,
      data: results
    });

    return new Response(JSON.stringify({
      success: true,
      message: "Hybrid background self-healing cycle executed successfully.",
      summary: results
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-auto-retry] Worker error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
