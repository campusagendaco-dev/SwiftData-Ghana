/**
 * OPS WORKER AI — Autonomous Operations, System Learning & Security Worker
 * Runs every 5 minutes via pg_cron or on-demand via Admin Console.
 *
 * Capabilities:
 *  1. MONITOR: Snapshots stuck pending/processing orders, provider balances/health,
 *     recent error clusters, open support tickets, pending withdrawals, and security alerts.
 *  2. LEARN: Updates rolling baselines & recurring error signatures in `ai_system_memory`.
 *  3. WORKER ACTIONS:
 *     - Safe autonomous ops: heal stuck orders, rebalance non-Korba SME providers,
 *       triage open support tickets, send deduplicated admin alerts.
 *     - High-impact ops: queued in `ai_worker_tasks` for 1-click admin approval
 *       (or executed directly when approved).
 *  4. INTERACTIVE COMMANDS: Accepts natural-language admin instructions (`mode: "command"`).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { getSmsConfig, dispatchUnifiedSms } from "../_shared/sms.ts";
import { callAiAgent, getAgentConfig } from "../_shared/ai.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const HIGH_IMPACT_ACTIONS = new Set(["suspend_agent", "disable_network", "lock_terminal", "refund_order"]);

// ━━━ ZERO-LOSS FINANCIAL GUARDRAILS FOR SELF-HEALING ━━━
const MAX_AUTO_HEAL_ORDER_AMOUNT_GHS = 100;   // Orders > GHS 100 require admin approval
const MAX_AUTO_HEAL_BATCH_TOTAL_GHS = 500;    // Max total GHS healed per 5-min patrol
const MAX_AI_HEAL_ATTEMPTS_PER_ORDER = 2;     // Never loop-heal the same order > 2 times
const HEAL_COOLDOWN_MS = 15 * 60 * 1000;      // 15-min cooldown between heals on same order
const DUPLICATE_DELIVERY_WINDOW_MS = 30 * 60 * 1000; // Skip heal if same phone+pkg delivered/processing in last 30m
const PROVIDER_SWITCH_COOLDOWN_MS = 30 * 60 * 1000;  // 30-min anti-flapping cooldown
const MIN_PROVIDER_BALANCE_FOR_PRIO1_GHS = 100;      // Never promote a low-balance provider

const PLACEHOLDER_PROVIDER_REFS = new Set([
  "", "failed_api_call", "dispatching", "routed", "duplicate_cooldown", "refunded", "timeout", "awaiting_provider",
]);

function hasRealProviderRef(providerOrderId: string | null | undefined): boolean {
  const ref = String(providerOrderId || "").trim().toLowerCase();
  return Boolean(ref && !PLACEHOLDER_PROVIDER_REFS.has(ref));
}

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

async function notifyAdminSms(supabaseAdmin: any, message: string): Promise<boolean> {
  try {
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("role", "admin")
      .not("phone", "is", null)
      .limit(1);

    const adminPhone = admins?.[0]?.phone;
    if (!adminPhone) return false;

    const smsConfig = await getSmsConfig(supabaseAdmin);
    if (!smsConfig?.apiKey) return false;

    await dispatchUnifiedSms(
      smsConfig.gateway,
      smsConfig.apiKey,
      smsConfig.senderId,
      adminPhone,
      `[Ops Worker AI] ${message}`,
      "custom"
    );
    return true;
  } catch (err) {
    console.error("[Ops Worker] Admin SMS failed:", err);
    return false;
  }
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

async function executeWorkerAction(
  supabaseAdmin: any,
  action: { type: string; params?: Record<string, any>; reason?: string; title?: string },
  recentActions: any[] = []
): Promise<{ ok: boolean; details: any }> {
  const p = action.params || {};

  if (action.type === "heal_stuck_orders") {
    const requestedIds: string[] = Array.isArray(p.pending_order_ids) ? p.pending_order_ids.slice(0, 10) : [];
    const healProcessing = Boolean(p.heal_processing);
    const healed: any[] = [];
    const skippedForSafety: any[] = [];
    let batchTotalGhs = 0;

    if (requestedIds.length > 0) {
      const { data: candidateOrders } = await supabaseAdmin
        .from("orders")
        .select("id, status, amount, network, package_size, customer_phone, payment_method, provider_id, provider_order_id, metadata, created_at")
        .in("id", requestedIds);

      const dupWindowIso = new Date(Date.now() - DUPLICATE_DELIVERY_WINDOW_MS).toISOString();

      for (const ord of candidateOrders || []) {
        const amt = Number(ord.amount || 0);
        const meta = ord.metadata || {};
        const prevAttempts = Number(meta.ai_heal_attempts || 0);
        const lastHealAt = meta.ai_last_heal_at ? new Date(meta.ai_last_heal_at).getTime() : 0;

        // Guard 1: Only heal still-pending/processing orders (never already fulfilled/refunded)
        if (ord.status !== "pending" && ord.status !== "processing") {
          skippedForSafety.push({ order_id: ord.id, reason: `Status is already ${ord.status}` });
          continue;
        }

        // Guard 2: Never double-dispatch an order that already has a confirmed provider reference
        if (ord.status === "processing" && hasRealProviderRef(ord.provider_order_id)) {
          skippedForSafety.push({ order_id: ord.id, reason: `Already has provider ref ${ord.provider_order_id}; status poll only` });
          continue;
        }

        // Guard 3: Per-order & per-batch GHS exposure cap -> queue for admin approval instead
        if (amt <= 0 || amt > MAX_AUTO_HEAL_ORDER_AMOUNT_GHS || batchTotalGhs + amt > MAX_AUTO_HEAL_BATCH_TOTAL_GHS) {
          skippedForSafety.push({ order_id: ord.id, reason: `Amount GHS ${amt} exceeds zero-loss auto-heal cap` });
          await supabaseAdmin.from("ai_worker_tasks").insert({
            agent_name: "ops_worker",
            task_type: "heal_stuck_orders",
            priority: "high",
            status: "awaiting_approval",
            title: `Approve High-Value Heal (GHS ${amt})`,
            reasoning: `Order ${ord.id} (GHS ${amt}, ${ord.network} ${ord.package_size}) exceeds automatic zero-loss cap (GHS ${MAX_AUTO_HEAL_ORDER_AMOUNT_GHS}).`,
            payload: { pending_order_ids: [ord.id], heal_processing: false },
          });
          continue;
        }

        // Guard 4: Max heal attempts & 15-min cooldown per order
        if (prevAttempts >= MAX_AI_HEAL_ATTEMPTS_PER_ORDER) {
          skippedForSafety.push({ order_id: ord.id, reason: `Reached max ${MAX_AI_HEAL_ATTEMPTS_PER_ORDER} auto-heal attempts` });
          continue;
        }
        if (lastHealAt && Date.now() - lastHealAt < HEAL_COOLDOWN_MS) {
          skippedForSafety.push({ order_id: ord.id, reason: "Within 15-min heal cooldown" });
          continue;
        }

        // Guard 5: Duplicate-delivery protection (same phone + package + network already fulfilled/processing in last 30m)
        if (ord.customer_phone && ord.package_size && ord.network) {
          const { data: siblingOrders } = await supabaseAdmin
            .from("orders")
            .select("id, status")
            .eq("customer_phone", ord.customer_phone)
            .eq("network", ord.network)
            .eq("package_size", ord.package_size)
            .in("status", ["fulfilled", "completed", "processing"])
            .neq("id", ord.id)
            .gte("created_at", dupWindowIso)
            .limit(1);

          if (siblingOrders && siblingOrders.length > 0) {
            skippedForSafety.push({
              order_id: ord.id,
              reason: `Duplicate delivery risk: sibling order ${siblingOrders[0].id} is already ${siblingOrders[0].status}`,
            });
            continue;
          }
        }

        // Stamp heal attempt BEFORE calling verify-payment to prevent concurrent races
        await supabaseAdmin
          .from("orders")
          .update({
            metadata: {
              ...meta,
              ai_heal_attempts: prevAttempts + 1,
              ai_last_heal_at: new Date().toISOString(),
            },
          })
          .eq("id", ord.id);

        batchTotalGhs += amt;

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ reference: ord.id, force: false }),
          });
          const body = await res.json().catch(() => ({}));
          healed.push({ order_id: ord.id, amount: amt, status: res.status, result: body?.status || body?.message || "checked" });
        } catch (err: any) {
          healed.push({ order_id: ord.id, amount: amt, error: err?.message || String(err) });
        }
      }
    }

    // Only invoke heal-processing-orders if not already called in the last 10 minutes
    let processingHealResult: any = null;
    if (healProcessing) {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recentHeal = recentActions.find(
        (a: any) => a.action_type === "heal_stuck_orders" && a.ts > tenMinsAgo && a.metadata?.details?.processing_heal
      );
      if (recentHeal) {
        processingHealResult = { skipped: true, reason: "Within 10-min processing-heal cooldown" };
      } else {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/heal-processing-orders`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ source: "ops_worker" }),
          });
          processingHealResult = await res.json().catch(() => ({ status: res.status }));
        } catch (err: any) {
          processingHealResult = { error: err?.message || String(err) };
        }
      }
    }

    return {
      ok: true,
      details: {
        batch_total_ghs: Number(batchTotalGhs.toFixed(2)),
        verified_pending: healed,
        skipped_for_safety: skippedForSafety,
        processing_heal: processingHealResult,
      },
    };
  }

  if (action.type === "rebalance_sme_provider" && p.provider_id) {
    // Guard 1: Anti-flapping 30-min cooldown between provider priority switches
    const switchCooldownIso = new Date(Date.now() - PROVIDER_SWITCH_COOLDOWN_MS).toISOString();
    const recentSwitch = recentActions.find(
      (a: any) => (a.action_type === "rebalance_sme_provider" || a.action_type === "switch_priority") && a.ts > switchCooldownIso
    );
    if (recentSwitch) {
      return { ok: false, details: "BLOCKED BY GUARDRAIL: Provider switch cooldown (30m) active to prevent flapping." };
    }

    const { data: targetProv } = await supabaseAdmin
      .from("providers")
      .select("id, name, handler_type, is_active, balance, consecutive_failures")
      .eq("id", p.provider_id)
      .maybeSingle();

    if (!targetProv) return { ok: false, details: "Target provider not found" };
    // Guard 2: STRICT SWIFTDATA GUARDRAIL — Never promote Korba for SME data bundles
    if (isKorbaProvider(targetProv)) {
      return { ok: false, details: "BLOCKED BY GUARDRAIL: Korba cannot be promoted for SME data bundles." };
    }
    // Guard 3: Never promote an inactive, low-balance, or currently failing provider
    if (!targetProv.is_active) {
      return { ok: false, details: `BLOCKED BY GUARDRAIL: Provider ${targetProv.name} is inactive.` };
    }
    if (Number(targetProv.balance || 0) < MIN_PROVIDER_BALANCE_FOR_PRIO1_GHS) {
      return {
        ok: false,
        details: `BLOCKED BY GUARDRAIL: Provider ${targetProv.name} balance (GHS ${targetProv.balance}) is below safe minimum (GHS ${MIN_PROVIDER_BALANCE_FOR_PRIO1_GHS}).`,
      };
    }
    if (Number(targetProv.consecutive_failures || 0) >= 3) {
      return {
        ok: false,
        details: `BLOCKED BY GUARDRAIL: Provider ${targetProv.name} has ${targetProv.consecutive_failures} consecutive failures.`,
      };
    }

    const { error } = await supabaseAdmin
      .from("providers")
      .update({ priority: Number(p.new_priority || 1), is_active: true })
      .eq("id", targetProv.id);

    if (error) throw error;
    return { ok: true, details: { provider: targetProv.name, balance: targetProv.balance, new_priority: Number(p.new_priority || 1) } };
  }

  if (action.type === "triage_ticket" && p.ticket_id) {
    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("*")
      .eq("id", p.ticket_id)
      .maybeSingle();

    if (!ticket) return { ok: false, details: "Ticket not found" };
    const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/auto-ticket-resolver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
      },
      body: JSON.stringify({ record: ticket }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, details: body };
  }

  if (action.type === "suspend_agent" || action.type === "lock_terminal") {
    const targetUserId = p.user_id || p.agent_id || p.target;
    if (!targetUserId) return { ok: false, details: "Missing target user_id" };

    // STRICT GUARDRAIL: Never suspend/lock admins
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("user_id, role, full_name")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!prof) return { ok: false, details: "User not found" };
    if (prof.role === "admin") return { ok: false, details: "BLOCKED BY GUARDRAIL: Cannot suspend/lock an admin." };

    const updateFields = action.type === "suspend_agent" ? { is_suspended: true } : { terminal_locked: true };
    const { error } = await supabaseAdmin.from("profiles").update(updateFields).eq("user_id", targetUserId);
    if (error) throw error;
    return { ok: true, details: { user_id: targetUserId, full_name: prof.full_name, action: action.type } };
  }

  if (action.type === "disable_network" && p.network) {
    const net = String(p.network).toUpperCase();
    const { error } = await supabaseAdmin
      .from("service_status")
      .update({ status: "offline", admin_note: action.reason || "Disabled by Ops Worker AI" })
      .eq("network", net);
    if (error) throw error;
    return { ok: true, details: { network: net, status: "offline" } };
  }

  if (action.type === "notify_admin") {
    const msg = String(p.message || action.reason || "Ops Worker AI alert").slice(0, 280);
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const duplicate = recentActions.find(
      (a: any) => a.action_type === "notify_admin" && a.ts > thirtyMinsAgo && String(a.reasoning || "").includes(msg.slice(0, 30))
    );
    if (duplicate) {
      return { ok: true, details: { skipped: true, reason: "Deduplicated within 30m window" } };
    }
    const sent = await notifyAdminSms(supabaseAdmin, msg);
    return { ok: true, details: { sms_sent: sent, message: msg } };
  }

  return { ok: false, details: `Unsupported action type: ${action.type}` };
}

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
    const authRes = await verifyAdmin(req, supabaseAdmin, { checkMfa: false });
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

    // ── MODE: APPROVE & EXECUTE QUEUED TASK ──────────────────────────────────
    if (mode === "execute_task") {
      if (!adminUserId) {
        return new Response(JSON.stringify({ error: "Admin session required to approve tasks" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const taskId = body?.task_id;
      if (!taskId) {
        return new Response(JSON.stringify({ error: "task_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: task } = await supabaseAdmin
        .from("ai_worker_tasks")
        .select("*")
        .eq("id", taskId)
        .maybeSingle();

      if (!task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (task.status !== "awaiting_approval" && task.status !== "pending") {
        return new Response(JSON.stringify({ error: `Task is already ${task.status}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const execRes = await executeWorkerAction(supabaseAdmin, {
        type: task.task_type,
        params: task.payload || {},
        reason: task.reasoning,
        title: task.title,
      });

      const finalStatus = execRes.ok ? "executed" : "failed";
      await supabaseAdmin
        .from("ai_worker_tasks")
        .update({
          status: finalStatus,
          approved_by: adminUserId,
          executed_at: new Date().toISOString(),
          result: execRes.details,
        })
        .eq("id", taskId);

      await supabaseAdmin.from("sentinel_actions").insert({
        action_type: task.task_type,
        status: finalStatus,
        effectiveness: 0,
        reasoning: `[Approved Task] ${task.reasoning || task.title}`,
        metadata: { source: "ops_worker", task_id: taskId, approved_by: adminUserId, result: execRes.details },
      });

      return new Response(JSON.stringify({ success: execRes.ok, status: finalStatus, details: execRes.details }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: REJECT QUEUED TASK ─────────────────────────────────────────────
    if (mode === "reject_task") {
      if (!adminUserId) {
        return new Response(JSON.stringify({ error: "Admin session required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const taskId = body?.task_id;
      await supabaseAdmin
        .from("ai_worker_tasks")
        .update({
          status: "rejected",
          approved_by: adminUserId,
          executed_at: new Date().toISOString(),
          result: { rejected_by: adminUserId },
        })
        .eq("id", taskId);

      return new Response(JSON.stringify({ success: true, status: "rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // ── MODE: INTERACTIVE ADMIN COMMAND ──────────────────────────────────────
    if (mode === "command") {
      const instruction = String(body?.instruction || "").trim();
      if (!instruction) {
        return new Response(JSON.stringify({ error: "instruction is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cmdPrompt = `
You are OPS WORKER AI — SwiftData's autonomous operations, security, and learning worker.
An administrator has given you a direct instruction. Use the live system snapshot and learned system memory to answer clearly and propose/execute actions.

━━━ STRICT SWIFTDATA GUARDRAILS ━━━
1. NEVER recommend or promote a Korba provider (is_korba: true) for affordable SME data bundles (MTN/Telecel/AT).
2. NEVER suspend or lock an admin account.
3. Prefer safe operational actions (heal_stuck_orders, rebalance_sme_provider, triage_ticket, notify_admin) and put high-impact actions (suspend_agent, lock_terminal, disable_network) in actions so they go to the approval queue.

━━━ AVAILABLE ACTIONS ━━━
- heal_stuck_orders: { "pending_order_ids": ["uuid"], "heal_processing": true|false }
- rebalance_sme_provider: { "provider_id": "uuid", "new_priority": 1 }
- triage_ticket: { "ticket_id": "uuid" }
- suspend_agent: { "user_id": "uuid" }
- lock_terminal: { "user_id": "uuid" }
- disable_network: { "network": "MTN|TELECEL|AT" }
- notify_admin: { "message": "string" }

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

      const executed: any[] = [];
      const queued: any[] = [];

      for (const act of Array.isArray(parsed.actions) ? parsed.actions : []) {
        if (HIGH_IMPACT_ACTIONS.has(act.type) || agentConfig.autonomy_mode === "approval_required") {
          const { data: qTask } = await supabaseAdmin
            .from("ai_worker_tasks")
            .insert({
              agent_name: "ops_worker",
              task_type: act.type,
              priority: act.priority || "high",
              status: "awaiting_approval",
              title: act.title || act.type,
              reasoning: act.reason || instruction,
              payload: act.params || {},
            })
            .select()
            .single();
          if (qTask) queued.push(qTask);
        } else if (agentConfig.autonomy_mode === "autonomous") {
          const res = await executeWorkerAction(supabaseAdmin, act, pulse.recent_actions);
          executed.push({ action: act.type, ...res });
          await supabaseAdmin.from("sentinel_actions").insert({
            action_type: act.type,
            status: res.ok ? "executed" : "failed",
            effectiveness: 0,
            reasoning: act.reason || `Admin command: ${instruction.slice(0, 120)}`,
            metadata: { source: "ops_worker", mode: "command", ai_model: aiRes.model, details: res.details },
          });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          model: aiRes.model,
          provider: aiRes.provider,
          usage: aiRes.usage,
          reply: parsed.reply || aiRes.text,
          findings: parsed.findings || [],
          memory_saved: memorySaved,
          executed_actions: executed,
          queued_tasks: queued,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── MODE: AUTONOMOUS 5-MIN PATROL ────────────────────────────────────────
    const patrolPrompt = `
You are OPS WORKER AI — SwiftData's 24/7 autonomous operations, monitoring, security, and self-learning worker.
Review the live system snapshot and learned system memory. Detect issues, update learned baselines/patterns, and take concrete worker actions ONLY when warranted.

━━━ STRICT SWIFTDATA GUARDRAILS ━━━
1. NEVER promote or route Korba providers (is_korba: true) for affordable SME data bundles.
2. NEVER suspend or lock admin accounts.
3. Anti-flapping: Inspect "recent_actions" and "pending_approvals" — DO NOT repeat an action or queue a duplicate approval already present.
4. Keep "actions" empty if the system is healthy and no stuck orders/open tickets/degraded providers require intervention.
5. Always record 1-2 concise "memory_updates" when you observe meaningful baselines (e.g. hourly success rate, provider health, recurring error signatures).

━━━ AVAILABLE ACTIONS ━━━
- heal_stuck_orders: { "pending_order_ids": ["uuid"], "heal_processing": true|false }
- rebalance_sme_provider: { "provider_id": "uuid", "new_priority": 1 }
- triage_ticket: { "ticket_id": "uuid" }
- suspend_agent: { "user_id": "uuid" } (high-impact -> queued for approval)
- disable_network: { "network": "MTN|TELECEL|AT" } (high-impact -> queued for approval)
- notify_admin: { "message": "string" } (ONLY for critical/actionable incidents)

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

    const executed: any[] = [];
    const queued: any[] = [];

    for (const act of Array.isArray(parsed.actions) ? parsed.actions : []) {
      if (agentConfig.autonomy_mode === "observe_only") {
        continue;
      }

      const needsApproval = HIGH_IMPACT_ACTIONS.has(act.type) || agentConfig.autonomy_mode === "approval_required";

      if (needsApproval) {
        const alreadyPending = pulse.pending_approvals.some(
          (t: any) => t.task_type === act.type && t.title === (act.title || act.type)
        );
        if (!alreadyPending) {
          const { data: qTask } = await supabaseAdmin
            .from("ai_worker_tasks")
            .insert({
              agent_name: "ops_worker",
              task_type: act.type,
              priority: act.priority || "high",
              status: "awaiting_approval",
              title: act.title || act.type,
              reasoning: act.reason || parsed.summary || "Proposed by Ops Worker AI",
              payload: act.params || {},
            })
            .select()
            .single();
          if (qTask) queued.push(qTask);
        }
      } else {
        const res = await executeWorkerAction(supabaseAdmin, act, pulse.recent_actions);
        executed.push({ action: act.type, ...res });

        await supabaseAdmin.from("ai_worker_tasks").insert({
          agent_name: "ops_worker",
          task_type: act.type,
          priority: act.priority || "medium",
          status: res.ok ? "executed" : "failed",
          title: act.title || act.type,
          reasoning: act.reason || parsed.summary || "Executed autonomously by Ops Worker AI",
          payload: act.params || {},
          result: res.details,
          executed_at: new Date().toISOString(),
        });

        await supabaseAdmin.from("sentinel_actions").insert({
          action_type: act.type,
          status: res.ok ? "executed" : "failed",
          effectiveness: 0,
          reasoning: act.reason || parsed.summary || "Autonomous Ops Worker execution",
          metadata: { source: "ops_worker", ai_model: aiRes.model, ai_provider: aiRes.provider, details: res.details },
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        model: aiRes.model,
        provider: aiRes.provider,
        usage: aiRes.usage,
        autonomy_mode: agentConfig.autonomy_mode,
        health_status: parsed.health_status || "HEALTHY",
        summary: parsed.summary || "Patrol complete.",
        findings: parsed.findings || [],
        memory_saved: memorySaved,
        executed_actions: executed,
        queued_tasks: queued,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Ops Worker AI Error]:", err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
