import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Report = {
  is_admin_requires_2fa: boolean;
  has_role_requires_2fa: boolean;
  policies: { table: string; policy: string; command: string }[];
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; report: Report }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * Read-only "Database 2FA check" for the Administrators tab: does the database's admin check
 * require 2FA, which policies check admin rights on their own, and how many admins lack 2FA.
 * `adminsWithout2fa` is null while the admin list is loading or has rows we couldn't check.
 */
export default function Database2faCheckCard({ adminsWithout2fa }: { adminsWithout2fa: number | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    // read-only: report only, changes nothing
    const { data, error } = await (supabase as any).rpc("admin_security_2fa_report");
    if (error) {
      setState(error.code === "PGRST202" ? { kind: "missing" } : { kind: "error", message: error.message || "Check failed" });
      return;
    }
    setState({ kind: "ready", report: data as Report });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tone = (ok: boolean) => (ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400");

  return (
    <div className="rounded-xl border border-border bg-card p-5 text-card-foreground">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-primary" />
          <span className="text-xs font-black uppercase tracking-[0.12em]">Database 2FA check</span>
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh database check"
          className="text-muted-foreground transition-colors hover:text-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${state.kind === "loading" ? "animate-spin" : ""}`} />
        </button>
      </div>

      {state.kind === "loading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</div>
      )}
      {state.kind === "missing" && (
        <p className="text-sm text-muted-foreground">Database check not installed yet</p>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">Could not run the check: {state.message}</p>
      )}
      {state.kind === "ready" && (
        <div className="space-y-2 text-sm">
          <p className={tone(state.report.is_admin_requires_2fa)}>
            Admin check requires 2FA: {state.report.is_admin_requires_2fa ? "Yes" : "No"}
          </p>
          <p className={tone(state.report.has_role_requires_2fa)}>
            Role check requires 2FA: {state.report.has_role_requires_2fa ? "Yes" : "No"}
          </p>
          <p>Policies with their own admin check: {state.report.policies.length}</p>
          {state.report.policies.length > 0 && (
            <ul className="ml-4 list-disc space-y-0.5 font-mono text-xs text-muted-foreground">
              {state.report.policies.map((p) => (
                <li key={`${p.table}/${p.policy}`}>{`${p.table} / ${p.policy} (${p.command})`}</li>
              ))}
            </ul>
          )}
          <p>Admins without 2FA: {adminsWithout2fa ?? "—"}</p>
        </div>
      )}
    </div>
  );
}
