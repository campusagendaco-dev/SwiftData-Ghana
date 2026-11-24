// Approve or reject one queued agent task (ai_worker_tasks). Called by ai-task-decide
// after verifyAdmin has confirmed an admin who entered their 2FA code.
// The task is claimed first with a conditional update, so it can run only once even when
// two admins click Approve together.

import { executeApprovedAction, type AgentSms } from "./agent_actions.ts";
import { normalizeActionType, policyFor } from "./agent_policy.ts";

export async function decideTask(
  db: any,
  input: { taskId: string; approve: boolean; adminId: string },
  ctx: { sms: AgentSms },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: task } = await db
    .from("ai_worker_tasks")
    .update({ status: "deciding" })
    .eq("id", input.taskId)
    .eq("status", "awaiting_approval")
    .select()
    .maybeSingle();
  if (!task) return { status: 409, body: { error: "Task is already being decided or done" } };

  const type = normalizeActionType(task.task_type);
  const audit = (action: string, extra: Record<string, unknown> = {}) =>
    db.from("audit_logs").insert({
      admin_id: input.adminId,
      action,
      details: { task_id: task.id, task_type: type, agent: task.agent_name, title: task.title, ...extra },
    });

  if (!input.approve) {
    await db.from("ai_worker_tasks").update({ status: "rejected", approved_by: input.adminId }).eq("id", task.id);
    await audit("ai_task_rejected");
    return { status: 200, body: { ok: true, status: "rejected" } };
  }

  const res = policyFor(type) === "approval"
    ? await executeApprovedAction(db, { task_type: type, payload: task.payload ?? {} }, { adminId: input.adminId, sms: ctx.sms })
        .catch((err: any) => ({ ok: false, error: err?.message || String(err) }))
    : { ok: false, error: "forbidden" };

  const status = res.ok ? "executed" : "failed";
  await db
    .from("ai_worker_tasks")
    .update({
      status,
      approved_by: input.adminId,
      executed_at: new Date().toISOString(),
      result: { ok: res.ok, details: (res as any).details ?? null, error: (res as any).error ?? null },
    })
    .eq("id", task.id);
  await audit("ai_task_approved", { ok: res.ok, error: (res as any).error ?? null });
  return { status: 200, body: { ok: res.ok, status, details: (res as any).details ?? null, error: (res as any).error ?? null } };
}
