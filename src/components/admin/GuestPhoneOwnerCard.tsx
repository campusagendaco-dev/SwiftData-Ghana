import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedCall } from "@/components/admin/ConfirmActionProvider";

type Status = {
  phone: string | null;
  phone_verified: boolean;
  owner_user_id: string | null;
  owner_name: string | null;
  credit_from: string | null;
};

/**
 * Whose account a phone number's Mystery Box guest purchases count for. The first account to verify
 * a number owns it; an admin (authenticator app) can move it, e.g. for a recycled SIM. The new owner
 * only gets purchases made after the move.
 */
export function GuestPhoneOwnerCard({ userId, userName }: { userId: string; userName?: string | null }) {
  const confirmed = useConfirmedCall();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    // read-only: shows who owns the number, changes nothing
    const { data, error } = await (supabase as any).rpc("admin_guest_phone_status", { p_user_id: userId });
    if (error) return setStatus(null);
    setStatus((Array.isArray(data) ? data[0] : data) ?? null);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!status) return null;

  const name = userName || "this account";
  const isOwner = status.owner_user_id === userId;
  const ownerText = status.owner_name || "another account";

  const move = async () => {
    if (!status.phone) return;
    setMoving(true);
    try {
      const res = await confirmed.rpc(
        "admin_set_guest_phone_owner",
        { p_user_id: userId },
        {
          title: "Move this number's guest purchases?",
          description: status.owner_user_id
            ? `From now on, guest purchases to ${status.phone} count toward Mystery Boxes for ${name} instead of ${ownerText}. Purchases made before now stay with ${ownerText}.`
            : `From now on, guest purchases to ${status.phone} count toward Mystery Boxes for ${name}.`,
          kind: "account",
          confirmLabel: "Yes, move it",
        },
      );
      if (res.cancelled) return;
      if (res.error) throw new Error(res.error.message || "Could not move the number");
      toast({ title: "Number moved", description: `Guest purchases to ${status.phone} now count for ${name}.` });
      await load();
    } catch (err: any) {
      toast({ title: "Could not move the number", description: err.message, variant: "destructive" });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="mt-2 flex items-start gap-2.5 rounded-2xl border border-border bg-card/60 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <Gift className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mystery Box guest purchases</p>
        <p className="text-xs text-foreground">
          {!status.phone || !status.phone_verified
            ? "Needs a verified phone number before guest purchases can count."
            : isOwner
              ? `Guest purchases to ${status.phone} count for this account${status.credit_from ? ` (since ${new Date(status.credit_from).toLocaleString()})` : ""}.`
              : status.owner_user_id
                ? `Guest purchases to ${status.phone} count for ${ownerText}, not this account.`
                : `Guest purchases to ${status.phone} don't count for any account yet.`}
        </p>
        {status.phone && status.phone_verified && !isOwner && (
          <Button size="sm" variant="outline" onClick={move} disabled={moving} className="h-7 gap-1 rounded-lg px-2.5 text-xs">
            {moving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Move to this account
          </Button>
        )}
      </div>
    </div>
  );
}

export default GuestPhoneOwnerCard;
