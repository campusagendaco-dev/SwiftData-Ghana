/**
 * OPS WORKER AI — operations, learning and security watcher.
 * Runs every 15 minutes via pg_cron (20261124170000_ai_agent_schedules.sql) or on demand
 * from the Admin Console.
 *
 * Safe-agents design (2026-11-24): it only WATCHES and PROPOSES.
 *  - Monitors stuck orders, providers, errors, tickets and security signals, and learns
 *    baselines in `ai_system_memory`.
 *  - Every AI action goes through routeAgentAction (agent_policy.ts): admin alerts run,
 *    approval actions are queued in `ai_worker_tasks` (propose mode) or recorded as
 *    "would propose" findings (observe_only), everything else is dropped.
 *  - Approvals happen only in ai-task-decide (admin with 2FA). It never sends, heals or
 *    refunds orders.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { callAiAgent, getAgentConfig } from "../_shared/ai.ts";
import { routeAgentAction, type AgentAction, type AgentMode } from "../_shared/agent_policy.ts";
import { queueAgentAction, runAutoAction } from "../_shared/agent_actions.ts";
import { agentSms } from "../_shared/agent_sms.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function isKorbaProvider(p: any): boolean {
  const ht = String(p?.handler_type || "").toLowerCase();
  const name = String(p?.name || "").toLowerCase();
  return ht.includes("korba") || name.includes("korba");
}

function safeParseJson(raw: string): Record<string, any> {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch (e) {
    console.warn("[Ops Worker] Failed to parse AI JSON:", e);
  }
  return {};
}

async function collectSystemPulse(supabaseAdmin: any) {
  const now = Date.now();
  const fiveMinsAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const tenMinsAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [
    stuckPendingRes,
    stuckProcessingRes,
    recentOrdersRes,
    providersRes,
    openTicketsRes,
    recentErrorsRes,
    memoryRes,
    recentActionsRes,
    pendingApprovalsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, network, amount, order_type, created_at")
      .eq("status", "pending")
      .not("order_type", "in", '("wallet_topup","store_wallet_topup","agent_activation","sub_agent_activation","vendor_activation","free_data_claim")')
      .gte("created_at", twoHoursAgo)
      .lte("created_at", fiveMinsAgo)
      .limit(15),
    supabaseAdmin
      .from("orders")
      .select("id, network, provider_id, amount, created_at")
      .eq("status", "processing")
      .gte("created_at", twentyFourHoursAgo)
      .lte("created_at", tenMinsAgo)
      .limit(20),
    supabaseAdmin
      .from("orders")
      .select("id, network, provider_id, status, amount, failure_reason, order_type")
      .gte("created_at", oneHourAgo)
      .limit(300),
    supabaseAdmin
      .from("providers")
      .select("id, name, handler_type, balance, priority, is_active, consecutive_failures")
      .order("priority", { ascending: true }),
    supabaseAdmin
      .from("support_tickets")
      .select("id, user_id, subject, status, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(10),
    supabaseAdmin
      .from("system_logs")
      .select("id, source, event, message, ts")
      .eq("level", "error")
      .gte("ts", oneHourAgo)
      .order("ts", { ascending: false })
      .limit(25),
    supabaseAdmin
      .from("ai_system_memory")
      .select("memory_key, category, summary, confidence, observations_count, data, last_observed_at")
      .order("last_observed_at", { ascending: false })
      .limit(25),
    supabaseAdmin
      .from("sentinel_actions")
      .select("action_type, status, effectiveness, reasoning, ts, metadata")
      .order("ts", { ascending: false })
      .limit(15),
    supabaseAdmin
      .from("ai_worker_tasks")
      .select("id, task_type, title, status")
      .eq("status", "awaiting_approval")
      .limit(15),
  ]);

  const recentOrders = recentOrdersRes.data || [];
  const networkStats = ["MTN", "TELECEL", "AT"].map((net) => {
    const netOrders = recentOrders.filter((o: any) => String(o.network || "").toUpperCase().includes(net));
    const failed = netOrders.filter((o: any) => o.status === "failed" || o.status === "fulfillment_failed").length;
    const fulfilled = netOrders.filter((o: any) => o.status === "fulfilled" || o.status === "completed").length;
    return {
      network: net,
      total_1h: netOrders.length,
      fulfilled_1h: fulfilled,
      failed_1h: failed,
      failure_rate: netOrders.length > 0 ? Number((failed / netOrders.length).toFixed(2)) : 0,
    };
  });

  const errorClusters: Record<string, number> = {};
  for (const log of recentErrorsRes.data || []) {
    const key = `${log.source || "sys"}:${(log.event || log.message || "error").slice(0, 60)}`;
    errorClusters[key] = (errorClusters[key] || 0) + 1;
  }

  return {
    stuck_orders_summary: {
      pending: (stuckPendingRes.data || []).length,
      pending_total_ghs: Number((stuckPendingRes.data || []).reduce((s: number, o: any) => s + Number(o.amount || 0), 0).toFixed(2)),
      processing: (stuckProcessingRes.data || []).length,
      processing_total_ghs: Number((stuckProcessingRes.data || []).reduce((s: number, o: any) => s + Number(o.amount || 0), 0).toFixed(2)),
    },
    stuck_pending_orders: stuckPendingRes.data || [],
    stuck_processing_orders: stuckProcessingRes.data || [],
    network_stats_1h: networkStats,
    providers: (providersRes.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      handler_type: p.handler_type,
      is_korba: isKorbaProvider(p),
      balance: Number(p.balance || 0),
      priority: p.priority,
      is_active: p.is_active,
      consecutive_failures: p.consecutive_failures || 0,
    })),
    open_tickets: openTicketsRes.data || [],
    error_clusters_1h: errorClusters,
    system_memory: memoryRes.data || [],
    recent_actions: recentActionsRes.data || [],
    pending_approvals: pendingApprovalsRes.data || [],
  };
}

async function upsertSystemMemory(supabaseAdmin: any, updates: any[]) {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  let saved = 0;

  for (const item of updates.slice(0, 8)) {
    if (!item?.memory_key || !item?.summary) continue;
    try {
      const { data: existing } = await supabaseAdmin
        .from("ai_system_memory")
        .select("id, observations_count")
        .eq("memory_key", String(item.memory_key).slice(0, 120))
        .maybeSingle();

      const validCategories = ["baseline", "error_signature", "provider_pattern", "security_pattern", "ops_playbook"];
      const category = validCategories.includes(item.category) ? item.category : "baseline";
      const confidence = Math.max(0.1, Math.min(0.99, Number(item.confidence ?? 0.75)));

      if (existing?.id) {
        await supabaseAdmin
          .from("ai_system_memory")
          .update({
            category,
            summary: String(item.summary).slice(0, 500),
            data: item.data || {},
            confidence,
            observations_count: (existing.observations_count || 1) + 1,
            last_observed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("ai_system_memory").insert({
          memory_key: String(item.memory_key).slice(0, 120),
          category,
          summary: String(item.summary).slice(0, 500),
          data: item.data || {},
          confidence,
          observations_count: 1,
          last_observed_at: new Date().toISOString(),
        });
      }
      saved++;
    } catch (err) {
      console.warn("[Ops Worker] Memory upsert error:", err);
    }
  }
  return saved;
}

/** Send each AI-proposed action through the policy. Nothing here can touch orders or money. */
async function routeActions(supabaseAdmin: any, mode: AgentMode, actions: unknown) {
  const ran: any[] = [];
  const queued: any[] = [];
  const recorded: any[] = [];
  const dropped: any[] = [];
  for (const raw of Array.isArray(actions) ? actions.slice(0, 10) : []) {
    const act = (raw && typeof raw === "object" ? raw : {}) as AgentAction;
    const { route, reason } = routeAgentAction(mode, act);
    if (route === "run") {
      ran.push({ type: act.type, ...(await runAutoAction(supabaseAdmin, "ops_worker", act, { sms: agentSms })) });
    } else if (route === "queue") {
      const res = await queueAgentAction(supabaseAdmin, "ops_worker", act);
      (res.queued ? queued : dropped).push({ type: act.type, title: act.title, reason: res.reason });
    } else if (route === "record") {
      await runAutoAction(supabaseAdmin, "ops_worker", { type: "record_finding", reason: act.reason, params: { would_propose: act } }, { sms: agentSms });
      recorded.push({ type: act.type, title: act.title });
    } else {
      dropped.push({ type: act?.type, reason });
    }
  }
  return { ran, queued, recorded, dropped };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY));
  const isCronAuthed = Boolean(
    isServiceRole ||
    (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)) ||
    (cronSecret && bearerToken && timingSafeEqual(bearerToken, cronSecret))
  );

  let adminUserId: string | null = null;
  if (!isCronAuthed) {
    const authRes = await verifyAdmin(req, supabaseAdmin);
    if (!authRes.success) {
      return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
        status: authRes.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    adminUserId = authRes.user?.id || null;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "patrol").toLowerCase();
    if (mode !== "patrol" && mode !== "command") {
      return json({ error: "Unknown mode. Approvals are done with ai-task-decide." }, 400);
    }

    // Load agent config
    const agentConfig = await getAgentConfig(supabaseAdmin, "ops_worker");
    if (mode === "patrol" && !agentConfig.is_active && isCronAuthed) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "ops_worker is paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Collect live system telemetry & memory
    const pulse = await collectSystemPulse(supabaseAdmin);

    // ── MODE: ADMIN COMMAND (an admin asked, so its actions are proposed for approval) ──
    if (mode === "command") {
      if (!adminUserId) return json({ error: "Admin session required for commands" }, 403);
      const instruction = String(body?.instruction || "").trim();
      if (!instruction) return json({ error: "instruction is required" }, 400);

      const cmdPrompt = `
You are OPS WORKER AI — SwiftData's operations, security, and learning worker.
An administrator has given you a direct instruction. Use the live system snapshot and learned system memory to answer clearly and propose actions for admin approval.

━━━ STRICT SWIFTDATA GUARDRAILS ━━━
1. You can only WATCH and PROPOSE. You never send, retry, heal or refund orders and never move money. For stuck orders, say how many and their total GH₵ in your reply/findings; an admin handles them on the order pages.
2. NEVER recommend or promote a Korba provider (is_korba: true) for affordable SME data bundles (MTN/Telecel/AT).
3. NEVER suspend or lock an admin account.
4. Every action except notify_admin waits for an admin to approve it.

━━━ AVAILABLE ACTIONS ━━━
- rebalance_sme_provider: { "provider_id": "uuid", "new_priority": 1 }
- suspend_agent: { "user_id": "uuid" }
- lock_terminal: { "user_id": "uuid" }
- disable_network: { "network": "MTN|TELECEL|AT" }
- notify_admin: { "message": "string", "topic": "short-stable-key" }

━━━ OUTPUT JSON SCHEMA ━━━
Respond with RAW JSON only:
{
  "reply": "Clear, concise executive response to the admin's instruction",
  "findings": ["bullet point finding"],
  "memory_updates": [{ "memory_key": "string", "category": "baseline|error_signature|provider_pattern|security_pattern|ops_playbook", "summary": "string", "confidence": 0.8, "data": {} }],
  "actions": [{ "type": "string", "priority": "low|medium|high|critical", "title": "string", "reason": "string", "params": {} }]
}`.trim();

      const aiRes = await callAiAgent(
        supabaseAdmin,
        "ops_worker",
        cmdPrompt,
        `ADMIN INSTRUCTION: ${instruction}\n\nLIVE SYSTEM SNAPSHOT:\n${JSON.stringify(pulse)}`,
        1800,
        { responseJson: true }
      );

      const parsed = safeParseJson(aiRes.text);
      const memorySaved = await upsertSystemMemory(supabaseAdmin, parsed.memory_updates || []);
      const routed = await routeActions(supabaseAdmin, "propose", parsed.actions);

      return json({
        success: true,
        model: aiRes.model,
        provider: aiRes.provider,
        usage: aiRes.usage,
        reply: parsed.reply || aiRes.text,
        findings: parsed.findings || [],
        memory_saved: memorySaved,
        ...routed,
      });
    }

    // ── MODE: PATROL (every 15 minutes) ──────────────────────────────────────
    const patrolPrompt = `
You are OPS WORKER AI — SwiftData's 24/7 operations, monitoring, security, and self-learning worker.
Review the live system snapshot and learned system memory. Detect issues, update learned baselines/patterns, and propose actions for admin approval ONLY when warranted.

━━━ STRICT SWIFTDATA GUARDRAILS ━━━
1. You can only WATCH and PROPOSE. You never send, retry, heal or refund orders and never move money. Report stuck orders as a finding with their count and total GH₵ (see stuck_orders_summary).
2. NEVER promote or route Korba providers (is_korba: true) for affordable SME data bundles.
3. NEVER suspend or lock admin accounts.
4. Anti-flapping: Inspect "recent_actions" and "pending_approvals" — DO NOT repeat an action or queue a duplicate approval already present.
5. Keep "actions" empty if the system is healthy.
6. Always record 1-2 concise "memory_updates" when you observe meaningful baselines (e.g. hourly success rate, provider health, recurring error signatures).

━━━ AVAILABLE ACTIONS (all except notify_admin wait for admin approval) ━━━
- rebalance_sme_provider: { "provider_id": "uuid", "new_priority": 1 }
- suspend_agent: { "user_id": "uuid" }
- disable_network: { "network": "MTN|TELECEL|AT" }
- notify_admin: { "message": "string", "topic": "short-stable-key" } (ONLY for critical/actionable incidents)

━━━ OUTPUT JSON SCHEMA ━━━
Respond with RAW JSON only:
{
  "summary": "One-sentence status summary",
  "health_status": "HEALTHY|DEGRADED|CRITICAL",
  "findings": ["string"],
  "memory_updates": [{ "memory_key": "string", "category": "baseline|error_signature|provider_pattern|security_pattern|ops_playbook", "summary": "string", "confidence": 0.8, "data": {} }],
  "actions": [{ "type": "string", "priority": "low|medium|high|critical", "title": "string", "reason": "string", "params": {} }]
}`.trim();

    const aiRes = await callAiAgent(
      supabaseAdmin,
      "ops_worker",
      patrolPrompt,
      `LIVE SYSTEM SNAPSHOT:\n${JSON.stringify(pulse)}`,
      1800,
      { responseJson: true }
    );

    const parsed = safeParseJson(aiRes.text);
    const memorySaved = await upsertSystemMemory(supabaseAdmin, parsed.memory_updates || []);
    const routed = await routeActions(supabaseAdmin, agentConfig.autonomy_mode, parsed.actions);

    return json({
      success: true,
      model: aiRes.model,
      provider: aiRes.provider,
      usage: aiRes.usage,
      autonomy_mode: agentConfig.autonomy_mode,
      health_status: parsed.health_status || "HEALTHY",
      summary: parsed.summary || "Patrol complete.",
      findings: parsed.findings || [],
      stuck_orders_summary: pulse.stuck_orders_summary,
      memory_saved: memorySaved,
      ...routed,
    });
  } catch (err: any) {
    console.error("[Ops Worker AI Error]:", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});
