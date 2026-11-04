import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Download, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Entry = {
  id: number;
  account: "main" | "api" | "loyalty";
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_at: string;
};

const LABELS: Record<string, string> = {
  opening_balance: "Opening balance",
  wallet_topup: "Wallet top-up",
  debt_recovery: "Applied to amount owed (15 Aug duplicate credit)",
  repay_credit: "Wallet top-up",
  credit_wallet: "Credit",
  debit_wallet: "Purchase",
  create_order_rpc: "API purchase",
  order_refund: "Refund",
  refund_failed_order: "Refund for a failed order",
  admin_credit: "Credit from SwiftData",
  admin_debit: "Adjustment by SwiftData",
  game_stake: "Game stake",
  game_stake_refund: "Game stake returned",
  credit_order_profits: "Sales profit",
  claim_daily_check_in: "Daily check-in reward",
  spin_the_wheel: "Spin the wheel",
  convert_loyalty_points: "Points converted",
  redeem_swift_points: "Points redeemed",
  user_transfer_to_api: "Transfer to API wallet",
  credit_api_wallet: "API wallet credit",
  transfer_float_to_subagent: "Float transfer",
  fulfill_store_wallet_topup: "Store top-up",
  approve_store_deposit: "Store deposit",
  purchase_sms_credits: "SMS credits",
  charge_sms_credit: "SMS charge",
  refund_sms_credit: "SMS refund",
  award_loyalty_points: "Points earned",
  trg_award_swift_points: "Points earned",
};
const labelFor = (r: string) => LABELS[r] || r.replace(/^unattributed_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const ACCOUNTS = [
  { id: "main", label: "Main wallet" },
  { id: "api", label: "API wallet" },
  { id: "loyalty", label: "Points" },
] as const;

const PAGE = 50;

export default function WalletStatement() {
  const { user } = useAuth();
  const [account, setAccount] = useState<"main" | "api" | "loyalty">("main");
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      if (!user) return;
      setLoading(true);
      const from = reset ? 0 : rows.length;
      const { data, error } = await supabase
        .from("wallet_ledger" as any)
        .select("id, account, amount, balance_before, balance_after, reason, reference_type, reference_id, note, created_at")
        .eq("agent_id", user.id)
        .eq("account", account)
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (!error && Array.isArray(data)) {
        const list = data as unknown as Entry[];
        setRows((prev) => (reset ? list : [...prev, ...list]));
        setHasMore(list.length === PAGE);
      }
      setLoading(false);
    },
    [user, account, rows.length]
  );

  useEffect(() => {
    setRows([]);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, account]);

  const money = (n: number) =>
    account === "loyalty" ? `${Number(n).toLocaleString("en-GH", { maximumFractionDigits: 2 })} pts` : `GH₵${Number(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportCsv = () => {
    const head = ["Date", "Description", "Reference", "Amount", "Balance after"];
    const lines = rows.map((r) =>
      [new Date(r.created_at).toISOString(), labelFor(r.reason), r.reference_id || "", Number(r.amount).toFixed(2), Number(r.balance_after).toFixed(2)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swiftdata-${account}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-black/40 overflow-hidden">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 pt-4 sm:pt-5">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">Statement</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Every change to your balance, permanently recorded
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-muted p-0.5" role="tablist" aria-label="Wallet">
            {ACCOUNTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={account === a.id}
                onClick={() => setAccount(a.id)}
                className={cn("h-8 px-3 rounded-lg text-[12.5px] font-semibold transition-colors", account === a.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="h-9 px-3 rounded-xl border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </header>

      {loading && rows.length === 0 ? (
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-muted-foreground">No entries yet for this wallet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 dark:divide-white/[0.06]">
          {rows.map((r) => {
            const credit = Number(r.amount) > 0;
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <span className={cn("h-9 w-9 shrink-0 rounded-xl flex items-center justify-center", credit ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                  {credit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-foreground truncate">{labelFor(r.reason)}</p>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {new Date(r.created_at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {r.reference_id ? ` · Ref ${r.reference_id.slice(0, 8).toUpperCase()}` : ""} · #{r.id}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("text-[13.5px] font-semibold tabular-nums", credit ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                    {credit ? "+" : "−"}
                    {money(Math.abs(Number(r.amount)))}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground tabular-nums">Bal {money(Number(r.balance_after))}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="p-4">
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading}
            className="w-full h-10 rounded-xl border border-border text-[13px] font-semibold hover:bg-muted inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load older entries
          </button>
        </div>
      )}
    </section>
  );
}
