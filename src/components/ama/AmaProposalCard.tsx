import { useRef, useState } from "react";
import { Loader2, ShoppingCart, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type AmaProposal =
  | { kind: "purchase"; network: string; package_size: string; phone: string; amount_ghs: number }
  | { kind: "redeem"; points: number; amount_ghs: number };

const ghs = (n: number) => `GH₵${Number(n).toFixed(2)}`;

/**
 * What Ama prepared, shown before anything happens. Buying data or redeeming points runs
 * only when the user taps Confirm, exactly once; Cancel does nothing.
 */
export default function AmaProposalCard({ proposal, onDone }: { proposal: AmaProposal; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const started = useRef(false);

  const finish = (message: string) => {
    setFinished(true);
    onDone(message);
  };

  const confirm = async () => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    try {
      if (proposal.kind === "purchase") {
        const { data, error } = await supabase.functions.invoke("wallet-buy-data", {
          body: {
            network: proposal.network,
            package_size: proposal.package_size,
            customer_phone: proposal.phone,
            amount: proposal.amount_ghs,
            reference: crypto.randomUUID(),
          },
        });
        if (error || data?.error) finish(`The purchase didn't go through: ${data?.error || error?.message || "unknown error"}. Nothing was charged by me; check your wallet before trying again.`);
        else finish(`Done! ${proposal.network} ${proposal.package_size} for ${proposal.phone} is on its way. Order ID: ${data?.order_id ?? "—"}.`);
      } else {
        const { data, error } = await supabase.functions.invoke("oracle-ai", { body: { action: "confirm_redeem", points: proposal.points } });
        if (error || data?.error) finish(`The redemption didn't go through: ${data?.error || error?.message || "unknown error"}.`);
        else finish(`Done! ${proposal.points} points were added to your wallet as ${ghs(proposal.amount_ghs)}.`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (finished) return null;
  const isPurchase = proposal.kind === "purchase";
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border bg-card p-3 text-card-foreground">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {isPurchase ? <ShoppingCart className="h-3.5 w-3.5" /> : <Gift className="h-3.5 w-3.5" />}
        {isPurchase ? "Check before buying" : "Check before redeeming"}
      </p>
      {proposal.kind === "purchase" ? (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <span className="font-semibold">{`${proposal.network} ${proposal.package_size}`}</span>
          <span className="font-mono">{proposal.phone}</span>
          <span className="text-right font-black">{ghs(proposal.amount_ghs)}</span>
        </div>
      ) : (
        <p className="text-sm font-semibold">{`${proposal.points} points → ${ghs(proposal.amount_ghs)}`}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPurchase ? "Confirm purchase" : "Confirm redemption"}
        </button>
        <button
          type="button"
          onClick={() => finish(isPurchase ? "Okay, I didn't buy anything." : "Okay, I didn't redeem anything.")}
          disabled={busy}
          className="h-8 rounded-lg border border-border px-3 text-xs font-bold hover:bg-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
