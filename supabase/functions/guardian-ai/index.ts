import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { routeAgentAction, type AgentAction, type AgentMode } from "../_shared/agent_policy.ts";
import { queueAgentAction, runAutoAction } from "../_shared/agent_actions.ts";
import { agentSms } from "../_shared/agent_sms.ts";
import { callAiAgent, getAgentConfig } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY));
  const isCronAuthed = Boolean(isServiceRole || (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)));
  if (!isCronAuthed) {
    const authRes = await verifyAdmin(req, supabaseAdmin);
    if (!authRes.success) {
      return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
        status: authRes.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const guardianCfg = await getAgentConfig(supabaseAdmin, "guardian_ai");
    if (!guardianCfg.is_active && isCronAuthed) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "guardian_ai is paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`🛡️ Guardian AI: Initiating 24/7 Autonomous Security Patrol...`);

    // Safe-agents design (2026-11-24): Guardian WATCHES and PROPOSES. Order, account, IP and
    // network changes go through routeAgentAction: queued for an admin with 2FA (propose
    // mode) or recorded as "would propose" findings (observe_only). Admin alerts are capped.
    const mode: AgentMode = guardianCfg.autonomy_mode;
    const notifyAdmin = (message: string, topic?: string) =>
      runAutoAction(supabaseAdmin, "guardian_ai", { type: "notify_admin", params: { message, topic } }, { sms: agentSms });
    const routed: any[] = [];
    const propose = async (action: AgentAction) => {
      const { route, reason } = routeAgentAction(mode, action);
      if (route === "run") {
        routed.push({ type: action.type, route, ...(await runAutoAction(supabaseAdmin, "guardian_ai", action, { sms: agentSms })) });
      } else if (route === "queue") {
        routed.push({ type: action.type, route, ...(await queueAgentAction(supabaseAdmin, "guardian_ai", action)) });
      } else if (route === "record") {
        await runAutoAction(supabaseAdmin, "guardian_ai", { type: "record_finding", reason: action.reason, params: { would_propose: action } }, { sms: agentSms });
        routed.push({ type: action.type, route });
      } else {
        routed.push({ type: action.type, route, reason });
      }
    };

    // 2. Fetch Data (Orders & Security Logs) for the last 15 minutes
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [ordersRes, logsRes] = await Promise.all([
      supabaseAdmin.from("orders").select("id, agent_id, network, amount, status, order_type, payment_method, paystack_verified_amount, provider_id, provider_order_id, failure_reason").gte("created_at", fifteenMinsAgo),
      supabaseAdmin.from("security_logs").select("user_id, ip_address, action, metadata").gte("created_at", fifteenMinsAgo)
    ]);

    if (ordersRes.error) throw ordersRes.error;
    
    const recentOrders = ordersRes.data || [];
    const securityLogs = logsRes.data || [];

    // --- MODULE: Autonomous Order Integrity, Provider Consistency & Payment Verification ---
    let orderDiscrepanciesRepaired = 0;
    let quarantinedOrders = 0;

    for (const ord of recentOrders) {
      const isPaidGateway = Number(ord.paystack_verified_amount || 0) > 0;
      
      // 1. Strict Payment Proof Verification: Quarantine any gateway order in processing/paid without payment proof
      if (ord.payment_method === "paystack" && !isPaidGateway && (ord.status === "processing" || ord.status === "paid")) {
        console.warn(`[Guardian AI] QUARANTINE: Order ${ord.id} is marked ${ord.status} but lacks Paystack verified payment proof.`);
        await propose({
          type: "quarantine_order",
          title: `Guardian: quarantine order ${String(ord.id).slice(0, 8)} (no verified Paystack payment)`,
          reason: `Order is ${ord.status} but has no verified Paystack payment.`,
          priority: "critical",
          params: { order_id: ord.id, amount: ord.amount, status: ord.status },
        });
        quarantinedOrders++;
      }

      // 2. Provider Signature Integrity Watchdog: Auto-repair mismatched provider badges
      const ref = String(ord.provider_order_id || "");
      if (ref.startsWith("SKP")) {
        const { data: skP } = await supabaseAdmin.from("providers").select("id").eq("handler_type", "skdataplug").maybeSingle();
        if (skP && ord.provider_id !== skP.id) {
          console.warn(`[Guardian AI] Correcting provider_id mismatch on order ${ord.id} (ref: ${ref}). Re-linking to SKPlug.`);
          await propose({
            type: "relink_order_provider",
            title: `Guardian: relink order ${String(ord.id).slice(0, 8)} to SKPlug`,
            reason: `Provider reference ${ref} belongs to SKPlug but the order is linked to another provider.`,
            priority: "medium",
            params: { order_id: ord.id, provider_id: skP.id },
          });
          orderDiscrepanciesRepaired++;
        }
      }
    }

    if (quarantinedOrders > 0) {
      await notifyAdmin(`SECURITY WATCHDOG: ${quarantinedOrders} order(s) lack verified payment; quarantine proposed for admin review.`, "guardian-quarantine");
    }

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

    // Resolve profiles, 30-day daily averages, and current wallet details for active agents
    const suspiciousAgentIds = suspiciousAgents.map(a => a.agent_id);
    const historicalAvgs: Record<string, number> = {};
    const walletInfo: Record<string, { balance: number; credit_limit: number }> = {};

    if (suspiciousAgentIds.length > 0) {
      // 1. Fetch 30-day historical transaction volume
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: histOrders } = await supabaseAdmin
        .from("orders")
        .select("agent_id, amount")
        .in("agent_id", suspiciousAgentIds)
        .eq("status", "fulfilled")
        .gte("created_at", thirtyDaysAgo);

      const agentTotals: Record<string, number> = {};
      (histOrders || []).forEach((o: any) => {
        if (o.agent_id) {
          agentTotals[o.agent_id] = (agentTotals[o.agent_id] || 0) + Number(o.amount || 0);
        }
      });
      suspiciousAgentIds.forEach(id => {
        // Daily average volume
        historicalAvgs[id] = Number(((agentTotals[id] || 0) / 30).toFixed(2));
      });

      // 2. Fetch current wallet details
      const { data: wallets } = await supabaseAdmin
        .from("wallets")
        .select("agent_id, balance, credit_limit")
        .in("agent_id", suspiciousAgentIds);

      (wallets || []).forEach((w: any) => {
        if (w.agent_id) {
          walletInfo[w.agent_id] = {
            balance: Number(w.balance || 0),
            credit_limit: Number(w.credit_limit || 0)
          };
        }
      });
    }

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, phone, terminal_locked, is_agent, role")
      .in("user_id", suspiciousAgentIds);

    const enrichedAgents = suspiciousAgents.map(a => {
      const p = profiles?.find(prof => prof.user_id === a.agent_id);
      const dailyAvg = historicalAvgs[a.agent_id] || 0;
      const wallet = walletInfo[a.agent_id] || { balance: 0, credit_limit: 0 };
      
      // Hourly baseline = dailyAvg / 24. Volume in 15 mins (a.volume) is compared to 1/4 of hourly baseline.
      const hourlyAvg = dailyAvg / 24;
      const expected15MinVol = hourlyAvg / 4;
      
      // Compute Velocity Burst Ratio. If they are selling 8x their historical hourly rate, it's a huge spike.
      const agentActivityObj = agentActivity[a.agent_id];
      const volume15m = agentActivityObj?.volume || 0;
      const velocityBurstRatio = expected15MinVol > 0 ? Number((volume15m / expected15MinVol).toFixed(2)) : 0.00;

      return {
        ...a,
        full_name: p?.full_name || "Unknown",
        phone: p?.phone || "Unknown",
        terminal_locked: p?.terminal_locked || false,
        is_admin: p?.role === 'admin',
        current_wallet_balance: wallet.balance,
        credit_limit: wallet.credit_limit,
        historical_30d_daily_avg_volume: dailyAvg,
        velocity_burst_ratio: velocityBurstRatio,
        volume_15m: volume15m
      };
    }).filter(a => !a.is_admin); // Never lock admins!

    // 3. AI Analysis (Claude Haiku for fast processing)
    const systemPrompt = `
      You are GUARDIAN AI — the 24/7 cyber-security watchdog for SwiftData. You WATCH and PROPOSE: every action except notify_admin waits for an admin to approve it.
      Your job is to review the recent 15-minute transaction logs of suspicious agents and propose actions that would neutralize threats.

      ━━━ CORE DIRECTIVES ━━━
      1. FRAUD & BOT DETECTION: High failure rates (>60%) combined with high volume indicate a bot or gateway exploit attempt.
      2. CARD TESTING: Multiple micro-transactions (under 2 GHS) is a severe red flag.
      3. IMPOSSIBLE TRAVEL: "distinct_ips_count" > 1 indicates compromised credentials (hijacked account).
      4. WALLET DRAINING: "cashout_volume" > 3000 GHS in 15 mins OR "cashout_volume" exceeding 75% of "current_wallet_balance" in a single audit sweep indicates rapid draining/compromise.
      5. VELOCITY BURST: If "velocity_burst_ratio" > 8.00 (sales volume is 8x their normal historical hourly baseline), this is a velocity burst anomaly indicating automated scraping or compromised script abuse. Propose a terminal lock unless "is_admin" (do not lock admins).
      6. API ABUSE: Malicious IPs with >15 auth failures should be proposed for blocking.
      7. OUTAGE PROTECTION: If a network is failing across >=3 distinct agents, propose taking it offline (broadcast_outage).
      8. ACTION PROTOCOL: If an agent exhibits behaviors 1-5, output a "lock_terminal" action so an admin can freeze their account.

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

    const aiResult = await callAiAgent(
      supabaseAdmin,
      "guardian_ai",
      systemPrompt,
      userMessage,
      1000
    );

    const rawText = aiResult.text;
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];


    // 4. Route the AI's actions (mapped to the shared action names)
    for (const action of actions.slice(0, 10)) {
      const metadata = action.params || {};
      const reason = metadata.reason || action.reason || "Guardian AI";
      const target = typeof action.target === "string" ? action.target : "";
      const agent = enrichedAgents.find((a) => a.agent_id === target);
      if (action.type === "lock_terminal") {
        if (!agent || agent.terminal_locked) continue;
        await propose({ type: "lock_terminal", title: `Guardian: lock terminal of ${agent.full_name} (${target.slice(0, 8)})`, reason, priority: "critical", params: { user_id: target, reason } });
      } else if (action.type === "flag_for_review") {
        await notifyAdmin(`GUARDIAN WARNING: Please review agent ${target.slice(0, 8)}. Reason: ${reason}`, `guardian-review-${target}`);
      } else if (action.type === "block_ip") {
        await propose({ type: "blacklist_ip", title: `Guardian: block IP ${target}`, reason, priority: "high", params: { ip: target, reason } });
      } else if (action.type === "broadcast_outage") {
        await propose({ type: "disable_network", title: `Guardian: take ${target.toUpperCase()} offline`, reason, priority: "high", params: { network: target.toUpperCase(), reason } });
      } else if (action.type === "notify_admin") {
        await notifyAdmin(metadata.message || "Guardian AI detected an anomaly.", metadata.topic);
      } else {
        routed.push({ type: action.type, route: "drop", reason: "unknown action" });
      }
    }
    const executedActions = routed;

    return new Response(JSON.stringify({ success: true, autonomy_mode: mode, actions_taken: executedActions }), {
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
