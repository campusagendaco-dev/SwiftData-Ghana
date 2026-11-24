import { describe, expect, it, vi } from "vitest";
import { decideTask } from "../../supabase/functions/_shared/agent_task_decide";
import { fakeDb } from "./helpers/fakeDb";

const sms = { sendAdmin: vi.fn(async () => true), sendBulk: vi.fn(async () => true) };
const task = (over: Record<string, unknown> = {}) => ({
  id: "t1", agent_name: "threat_hunter", task_type: "suspend_cluster", status: "awaiting_approval",
  title: "Suspend 2 accounts", payload: { user_ids: ["a", "b"] }, ...over,
});
const people = [{ user_id: "a", role: "agent" }, { user_id: "b", role: "agent" }];

describe("decideTask", () => {
  it("runs a task only once when two admins approve at the same time", async () => {
    const db = fakeDb({ ai_worker_tasks: [task()], profiles: people });
    const [r1, r2] = await Promise.all([
      decideTask(db, { taskId: "t1", approve: true, adminId: "admin-1" }, { sms }),
      decideTask(db, { taskId: "t1", approve: true, adminId: "admin-2" }, { sms }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((r1.status === 409 ? r1 : r2).body.error).toBe("Task is already being decided or done");
    expect(db.writes.filter((w) => w.table === "profiles")).toHaveLength(1);
    expect(db.tables.ai_worker_tasks[0]).toMatchObject({ status: "executed" });
  });

  it("records who approved, when, and the result", async () => {
    const db = fakeDb({ ai_worker_tasks: [task()], profiles: people });
    const res = await decideTask(db, { taskId: "t1", approve: true, adminId: "admin-1" }, { sms });
    expect(res.status).toBe(200);
    const t = db.tables.ai_worker_tasks[0];
    expect(t).toMatchObject({ status: "executed", approved_by: "admin-1" });
    expect(typeof t.executed_at).toBe("string");
    expect(db.writes.find((w) => w.table === "audit_logs")?.values).toMatchObject({ admin_id: "admin-1", action: "ai_task_approved", details: { task_id: "t1", task_type: "suspend_cluster" } });
  });

  it("fails a task whose type is no longer allowed, without running anything", async () => {
    const db = fakeDb({ ai_worker_tasks: [task({ task_type: "heal_stuck_orders", payload: { pending_order_ids: ["o"] } })] });
    const res = await decideTask(db, { taskId: "t1", approve: true, adminId: "admin-1" }, { sms });
    expect(db.tables.ai_worker_tasks[0].status).toBe("failed");
    expect(res.body.error).toBe("forbidden");
    expect(db.writes.some((w) => w.table === "orders" || w.table === "profiles")).toBe(false);
  });

  it("marks a failed run as failed with the reason", async () => {
    const db = fakeDb({ ai_worker_tasks: [task({ task_type: "switch_priority", payload: { provider_id: "missing" } })] });
    const res = await decideTask(db, { taskId: "t1", approve: true, adminId: "admin-1" }, { sms });
    expect(res.status).toBe(200);
    expect(db.tables.ai_worker_tasks[0]).toMatchObject({ status: "failed" });
    expect(res.body.error).toBe("provider not found");
  });

  it("rejects without running the action", async () => {
    const db = fakeDb({ ai_worker_tasks: [task()], profiles: people });
    const res = await decideTask(db, { taskId: "t1", approve: false, adminId: "admin-1" }, { sms });
    expect(res.status).toBe(200);
    expect(db.tables.ai_worker_tasks[0]).toMatchObject({ status: "rejected", approved_by: "admin-1" });
    expect(db.writes.some((w) => w.table === "profiles")).toBe(false);
    expect(db.writes.find((w) => w.table === "audit_logs")?.values.action).toBe("ai_task_rejected");
  });

  it("answers 409 for an unknown or already decided task", async () => {
    const db = fakeDb({ ai_worker_tasks: [task({ status: "executed" })] });
    expect((await decideTask(db, { taskId: "nope", approve: true, adminId: "a" }, { sms })).status).toBe(409);
    expect((await decideTask(db, { taskId: "t1", approve: true, adminId: "a" }, { sms })).status).toBe(409);
  });
});
