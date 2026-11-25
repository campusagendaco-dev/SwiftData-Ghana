import { describe, expect, it, vi } from "vitest";
import { executeApprovedAction, queueAgentAction, runAutoAction } from "../../supabase/functions/_shared/agent_actions";
import { fakeDb } from "./helpers/fakeDb";

const fakeSms = () => ({ sendAdmin: vi.fn(async () => true), sendBulk: vi.fn(async () => true) });
const today = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("queueAgentAction", () => {
  it("queues once while the same proposal is still waiting", async () => {
    const db = fakeDb();
    const action = { type: "suspend_cluster", title: "Suspend IP cluster 1.2.3.4", params: { user_ids: ["a"] } };
    expect(await queueAgentAction(db, "threat_hunter", action)).toEqual({ queued: true });
    expect((await queueAgentAction(db, "threat_hunter", action)).queued).toBe(false);
    const inserts = db.writes.filter((w) => w.table === "ai_worker_tasks" && w.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ agent_name: "threat_hunter", task_type: "suspend_cluster", status: "awaiting_approval", payload: { user_ids: ["a"] } });
  });

  it("refuses to queue anything that is not an approval action", async () => {
    const db = fakeDb();
    expect((await queueAgentAction(db, "ops_worker", { type: "heal_stuck_orders", params: {} })).queued).toBe(false);
    expect(db.writes).toHaveLength(0);
  });
});

describe("runAutoAction", () => {
  it("never runs an approval action by itself", async () => {
    const db = fakeDb();
    const res = await runAutoAction(db, "x", { type: "suspend_cluster", params: { user_ids: ["a"] } }, { sms: fakeSms() });
    expect(res.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it("alerts in-app but skips the SMS once 10 admin texts went out today", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ action_type: "notify_admin", ts: today(), metadata: { sms_sent: true, topic: "t" + i } }));
    const db = fakeDb({ sentinel_actions: rows });
    const sms = fakeSms();
    await runAutoAction(db, "ops_worker", { type: "notify_admin", params: { message: "New outage pattern" } }, { sms });
    expect(sms.sendAdmin).not.toHaveBeenCalled();
    const alert = db.writes.find((w) => w.table === "sentinel_actions" && w.op === "insert");
    expect(alert?.values).toMatchObject({ action_type: "notify_admin", metadata: { sms_sent: false } });
  });

  it("does not text the same topic twice within an hour", async () => {
    const db = fakeDb({ sentinel_actions: [{ action_type: "notify_admin", ts: ago(30 * 60 * 1000), metadata: { sms_sent: true, topic: "mtn-down" } }] });
    const sms = fakeSms();
    await runAutoAction(db, "ops_worker", { type: "notify_admin", params: { message: "MTN down again", topic: "mtn-down" } }, { sms });
    expect(sms.sendAdmin).not.toHaveBeenCalled();
  });

  it("just after midnight, a topic texted before midnight still isn't repeated", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-25T00:10:00Z"));
      const db = fakeDb({ sentinel_actions: [{ action_type: "notify_admin", ts: "2026-11-24T23:50:00.000Z", metadata: { sms_sent: true, topic: "mtn-down" } }] });
      const sms = fakeSms();
      await runAutoAction(db, "ops_worker", { type: "notify_admin", params: { message: "MTN down again", topic: "mtn-down" } }, { sms });
      expect(sms.sendAdmin).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("yesterday's texts don't count toward today's limit", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-25T00:10:00Z"));
      const rows = Array.from({ length: 10 }, (_, i) => ({ action_type: "notify_admin", ts: `2026-11-24T23:${String(15 + i).padStart(2, "0")}:00.000Z`, metadata: { sms_sent: true, topic: `t${i}` } }));
      const db = fakeDb({ sentinel_actions: rows });
      const sms = fakeSms();
      await runAutoAction(db, "ops_worker", { type: "notify_admin", params: { message: "New problem", topic: "fresh" } }, { sms });
      expect(sms.sendAdmin).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("texts a new topic and records that it did", async () => {
    const db = fakeDb();
    const sms = fakeSms();
    await runAutoAction(db, "ops_worker", { type: "notify_admin", params: { message: "Provider X failing" } }, { sms });
    expect(sms.sendAdmin).toHaveBeenCalledTimes(1);
    expect(db.writes.find((w) => w.table === "sentinel_actions")?.values).toMatchObject({ metadata: { sms_sent: true, agent: "ops_worker" } });
  });

  it("stores a watch-only proposal as a finding", async () => {
    const db = fakeDb();
    const wouldPropose = { type: "suspend_cluster", title: "Suspend 3 accounts", params: { user_ids: ["a", "b", "c"] } };
    await runAutoAction(db, "threat_hunter", { type: "record_finding", params: { would_propose: wouldPropose } }, { sms: fakeSms() });
    const w = db.writes.find((x) => x.table === "ai_insights");
    expect(w?.values.insight_text).toBe("Would propose: Suspend 3 accounts");
    expect(w?.values.metadata).toMatchObject({ agent: "threat_hunter", would_propose: wouldPropose });
  });

  it("does not store the same finding again within an hour", async () => {
    const db = fakeDb({ ai_insights: [{ insight_text: "Would propose: Suspend 3 accounts", created_at: ago(20 * 60 * 1000) }] });
    const wouldPropose = { type: "suspend_cluster", title: "Suspend 3 accounts", params: { user_ids: ["a", "b", "c"] } };
    const res = await runAutoAction(db, "threat_hunter", { type: "record_finding", params: { would_propose: wouldPropose } }, { sms: fakeSms() });
    expect(res.ok).toBe(true);
    expect(db.writes.filter((x) => x.table === "ai_insights")).toHaveLength(0);
  });
});

describe("executeApprovedAction", () => {
  const ctx = () => ({ adminId: "admin-1", sms: fakeSms() });

  it("suspends exactly the approved accounts", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", role: "agent" }, { user_id: "b", role: "agent" }, { user_id: "c", role: "agent" }] });
    const res = await executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ["a", "b"] } }, ctx());
    expect(res.ok).toBe(true);
    expect(db.tables.profiles.filter((p) => p.is_suspended).map((p) => p.user_id)).toEqual(["a", "b"]);
  });

  it("an approved suspension is never a timed hold that a code could lift", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", role: "agent", suspended_until: "2026-11-24T20:00:00Z" }] });
    await executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ["a"] } }, ctx());
    expect(db.tables.profiles[0]).toMatchObject({ is_suspended: true, suspended_until: null });
  });

  it("never suspends an admin", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", role: "agent" }, { user_id: "boss", role: "admin" }] });
    const res = await executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ["a", "boss"] } }, ctx());
    expect(db.tables.profiles.find((p) => p.user_id === "boss")?.is_suspended).toBeUndefined();
    expect(res.details).toMatchObject({ skipped_admins: ["boss"] });
  });

  it("refuses more than 20 accounts with no writes", async () => {
    const db = fakeDb();
    const ids = Array.from({ length: 21 }, (_, i) => "u" + i);
    const res = await executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ids } }, ctx());
    expect(res.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses forbidden work even if it reached the queue", async () => {
    const db = fakeDb();
    expect(await executeApprovedAction(db, { task_type: "heal_stuck_orders", payload: {} }, ctx())).toMatchObject({ ok: false, error: "forbidden" });
    expect(db.writes).toHaveLength(0);
  });

  it("never puts Korba at priority 1", async () => {
    const db = fakeDb({ providers: [{ id: "k", name: "Korba", handler_type: "korba", is_active: true, balance: 900, consecutive_failures: 0, priority: 3 }] });
    const res = await executeApprovedAction(db, { task_type: "switch_priority", payload: { provider_id: "k", new_priority: 1 } }, ctx());
    expect(res.ok).toBe(false);
    expect(db.tables.providers[0].priority).toBe(3);
  });

  it("only quarantines an order that has not been delivered", async () => {
    const db = fakeDb({ orders: [{ id: "o1", status: "fulfilled" }, { id: "o2", status: "processing" }] });
    expect((await executeApprovedAction(db, { task_type: "quarantine_order", payload: { order_id: "o1" } }, ctx())).ok).toBe(false);
    expect(db.tables.orders[0].status).toBe("fulfilled");
    expect((await executeApprovedAction(db, { task_type: "quarantine_order", payload: { order_id: "o2" } }, ctx())).ok).toBe(true);
    expect(db.tables.orders[1].status).toBe("fulfillment_failed");
  });

  it("records the approving admin on an IP block", async () => {
    const db = fakeDb();
    await executeApprovedAction(db, { task_type: "blacklist_ip", payload: { ip: "1.2.3.4", reason: "cluster" } }, ctx());
    expect(db.writes.find((w) => w.table === "security_blacklist")?.values).toMatchObject({ type: "ip", value: "1.2.3.4", created_by: "admin-1" });
  });
});

describe("what the admin is shown comes from the database, not the AI", () => {
  it("names the provider from the providers table, whatever the AI wrote", async () => {
    const db = fakeDb({ providers: [{ id: "p1", name: "SKPlug", handler_type: "skdataplug" }] });
    await queueAgentAction(db, "sentinel_prime", { type: "switch_priority", title: "Switch Korba to priority 1", params: { provider_id: "p1", provider_name: "Korba", new_priority: 1 } });
    const t = db.tables.ai_worker_tasks[0];
    expect(t.title).toBe("sentinel_prime: set provider SKPlug to priority 1");
    expect(t.payload.display).toMatchObject({ provider: { id: "p1", name: "SKPlug" } });
  });

  it("lists the names of the accounts to be suspended", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", full_name: "Ama Mensah" }, { user_id: "b", full_name: "Kofi Boateng" }] });
    await queueAgentAction(db, "threat_hunter", { type: "suspend_cluster", title: "x", params: { user_ids: ["a", "b"] } });
    const t = db.tables.ai_worker_tasks[0];
    expect(t.title).toBe("threat_hunter: suspend 2 accounts");
    expect(t.payload.display.accounts).toEqual([{ id: "a", name: "Ama Mensah" }, { id: "b", name: "Kofi Boateng" }]);
  });

  it("counts outage text recipients and shows the exact text", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", is_agent: true, phone: "0241" }, { user_id: "b", is_agent: true, phone: "0242" }, { user_id: "c", is_agent: false, phone: "0243" }] });
    await queueAgentAction(db, "sentinel_prime", { type: "broadcast_outage", params: { network: "mtn" } });
    const d = db.tables.ai_worker_tasks[0].payload.display;
    expect(d.recipients).toBe(2);
    expect(d.sms_text).toContain("instability with the MTN network");
  });

  it("shows the order amount from the orders table", async () => {
    const db = fakeDb({ orders: [{ id: "o1234567xx", amount: 25, status: "processing" }] });
    await queueAgentAction(db, "guardian_ai", { type: "quarantine_order", params: { order_id: "o1234567xx", amount: 999 } });
    const t = db.tables.ai_worker_tasks[0];
    expect(t.payload.display.order).toEqual({ id: "o1234567xx", amount: 25, status: "processing" });
    expect(t.title).toBe("guardian_ai: mark order o1234567 failed (GH₵25.00)");
  });
});

describe("proposals don't come back after a decision", () => {
  const cluster = (title: string) => ({ type: "suspend_cluster", title, params: { user_ids: ["b", "a"] } });

  it("does not queue the same targets again while waiting, even with a new AI title", async () => {
    const db = fakeDb();
    await queueAgentAction(db, "threat_hunter", cluster("first wording"));
    expect((await queueAgentAction(db, "threat_hunter", { ...cluster("second wording"), params: { user_ids: ["a", "b"] } })).queued).toBe(false);
  });

  it("does not queue again within 24 hours of a rejection, but does after", async () => {
    const db = fakeDb({ ai_worker_tasks: [{ id: "old", task_type: "suspend_cluster", target_key: "suspend_cluster:a,b", status: "rejected", created_at: ago(3 * 60 * 60 * 1000) }] });
    expect((await queueAgentAction(db, "threat_hunter", cluster("again"))).queued).toBe(false);
    db.tables.ai_worker_tasks[0].created_at = ago(25 * 60 * 60 * 1000);
    expect((await queueAgentAction(db, "threat_hunter", cluster("again"))).queued).toBe(true);
  });

  it("records the same duplicate-account flag only once a day", async () => {
    const db = fakeDb({ duplicate_account_flags: [{ primary_user_id: "a", created_at: ago(60 * 60 * 1000) }] });
    await runAutoAction(db, "account_cloner", { type: "flag_review", params: { user_ids: ["a", "b"] } }, { sms: fakeSms() });
    expect(db.writes.filter((w) => w.table === "duplicate_account_flags")).toHaveLength(0);
  });

  it("records the same AML alert only once a day", async () => {
    const db = fakeDb({ aml_alerts: [{ agent_id: "k", alert_type: "STRUCTURING", created_at: ago(60 * 60 * 1000) }] });
    await runAutoAction(db, "aml_scanner", { type: "flag_aml_review", params: { agent_id: "k", pattern: "STRUCTURING" } }, { sms: fakeSms() });
    expect(db.writes.filter((w) => w.table === "aml_alerts")).toHaveLength(0);
  });
});

describe("admins are found in user_roles", () => {
  it("never suspends someone with the admin role even if their profile says agent", async () => {
    const db = fakeDb({ profiles: [{ user_id: "a", role: "agent" }, { user_id: "boss", role: "agent" }], user_roles: [{ user_id: "boss", role: "admin" }] });
    const res = await executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ["a", "boss"] } }, { adminId: "x", sms: fakeSms() });
    expect(db.tables.profiles.find((p) => p.user_id === "boss")?.is_suspended).toBeUndefined();
    expect(res.details).toMatchObject({ skipped_admins: ["boss"] });
  });
});

