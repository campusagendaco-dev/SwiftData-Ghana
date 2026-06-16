import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cron: runs every 5 minutes (schedule in Supabase Dashboard → Edge Functions → Schedules)
// Finds stuck processing orders with no provider_order_id and retries them via verify-payment

serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: stuckOrders, error } = await supabase
    .from("orders")
    .select("id, network, package_size, customer_phone, amount, order_type")
    .eq("status", "processing")
    .neq("network", "MTN Mash Up")
    .is("provider_order_id", null)
    .lt("updated_at", fifteenMinutesAgo)
    .in("order_type", ["data", "airtime"])
    .limit(20); // Process max 20 per run to avoid timeout

  if (error) {
    console.error("[cron-auto-retry] DB error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!stuckOrders?.length) {
    console.log("[cron-auto-retry] No stuck orders found.");
    return new Response(JSON.stringify({ retried: 0, fulfilled: 0 }), { status: 200 });
  }

  console.log(`[cron-auto-retry] Found ${stuckOrders.length} stuck orders`);

  let retried = 0;
  let fulfilled = 0;
  const failedIds: string[] = [];

  for (const order of stuckOrders) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reference: order.id }),
      });

      const result = await res.json();
      retried++;

      if (result.status === "fulfilled") {
        fulfilled++;
        console.log(`[cron-auto-retry] ✓ Fulfilled: ${order.id}`);
      } else {
        console.log(`[cron-auto-retry] ~ Queued: ${order.id} → ${result.status}`);
      }
    } catch (e: any) {
      console.error(`[cron-auto-retry] Failed for ${order.id}:`, e.message);
      failedIds.push(order.id);
    }
  }

  // Log summary to system_logs
  await supabase.from("system_logs").insert({
    level: fulfilled > 0 ? "info" : failedIds.length > 0 ? "warn" : "info",
    source: "cron-auto-retry",
    event: "cron.auto_retry_complete",
    message: `Auto-retry run: ${fulfilled} fulfilled, ${retried - fulfilled - failedIds.length} queued, ${failedIds.length} failed`,
    data: {
      total_stuck: stuckOrders.length,
      retried,
      fulfilled,
      failed: failedIds.length,
      failed_ids: failedIds,
    },
  });

  return new Response(
    JSON.stringify({ retried, fulfilled, failed: failedIds.length }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
