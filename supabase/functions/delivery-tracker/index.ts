import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // SECURITY: Rate-limit delivery tracker to prevent scraping
    // Extract a stable key from the request IP
    const clientIp = req.headers.get("cf-connecting-ip")
      || req.headers.get("x-real-ip")
      || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || "anon";

    const { data: withinLimit } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: `delivery_tracker:${clientIp}`,
      p_rate_limit: 120 // max 120 requests/minute per IP
    });

    if (withinLimit === false) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Get aggregated stats — 24 hours for active/pending orders, 1 hour window for recent fulfilled rate
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgoMs = Date.now() - 60 * 60 * 1000;

    const { data: recentOrders, error: statsError } = await supabaseAdmin
      .from("orders")
      .select("status, created_at, network, package_size")
      // SECURITY: Do NOT select customer_phone — prevents data enumeration
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(300); // Cap to prevent large data dumps

    if (statsError) throw statsError;

    const recentFulfilledInHour = recentOrders?.filter(
      o => o.status === 'fulfilled' && new Date(o.created_at).getTime() >= oneHourAgoMs
    ) || [];

    const stats = {
      checked: recentOrders?.length || 0,
      delivered: recentFulfilledInHour.length,
      partial: recentOrders?.filter(o => o.status === 'processing').length || 0,
      pending: recentOrders?.filter(o => o.status === 'paid').length || 0,
      failed: recentOrders?.filter(o => o.status === 'fulfillment_failed' || o.status === 'error').length || 0,
    };

    // Deterministic 1-minute bucket seeds for tracking IDs & batch numbers
    const minuteBucket = Math.floor(Date.now() / 60000);
    const trackingSeed = ((minuteBucket * 2654435761) % 900000) + 1000000;
    const batchSeed = ((minuteBucket * 1103515245) % 900000) + 100000;

    // 2. Get the "Last Delivered" order details — no PII
    const lastDeliveredOrder = recentOrders?.find(o => o.status === 'fulfilled');
    let lastDelivered = null;
    if (lastDeliveredOrder) {
      const placedAt = new Date(lastDeliveredOrder.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      lastDelivered = {
        trackingId: trackingSeed.toString(),
        summary: `Order delivered at ${placedAt}`
      };
    }

    // 3. Build batch summaries — NO phone numbers exposed
    const inCurrentBatch = recentOrders
      ?.filter(o => o.status === 'paid' || o.status === 'processing')
      .slice(0, 5)
      .map(o => ({
        network: o.network || "YELLO",
        capacity: o.package_size || "1GB",
        deliveryStatus: o.status === 'processing' ? 'Processing' : 'In Queue'
      })) || [];

    const inLastDeliveredBatch = recentOrders
      ?.filter(o => o.status === 'fulfilled')
      .slice(0, 5)
      .map(o => ({
        network: o.network || "YELLO",
        capacity: o.package_size || "1GB",
        deliveryStatus: "Sent"
      })) || [];

    return new Response(
      JSON.stringify({
        status: "success",
        data: {
          message: "Delivery scanner is actively checking orders...",
          scanner: { 
            active: stats.pending > 0 || stats.partial > 0, 
            waiting: stats.pending === 0, 
            waitSeconds: stats.pending === 0 ? 30 : 0 
          },
          stats,
          lastDelivered,
          checkingNow: { 
            summary: stats.pending > 0 ? `Checking now: Batch #${batchSeed}` : "Scanner idling... waiting for new orders" 
          },
          yourOrders: {
            inCurrentBatch,
            inLastDeliveredBatch
          }
        }
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

