// Shared runner for backend AI agents (2026-11-24 safe-agents design).
//   queueAgentAction      - puts an approval action in ai_worker_tasks for an admin
//   runAutoAction         - the only things an agent may do by itself: findings, flags,
//                           capped admin alerts
//   executeApprovedAction - fixed handler per approval type, run only by ai-task-decide
//                           after an admin with 2FA approved it
// Never sends, re-sends or refunds an order and never moves money. SMS sending is
// passed in (`AgentSms`) so this file has no network imports and is unit-tested.

import { checkActionLimits, normalizeActionType, policyFor, type AgentAction } from "./agent_policy.ts";

export type AgentSms = {
  /** Text the admin alert number. Resolves true when a text was sent. */
  sendAdmin: (db: any, message: string) => Promise<boolean>;
  /** Text many numbers at once. Resolves true when sent. */
  sendBulk: (db: any, phones: string[], message: string) => Promise<boolean>;
};

export const ADMIN_SMS_PER_DAY = 10;
const TOPIC_SMS_WINDOW_MS = 60 * 60 * 1000;
const MIN_PROVIDER_BALANCE_GHS = 100;

type Result = { ok: boolean; details?: unknown; error?: string };

const isKorba = (p: any) =>
  String(p?.handler_type || "").toLowerCase().includes("korba") || String(p?.name || "").toLowerCase().includes("korba");

export async function queueAgentAction(db: any, agentName: string, action: AgentAction): Promise<{ queued: boolean; reason?: string }> {
  const type = normalizeActionType(action.type);
  if (policyFor(type) !== "approval") return { queued: false, reason: "not an approval action" };
  const limits = checkActionLimits(action);
  if (!limits.ok) return { queued: false, reason: limits.reason };
  const title = String(action.title || type).slice(0, 200);

  const { data: existing } = await db
    .from("ai_worker_tasks")
    .select("id")
    .eq("task_type", type)
    .eq("title", title)
    .eq("status", "awaiting_approval")
    .limit(1)
    .maybeSingle();
  if (existing) return { queued: false, reason: "already waiting for approval" };

  const { error } = await db.from("ai_worker_tasks").insert({
    agent_name: agentName,
    task_type: type,
    priority: ["low", "medium", "high", "critical"].includes(String(action.priority)) ? action.priority : "high",
    status: "awaiting_approval",
    title,
    reasoning: action.reason || null,
    payload: action.params ?? {},
  });
  if (error) return { queued: false, reason: error.message };
  return { queued: true };
}

export async function runAutoAction(db: any, agentName: string, action: AgentAction, ctx: { sms: AgentSms }): Promise<Result> {
  const type = normalizeActionType(action.type);
  const p = (action.params ?? {}) as Record<string, any>;

  if (type === "notify_admin") {
    const message = String(p.message || action.reason || "Agent alert").slice(0, 280);
    const topic = String(p.topic || message.slice(0, 30));
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: recent } = await db
      .from("sentinel_actions")
      .select("ts, metadata")
      .eq("action_type", "notify_admin")
      .gte("ts", startOfDay.toISOString())
      .limit(500);
    const sentToday = (recent || []).filter((r: any) => r?.metadata?.sms_sent === true);
    const hourAgo = new Date(Date.now() - TOPIC_SMS_WINDOW_MS).toISOString();
    const topicRecent = sentToday.some((r: any) => r.metadata?.topic === topic && r.ts > hourAgo);
    let smsSent = false;
    if (sentToday.length < ADMIN_SMS_PER_DAY && !topicRecent) {
      smsSent = await ctx.sms.sendAdmin(db, `[${agentName}] ${message}`).catch(() => false);
    }
    // The sentinel_actions row is the in-app alert shown on the Sentinel AI page.
    await db.from("sentinel_actions").insert({
      action_type: "notify_admin",
      status: "executed",
      reasoning: message,
      metadata: { agent: agentName, topic, sms_sent: smsSent },
    });
    return { ok: true, details: { sms_sent: smsSent } };
  }

  if (type === "record_finding") {
    const would = p.would_propose as AgentAction | undefined;
    const text = would ? `Would propose: ${would.title || normalizeActionType(would.type)}` : String(p.text || action.title || "Agent finding");
    await db.from("ai_insights").insert({
      agent_id: null,
      type: "agent_finding",
      insight_text: text.slice(0, 500),
      metadata: { agent: agentName, ...(would ? { would_propose: would } : {}), reason: action.reason || null },
    });
    return { ok: true };
  }

  if (type === "flag_review") {
    const ids: string[] = Array.isArray(p.user_ids) ? p.user_ids.filter((x: unknown) => typeof x === "string") : [];
    if (!ids.length) return { ok: false, error: "flag_review needs user_ids" };
    await db.from("duplicate_account_flags").insert({
      primary_user_id: ids[0],
      duplicate_user_ids: ids.slice(1),
      matching_criteria: String(p.reason || action.reason || "Flagged by agent"),
      confidence_score: Number(p.confidence ?? 0.5),
      action_taken: "flagged_review",
    });
    return { ok: true };
  }

  if (type === "flag_aml_review") {
    if (!p.agent_id) return { ok: false, error: "flag_aml_review needs agent_id" };
    await db.from("aml_alerts").insert({
      agent_id: p.agent_id,
      alert_type: String(p.pattern || "GENERAL"),
      risk_score: Number(p.risk_score ?? 50),
      pattern_description: String(p.reason || action.reason || "Flagged by agent"),
      action_taken: "flagged_for_review",
    });
    return { ok: true };
  }

  // record_memory / record_strategy stay in each agent's own memory code; every other
  // type is not an auto action.
  return { ok: false, error: `not an auto action: ${type}` };
}

async function suspendAccounts(db: any, ids: string[], field: "is_suspended" | "terminal_locked"): Promise<Result> {
  const { data: profs } = await db.from("profiles").select("user_id, role").in("user_id", ids);
  const found = (profs || []) as { user_id: string; role?: string }[];
  const admins = found.filter((x) => x.role === "admin").map((x) => x.user_id);
  const targets = found.filter((x) => x.role !== "admin").map((x) => x.user_id);
  if (targets.length) {
    const { error } = await db.from("profiles").update({ [field]: true }).in("user_id", targets);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: targets.length > 0, details: { changed: targets, skipped_admins: admins, not_found: ids.filter((i) => !found.some((f) => f.user_id === i)) } };
}

export async function executeApprovedAction(
  db: any,
  task: { task_type: string; payload: Record<string, unknown> },
  ctx: { adminId: string; sms: AgentSms },
): Promise<Result> {
  const type = normalizeActionType(task.task_type);
  if (policyFor(type) !== "approval") return { ok: false, error: "forbidden" };
  const limits = checkActionLimits({ type, params: task.payload });
  if (!limits.ok) return { ok: false, error: limits.reason };
  const p = (task.payload ?? {}) as Record<string, any>;

  switch (type) {
    case "suspend_agent":
    case "suspend_login_bot":
      return suspendAccounts(db, [p.user_id], "is_suspended");
    case "lock_terminal":
      return suspendAccounts(db, [p.user_id], "terminal_locked");
    case "suspend_cluster":
      return suspendAccounts(db, p.user_ids, "is_suspended");
    case "suspend_referral_ring":
      return suspendAccounts(db, [...p.member_ids, ...(p.referrer_id ? [p.referrer_id] : [])], "is_suspended");

    case "blacklist_ip": {
      const { error } = await db.from("security_blacklist").upsert(
        { type: "ip", value: p.ip, reason: String(p.reason || "Approved agent proposal"), created_by: ctx.adminId },
        { onConflict: "value", ignoreDuplicates: true },
      );
      return error ? { ok: false, error: error.message } : { ok: true, details: { ip: p.ip } };
    }

    case "freeze_cashouts": {
      const { error } = await db.from("aml_alerts").insert({
        agent_id: p.agent_id,
        alert_type: "CASHOUT_FREEZE",
        risk_score: 70,
        pattern_description: String(p.reason || "Approved agent proposal"),
        action_taken: "cashouts_frozen",
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    }

    case "switch_priority":
    case "rebalance_sme_provider":
    case "self_heal_provider": {
      const { data: prov } = await db
        .from("providers")
        .select("id, name, handler_type, is_active, balance, consecutive_failures")
        .eq("id", p.provider_id)
        .maybeSingle();
      if (!prov) return { ok: false, error: "provider not found" };
      const newPriority = type === "self_heal_provider" ? 1 : Math.max(1, Math.min(10, Math.trunc(Number(p.new_priority || 1))));
      if (isKorba(prov) && newPriority === 1) return { ok: false, error: "Korba can never be set to priority 1 for SME data" };
      if (Number(prov.balance || 0) < MIN_PROVIDER_BALANCE_GHS) return { ok: false, error: `provider balance below GH₵${MIN_PROVIDER_BALANCE_GHS}` };
      if (type !== "self_heal_provider" && (!prov.is_active || Number(prov.consecutive_failures || 0) >= 3)) {
        return { ok: false, error: "provider is inactive or failing" };
      }
      const values =
        type === "self_heal_provider"
          ? { priority: 1, is_active: true, consecutive_failures: 0 }
          : type === "rebalance_sme_provider"
            ? { priority: newPriority, is_active: true }
            : { priority: newPriority };
      const { error } = await db.from("providers").update(values).eq("id", prov.id);
      return error ? { ok: false, error: error.message } : { ok: true, details: { provider: prov.name, ...values } };
    }

    case "disable_network": {
      const network = String(p.network).toUpperCase();
      const { error } = await db
        .from("service_status")
        .update({ status: "offline", admin_note: String(p.reason || "Disabled after admin approved an agent proposal") })
        .eq("network", network);
      return error ? { ok: false, error: error.message } : { ok: true, details: { network, status: "offline" } };
    }

    case "broadcast_outage": {
      const network = String(p.network);
      const { data: agents } = await db.from("profiles").select("phone").eq("is_agent", true).not("phone", "is", null);
      const phones = (agents || []).map((a: any) => a.phone).filter(Boolean);
      if (!phones.length) return { ok: false, error: "no agent phone numbers" };
      const msg = `SwiftData Alert: We have detected instability with the ${network} network. Purchases may be delayed. Our system is auto-rerouting traffic.`;
      const sent = await ctx.sms.sendBulk(db, phones, msg);
      return { ok: sent, details: { recipients: phones.length, network } };
    }

    case "quarantine_order": {
      const { data: order } = await db.from("orders").select("id, status").eq("id", p.order_id).maybeSingle();
      if (!order) return { ok: false, error: "order not found" };
      if (!["processing", "paid"].includes(order.status)) return { ok: false, error: `order is ${order.status}; only processing or paid orders can be quarantined` };
      const { error } = await db
        .from("orders")
        .update({ status: "fulfillment_failed", failure_reason: "SECURITY_QUARANTINE: Missing verified payment proof (approved by admin)", updated_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", order.status);
      return error ? { ok: false, error: error.message } : { ok: true, details: { order_id: order.id } };
    }

    case "relink_order_provider": {
      const { data: prov } = await db.from("providers").select("id").eq("id", p.provider_id).maybeSingle();
      if (!prov) return { ok: false, error: "provider not found" };
      const { error } = await db.from("orders").update({ provider_id: prov.id, updated_at: new Date().toISOString() }).eq("id", p.order_id);
      return error ? { ok: false, error: error.message } : { ok: true, details: { order_id: p.order_id, provider_id: prov.id } };
    }
  }
  return { ok: false, error: "forbidden" };
}
