import { useEffect, useState } from "react";
import { ShieldAlert, CheckCircle2, XCircle, Phone, User, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PendingUnsuspendRequest {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  phone: string;
  suspension_reason: string;
  is_security_breach: boolean;
  status: string;
  created_at: string;
}

export default function AdminUnsuspendPopup() {
  const [requests, setRequests] = useState<PendingUnsuspendRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const loadPending = async () => {
    try {
      const { data } = await (supabase as any)
        .from("account_unsuspend_requests")
        .select("id, user_id, user_name, user_email, phone, suspension_reason, is_security_breach, status, created_at")
        .eq("status", "pending_admin_approval")
        .order("created_at", { ascending: false })
        .limit(5);
      if (Array.isArray(data)) setRequests(data);
    } catch {
      // ignore if table not migrated yet
    }
  };

  useEffect(() => {
    void loadPending();

    const channel = supabase
      .channel("admin-unsuspend-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "account_unsuspend_requests" },
        (payload: any) => {
          const row = payload.new as PendingUnsuspendRequest | undefined;
          if (!row) return;

          if (row.status === "pending_admin_approval") {
            setRequests((prev) => {
              const filtered = prev.filter((r) => r.id !== row.id);
              return [row, ...filtered].slice(0, 5);
            });
            setDismissedIds((prev) => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
            toast.warning(`Security Approval Needed: ${row.user_name || row.phone} verified OTP to unsuspend`, {
              description: row.suspension_reason,
              duration: 8000,
            });
          } else {
            setRequests((prev) => prev.filter((r) => r.id !== row.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDecision = async (reqItem: PendingUnsuspendRequest, decision: "approve" | "reject") => {
    setBusyId(reqItem.id);
    try {
      const { data, error } = await supabase.functions.invoke("self-unsuspend", {
        body: { action: "admin_decision", request_id: reqItem.id, decision },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setRequests((prev) => prev.filter((r) => r.id !== reqItem.id));
      toast.success(
        decision === "approve"
          ? `Approved & unsuspended ${reqItem.user_name || reqItem.phone}`
          : `Kept ${reqItem.user_name || reqItem.phone} suspended`
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to process decision");
    } finally {
      setBusyId(null);
    }
  };

  const visible = requests.filter((r) => !dismissedIds.has(r.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-[calc(100vw-2rem)]">
      {visible.slice(0, 2).map((reqItem) => (
        <div
          key={reqItem.id}
          className="rounded-2xl border border-amber-500/40 bg-zinc-950/95 backdrop-blur-xl text-white shadow-2xl shadow-black/60 p-4 space-y-3 animate-in slide-in-from-bottom-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                    Unsuspend Approval
                  </span>
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[9px] px-1.5 py-0">
                    OTP VERIFIED
                  </Badge>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">Security breach requires admin decision</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDismissedIds((prev) => new Set(prev).add(reqItem.id))}
              className="text-zinc-500 hover:text-white p-1"
              title="Dismiss popup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="truncate">{reqItem.user_name || "Unknown User"}</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400 font-mono text-[11px]">
              <Phone className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>{reqItem.phone}</span>
              {reqItem.user_email && <span className="truncate">· {reqItem.user_email}</span>}
            </div>
            <div className="pt-1.5 mt-1 border-t border-white/10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block">
                Suspension Reason:
              </span>
              <p className="text-[11px] text-zinc-200 leading-snug mt-0.5">{reqItem.suspension_reason}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busyId === reqItem.id}
              onClick={() => void handleDecision(reqItem, "approve")}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9"
            >
              {busyId === reqItem.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              )}
              Approve & Unsuspend
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === reqItem.id}
              onClick={() => void handleDecision(reqItem, "reject")}
              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 font-bold text-xs h-9"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
