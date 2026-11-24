// What backend AI agents may do (owner rules, 2026-11-24 design):
//   auto      - the agent may do it by itself (records and admin alerts only)
//   approval  - waits in ai_worker_tasks for an admin with 2FA (ai-task-decide)
//   forbidden - never done: anything that sends/re-sends orders, refunds or moves money,
//               and every action type not listed here.
// Pure module: no Deno or network imports, so it is unit-tested from Vitest.

export type AgentMode = "observe_only" | "propose";
export type ActionPolicy = "auto" | "approval" | "forbidden";
export type AgentAction = {
  type: string;
  params?: Record<string, unknown>;
  title?: string;
  reason?: string;
  priority?: string;
};
export type AgentRoute = "drop" | "record" | "queue" | "run";
export type ConfirmKindForAction = "account" | "ops" | "message";

export const MAX_ACCOUNTS_PER_TASK = 20;

const AUTO = new Set(["record_finding", "record_memory", "record_strategy", "flag_review", "flag_aml_review", "notify_admin"]);

const APPROVAL_KIND: Record<string, ConfirmKindForAction> = {
  suspend_agent: "account",
  suspend_cluster: "account",
  suspend_login_bot: "account",
  suspend_referral_ring: "account",
  blacklist_ip: "account",
  freeze_cashouts: "account",
  lock_terminal: "account",
  switch_priority: "ops",
  rebalance_sme_provider: "ops",
  self_heal_provider: "ops",
  disable_network: "ops",
  quarantine_order: "ops",
  relink_order_provider: "ops",
  broadcast_outage: "message",
};

/** The id each approval type acts on. Types not listed take a list of accounts instead. */
const REQUIRED_ID: Record<string, string> = {
  suspend_agent: "user_id",
  lock_terminal: "user_id",
  suspend_login_bot: "user_id",
  freeze_cashouts: "agent_id",
  switch_priority: "provider_id",
  rebalance_sme_provider: "provider_id",
  self_heal_provider: "provider_id",
  quarantine_order: "order_id",
  relink_order_provider: "order_id",
  blacklist_ip: "ip",
};

export function normalizeMode(raw: unknown): AgentMode {
  return String(raw ?? "").trim().toLowerCase() === "propose" ? "propose" : "observe_only";
}

export function normalizeActionType(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function policyFor(type: string): ActionPolicy {
  const t = normalizeActionType(type);
  if (AUTO.has(t)) return "auto";
  if (t in APPROVAL_KIND) return "approval";
  return "forbidden";
}

const isId = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function checkActionLimits(action: AgentAction): { ok: true } | { ok: false; reason: string } {
  const t = normalizeActionType(action?.type);
  const p = (action?.params ?? {}) as Record<string, unknown>;

  const idKey = REQUIRED_ID[t];
  if (idKey && !isId(p[idKey])) return { ok: false, reason: `${t} needs ${idKey}` };
  if (t === "relink_order_provider" && !isId(p.provider_id)) return { ok: false, reason: "relink_order_provider needs provider_id" };

  if (t === "suspend_cluster" || t === "suspend_referral_ring") {
    const list = t === "suspend_cluster" ? p.user_ids : p.member_ids;
    if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: `${t} needs a list of accounts` };
    if (!list.every(isId)) return { ok: false, reason: `${t} has an invalid account id` };
    const extra = t === "suspend_referral_ring" && p.referrer_id != null ? 1 : 0;
    if (extra && !isId(p.referrer_id)) return { ok: false, reason: "invalid referrer_id" };
    if (list.length + extra > MAX_ACCOUNTS_PER_TASK) {
      return { ok: false, reason: `more than ${MAX_ACCOUNTS_PER_TASK} accounts in one task` };
    }
  }
  return { ok: true };
}

export function routeAgentAction(mode: AgentMode, action: AgentAction): { route: AgentRoute; reason: string } {
  const policy = policyFor(action?.type);
  if (policy === "forbidden") return { route: "drop", reason: "forbidden action" };
  if (policy === "auto") return { route: "run", reason: "auto action" };
  const limits = checkActionLimits(action);
  if (!limits.ok) return { route: "drop", reason: limits.reason };
  return normalizeMode(mode) === "propose"
    ? { route: "queue", reason: "waits for admin approval" }
    : { route: "record", reason: "watch-only: recorded as would-propose" };
}

export function confirmKindFor(type: string): ConfirmKindForAction {
  return APPROVAL_KIND[normalizeActionType(type)] ?? "ops";
}
