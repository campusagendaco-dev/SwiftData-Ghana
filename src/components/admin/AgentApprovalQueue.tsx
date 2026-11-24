import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirmedCall } from "@/components/admin/ConfirmActionProvider";
import { agentConfirmKind } from "@/lib/agentConfirmKind";

export type AgentTask = {
  id: string;
  agent_name: string;
  task_type: string;
  priority: string;
  status: string;
  title: string;
  reasoning: string | null;
  payload: Record<string, any> | null;
  created_at: string;
};

type TaskChange = { line: string; names?: string; sms?: string; recipients?: number; amountGhs?: number };

/**
 * Plain words for what approving a task changes. Uses `payload.display`, which the server
 * filled from the database by id (names, recipient count, order amount, SMS text), so the
 * AI can't label one account or provider with another's name.
 */
export function describeTaskChange(task: Pick<AgentTask, "task_type" | "payload">): TaskChange {
  const p = task.payload ?? {};
  const d = (p.display ?? {}) as Record<string, any>;
  const type = String(task.task_type).toLowerCase();
  const accounts: { id: string; name: string }[] | undefined = Array.isArray(d.accounts) ? d.accounts : undefined;
  const names = accounts?.map((a) => a.name).join(", ");
  if (type === "freeze_cashouts") {
    return { line: "Records a cashout-freeze alert for review (does not block cashouts)", names };
  }
  if (type === "broadcast_outage") {
    const recipients = typeof d.recipients === "number" ? d.recipients : undefined;
    return {
      line: recipients == null ? `SMS to every agent about ${p.network}` : `${recipients} agents get this SMS`,
      sms: d.sms_text,
      recipients,
    };
  }
  if (type === "quarantine_order" && d.order) {
    const amount = typeof d.order.amount === "number" ? d.order.amount : undefined;
    return {
      line: `Order ${String(d.order.id).slice(0, 8)} (${amount == null ? "amount unknown" : `GH₵${amount.toFixed(2)}`}, ${d.order.status}) will be marked failed`,
      amountGhs: amount,
    };
  }
  const ids = Array.isArray(p.user_ids) ? p.user_ids : Array.isArray(p.member_ids) ? [...p.member_ids, ...(p.referrer_id ? [p.referrer_id] : [])] : null;
  if (ids) return { line: `${ids.length} account${ids.length === 1 ? "" : "s"}`, names };
  switch (type) {
    case "suspend_agent":
    case "suspend_login_bot":
    case "lock_terminal":
      return { line: `1 account (${names ?? String(p.user_id ?? "").slice(0, 8)})`, names };
    case "blacklist_ip":
      return { line: `IP ${p.ip}` };
    case "disable_network":
      return { line: `${p.network} network goes offline` };
    case "relink_order_provider":
      return { line: `Order ${String(p.order_id ?? "").slice(0, 8)} relinked to ${d.provider?.name ?? "another provider"}` };
    default:
      return d.provider
        ? { line: `Provider ${d.provider.name} priority ${d.priority ?? p.new_priority ?? 1}` }
        : { line: p.provider_id ? `Provider ${String(p.provider_id).slice(0, 8)} priority ${p.new_priority ?? 1}` : "See details" };
  }
}

/**
 * Approval queue for AI agent proposals (ai_worker_tasks). Approve asks in the admin
 * confirmation box first, then ai-task-decide runs it (admin with 2FA; a task runs once).
 */
export default function AgentApprovalQueue({ tasks, onDecided }: { tasks: AgentTask[]; onDecided: () => void }) {
  const confirmed = useConfirmedCall();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: "ok" | "warn" | "error" } | null>(null);

  const decide = async (task: AgentTask, approve: boolean) => {
    if (approve) {
      const change = describeTaskChange(task);
      const ok = await confirmed.confirm({
        title: task.title,
        description: [
          `${change.line}.`,
          change.names && `Accounts: ${change.names}.`,
          change.sms && `SMS text: "${change.sms}"`,
          `Proposed by ${task.agent_name}${task.reasoning ? ` (${task.reasoning})` : ""}.`,
        ].filter(Boolean).join(" "),
        kind: agentConfirmKind(task.task_type),
        confirmLabel: "Approve",
        ...(change.recipients != null ? { orders: change.recipients } : {}),
        ...(change.amountGhs != null ? { amountGhs: change.amountGhs } : {}),
      });
      if (!ok) return;
    }
    setBusyId(task.id);
    try {
      // Approve was confirmed above; reject changes nothing in the system.
      const { data, error } = await supabase.functions.invoke("ai-task-decide", { body: { task_id: task.id, approve } });
      if ((error as any)?.context?.status === 409) {
        setNotice({ id: task.id, text: "Already decided by another admin", tone: "warn" });
      } else if (error || data?.error) {
        setNotice({ id: task.id, text: data?.error || error?.message || "Could not decide the task", tone: "error" });
      } else if (approve && data?.ok === false) {
        setNotice({ id: task.id, text: `Approved but not applied: ${data?.error || "refused"}`, tone: "error" });
      } else {
        setNotice({ id: task.id, text: approve ? "Approved and applied" : "Rejected", tone: "ok" });
      }
      onDecided();
    } finally {
      setBusyId(null);
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500/60" />
        <p className="text-xs text-muted-foreground">Nothing waiting for approval.</p>
        {notice && <p className="mt-2 text-xs text-muted-foreground">{notice.text}</p>}
      </div>
    );
  }

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto">
      {tasks.map((task) => (
        <div key={task.id} className="space-y-2 rounded-2xl border border-border bg-card p-3.5 text-card-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold">{task.title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">{task.priority}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {task.agent_name} · {new Date(task.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
          {(() => {
            const change = describeTaskChange(task);
            return (
              <div className="space-y-0.5 text-[11px]">
                <p>
                  <span className="font-semibold">What changes: </span>
                  <span>{change.line}</span>
                </p>
                {change.names && <p className="text-muted-foreground">{change.names}</p>}
                {change.sms && <p className="italic text-muted-foreground">“{change.sms}”</p>}
              </div>
            );
          })()}
          {task.reasoning && <p className="text-[11px] leading-snug text-muted-foreground">{task.reasoning}</p>}
          {notice?.id === task.id && (
            <p className={`text-[11px] font-semibold ${notice.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : notice.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
              {notice.text}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busyId === task.id}
              onClick={() => void decide(task, true)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {busyId === task.id && <Loader2 className="h-3 w-3 animate-spin" />}
              Approve
            </button>
            <button
              type="button"
              disabled={busyId === task.id}
              onClick={() => void decide(task, false)}
              className="rounded-lg bg-muted px-3 py-1.5 text-[10px] font-black uppercase text-muted-foreground hover:bg-red-600 hover:text-white disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
