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

  // 3. Aggregate velocity per agent per network
  const velocity = new Map<string, Record<string, number>>();
  for (const o of orders) {
    if (!o.agent_id || !o.network) continue;
    if (!velocity.has(o.agent_id)) {
      velocity.set(o.agent_id, { MTN: 0, Telecel: 0, AirtelTigo: 0 });
    }
    const agentStats = velocity.get(o.agent_id)!;
    if (agentStats[o.network] !== undefined) {
      agentStats[o.network]++;
    }
  }

  // 4. Generate recommendations
  let recommendationsGenerated = 0;

  for (const agent of agents) {
    const stats = velocity.get(agent.user_id);
    if (!stats) continue;

    for (const [network, count] of Object.entries(stats)) {
      // If velocity is very high (e.g., > 100 sales in 7 days), recommend a markup increase
      if (count >= 100) {
        const currentMarkup = Number(agent.markups?.[network] || 0);
        
        // Ensure we only recommend if current markup is relatively low (< 5 GHS)
        if (currentMarkup < 5) {
          const recommendedIncrease = 0.5;
          const extraDailyProfit = Math.round((count / 7) * recommendedIncrease);
          
          const title = `AI Profit Optimizer: ${network}`;
          const message = `You are selling a very high volume of ${network} data (${count} sales this week). AI recommends increasing your markup by GH₵${recommendedIncrease}. This could increase your daily profit by roughly GH₵${extraDailyProfit}.`;

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
              priority: "high",
              action_data: { network, recommended_markup: currentMarkup + recommendedIncrease }
            });
            recommendationsGenerated++;
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
