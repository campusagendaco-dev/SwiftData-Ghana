import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// Runs every 6 hours
Deno.cron("Vendor Profit Recommender", "0 */6 * * *", async () => {
  console.log("Running AI Vendor Profit Recommender...");
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Get all active agents
  const { data: agents, error: agentError } = await supabase
    .from("profiles")
    .select("user_id, markups")
    .eq("is_agent", true)
    .eq("agent_approved", true);

  if (agentError || !agents) {
    console.error("Failed to fetch agents:", agentError);
    return;
  }

  // 2. Fetch recent orders to analyze velocity
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("agent_id, network")
    .eq("status", "fulfilled")
    .in("order_type", ["data", "api"])
    .gte("created_at", sevenDaysAgo.toISOString());

  if (ordersError || !orders) {
    console.error("Failed to fetch orders:", ordersError);
    return;
  }

  // 3. Aggregate velocity per agent per network, and calculate global network stats
  const velocity = new Map<string, Record<string, number>>();
  const networkTotals: Record<string, number> = { MTN: 0, Telecel: 0, AirtelTigo: 0 };
  const networkActiveAgents: Record<string, number> = { MTN: 0, Telecel: 0, AirtelTigo: 0 };

  for (const o of orders) {
    if (!o.agent_id || !o.network) continue;
    if (!velocity.has(o.agent_id)) {
      velocity.set(o.agent_id, { MTN: 0, Telecel: 0, AirtelTigo: 0 });
    }
    const agentStats = velocity.get(o.agent_id)!;
    if (agentStats[o.network] !== undefined) {
      agentStats[o.network]++;
      networkTotals[o.network]++;
    }
  }

  // Count active agents per network to calculate average platform velocities
  for (const agent of agents) {
    const stats = velocity.get(agent.user_id);
    if (!stats) continue;
    for (const [network, count] of Object.entries(stats)) {
      if (count > 0) {
        networkActiveAgents[network]++;
      }
    }
  }

  // 4. Generate highly intelligent recommendations
  let recommendationsGenerated = 0;

  for (const agent of agents) {
    const stats = velocity.get(agent.user_id);
    if (!stats) continue;

    for (const [network, count] of Object.entries(stats)) {
      // Dynamic High-Volume Threshold: We recommend optimizations if count is >= 15 weekly sales
      if (count >= 15) {
        const currentMarkup = Number(agent.markups?.[network] || 0);
        
        // Ensure markups are competitively bounded (safety threshold)
        if (currentMarkup < 6) {
          // Dynamic Elasticity Markup Recommendation: Higher velocity allows scaling the increase
          // We recommend larger increases for larger volumes, but strictly capped to stay competitive.
          const suggestedIncrease = Math.min(1.50, Math.max(0.20, Number((count / 250).toFixed(2))));
          const newMarkup = Number((currentMarkup + suggestedIncrease).toFixed(2));
          
          // Downside Pricing Safety Net & Price Elasticity factor (e.g. 15% estimated drop in sales volume due to price hike)
          const elasticityConstant = 0.85; 
          const currentDailyProfit = (count / 7) * currentMarkup;
          const projectedDailyProfit = (count / 7) * newMarkup * elasticityConstant;
          const netDailyProfitIncrease = Math.max(0, projectedDailyProfit - currentDailyProfit);
          const extraDailyProfit = Math.round(netDailyProfitIncrease);

          // Calculate average platform velocity for comparison
          const activeCount = networkActiveAgents[network] || 1;
          const avgVelocity = Math.round(networkTotals[network] / activeCount);

          // We only recommend if it mathematically increases their projected net profit
          if (projectedDailyProfit > currentDailyProfit) {
            const title = `AI Profit Optimizer: ${network}`;
            
            const message = [
              `SwiftData AI audited your weekly sales velocity for ${network} (${count} sales, compared to the platform average of ${avgVelocity}).`,
              `To maximize your returns, AI recommends optimizing your markup from GH₵${currentMarkup.toFixed(2)} to GH₵${newMarkup.toFixed(2)} (+GH₵${suggestedIncrease.toFixed(2)} increase).`,
              `Accounting for a simulated ${Math.round((1 - elasticityConstant) * 100)}% price elasticity drop, this is projected to boost your daily net profit by ~GH₵${extraDailyProfit.toFixed(2)} (~GH₵${(extraDailyProfit * 7).toFixed(2)} extra weekly).`
            ].join(" ");

            // Check if we recently sent this recommendation to avoid spam
            const { data: existing } = await supabase
              .from("ai_recommendations")
              .select("id")
              .eq("user_id", agent.user_id)
              .eq("agent_type", "vendor-profit")
              .eq("title", title)
              .gt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // last 7 days
              .limit(1);

            if (!existing || existing.length === 0) {
              await supabase.from("ai_recommendations").insert({
                user_id: agent.user_id,
                agent_type: "vendor-profit",
                title,
                message,
                priority: count >= 50 ? "high" : "medium",
                action_data: { 
                  network, 
                  current_markup: currentMarkup,
                  recommended_markup: newMarkup, 
                  estimated_increase: suggestedIncrease,
                  projected_weekly_gain: extraDailyProfit * 7 
                }
              });
              recommendationsGenerated++;
            }
          }
        }
      }
    }
  }

  console.log(`Vendor Profit Recommender finished. Generated ${recommendationsGenerated} recommendations.`);
});

serve(async (req) => {
  return new Response(JSON.stringify({ status: "AI Vendor Recommender is active." }), {
    headers: { "Content-Type": "application/json" },
  });
});
