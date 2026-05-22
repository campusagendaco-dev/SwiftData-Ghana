import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    console.log(`🛡️ Guardian AI: Initiating 24/7 Autonomous Security Patrol...`);

    // 1. Fetch Admin Contact
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("phone, email")
      .eq("role", "admin")
      .limit(1);
    
    const adminContact = admins?.[0];

    const notifyAdmin = async (message: string) => {
      if (adminContact?.phone) {
        try {
          const { apiKey, senderId } = await getSmsConfig(supabaseAdmin);
          if (apiKey) {
            await sendSmsViaTxtConnect(apiKey, senderId, adminContact.phone, `[Guardian AI] ${message}`);
          }
        } catch (e) {
          console.error("SMS notification failed:", e);
        }
      }
    };

    // 2. Fetch Data (Orders & Security Logs) for the last 15 minutes
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [ordersRes, logsRes] = await Promise.all([
      supabaseAdmin.from("orders").select("agent_id, network, amount, status, order_type").gte("created_at", fifteenMinsAgo),
      supabaseAdmin.from("security_logs").select("user_id, ip_address, action, metadata").gte("created_at", fifteenMinsAgo)
    ]);

    if (ordersRes.error) throw ordersRes.error;
    
    const recentOrders = ordersRes.data || [];
    const securityLogs = logsRes.data || [];

    // --- MODULE: Rapid Wallet Draining & Micro-Transaction Analysis ---
    const agentActivity: Record<string, { total: number; failed: number; volume: number; cashout_volume: number; micro_txns: number; distinct_ips: Set<string> }> = {};
    
    // --- MODULE: Smart Provider Outage Protection ---
    const networkFailures: Record<string, Set<string>> = {};

    for (const o of recentOrders) {
      if (!agentActivity[o.agent_id]) {
        agentActivity[o.agent_id] = { total: 0, failed: 0, volume: 0, cashout_volume: 0, micro_txns: 0, distinct_ips: new Set() };
      }
      agentActivity[o.agent_id].total++;
      agentActivity[o.agent_id].volume += Number(o.amount || 0);

      if (o.status === "failed" || o.status === "fulfillment_failed") {
        agentActivity[o.agent_id].failed++;
        if (o.network) {
          if (!networkFailures[o.network]) networkFailures[o.network] = new Set();
          networkFailures[o.network].add(o.agent_id);
        }
      } else if (o.order_type === 'cashout' || o.order_type === 'transfer' || o.order_type === 'wallet_transfer') {
        agentActivity[o.agent_id].cashout_volume += Number(o.amount || 0);
      }
      
      if (Number(o.amount || 0) < 2) {
        agentActivity[o.agent_id].micro_txns++;
      }
    }

    // --- MODULE: Impossible Travel & API Abuse ---
    const apiAbuseByIp: Record<string, number> = {};
    for (const log of securityLogs) {
      if (log.action === "api_auth_failure" && log.ip_address) {
        apiAbuseByIp[log.ip_address] = (apiAbuseByIp[log.ip_address] || 0) + 1;
      } else if (log.user_id && log.ip_address) {
        if (!agentActivity[log.user_id]) {
          agentActivity[log.user_id] = { total: 0, failed: 0, volume: 0, cashout_volume: 0, micro_txns: 0, distinct_ips: new Set() };
        }
        agentActivity[log.user_id].distinct_ips.add(log.ip_address);
      }
    }

    const maliciousIps = Object.entries(apiAbuseByIp).filter(([ip, count]) => count > 15).map(([ip, count]) => ({ ip, count }));
    const failingNetworks = Object.entries(networkFailures).filter(([network, agents]) => agents.size >= 3).map(([network]) => network);

    // Filter to agents with suspicious activity
    const suspiciousAgents = Object.entries(agentActivity).map(([id, stats]) => ({
      agent_id: id,
      total: stats.total,
      failed: stats.failed,
      cashout_volume: stats.cashout_volume,
      micro_txns: stats.micro_txns,
      distinct_ips_count: stats.distinct_ips.size,
      failure_rate: stats.total > 0 ? (stats.failed / stats.total) : 0,
      risk_score: 0
    })).filter(a => a.failure_rate > 0.4 || a.micro_txns > 5 || a.cashout_volume > 3000 || a.distinct_ips_count > 1);

    // If everything is peaceful, exit early.
    if (suspiciousAgents.length === 0 && maliciousIps.length === 0 && failingNetworks.length === 0) {
      console.log("Guardian AI: No severe threats detected in the last 15 minutes. Standing by.");
      return new Response(JSON.stringify({ success: true, message: "No threats detected." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve profile details for suspicious agents
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, phone, terminal_locked, is_agent, role")
      .in("user_id", suspiciousAgents.map(a => a.agent_id));

    const enrichedAgents = suspiciousAgents.map(a => {
      const p = profiles?.find(prof => prof.user_id === a.agent_id);
      return {
        ...a,
        full_name: p?.full_name || "Unknown",
        phone: p?.phone || "Unknown",
        terminal_locked: p?.terminal_locked || false,
        is_admin: p?.role === 'admin'
      };
    }).filter(a => !a.is_admin); // Never lock admins!

    // 3. AI Analysis (Claude Haiku for fast processing)
    const systemPrompt = `
      You are GUARDIAN AI — the 24/7 autonomous cyber-security watchdog for SwiftData.
      Your job is to review the recent 15-minute transaction logs of suspicious agents and immediately neutralize threats.

      ━━━ CORE DIRECTIVES ━━━
      1. FRAUD & BOT DETECTION: High failure rates (>60%) combined with high volume indicate a bot or gateway exploit attempt.
      2. CARD TESTING: Multiple micro-transactions (under 2 GHS) is a severe red flag.
      3. IMPOSSIBLE TRAVEL: "distinct_ips_count" > 1 indicates compromised credentials (hijacked account).
      4. WALLET DRAINING: "cashout_volume" > 3000 GHS in 15 mins indicates rapid draining.
      5. API ABUSE: Malicious IPs with >15 auth failures must be blocked immediately.
      6. OUTAGE PROTECTION: If a network is failing across >=3 distinct agents, broadcast an outage.
      7. ACTION PROTOCOL: If an agent exhibits behaviors 1-4, you MUST output a "lock_terminal" action to freeze their account.

      ━━━ AVAILABLE ACTIONS ━━━
      - lock_terminal: { "target": "uuid", "reason": "string" }
      - flag_for_review: { "target": "uuid", "reason": "string" }
      - block_ip: { "target": "ip_address", "reason": "string" }
      - broadcast_outage: { "target": "network_name", "reason": "string" }
      - notify_admin: { "message": "string" }

      ━━━ CRITICAL OUTPUT RULES ━━━
      - Respond with RAW JSON only. No markdown. No code blocks. No backticks.
      - Schema: {"actions":[{"type":"string","target":"string","params":{}}]}
    `;

    const userMessage = `
      SUSPICIOUS AGENT ACTIVITY (Last 15 Mins):
      ${JSON.stringify(enrichedAgents, null, 2)}
      
      MALICIOUS IPs (API Credential Stuffing):
      ${JSON.stringify(maliciousIps, null, 2)}
      
      FAILING NETWORKS (>=3 affected agents):
      ${JSON.stringify(failingNetworks, null, 2)}
    `;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || "{}";
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    const executedActions = [];

    // 4. Execute Autonomous Actions
    for (const action of actions) {
      console.log(`Guardian AI Execution: ${action.type} on ${action.target}`);
      
      let effectiveness = 1;
      const metadata = action.params || {};

      try {
        if (action.type === 'lock_terminal') {
          // Verify agent isn't already locked to prevent spam
          const targetAgent = enrichedAgents.find(a => a.agent_id === action.target);
          if (targetAgent && !targetAgent.terminal_locked) {
            await supabaseAdmin.from("profiles").update({ terminal_locked: true }).eq("user_id", action.target);
            await notifyAdmin(`GUARDIAN ALERT: Locked terminal for ${targetAgent.full_name} (${targetAgent.phone}). Reason: ${metadata.reason || 'Anomalous activity'}.`);
            
            // Log to fraud risk
            await supabaseAdmin.from("fraud_risk_logs").insert({
              agent_id: action.target,
              risk_score: 99,
              risk_factors: ['24/7_Guardian_Bot_Detection'],
              action_taken: 'terminal_locked_by_ai'
            });
          }
        }

        if (action.type === 'flag_for_review') {
          await notifyAdmin(`GUARDIAN WARNING: Please review agent ${action.target.slice(0, 8)}. Reason: ${metadata.reason || action.reason}`);
        }

        if (action.type === 'block_ip') {
          await supabaseAdmin.from("security_blacklist").insert({
            type: "ip",
            value: action.target,
            reason: metadata.reason || action.reason || "Brute force / Credential Stuffing",
            created_by: "guardian_ai"
          });
          await notifyAdmin(`GUARDIAN DEFENSE: Blocked malicious IP ${action.target} due to API credential stuffing.`);
        }

        if (action.type === 'broadcast_outage') {
          await supabaseAdmin.from("service_status").update({ 
            status: "offline", 
            admin_note: "Auto-disabled by Guardian AI due to universal network failure" 
          }).eq("network", action.target.toUpperCase());
          await notifyAdmin(`GUARDIAN OUTAGE: Auto-disabled ${action.target} network across the platform to prevent further failures.`);
        }

        if (action.type === 'notify_admin') {
          await notifyAdmin(metadata.message || "Guardian AI detected an anomaly.");
        }

        // Log to sentinel_actions for UI
        const { data: loggedAction } = await supabaseAdmin.from("sentinel_actions").insert({
          action_type: action.type,
          status: 'executed',
          effectiveness: effectiveness,
          reasoning: action.reason || metadata.reason || "Autonomous Guardian Sweep",
          metadata: { ...metadata, source: "guardian_ai" }
        }).select().single();

        if (loggedAction) executedActions.push(loggedAction);
      } catch (err: any) {
        console.error(`Guardian Execution Failed:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, actions_taken: executedActions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Guardian AI Critical Failure:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
