import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, dispatchUnifiedSms, dispatchUnifiedBulkSms } from "../_shared/sms.ts";
import { callAiAgent } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const body = await req.json().catch(() => ({}));
    const { event, order_id, log_id } = body;

    console.log(`Sentinel Prime: Initiating ${event ? 'Surgical Strike' : 'Autonomous Cognitive Scan'}...`);

    // 1. Self-Healing Webhook Failover Watchdog
    console.log("Sentinel Failover: Scanning for stuck pending orders...");
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: stuckOrders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("status", "pending")
      .not("order_type", "in", '("wallet_topup","store_wallet_topup","agent_activation","sub_agent_activation","vendor_activation","free_data_claim")')
      .gte("created_at", twoHoursAgo)
      .lte("created_at", fiveMinutesAgo);

    if (stuckOrders && stuckOrders.length > 0) {
      console.log(`Sentinel Failover: Found ${stuckOrders.length} stuck pending orders. Triggering verify-payment healing...`);
      const healingPromises = stuckOrders.map(async (order: any) => {
        try {
          console.log(`Sentinel Failover: Triggering check for order ${order.id}`);
          const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ reference: order.id }),
          });
          const data = await res.json().catch(() => ({}));
          console.log(`Sentinel Failover: Healing check result for ${order.id}:`, data);
        } catch (err: any) {
          console.error(`[Sentinel Failover] Failed to trigger verify-payment for ${order.id}:`, err.message);
        }
      });
      await Promise.allSettled(healingPromises);
    }

    // 2. Fetch Deep Cognitive Memory (Adaptive Relearning Foundation)
    const [strategiesRes, pastActionsRes, recentFailuresRes] = await Promise.all([
      // 2a. Active Strategies Knowledge Base
      supabaseAdmin
        .from("sentinel_strategies")
        .select("id, name, condition_prompt, action_template, confidence_score, version")
        .eq("is_active", true)
        .order("confidence_score", { ascending: false }),
      // 2b. Recent Tactical Action History (Last 15 decisions & outcome evaluations)
      supabaseAdmin
        .from("sentinel_actions")
        .select("id, action_type, status, effectiveness, reasoning, ts, metadata")
        .order("ts", { ascending: false })
        .limit(15),
      // 2c. Live System Failure Clusters (Last 2 hours)
      supabaseAdmin
        .from("orders")
        .select("network, failure_reason, provider_id, status")
        .in("status", ["failed", "fulfillment_failed"])
        .gte("created_at", twoHoursAgo)
        .limit(50)
    ]);

    const activeStrategies = strategiesRes.data || [];
    const pastActions = pastActionsRes.data || [];
    const recentFailures = recentFailuresRes.data || [];

    // Group failure patterns for swift pattern recognition
    const failureClusters: Record<string, number> = {};
    for (const f of recentFailures) {
      const reasonKey = `${f.network || 'UNKNOWN'}: ${(f.failure_reason || 'UNSPECIFIED').slice(0, 50)}`;
      failureClusters[reasonKey] = (failureClusters[reasonKey] || 0) + 1;
    }

    // 3. Fetch Real-time Agent & Provider Ecosystem Pulse
    let agentsToAnalyze: any[] = [];
    let ordersToAnalyze: any[] = [];

    if (event === 'order_failure' && order_id) {
      // Surgical Strike: Focus on specific failure
      const { data: failedOrder } = await supabaseAdmin.from("orders").select("*").eq("id", order_id).single();
      if (failedOrder) {
        const [agentRes, walletRes] = await Promise.all([
          supabaseAdmin.from("profiles").select("user_id, full_name, phone, loyalty_points").eq("user_id", failedOrder.agent_id).single(),
          supabaseAdmin.from("wallets").select("balance").eq("agent_id", failedOrder.agent_id).maybeSingle()
        ]);
        const profileData = agentRes.data;
        if (profileData) {
          agentsToAnalyze = [{
            id: profileData.user_id,
            name: profileData.full_name,
            phone: profileData.phone,
            loyalty_points: profileData.loyalty_points,
            wallet_balance: walletRes.data?.balance ?? 0
          }];
        }
        ordersToAnalyze = [failedOrder];
      }
    } else {
      // General Autonomous Sweep
      const { data: agents } = await supabaseAdmin.from("profiles").select("user_id, full_name, phone, loyalty_points").eq("is_agent", true).limit(50);
      if (agents && agents.length > 0) {
        const agentIds = agents.map((a: any) => a.user_id);
        const { data: wallets } = await supabaseAdmin.from("wallets").select("agent_id, balance").in("agent_id", agentIds);
        const walletMap = new Map((wallets || []).map((w: any) => [w.agent_id, w.balance]));
        agentsToAnalyze = agents.map((a: any) => ({
          id: a.user_id,
          name: a.full_name,
          phone: a.phone,
          loyalty_points: a.loyalty_points,
          wallet_balance: walletMap.get(a.user_id) ?? 0
        }));
      }
      const { data: recentOrders } = await supabaseAdmin.from("orders").select("*").gt("created_at", new Date(Date.now() - 3600000).toISOString());
      ordersToAnalyze = recentOrders || [];
    }

    const { data: settings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("*").single();
    const { data: providers } = await supabaseAdmin.from("providers").select("*").order("priority", { ascending: true });

    // Fetch Admin Contact for tactical alerts
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("phone, email")
      .eq("role" as any, "admin" as any)
      .limit(1);
    
    const adminContact = admins?.[0];

    // Agent Risk & Behavior Metrics
    const agentStats = (agentsToAnalyze || []).map((agent: any) => {
      const orders = (ordersToAnalyze || []).filter((o: any) => o.agent_id === agent.id);
      const failures = orders.filter((o: any) => o.status === 'failed' || o.status === 'fulfillment_failed').length;
      
      let riskScore = 0;
      if (orders.length > 20) riskScore += 35;
      if (failures > 5) riskScore += 30;
      if (orders.length > 0 && (failures / orders.length) > 0.5) riskScore += 35;

      return {
        id: agent.id,
        name: agent.name || agent.full_name,
        phone: agent.phone,
        balance: agent.wallet_balance,
        velocity: orders.length,
        failure_rate: orders.length > 0 ? Number((failures / orders.length).toFixed(2)) : 0,
        risk_score: riskScore
      };
    });

    // Provider Health & Liquidity
    const providerHealth = (providers || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      priority: p.priority,
      consecutive_failures: p.consecutive_failures || 0,
      status: p.is_active ? 'active' : 'inactive',
      handler_type: p.handler_type
    }));

    // Network Outage & Drop Rates
    const networkStats = ["MTN", "TELECEL", "AT", "GLO"].map((net: string) => {
      const netOrders = (ordersToAnalyze || []).filter((o: any) => (o.network || '').toUpperCase().includes(net));
      const failures = netOrders.filter((o: any) => o.status === 'failed' || o.status === 'fulfillment_failed').length;
      return {
        network: net,
        total: netOrders.length,
        failures: failures,
        failure_rate: netOrders.length > 0 ? Number((failures / netOrders.length).toFixed(2)) : 0
      };
    });

    // 4. Construct Supercharged Adaptive Cognitive Prompt
    const systemPrompt = `
      You are SENTINEL PRIME — the autonomous intelligence brain and controller for SwiftData.
      
      ━━━ CORE DIRECTIVES ━━━
      1. FRAUD DETECTION: Identify high-risk velocity attacks (risk_score > 80, rapid < GHS 5 test transactions).
      2. FINANCIAL INTEGRITY: Monitor wallet balances, flag suspicious self-topups or circular flows.
      3. LIQUIDITY BALANCING: Ensure only providers with HEALTHY BALANCE (> GHS 50) and low consecutive failures hold Priority 1.
      4. AUTO-FAILOVER: If Priority 1 provider balance < GHS 50 or consecutive_failures >= 3, switch priority to the best alternative.
      5. NETWORK HEALING: If a provider restored healthy balance and 0 failures, re-promote them to Priority 1.
      6. OUTAGE MITIGATION: If a network's failure rate > 50% across at least 5 orders, broadcast outage to protect user confidence.
      7. RELEARNING & ANTI-FLAPPING:
         - Inspect "RECENT TACTICAL MEMORY". If an action of the same type was executed recently and is still taking effect, DO NOT repeat it redundantly.
         - If an action previously yielded negative effectiveness (-1), adjust thresholds or choose an alternative action.
         - Match actions against the "ACTIVE STRATEGY KNOWLEDGE BASE" and include "strategy_id" when executing proven playbooks.
         - If you discover a novel systemic pattern, propose a new strategy in "new_strategies".

      ━━━ AVAILABLE ACTIONS ━━━
      - lock_terminal: { "target": "agent_uuid", "reason": "string", "strategy_id": "optional_uuid" }
      - switch_priority: { "provider_id": "uuid", "new_priority": 1, "provider_name": "string", "reason": "string", "strategy_id": "optional_uuid" }
      - self_heal_provider: { "provider_id": "uuid", "provider_name": "string", "reason": "string", "strategy_id": "optional_uuid" }
      - broadcast_outage: { "network": "MTN|TELECEL|AT", "reason": "string", "strategy_id": "optional_uuid" }
      - notify_admin: { "message": "string" }

      ━━━ CRITICAL OUTPUT RULES ━━━
      - Respond with RAW JSON only. No markdown. No code blocks. No backticks. No explanations.
      - Required JSON schema:
      {
        "findings": ["summary findings string"],
        "actions": [{ "type": "string", "target": "uuid_or_null", "params": {}, "strategy_id": "optional_uuid", "reason": "string" }],
        "insights": [{ "agent_id": "uuid_or_null", "type": "profit|liquidity|security", "text": "insight description", "metadata": {} }],
        "new_strategies": [{ "name": "string", "condition_prompt": "string", "action_template": {} }]
      }
    `;

    const userMessage = `
      CURRENT SYSTEM STATE:
      Providers: ${JSON.stringify(providerHealth)}
      Networks: ${JSON.stringify(networkStats)}
      Agent Threats: ${JSON.stringify(agentStats.filter((a: any) => a.risk_score > 30))}
      Order Failure Clusters (Last 2h): ${JSON.stringify(failureClusters)}
      
      ACTIVE STRATEGY KNOWLEDGE BASE:
      ${JSON.stringify(activeStrategies)}
      
      RECENT TACTICAL MEMORY (ACTIONS & EVALUATIONS):
      ${JSON.stringify(pastActions)}
    `;

    // 5. Call Supercharged AI Brain
    const aiResult = await callAiAgent(
      supabaseAdmin,
      "sentinel_prime",
      systemPrompt,
      userMessage,
      1800
    );

    const rawText = aiResult.text;
    let parsed: any = {};
    try {
      const jsonStart = rawText.indexOf("{");
      const jsonEnd = rawText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
      }
    } catch (parseErr) {
      console.warn("[Sentinel AI] Failed to parse AI JSON output, falling back to defaults:", parseErr);
    }
    const result = {
      findings: Array.isArray(parsed?.findings) ? parsed.findings : [],
      actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
      insights: Array.isArray(parsed?.insights) ? parsed.insights : [],
      new_strategies: Array.isArray(parsed?.new_strategies) ? parsed.new_strategies : []
    };

    // 6. Execute Autonomous Actions with Dynamic Relearning Tracking
    const executedActions = [];

    // Helper for Admin SMS Notifications via multi-gateway dispatcher
    const notifyAdmin = async (message: string) => {
      if (adminContact?.phone) {
        try {
          const smsConfig = await getSmsConfig(supabaseAdmin);
          if (smsConfig?.apiKey) {
            await dispatchUnifiedSms(
              smsConfig.gateway,
              smsConfig.apiKey,
              smsConfig.senderId,
              adminContact.phone,
              `[Sentinel AI] ${message}`,
              "custom"
            );
            console.log(`[Sentinel AI] Admin Notified: ${adminContact.phone}`);
          }
        } catch (smsErr) {
          console.error("[Sentinel AI] SMS notification failed:", smsErr);
        }
      }
    };

    for (const action of result.actions || []) {
      console.log(`Sentinel Tactical Action: ${action.type} on ${action.target || 'System'}`);
      
      const status = 'executed';
      const actionMetadata = action.params || {};

      try {
        if (action.type === 'lock_terminal' && action.target) {
          const { error: lockError } = await supabaseAdmin
            .from("profiles")
            .update({ terminal_locked: true })
            .eq("user_id", action.target);

          if (lockError) throw lockError;

          await supabaseAdmin.from("fraud_risk_logs").insert({
            agent_id: action.target,
            risk_score: 95,
            risk_factors: ['AI_Autonomous_Security_Sweep'],
            action_taken: 'lock_terminal'
          });

          await notifyAdmin(`Quarantined Agent terminal ${action.target.slice(0,8)} due to velocity fraud pattern.`);
          actionMetadata.reason = action.reason || "Autonomous fraud quarantine";
        }

        if (action.type === 'switch_priority' && action.params?.provider_id) {
          const { error: pError } = await supabaseAdmin
            .from("providers")
            .update({ priority: action.params.new_priority || 1 })
            .eq("id", action.params.provider_id);
          
          if (pError) throw pError;
          
          await notifyAdmin(`Rebalanced liquidity: Switched ${action.params.provider_name || 'Provider'} to Priority ${action.params.new_priority || 1}.`);
          actionMetadata.reason = action.reason || "Autonomous liquidity balancing";
        }

        if (action.type === 'self_heal_provider' && action.params?.provider_id) {
          const { error: healError } = await supabaseAdmin
            .from("providers")
            .update({ priority: 1, is_active: true, consecutive_failures: 0 })
            .eq("id", action.params.provider_id);
          
          if (healError) throw healError;
          
          await notifyAdmin(`Restored Provider: ${action.params.provider_name || 'Provider'} reprioritized to Priority 1.`);
          actionMetadata.reason = action.reason || "Autonomous health recovery";
        }

        if (action.type === 'broadcast_outage') {
          const network = action.params.network || "telecom network";
          
          // Anti-flapping: Check if an outage was already broadcast in the last 45 minutes
          const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
          const recentBroadcast = pastActions.find(
            (a: any) => a.action_type === "broadcast_outage" &&
            (a.metadata?.network || "").toUpperCase() === network.toUpperCase() &&
            a.ts > fortyFiveMinutesAgo
          );

          if (recentBroadcast) {
            console.log(`[Sentinel AI] Anti-flapping: Outage for ${network} already broadcasted within 45m. Suppressing duplicate.`);
            continue;
          }

          const { data: allAgents } = await supabaseAdmin
            .from("profiles")
            .select("phone")
            .eq("is_agent", true)
            .not("phone", "is", null);

          const phones = (allAgents || []).map((a: any) => a.phone).filter(Boolean);
          
          if (phones.length > 0) {
            const msg = `SwiftData Alert: We have detected instability with the ${network} network. Purchases may be delayed. Our system is auto-rerouting traffic.`;
            // Instant bulk dispatch via unified multi-gateway dispatcher
            const smsConfig = await getSmsConfig(supabaseAdmin);
            if (smsConfig?.apiKey) {
              await dispatchUnifiedBulkSms(
                smsConfig.gateway,
                smsConfig.apiKey,
                smsConfig.senderId,
                phones,
                msg,
                "broadcast"
              );
            }
          }
          await notifyAdmin(`Outage alert sent to ${phones.length} agents for ${network}`);
          actionMetadata.reason = action.reason || "High network drop rate detected autonomously";
        }

        if (action.type === 'notify_admin') {
          await notifyAdmin(action.params.message || action.reason || "Sentinel anomaly detected.");
        }

        // Record tactical action with effectiveness = 0 (pending evaluation by Sentinel Evolve)
        const { data: loggedAction } = await supabaseAdmin.from("sentinel_actions").insert({
          action_type: action.type,
          strategy_id: action.strategy_id || null,
          status: status,
          effectiveness: 0, // Pending objective evaluation by sentinel-evolve
          reasoning: action.reason || "Autonomous cognitive execution",
          metadata: { ...actionMetadata, ai_model: aiResult.model, ai_provider: aiResult.provider }
        }).select().single();

        if (loggedAction) executedActions.push(loggedAction);

      } catch (err: any) {
        console.error(`Tactical execution failed for ${action.type}:`, err.message);
        await supabaseAdmin.from("sentinel_actions").insert({
          action_type: action.type,
          strategy_id: action.strategy_id || null,
          status: 'failed',
          effectiveness: -1,
          reasoning: "Execution error: " + err.message,
          metadata: { ...actionMetadata, error: err.message }
        });
      }
    }

    // 7. Store Newly Discovered Strategies into Cognitive Memory
    if (result.new_strategies && result.new_strategies.length > 0) {
      for (const strat of result.new_strategies) {
        if (strat.name && strat.condition_prompt) {
          console.log(`[Sentinel Brain] Learned new strategy: "${strat.name}"`);
          await supabaseAdmin.from("sentinel_strategies").insert({
            name: strat.name,
            condition_prompt: strat.condition_prompt,
            action_template: strat.action_template || {},
            confidence_score: 0.70,
            version: 1,
            is_active: true
          });
        }
      }
    }

    // 8. Store Actionable Insights
    if (result.insights && result.insights.length > 0) {
      await supabaseAdmin.from("ai_insights").insert(
        result.insights.map((i: any) => ({
          agent_id: i.agent_id || null,
          type: i.type === 'profit' ? 'profit_optimization' : (i.type === 'security' ? 'security_alert' : 'liquidity_warning'),
          insight_text: i.text || i.insight_text || "System insight generated",
          metadata: i.metadata || {}
        }))
      );
    }

    return new Response(JSON.stringify({ 
      success: true, 
      ai_model: aiResult.model,
      ai_provider: aiResult.provider,
      findings: result.findings,
      tactical_actions: executedActions,
      new_strategies_learned: result.new_strategies?.length || 0
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[Sentinel AI Error]:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
