import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ReceiptText, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirmedCall } from "@/components/admin/ConfirmActionProvider";

/**
 * MoMo receipt checker for support staff. The AI reads the picture; fixed rules decide the
 * red flags (wrong recipient, amount, reused transaction ID, old or edited receipt). The best
 * result is "No red flags found". Accepting records the decision and credits nothing.
 */

type Flag = { code: string; severity: "high" | "medium"; message: string };
type Extracted = {
  provider?: string;
  transaction_id?: string | null;
  amount?: number | null;
  sender_name?: string | null;
  sender_phone?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  timestamp?: string | null;
  status?: string;
};
type Result = { check_id: string | null; verdict: "no_red_flags" | "flagged"; risk_level: string; flags: Flag[]; extracted: Extracted; order_amount: number | null };
type Account = { id: string; phone: string; account_name: string | null; is_active: boolean };

const ghs = (n: number | null | undefined) => (n == null ? "—" : `GH₵${Number(n).toFixed(2)}`);
const MAX_BYTES = 5 * 1024 * 1024;

/** Same rule as the server: Ghana numbers stored as 233XXXXXXXXX. */
export function toGhPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (/^233\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return `233${d.slice(1)}`;
  if (/^\d{9}$/.test(d)) return `233${d}`;
  return null;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export default function AdminMomoReceipts() {
  const confirmed = useConfirmedCall();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [image, setImage] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [expected, setExpected] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  const loadAccounts = useCallback(async () => {
    const { data } = await (supabase as any).from("momo_receiving_accounts").select("id, phone, account_name, is_active").eq("is_active", true).order("created_at");
    setAccounts((data as Account[]) || []);
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setDecided(null);
    if (!file) return setImage(null);
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) return toast.error("Upload a JPG, PNG or WEBP picture");
    if (file.size > MAX_BYTES) return toast.error("The picture is larger than 5 MB");
    setImage(await readAsDataUrl(file));
  };

  const check = async () => {
    if (!image) return;
    setChecking(true);
    setResult(null);
    setDecided(null);
    const amount = Number(expected);
    // read-only: a check reads the picture and records the result; it credits or sends nothing
    const { data, error } = await supabase.functions.invoke("verify-momo-receipt", {
      body: {
        action: "check",
        image_base64: image,
        ...(orderId.trim() ? { order_id: orderId.trim() } : {}),
        ...(Number.isFinite(amount) && amount > 0 ? { expected_amount: amount } : {}),
      },
    });
    setChecking(false);
    if (error || data?.error) return toast.error(data?.error || error?.message || "Check failed");
    setResult(data as Result);
  };

  const decide = async (decision: "accepted" | "rejected") => {
    if (!result?.check_id) return;
    if (decision === "accepted") {
      const ok = await confirmed.confirm({
        title: `Accept receipt ${result.extracted.transaction_id ?? ""}?`.trim(),
        description: `${ghs(result.extracted.amount)} from ${result.extracted.sender_name ?? result.extracted.sender_phone ?? "unknown"}. ${
          result.flags.length ? `${result.flags.length} red flag(s) were found.` : "No red flags were found."
        } Check the MoMo statement before crediting; accepting credits nothing.`,
        kind: "receipt",
        confirmLabel: "Accept receipt",
        ...(result.extracted.amount != null ? { amountGhs: Number(result.extracted.amount) } : {}),
      });
      if (!ok) return;
    }
    const { data, error } = await supabase.functions.invoke("verify-momo-receipt", { body: { action: "decide", check_id: result.check_id, decision } });
    if (error || data?.error) return toast.error(data?.error || error?.message || "Could not record the decision");
    setDecided(decision);
    toast.success(decision === "accepted" ? "Receipt accepted" : "Receipt rejected");
  };

  const addAccount = async () => {
    const phone = toGhPhone(newPhone);
    if (!phone) return toast.error("Enter a Ghana MoMo number, e.g. 024 123 4567");
    const ok = await confirmed.confirm({
      title: `Add ${phone} as a SwiftData MoMo number?`,
      description: "Receipts paid to this number will count as paid to SwiftData.",
      kind: "receipt",
      confirmLabel: "Add number",
    });
    if (!ok) return;
    const { error } = await (supabase as any).from("momo_receiving_accounts").insert({ phone, account_name: newName.trim() || null, is_active: true });
    if (error) return toast.error(error.message);
    setNewPhone("");
    setNewName("");
    void loadAccounts();
  };

  const removeAccount = async (a: Account) => {
    const ok = await confirmed.confirm({
      title: `Stop accepting receipts paid to ${a.phone}?`,
      description: "Receipts paid to this number will be flagged from now on.",
      kind: "receipt",
      confirmLabel: "Remove number",
    });
    if (!ok) return;
    const { error } = await (supabase as any).from("momo_receiving_accounts").update({ is_active: false }).eq("id", a.id);
    if (error) return toast.error(error.message);
    void loadAccounts();
  };

  const e = result?.extracted;
  const field = (labelText: string, value: unknown) => (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{labelText}</p>
      <p className="text-sm">{value == null || value === "" ? "—" : String(value)}</p>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-foreground">
          <ReceiptText className="h-7 w-7 text-primary" />
          MoMo receipt checker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a customer's MoMo receipt to read it and look for red flags. A receipt picture can't prove a payment; check the MoMo statement before crediting anything.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 text-card-foreground lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold sm:col-span-3">
              Receipt picture
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(ev) => void onFile(ev.target.files?.[0])} className="mt-1 block w-full text-sm" />
            </label>
            <label className="text-xs font-semibold">
              Order ID (optional)
              <input value={orderId} onChange={(ev) => setOrderId(ev.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" />
            </label>
            <label className="text-xs font-semibold">
              Expected GH₵ (if no order)
              <input value={expected} onChange={(ev) => setExpected(ev.target.value)} inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void check()}
                disabled={!image || checking}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {checking && <Loader2 className="h-4 w-4 animate-spin" />}
                Check receipt
              </button>
            </div>
          </div>

          {result && e && (
            <div className="space-y-4 border-t border-border pt-4">
              {result.verdict === "no_red_flags" ? (
                <p className="flex items-center gap-2 text-lg font-black text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-5 w-5" />No red flags found</p>
              ) : (
                <p className="flex items-center gap-2 text-lg font-black text-red-600 dark:text-red-400">
                  <ShieldAlert className="h-5 w-5" />Flagged · {result.flags.length} problem{result.flags.length === 1 ? "" : "s"}
                </p>
              )}
              {result.flags.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {result.flags.map((f, i) => (
                    <li key={`${f.code}-${i}`} className={f.severity === "high" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}>{f.message}</li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {field("Provider", e.provider)}
                {field("Transaction ID", e.transaction_id)}
                {field("Amount", ghs(e.amount))}
                {field("From", [e.sender_name, e.sender_phone].filter(Boolean).join(" · "))}
                {field("To", [e.recipient_name, e.recipient_phone].filter(Boolean).join(" · "))}
                {field("Time on receipt", e.timestamp)}
                {field("Status on receipt", e.status)}
                {field("Order amount", ghs(result.order_amount))}
              </div>
              <p className="text-xs text-muted-foreground">A receipt picture can't prove a payment. Check the MoMo statement before crediting anything.</p>
              {decided ? (
                <p className="text-sm font-semibold">Decision recorded: {decided}.</p>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void decide("accepted")} className="h-9 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500">Accept receipt</button>
                  <button type="button" onClick={() => void decide("rejected")} className="h-9 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted">Reject receipt</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-card-foreground">
          <p className="text-sm font-black">SwiftData MoMo numbers</p>
          <p className="text-xs text-muted-foreground">A receipt only passes when the money went to one of these.</p>
          {accounts.length === 0 ? (
            <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">No SwiftData MoMo number yet, so every receipt will be flagged. Add your receiving numbers below.</p>
          ) : (
            <ul className="space-y-1">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg bg-muted px-2 py-1 text-sm">
                  <span><span className="font-mono">{a.phone}</span>{a.account_name ? ` · ${a.account_name}` : ""}</span>
                  <button type="button" aria-label={`Remove ${a.phone}`} onClick={() => void removeAccount(a)} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="block text-xs font-semibold">
            MoMo number
            <input value={newPhone} onChange={(ev) => setNewPhone(ev.target.value)} placeholder="024 123 4567" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" />
          </label>
          <label className="block text-xs font-semibold">
            Account name
            <input value={newName} onChange={(ev) => setNewName(ev.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" />
          </label>
          <button type="button" onClick={() => void addAccount()} className="h-9 w-full rounded-lg border border-border text-sm font-bold hover:bg-muted">Add number</button>
        </div>
      </div>
    </div>
  );
}
