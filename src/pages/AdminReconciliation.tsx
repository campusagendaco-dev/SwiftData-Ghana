import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, Loader2, RefreshCw, Search, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reconciliation: the nightly read-only check (wallet-reconcile) compares Paystack payments,
 * orders and the wallet ledger, and explains each problem in plain words with a safe next
 * step. Nothing on this page sends, re-sends, refunds or credits anything.
 */

type Issue = {
  key: string;
  type: string;
  order_id: string;
  amount_ghs: number;
  detail: string;
  explanation?: string;
  next_step?: string;
  explained_by?: "ai" | "rules";
};

type Run = {
  id: number;
  run_at: string;
  kind: string;
  ok: boolean;
  issues: number;
  details: {
    window_hours?: number;
    paystack_transactions?: number;
    paystack_total?: number;
    issues_total_ghs?: number;
    by_type?: Record<string, number>;
    sample?: Issue[];
  } | null;
};

const LABELS: Record<string, string> = {
  paid_without_order: "Paid, no order",
  paid_not_credited: "Top-up not credited",
  credited_without_payment: "Credited, no payment",
  credit_exceeds_payment: "Credited more than paid",
  refunded_twice: "Refunded twice",
  delivered_twice: "Delivered twice",
  charged_twice_delivered_once: "Charged twice, delivered once",
  delivered_not_fully_paid: "Delivered, not fully paid",
};
const label = (t: string) => LABELS[t] ?? t.replace(/_/g, " ");
const ghs = (n: number | undefined) => `GH₵${Number(n || 0).toFixed(2)}`;
const when = (s: string) => new Date(s).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AdminReconciliation() {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("wallet_reconciliation_runs")
      .select("id, run_at, kind, ok, issues, details")
      .eq("kind", "paystack")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRun((data as Run) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = async () => {
    setChecking(true);
    // read-only: wallet-reconcile only records a check run and notifies admins; it never credits wallets or sends orders
    const { data, error } = await supabase.functions.invoke("wallet-reconcile", { body: {}, headers: await authHeader() });
    setChecking(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Check failed");
      return;
    }
    toast[data?.ok ? "success" : "warning"](data?.ok ? "Everything matched" : `${data?.issues ?? 0} problem(s) found`);
    void load();
  };

  const issues = useMemo(() => run?.details?.sample ?? [], [run]);
  const counts = useMemo(() => issues.reduce((m: Record<string, number>, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {}), [issues]);
  const shown = issues.filter((i) => {
    if (filter !== "all" && i.type !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || i.order_id.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q);
  });
  const total = run?.details?.issues_total_ghs ?? issues.reduce((s, i) => s + Number(i.amount_ghs || 0), 0);
  const hours = run?.details?.window_hours ?? 48;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-foreground">
            <CreditCard className="h-7 w-7 text-primary" />
            Reconciliation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every night Paystack payments, orders and wallets are compared. Each problem is explained with a safe next step.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={checking}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-60"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Run check now
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the latest check…</div>
      ) : !run ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No check has run yet.</div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-5 text-card-foreground">
            <p className="text-lg font-black">{run.ok ? "All clear" : `${issues.length} problem${issues.length === 1 ? "" : "s"} · ${ghs(total)}`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {run.details?.paystack_transactions ?? 0} Paystack payments ({ghs(run.details?.paystack_total)}) checked over the last {hours} hours · run {when(run.run_at)}
            </p>
            {run.issues > issues.length && (
              <p className="mt-1 text-xs text-muted-foreground">Showing the first {issues.length} of {run.issues}.</p>
            )}
          </div>

          {run.ok || issues.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-semibold text-foreground">Everything matched in the last {hours} hours.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search reference or order id"
                    className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {[["all", `All (${issues.length})`], ...Object.entries(counts).map(([t, n]) => [t, `${label(t)} (${n})`])].map(([id, text]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${filter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="space-y-3">
                {shown.map((i) => (
                  <li key={i.key} className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold">{label(i.type)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{i.order_id}</span>
                      </div>
                      <span className="text-sm font-black">{ghs(i.amount_ghs)}</span>
                    </div>
                    <p className="mt-2 text-sm">{i.explanation ?? i.detail}</p>
                    {i.next_step && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Next step: </span>
                        <span>{i.next_step}</span>
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        {i.explained_by === "ai" ? "AI explanation" : "Standard explanation"}
                      </span>
                      <span>{i.detail}</span>
                      <a
                        href={`https://dashboard.paystack.com/#/search?model=transactions&query=${encodeURIComponent(i.order_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" /> Paystack
                      </a>
                    </div>
                  </li>
                ))}
                {shown.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No problems match this filter.</li>}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
