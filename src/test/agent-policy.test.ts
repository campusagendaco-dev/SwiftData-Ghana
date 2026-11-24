import { describe, expect, it } from "vitest";
import {
  MAX_ACCOUNTS_PER_TASK,
  checkActionLimits,
  confirmKindFor,
  normalizeActionType,
  normalizeMode,
  policyFor,
  routeAgentAction,
} from "../../supabase/functions/_shared/agent_policy";

// Owner rules: agents never send/re-send orders or move money, and anything that changes
// accounts, routing or messaging waits for an admin. Unknown means "no".
describe("agent modes", () => {
  it("treats missing, unknown and old modes as watch-only", () => {
    expect(normalizeMode(undefined)).toBe("observe_only");
    expect(normalizeMode(null)).toBe("observe_only");
    expect(normalizeMode("autonomous")).toBe("observe_only");
    expect(normalizeMode("approval_required")).toBe("observe_only");
    expect(normalizeMode(" PROPOSE ")).toBe("propose");
  });
});

describe("action policy", () => {
  it("forbids order healing in any spelling, unknown actions and ticket triage", () => {
    expect(policyFor(normalizeActionType(" Heal_Stuck_Orders "))).toBe("forbidden");
    expect(policyFor("made_up")).toBe("forbidden");
    expect(policyFor("triage_ticket")).toBe("forbidden");
    expect(policyFor(normalizeActionType(undefined))).toBe("forbidden");
  });

  it("lets agents record findings and alert admins by themselves", () => {
    for (const t of ["record_finding", "record_memory", "record_strategy", "flag_review", "flag_aml_review", "notify_admin"]) {
      expect(policyFor(t)).toBe("auto");
    }
  });

  it("needs approval for account, routing, order and broadcast changes", () => {
    for (const t of [
      "suspend_agent", "suspend_cluster", "suspend_login_bot", "suspend_referral_ring",
      "blacklist_ip", "freeze_cashouts", "lock_terminal",
      "switch_priority", "rebalance_sme_provider", "self_heal_provider", "disable_network",
      "quarantine_order", "relink_order_provider", "broadcast_outage",
    ]) {
      expect(policyFor(t)).toBe("approval");
    }
  });
});

describe("routing", () => {
  const cluster = { type: "suspend_cluster", params: { user_ids: ["a"] } };

  it("records instead of queueing while watch-only", () => {
    expect(routeAgentAction("observe_only", cluster).route).toBe("record");
  });

  it("queues approval actions when the agent may propose", () => {
    expect(routeAgentAction("propose", cluster).route).toBe("queue");
  });

  it("drops a suspension of more than 20 accounts", () => {
    const ids = Array.from({ length: MAX_ACCOUNTS_PER_TASK + 1 }, (_, i) => "u" + i);
    expect(routeAgentAction("propose", { type: "suspend_cluster", params: { user_ids: ids } }).route).toBe("drop");
  });

  it("runs admin alerts in both modes", () => {
    expect(routeAgentAction("observe_only", { type: "notify_admin" }).route).toBe("run");
    expect(routeAgentAction("propose", { type: "notify_admin" }).route).toBe("run");
  });

  it("drops order healing even when proposing", () => {
    expect(routeAgentAction("propose", { type: "heal_stuck_orders", params: { pending_order_ids: ["x"] } }).route).toBe("drop");
  });
});

describe("limits", () => {
  it("refuses non-string or empty account ids", () => {
    expect(checkActionLimits({ type: "suspend_cluster", params: { user_ids: ["a", 5] } }).ok).toBe(false);
    expect(checkActionLimits({ type: "suspend_cluster", params: { user_ids: [] } }).ok).toBe(false);
    expect(checkActionLimits({ type: "suspend_cluster", params: { user_ids: ["a", " "] } }).ok).toBe(false);
  });

  it("counts the referrer in the 20-account limit", () => {
    const members = Array.from({ length: 20 }, (_, i) => "m" + i);
    expect(checkActionLimits({ type: "suspend_referral_ring", params: { member_ids: members, referrer_id: "r" } }).ok).toBe(false);
    expect(checkActionLimits({ type: "suspend_referral_ring", params: { member_ids: members.slice(0, 19), referrer_id: "r" } }).ok).toBe(true);
  });

  it("needs the target id each type acts on", () => {
    expect(checkActionLimits({ type: "suspend_agent", params: {} }).ok).toBe(false);
    expect(checkActionLimits({ type: "suspend_agent", params: { user_id: "u" } }).ok).toBe(true);
    expect(checkActionLimits({ type: "freeze_cashouts", params: { agent_id: "" } }).ok).toBe(false);
    expect(checkActionLimits({ type: "switch_priority", params: {} }).ok).toBe(false);
    expect(checkActionLimits({ type: "quarantine_order", params: { order_id: "o" } }).ok).toBe(true);
    expect(checkActionLimits({ type: "blacklist_ip", params: { ip: "1.2.3.4" } }).ok).toBe(true);
  });

  it("needs the network for network-wide actions", () => {
    expect(checkActionLimits({ type: "disable_network", params: {} }).ok).toBe(false);
    expect(checkActionLimits({ type: "broadcast_outage", params: {} }).ok).toBe(false);
    expect(checkActionLimits({ type: "broadcast_outage", params: { network: "MTN" } }).ok).toBe(true);
  });
});

describe("confirmation kind", () => {
  it("maps actions to the box's warning", () => {
    expect(confirmKindFor("switch_priority")).toBe("ops");
    expect(confirmKindFor("quarantine_order")).toBe("ops");
    expect(confirmKindFor("broadcast_outage")).toBe("message");
    expect(confirmKindFor("blacklist_ip")).toBe("account");
    expect(confirmKindFor("suspend_cluster")).toBe("account");
  });
});
