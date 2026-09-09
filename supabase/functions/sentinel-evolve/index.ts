import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log("[Sentinel Evolve] Commencing empirical action evaluation and self-learning cycle...");

    // 1. Fetch executed actions pending evaluation (effectiveness = 0) older than 3 minutes
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: actionsToEvaluate, error: actionError } = await supabaseAdmin
      .from("sentinel_actions")
      .select("*")
      .eq("status", "executed")
      .eq("effectiveness", 0)
      .lt("ts", threeMinutesAgo)
      .order("ts", { ascending: true })
      .limit(20);

    if (actionError) throw actionError;

    const evaluations = [];

    for (const action of (actionsToEvaluate || [])) {
      let effectiveness = 1; // Default assumption of positive resolution
      const actionTs = action.ts;
      const windowEnd = new Date(new Date(actionTs).getTime() + 30 * 60 * 1000).toISOString();

      try {
        if (action.action_type === "switch_priority" || action.action_type === "self_heal_provider") {
          const providerId = action.metadata?.provider_id;
          if (providerId) {
            // Check orders processed by this provider after the action was taken
            const { data: subsequentOrders } = await supabaseAdmin
              .from("orders")
              .select("status")
              .eq("provider_id", providerId)
              .gt("updated_at", actionTs)
              .lt("updated_at", windowEnd)
              .limit(20);

            if (subsequentOrders && subsequentOrders.length > 0) {
              const fails = subsequentOrders.filter((o: any) => o.status === "failed" || o.status === "fulfillment_failed").length;
              const failRate = fails / subsequentOrders.length;
              // If failure rate remained high (> 40%), the switch was ineffective
              effectiveness = failRate > 0.4 ? -1 : 1;
            }
          }
        } else if (action.action_type === "lock_terminal") {
          // Check if error logs for this agent subsided
          const agentId = action.metadata?.target || action.metadata?.agent_id;
          if (agentId) {
            const { data: newViolations } = await supabaseAdmin
              .from("security_audit_logs")
              .select("id")
              .eq("user_id", agentId)
              .gt("timestamp", actionTs)
              .limit(1);

            effectiveness = (newViolations && newViolations.length > 0) ? -1 : 1;
          }
        } else {
          // Check if system errors subsided in the 30-minute window
          const { data: subsequentErrors } = await supabaseAdmin
            .from("system_logs")
            .select("id")
            .eq("level", "error")
            .gt("ts", actionTs)
            .lt("ts", windowEnd)
            .limit(10);

          effectiveness = (subsequentErrors && subsequentErrors.length > 5) ? -1 : 1;
        }
      } catch (evalErr) {
        console.warn(`[Sentinel Evolve] Evaluation heuristic error for action ${action.id}:`, evalErr);
        effectiveness = 1;
      }

      // Update the evaluated action
      await supabaseAdmin
        .from("sentinel_actions")
        .update({ effectiveness })
        .eq("id", action.id);

      // Relearn & Adapt Strategy Confidence Scores
      if (action.strategy_id) {
        const { data: strategy } = await supabaseAdmin
          .from("sentinel_strategies")
          .select("confidence_score, version")
          .eq("id", action.strategy_id)
          .single();

        if (strategy) {
          const currentScore = strategy.confidence_score ?? 0.5;
          // Reward success with +0.05, penalize failure with -0.15
          const delta = effectiveness === 1 ? 0.05 : -0.15;
          const newScore = Math.max(0.1, Math.min(0.99, Number((currentScore + delta).toFixed(2))));
          const shouldDeactivate = newScore < 0.35;

          await supabaseAdmin
            .from("sentinel_strategies")
            .update({ 
              confidence_score: newScore,
              is_active: !shouldDeactivate,
              version: (strategy.version || 1) + 1
            })
            .eq("id", action.strategy_id);

          console.log(`[Sentinel Evolve] Strategy ${action.strategy_id} updated: confidence ${currentScore} -> ${newScore} (active: ${!shouldDeactivate})`);
        }
      } else if (effectiveness === 1 && action.action_type !== "notify_admin") {
        // Synthesize newly discovered high-effectiveness pattern into a permanent strategy
        try {
          const newStrategyName = `Evolved: Auto-${action.action_type.replace(/_/g, " ")}`;
          const conditionDesc = action.reasoning || "Empirically validated systemic intervention";
          
          await supabaseAdmin.from("sentinel_strategies").insert({
            name: newStrategyName,
            condition_prompt: conditionDesc,
            action_template: { action_type: action.action_type, params: action.metadata || {} },
            confidence_score: 0.75,
            version: 1,
            is_active: true
          });
          console.log(`[Sentinel Evolve] Created new permanent strategy: "${newStrategyName}"`);
        } catch (stratErr) {
          console.error("[Sentinel Evolve] Failed to synthesize new strategy:", stratErr);
        }
      }

      evaluations.push({ action_id: action.id, type: action.action_type, effectiveness });
    }

    console.log(`[Sentinel Evolve] Completed evaluation of ${evaluations.length} action(s).`);

    return new Response(JSON.stringify({
      success: true,
      evaluated_count: evaluations.length,
      evaluations,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("[Sentinel Evolve Error]:", error);
    return new Response(JSON.stringify({ error: (error as any)?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
