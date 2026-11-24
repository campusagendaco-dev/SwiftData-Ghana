import { AlertCircle, HelpCircle, Shield } from "lucide-react";

export type AdminMfaStatus = "verified" | "none" | "unknown";

/** 2FA badge for the Administrators table. "unknown" (lookup failed) never reads as NO 2FA. */
export default function AdminTwoFactorBadge({ status }: { status: AdminMfaStatus }) {
  if (status === "verified") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Shield className="w-3 h-3" /><span className="text-[9px] font-black font-mono uppercase">2FA OK</span>
      </div>
    );
  }
  if (status === "none") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse">
        <AlertCircle className="w-3 h-3" /><span className="text-[9px] font-black font-mono uppercase">NO 2FA</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-muted-foreground border border-border"
      title="Couldn't check this admin's 2FA. Refresh to try again.">
      <HelpCircle className="w-3 h-3" /><span className="text-[9px] font-black font-mono uppercase">2FA UNKNOWN</span>
    </div>
  );
}
