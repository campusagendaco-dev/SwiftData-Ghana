import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// Runs every 5 minutes
Deno.cron("Network Routing Recommender", "*/5 * * * *", async () => {
  console.log("Running AI Network Routing Recommender...");
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch orders from the last 15 minutes
  const fifteenMinutesAgo = new Date();
  fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

  const { data: recentOrders, error } = await supabase
    .from("orders")
    .select("status, network, provider")
    .in("order_type", ["data", "api"])
    .gte("created_at", fifteenMinutesAgo.toISOString());

  if (error || !recentOrders) {
    console.error("Failed to fetch recent orders:", error);
    return;
  }

  // 2. Calculate failure rates per network
  const stats = new Map<string, { total: number; failed: number }>();
  for (const o of recentOrders) {
    if (!o.network) continue;
    if (!stats.has(o.network)) {
      stats.set(o.network, { total: 0, failed: 0 });
    }
    const stat = stats.get(o.network)!;
    stat.total++;
    if (o.status === "fulfillment_failed") stat.failed++;
  }

  // 3. Generate recommendations for Admins
  let recommendationsGenerated = 0;

  for (const [network, data] of stats.entries()) {
    if (data.total >= 5) { // Need at least 5 orders to establish a valid failure rate
      const failureRate = data.failed / data.total;
      
      if (failureRate >= 0.25) { // 25% or more failure rate
        const title = `AI Alert: High Failure Rate on ${network}`;
        const message = `${network} is experiencing a ${(failureRate * 100).toFixed(0)}% failure rate over the last 15 minutes (${data.failed} failed out of ${data.total}). AI recommends switching your primary provider routing for ${network} immediately.`;

        // Check for recent alerts to prevent spam (don't alert more than once per hour per network)
        const { data: existing } = await supabase
          .from("ai_recommendations")
          .select("id")
          .is("user_id", null) // null user_id means it's a global admin alert
          .eq("agent_type", "network-routing")
          .eq("title", title)
          .gt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .limit(1);

        if (!existing || existing.length === 0) {
          // Send alert to admin
          await supabase.from("ai_recommendations").insert({
            user_id: null,
            agent_type: "network-routing",
            title,
            message,
            priority: "critical",
            action_data: { network, failureRate, switch_recommended: true }
          });
          recommendationsGenerated++;
          console.log(`Generated routing recommendation for ${network}`);
        }
      }
    }
  }

  console.log(`Routing Recommender finished. Generated ${recommendationsGenerated} alerts.`);
});

serve(async (req) => {
  return new Response(JSON.stringify({ status: "AI Routing Recommender is active." }), {
    headers: { "Content-Type": "application/json" },
  });
});
