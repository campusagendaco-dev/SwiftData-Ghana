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

  // 2. Aggregate failure rates per network and per provider
  // Structure: Map<network, Record<providerName, { total: number; failed: number }>>
  const networkProviderStats = new Map<string, Record<string, { total: number; failed: number }>>();

  for (const o of recentOrders) {
    if (!o.network || !o.provider) continue;
    if (!networkProviderStats.has(o.network)) {
      networkProviderStats.set(o.network, {});
    }
    const provStats = networkProviderStats.get(o.network)!;
    if (!provStats[o.provider]) {
      provStats[o.provider] = { total: 0, failed: 0 };
    }
    provStats[o.provider].total++;
    if (o.status === "fulfillment_failed") {
      provStats[o.provider].failed++;
    }
  }

  // 3. Generate Bayesian Outage & Alternative Path recommendations for Admins
  let recommendationsGenerated = 0;

  for (const [network, provStats] of networkProviderStats.entries()) {
    // Calculate total stats for the network across all providers
    let totalNetworkOrders = 0;
    let totalNetworkFailed = 0;
    
    let worstProvider = "";
    let worstFailureRate = 0;
    let worstFailedCount = 0;

    let bestProvider = "";
    let bestSuccessRate = 0;
    let bestVolume = 0;

    for (const [provider, stats] of Object.entries(provStats)) {
      totalNetworkOrders += stats.total;
      totalNetworkFailed += stats.failed;

      const failRate = stats.failed / stats.total;
      const successRate = 1 - failRate;

      // Identify the failing provider
      if (stats.total >= 3 && failRate > worstFailureRate) {
        worstFailureRate = failRate;
        worstProvider = provider;
        worstFailedCount = stats.failed;
      }

      // Identify the most stable alternative provider
      if (successRate > bestSuccessRate || (successRate === bestSuccessRate && stats.total > bestVolume)) {
        bestSuccessRate = successRate;
        bestProvider = provider;
        bestVolume = stats.total;
      }
    }

    if (totalNetworkOrders >= 4) { // Establish valid base sample size
      const globalFailRate = totalNetworkFailed / totalNetworkOrders;
      
      // Bayesian Outage Confidence Formula: Dampens small volume noise, scales with larger samples
      // OutageConfidence = FailRate * (1 - Math.exp(-TotalOrders / 6))
      const outageConfidence = globalFailRate * (1 - Math.exp(-totalNetworkOrders / 6));

      // We alert if the confidence threshold indicates severe disruption (Confidence >= 0.20)
      if (outageConfidence >= 0.20) {
        const title = `AI Alert: High Failure Rate on ${network}`;
        
        let priority = "medium";
        if (outageConfidence >= 0.65) priority = "critical";
        else if (outageConfidence >= 0.40) priority = "high";

        // Construct detailed message pointing to the culprit and the solution
        let message = `SwiftData AI detected severe latency on ${network} with a ${(globalFailRate * 100).toFixed(0)}% failure rate (${totalNetworkFailed}/${totalNetworkOrders} orders failing).`;
        
        if (worstProvider) {
          message += ` The primary culprit appears to be provider [${worstProvider}] showing a ${(worstFailureRate * 100).toFixed(0)}% failure rate.`;
        }
        
        if (bestProvider && bestProvider !== worstProvider && bestSuccessRate >= 0.85) {
          message += ` AI recommends switching your primary routing for ${network} immediately to [${bestProvider}], which is running stable at a ${(bestSuccessRate * 100).toFixed(0)}% success rate.`;
        } else {
          message += ` AI recommends disabling or checking the connections for your primary ${network} gateways immediately.`;
        }

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
            priority,
            action_data: { 
              network, 
              global_failure_rate: globalFailRate, 
              confidence_score: outageConfidence,
              culprit_provider: worstProvider,
              recommended_provider: bestProvider,
              switch_recommended: true 
            }
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
