import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Run = { id: number; run_at: string; kind: "ledger" | "paystack"; ok: boolean; issues: number | null; details: any };
type Req = {
  id: string; agent_id: string; account: string; amount: number; reason: string;
  requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null;
};
type Entry = { id: number; account: string; amount: number; balance_after: number; reason: string; source: string | null; reference_id: string | null; created_at: string; actor_role: string | null };

const card = "rounded-2xl border border-border/70 bg-card/85 dark:border-white/[0.08] dark:bg-black/30";
const ced = (n: number) => `GH₵${Number(n || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token}` };
}

export default function AdminWalletLedger() {
  const [runs, setRuns] = useState<{ ledger?: Run; paystack?: Run }>({});
  const [checking, setChecking] = useState<"" | "ledger" | "paystack">("");
  const [pending, setPending] = useState<Req[]>([]);
  const [recent, setRecent] = useState<Req[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<string>("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ user_id: string; full_name: string | null; email: string | null; phone: string | null } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [searching, setSearching] = useState(false);

  const loadRuns = useCallback(async () => {
    const { data } = await supabase.from("wallet_reconciliation_runs" as any).select("id, run_at, kind, ok, issues, details").order("id", { ascending: false }).limit(20);
    const list = (data || []) as unknown as Run[];
    setRuns({ ledger: list.find((r) => r.kind === "ledger"), paystack: list.find((r) => r.kind === "paystack") });
  }, []);

  const loadRequests = useCallback(async () => {
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("wallet_adjustment_requests" as any).select("*").eq("status", "pending").order("requested_at", { ascending: true }),
      supabase.from("wallet_adjustment_requests" as any).select("*").neq("status", "pending").order("requested_at", { ascending: false }).limit(15),
    ]);
    const pend = (p || []) as unknown as Req[];
    const rec = (r || []) as unknown as Req[];
    setPending(pend);
    setRecent(rec);
    const ids = [...new Set([...pend, ...rec].flatMap((x) => [x.agent_id, x.requested_by, x.decided_by]).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids);
      setNames(Object.fromEntries((profs || []).map((x: any) => [x.user_id, x.full_name || x.email || x.user_id.slice(0, 8)])));
    }
  }, []);

  useEffect(() => {
    loadRuns();
    loadRequests();
  }, [loadRuns, loadRequests]);

  const runLedgerCheck = async () => {
    setChecking("ledger");
    const { data, error } = await (supabase.rpc as any)("verify_wallet_ledger");
    setChecking("");
    if (error) return toast.error(error.message);
    toast[data?.ok ? "success" : "error"](data?.ok ? "Ledger verified: every balance matches" : `${data?.balance_mismatches} mismatch(es), ${data?.chain_breaks} chain break(s)`);
    loadRuns();
  };

  const runPaystackCheck = async () => {
    setChecking("paystack");
    const { data, error } = await supabase.functions.invoke("wallet-reconcile", { body: {}, headers: await authHeader() });
    setChecking("");
    if (error || data?.error) return toast.error(data?.error || error?.message || "Check failed");
    toast[data?.ok ? "success" : "error"](data?.ok ? `All ${data.paystack_transactions} Paystack payments reconcile` : `${data.issues} issue(s) found`);
    loadRuns();
  };

  const decide = async (r: Req, approve: boolean) => {
    setDeciding(r.id + (approve ? ":a" : ":r"));
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "decide_wallet_adjustment", request_id: r.id, approve },
      headers: await authHeader(),
    });
    setDeciding("");
    if (error || data?.error) return toast.error(data?.error || error?.message || "Failed");
    toast.success(approve ? (data?.executed ? "Approved and applied" : data?.error || "Approved") : "Rejected");
    loadRequests();
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setEntries([]);
    const digits = q.replace(/\D/g, "");
    let sel = supabase.from("profiles").select("user_id, full_name, email, phone").limit(1);
    sel = q.includes("@") ? sel.ilike("email", q) : digits.length >= 9 ? sel.ilike("phone", `%${digits.slice(-9)}`) : sel.eq("user_id", q);
    const { data: prof } = await sel.maybeSingle();
    setFound(prof as any);
    if (prof) {
      const { data } = await supabase
        .from("wallet_ledger" as any)
        .select("id, account, amount, balance_after, reason, source, reference_id, created_at, actor_role")
        .eq("agent_id", (prof as any).user_id)
        .order("id", { ascending: false })
        .limit(100);
      setEntries((data || []) as unknown as Entry[]);
    }
    setSearching(false);
  };

  const RunCard = ({ title, run, onRun, busy }: { title: string; run?: Run; onRun: () => void; busy: boolean }) => (
    <section className={cn(card, "p-4 sm:p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("h-10 w-10 rounded-xl flex items-center justify-center", !run ? "bg-muted text-muted-foreground" : run.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400")}>
            {!run ? <ShieldCheck className="h-5 w-5" /> : run.ok ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-[15px] font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{run ? `Last run ${when(run.run_at)}` : "Not run yet"}</p>
          </div>
        </div>
        <button type="button" onClick={onRun} disabled={busy} className="h-9 px-3 rounded-xl border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run now
        </button>
      </div>
      {run && (
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
          {run.kind === "ledger" ? (
            <>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Wallets</dt><dd className="font-semibold tabular-nums">{run.details?.wallets_checked ?? "—"}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Mismatches</dt><dd className={cn("font-semibold tabular-nums", run.details?.balance_mismatches ? "text-rose-600" : "")}>{run.details?.balance_mismatches ?? 0}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Chain breaks</dt><dd className={cn("font-semibold tabular-nums", run.details?.chain_breaks ? "text-rose-600" : "")}>{run.details?.chain_breaks ?? 0}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Unlabelled (24h)</dt><dd className="font-semibold tabular-nums">{run.details?.unattributed_24h ?? 0}</dd></div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Payments</dt><dd className="font-semibold tabular-nums">{run.details?.paystack_transactions ?? "—"}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{ced(run.details?.paystack_total)}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Top-ups checked</dt><dd className="font-semibold tabular-nums">{run.details?.topup_credits_checked ?? 0}</dd></div>
              <div className="rounded-xl bg-muted/50 p-2.5"><dt className="text-muted-foreground">Issues</dt><dd className={cn("font-semibold tabular-nums", run.issues ? "text-rose-600" : "")}>{run.issues ?? 0}</dd></div>
            </>
          )}
        </dl>
      )}
      {run && !run.ok && Array.isArray(run.details?.sample) && run.details.sample.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground max-h-40 overflow-y-auto">
          {run.details.sample.slice(0, 20).map((i: any, k: number) => (
            <li key={k}><span className="font-semibold text-foreground">{String(i.type).replace(/_/g, " ")}</span> · {String(i.order_id).slice(0, 8)} · {i.detail}</li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Wallet ledger</h1>
        <p className="text-sm text-muted-foreground">Every balance change is recorded, sealed and checked nightly. Large manual adjustments need two admins.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RunCard title="Ledger integrity" run={runs.ledger} onRun={runLedgerCheck} busy={checking === "ledger"} />
        <RunCard title="Paystack reconciliation (48h)" run={runs.paystack} onRun={runPaystackCheck} busy={checking === "paystack"} />
      </div>

      <section className={cn(card, "p-4 sm:p-5")}>
        <h2 className="text-[15px] font-semibold">Adjustments waiting for a second admin</h2>
        <p className="text-xs text-muted-foreground">You can’t approve your own request.</p>
        {pending.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted-foreground">Nothing waiting.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {pending.map((r) => (
              <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">
                    {Number(r.amount) > 0 ? "Credit" : "Debit"} {ced(Math.abs(Number(r.amount)))} · {r.account === "api" ? "API wallet" : "Main wallet"} · {names[r.agent_id] || r.agent_id.slice(0, 8)}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">“{r.reason}” · requested by {names[r.requested_by] || r.requested_by.slice(0, 8)} · {when(r.requested_at)}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => decide(r, true)} disabled={!!deciding} className="h-9 px-3 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-500 disabled:opacity-60">
                    {deciding === r.id + ":a" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                  </button>
                  <button type="button" onClick={() => decide(r, false)} disabled={!!deciding} className="h-9 px-3 rounded-xl border border-border text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-60">
                    {deciding === r.id + ":r" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-muted-foreground">Recent adjustments</summary>
            <ul className="mt-2 space-y-1.5 text-[12.5px]">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className={cn("font-semibold", r.status === "executed" ? "text-emerald-600" : r.status === "rejected" ? "text-foreground" : "text-rose-600")}>{r.status}</span>
                  <span>{Number(r.amount) > 0 ? "+" : "−"}{ced(Math.abs(Number(r.amount)))} {r.account}</span>
                  <span>· {names[r.agent_id] || r.agent_id.slice(0, 8)}</span>
                  <span>· “{r.reason}”</span>
                  <span>· {when(r.decided_at || r.requested_at)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className={cn(card, "p-4 sm:p-5")}>
        <h2 className="text-[15px] font-semibold">Look up a user’s ledger</h2>
        <form onSubmit={search} className="mt-3 flex gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Email, phone or user ID" className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-[14px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
          </label>
          <button type="submit" disabled={searching} className="h-11 px-4 rounded-xl bg-foreground text-background text-[13.5px] font-semibold disabled:opacity-60">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </button>
        </form>
        {found === null && query && !searching ? null : found ? (
          <div className="mt-4">
            <p className="text-[13.5px]"><span className="font-semibold">{found.full_name || "User"}</span> <span className="text-muted-foreground">· {found.email} · {found.phone}</span></p>
            {entries.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted-foreground">No ledger entries.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-2 pr-3 font-medium">#</th><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Wallet</th><th className="py-2 pr-3 font-medium">Reason</th><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Ref</th><th className="py-2 pr-3 font-medium text-right">Amount</th><th className="py-2 font-medium text-right">Balance</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">{e.id}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{when(e.created_at)}</td>
                        <td className="py-2 pr-3">{e.account}</td>
                        <td className={cn("py-2 pr-3", e.reason.startsWith("unattributed") && "text-amber-600 font-semibold")}>{e.reason}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{e.source}</td>
                        <td className="py-2 pr-3 font-mono text-[11.5px]">{e.reference_id ? e.reference_id.slice(0, 8) : "—"}</td>
                        <td className={cn("py-2 pr-3 text-right tabular-nums font-semibold", Number(e.amount) > 0 ? "text-emerald-600" : "")}>{Number(e.amount) > 0 ? "+" : ""}{Number(e.amount).toFixed(2)}</td>
                        <td className="py-2 text-right tabular-nums">{Number(e.balance_after).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : query && !searching ? (
          <p className="mt-3 text-[13px] text-muted-foreground">No user found.</p>
        ) : null}
      </section>
    </div>
  );
}
