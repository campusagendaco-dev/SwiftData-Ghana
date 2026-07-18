import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";
import { callAiAgent } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const body = await req.json().catch(() => ({}));
    const { event, order_id, log_id } = body;

    console.log(`Sentinel Prime: Initiating ${event ? 'Surgical Strike' : 'Autonomous Scan'}...`);

    // 1. Self-Healing Webhook Failover Watchdog
    console.log("Sentinel Failover: Scanning for stuck pending orders...");
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: stuckOrders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("status", "pending")
      .gte("created_at", twoHoursAgo)
      .lte("created_at", fiveMinutesAgo);

    if (stuckOrders && stuckOrders.length > 0) {
      console.log(`Sentinel Failover: Found ${stuckOrders.length} stuck pending orders. Triggering verify-payment healing...`);
      const healingPromises = stuckOrders.map(async (order) => {
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

    // 2. Fetch System Pulse
    let agentsToAnalyze = [];
    let ordersToAnalyze = [];

    if (event === 'order_failure' && order_id) {
      // Surgical Strike: Focus on this specific failure
      const { data: failedOrder } = await supabaseAdmin.from("orders").select("*").eq("id", order_id).single();
      if (failedOrder) {
        const [agentRes, walletRes] = await Promise.all([
          supabaseAdmin.from("profiles").select("user_id, full_name, phone, loyalty_points").eq("user_id", failedOrder.agent_id).single(),
          supabaseAdmin.from("wallets").select("balance").eq("agent_id", failedOrder.agent_id).maybeSingle()
        ]);
        const profileData = agentRes.data;
        if (profileData) {
          const agent = {
            id: profileData.user_id,
            full_name: profileData.full_name,
            phone: profileData.phone,
            loyalty_points: profileData.loyalty_points,
            wallet_balance: walletRes.data?.balance ?? 0
          };
          agentsToAnalyze = [agent];
        }
        ordersToAnalyze = [failedOrder];
      }
    } else {
      // General Scan
      const { data: agents } = await supabaseAdmin.from("profiles").select("user_id, full_name, phone, loyalty_points").eq("is_agent", true).limit(50);
      if (agents && agents.length > 0) {
        const agentIds = agents.map(a => a.user_id);
        const { data: wallets } = await supabaseAdmin.from("wallets").select("agent_id, balance").in("agent_id", agentIds);
        const walletMap = new Map((wallets || []).map(w => [w.agent_id, w.balance]));
        agentsToAnalyze = agents.map(a => ({
          id: a.user_id,
          full_name: a.full_name,
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
    
    // Fetch Admin Contact
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("phone, email")
      .eq("role" as any, "admin" as any)
      .limit(1);
    
    const adminContact = admins?.[0];

    // 2. Risk & Behavior Processing (Sentinel Prime Core)
    const agentStats = agentsToAnalyze?.map(agent => {
      const orders = ordersToAnalyze?.filter(o => o.agent_id === agent.id) || [];
      const failures = orders.filter(o => o.status === 'failed').length;
      
      // Heuristic Risk Score
      let riskScore = 0;
      if (orders.length > 20) riskScore += 40;
      if (failures > 5) riskScore += 30;
      if (orders.length > 0 && (failures / orders.length) > 0.5) riskScore += 30;

      return {
        id: agent.id,
        name: agent.full_name,
        phone: agent.phone,
        balance: agent.wallet_balance,
        loyalty: agent.loyalty_points,
        velocity: orders.length,
        failure_rate: orders.length > 0 ? (failures / orders.length).toFixed(2) : 0,
        risk_score: riskScore
      };
    });

    // 3. Provider Health Check (Liquidity Balancing)
    const providerHealth = providers?.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      priority: p.priority,
      status: p.is_active ? 'active' : 'inactive',
      type: p.provider_type
    }));

    // 3.5 Network Performance
    const networkStats = ["MTN", "TELECEL", "AT", "GLO"].map(net => {
      const netOrders = ordersToAnalyze?.filter(o => o.network === net) || [];
      const failures = netOrders.filter(o => o.status === 'failed' || o.status === 'fulfillment_failed').length;
      return {
        network: net,
        total: netOrders.length,
        failures: failures,
        failure_rate: netOrders.length > 0 ? Number((failures / netOrders.length).toFixed(2)) : 0
      };
    });

    // 4. Construct the "God Mode" Prompt
    const systemPrompt = `
      You are SENTINEL PRIME — the ultimate autonomous controller for Swift Vendor.
      
      ━━━ CORE DIRECTIVES ━━━
      1. FRAUD DETECTION: Identify high risk scores (>80).
      2. FINANCIAL INTEGRITY: Monitor wallet_balance on profiles table. Flag suspicious self-top-ups.
      3. VELOCITY ATTACKS: Watch for agents making multiple rapid small top-ups (e.g. GHS 1.00 to 5.00 repeated within minutes), which suggests card testing or gateway exploitation.
      4. BALANCE STACKING: Flag accounts with high inflows but zero data sales.
      5. LIQUIDITY BALANCING: Ensure only providers with HIGH BALANCE are prioritized (Priority 1).
      6. FAILOVER: If Priority 1 provider has balance < 50, switch to the highest balance alternative.
      7. NETWORK OUTAGE: If a network's failure rate > 0.50 (50%) and total > 5, output a 'broadcast_outage' action to alert all active agents of the downtime.
      8. NOTIFICATION: Any autonomous action MUST trigger an admin notification.
      9. TRANSPARENCY: If an agent reports a discrepancy, direct them to use the "Wallet Statement" on their dashboard for proof.

      ━━━ AVAILABLE ACTIONS ━━━
      - lock_terminal: { "target": "uuid", "reason": "string" }
      - switch_priority: { "provider_id": "uuid", "new_priority": 1, "reason": "string" }
      - broadcast_outage: { "network": "string", "reason": "string" }
      - notify_admin: { "message": "string" }

      ━━━ CRITICAL OUTPUT RULES ━━━
      - Respond with RAW JSON only. No markdown. No code blocks. No backticks. No explanations.
      - Your entire response must be a single valid JSON object and nothing else.
      - If there is nothing to action, return: {"findings":[],"actions":[],"insights":[]}
      - Required schema:
      {"findings":[],"actions":[{"type":"string","target":"uuid","params":{}}],"insights":[]}
    `;

    const userMessage = `
      CURRENT NETWORK STATE:
      Agents: ${JSON.stringify(agentStats)}
      Providers: ${JSON.stringify(providerHealth)}
      Networks: ${JSON.stringify(networkStats)}
      System Settings: ${JSON.stringify(settings)}
    `;

    // 5. Call AI Brain via dynamic routing and self-healing failover client
    const aiResult = await callAiAgent(
      supabaseAdmin,
      "sentinel_prime",
      systemPrompt,
      userMessage,
      1500
    );

    const rawText = aiResult.text;
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON object found in AI response");
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    const result = {
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
    };

    // 5. Execute Autonomous Actions & Store Insights
    const executedActions = [];

    // Helper for SMS Notifications
    const notifyAdmin = async (message: string) => {
      if (adminContact?.phone) {
        try {
          const { apiKey, senderId } = await getSmsConfig(supabaseAdmin);
          if (apiKey) {
            await sendSmsViaTxtConnect(apiKey, senderId, adminContact.phone, `[Sentinel AI] ${message}`);
            console.log(`Admin Notified via SMS: ${adminContact.phone}`);
          }
        } catch (smsErr) {
          console.error("SMS notification failed:", smsErr);
        }
      }
    };

    for (const action of result.actions || []) {
      console.log(`Sentinel Tactical Action: ${action.type} on ${action.target || 'System'}`);
      
      const status = 'executed';
      const effectiveness = 1;
      const actionMetadata = action.params || {};

      try {
        if (action.type === 'lock_terminal') {
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

          await notifyAdmin(`Locked terminal for Agent ID ${action.target.slice(0,8)} due to high fraud risk.`);
          actionMetadata.reason = "High-velocity fraud pattern detected autonomously";
        }

        if (action.type === 'adjust_float_bridge') {
          // Autonomous Float Bridge (Overdraft) Adjustment
          const { error: bridgeError } = await supabaseAdmin
            .from("wallets")
            .update({ 
              auto_credit_limit: action.params.new_limit,
              ai_trust_score: action.params.new_trust_score,
              last_credit_review: new Date().toISOString()
            })
            .eq("agent_id", action.target);
          
          if (bridgeError) throw bridgeError;
          
          await notifyAdmin(`Float Bridge Updated for Agent ${action.target.slice(0,8)}: New Limit GHS ${action.params.new_limit}.`);
          actionMetadata.reason = "Performance-based liquidity bridge";
        }

        if (action.type === 'switch_priority') {
          // Autonomous Liquidity Rebalancing
          const { error: pError } = await supabaseAdmin
            .from("providers")
            .update({ priority: action.params.new_priority })
            .eq("id", action.params.provider_id);
          
          if (pError) throw pError;
          
          await notifyAdmin(`Rebalanced liquidity: Switched ${action.params.provider_name || 'Provider'} to Priority ${action.params.new_priority}.`);
          actionMetadata.reason = "Autonomous liquidity optimization";
        }

        if (action.type === 'self_heal_provider') {
          // Autonomous Network Recovery
          const { error: healError } = await supabaseAdmin
            .from("providers")
            .update({ priority: 1, is_active: true })
            .eq("id", action.params.provider_id);
          
          if (healError) throw healError;
          
          await notifyAdmin(`Network Healed: ${action.params.provider_name || 'Provider'} restored to Priority 1 after health verification.`);
          actionMetadata.reason = "Autonomous system recovery";
        }

        if (action.type === 'broadcast_outage') {
          const network = action.params.network || "A network";
          const { data: allAgents } = await supabaseAdmin.from("profiles").select("phone").eq("is_agent", true).not("phone", "is", null);
          const phones = allAgents?.map(a => a.phone) || [];
          
          if (phones.length > 0) {
            const { apiKey, senderId } = await getSmsConfig(supabaseAdmin);
            if (apiKey) {
              const msg = `SwiftData Alert: We have detected instability with the ${network} network. Purchases may fail. Please inform customers. We are monitoring closely.`;
              // In production, batch these. For now, map over them:
              await Promise.all(phones.map(phone => sendSmsViaTxtConnect(apiKey, senderId, phone, msg).catch(e => console.error(e))));
            }
          }
          await notifyAdmin(`Outage broadcasted to ${phones.length} agents for network: ${network}`);
          actionMetadata.reason = "High failure rate detected automatically";
        }

        if (action.type === 'notify_admin') {
           await notifyAdmin(action.params.message || "System anomaly detected.");
        }

        // Log the tactical action to the audit stream
        const { data: loggedAction } = await supabaseAdmin.from("sentinel_actions").insert({
          action_type: action.type,
          status: status,
          effectiveness: effectiveness,
          reasoning: action.reason || action.diagnosis || "Autonomous optimization",
          metadata: actionMetadata
        }).select().single();

        if (loggedAction) executedActions.push(loggedAction);

      } catch (err: any) {
        console.error(`Tactical execution failed: ${err.message}`);
        await supabaseAdmin.from("sentinel_actions").insert({
          action_type: action.type,
          status: 'failed',
          effectiveness: -1,
          reasoning: "Execution error: " + err.message,
          metadata: { ...actionMetadata, error: err.message }
        });
      }
    }

    if (result.insights) {
      await supabaseAdmin.from("ai_insights").insert(
        result.insights.map((i: any) => ({
          agent_id: i.agent_id,
          type: i.type === 'profit' ? 'profit_optimization' : 'liquidity_warning',
          insight_text: i.text,
          metadata: i.metadata
        }))
      );
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: result,
      tactical_actions: executedActions 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
