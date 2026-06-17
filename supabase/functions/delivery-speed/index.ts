import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

declare const Deno: any;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Primary: Try to mirror DataHub widget API
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000); // 6s timeout for external service
    const datahubRes = await fetch("https://user.datahubgh.com/api/widget/last-mtn-delivered?format=json", {
      signal: ctrl.signal
    });
    clearTimeout(tid);

    if (datahubRes.ok) {
      const data = await datahubRes.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err: any) {
    console.warn("[delivery-speed] Failed to fetch from DataHub widget API:", err?.message || err);
  }

  // Fallback 1: Calculate from our own DB 'orders' table
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      
      // Query the latest successful MTN data order
      const { data: orders, error } = await supabase
        .from("orders")
        .select("created_at, updated_at")
        .eq("status", "fulfilled")
        .eq("network", "MTN")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (orders && orders.length > 0) {
        const placed = new Date(orders[0].created_at);
        const delivered = new Date(orders[0].updated_at);
        let diff = Math.round((delivered.getTime() - placed.getTime()) / (60 * 1000));
        
        if (diff <= 0) diff = 1; // Minimum 1 minute
        if (diff > 60) diff = 10; // Cap abnormal values (e.g. if stuck in processing)

        const displayTimeStr = placed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
        const displayDateStr = placed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const placedAtDisplay = `${displayDateStr}, ${displayTimeStr}`;

        const deliveredTimeStr = delivered.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
        const deliveredDateStr = delivered.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const deliveredAtDisplay = `${deliveredDateStr}, ${deliveredTimeStr}`;

        const durationText = diff === 1 ? "Took about 1 min." : `Took about ${diff} mins.`;
        const estDeliveryText = diff <= 2 ? "Instant." : `~${diff} mins.`;
        const bucket = diff <= 2 ? "instant" : "normal";

        return new Response(JSON.stringify({
          success: true,
          order: {
            orderNumber: 0,
            placedAt: orders[0].created_at,
            deliveredAt: orders[0].updated_at
          },
          display: {
            title: "Latest MTN Successful Order (Local)",
            placedAt: placedAtDisplay,
            deliveredAt: deliveredAtDisplay,
            duration: durationText,
            estimatedDelivery: estDeliveryText,
            estimatedDeliveryBucket: bucket,
            lastOrderDurationMinutes: diff
          },
          message: `Latest MTN Successful Order (Local) — Placed at ${placedAtDisplay}, Delivered at ${deliveredAtDisplay}. ${durationText} Estimated delivery: ${estDeliveryText}`
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (dbErr: any) {
      console.error("[delivery-speed] DB calculation fallback failed:", dbErr?.message || dbErr);
    }
  }

  // Fallback 2: Server-side dynamic estimation based on current minutes (failsafe)
  const now = new Date();
  const seed = now.getMinutes() % 5;
  const minutes = 6 + seed; // 6 to 10 minutes fallback

  const placedAt = new Date(now.getTime() - minutes * 60 * 1000).toISOString();
  const deliveredAt = now.toISOString();

  return new Response(JSON.stringify({
    success: true,
    order: {
      orderNumber: 0,
      placedAt,
      deliveredAt
    },
    display: {
      title: "Latest MTN Successful Order (Estimate)",
      placedAt: "Just now",
      deliveredAt: "Just now",
      duration: `Took about ${minutes} mins.`,
      estimatedDelivery: `~${minutes} mins.`,
      estimatedDeliveryBucket: "normal",
      lastOrderDurationMinutes: minutes
    },
    message: `Latest MTN Successful Order (Estimate) — Estimated delivery: ~${minutes} mins.`
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
