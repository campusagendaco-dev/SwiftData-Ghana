import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Database, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPACT_STEPS,
  CRON_HISTORY_FALLBACK_SQL,
  addDeleted,
  formatBytes,
  sumDeleted,
  type DbCleanupResult,
  type DbSpace,
} from "@/lib/dbSpace";

/** Safety cap on repeated cleanup calls (each one runs for about 5 seconds). */
const MAX_CLEANUP_CALLS = 200;

const errorText = (message: string | undefined) =>
  message?.includes("not_authorized")
    ? "Only a full admin signed in with 2FA can do this."
    : "The cleanup stopped early. What was already removed stays removed — you can press Clean now again.";

export default function AdminDatabaseSpace() {
  const [space, setSpace] = useState<DbSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});

  const loadSpace = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_db_space" as any);
    if (error || !data) {
      toast.error(error ? errorText(error.message) : "Couldn't load database sizes.");
    } else {
      setSpace(data as unknown as DbSpace);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSpace();
  }, [loadSpace]);

  const cleanNow = async () => {
    setCleaning(true);
    setResult(null);
    setFailures({});
    setProgress(0);
    let deleted: Record<string, number> = {};
    let errors: Record<string, string> = {};
    try {
      for (let i = 0; i < MAX_CLEANUP_CALLS; i++) {
        const { data, error } = await supabase.rpc("admin_db_cleanup_now" as any);
        if (error || !data) {
          toast.error(errorText(error?.message));
          break;
        }
        const res = data as unknown as DbCleanupResult;
        deleted = addDeleted(deleted, res.deleted || {});
        errors = { ...errors, ...(res.errors || {}) };
        setProgress(sumDeleted(deleted));
        if (!res.more_remaining) break;
      }
    } finally {
      setResult(sumDeleted(deleted));
      setFailures(errors);
      setCleaning(false);
      await loadSpace();
    }
  };

  const copySql = async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      toast.success("Copied. Paste it into a new Supabase SQL editor query and run it on its own.");
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand.");
    }
  };

  const tables = [...(space?.tables ?? [])].sort((a, b) => b.total_bytes - a.total_bytes);
  const cleanable = tables.reduce((s, t) => s + t.total_bytes, 0);
  const last = space?.last_run ?? null;
  const labelFor = (target: string) => tables.find((t) => t.target === target)?.label ?? target;
  const lastErrors = Object.keys(last?.errors ?? {});

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" /> Database Space
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Old logs and job history are cleared automatically every night at 03:20. Orders, payments, wallets and
          customer accounts are never touched here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Whole database</CardDescription>
            <CardTitle className="text-3xl">{space ? formatBytes(space.database_bytes) : "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Logs and history (cleaned automatically)</CardDescription>
            <CardTitle className="text-3xl">{space ? formatBytes(cleanable) : "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last cleanup</CardDescription>
            <CardTitle className="text-base">
              {last ? (
                <>
                  {last.source === "nightly" ? "Nightly" : "Manual"} · {new Date(last.started_at).toLocaleString()}
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">
                    {sumDeleted(last.deleted).toLocaleString()} rows removed
                    {last.more_remaining ? " (more left — runs again tonight)" : ""}
                  </span>
                  {lastErrors.length > 0 && (
                    <span className="mt-1 block text-sm font-normal text-destructive">
                      Couldn't clean: {lastErrors.map(labelFor).join(", ")}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm font-normal text-muted-foreground">Not run yet</span>
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">What gets cleaned</CardTitle>
            <CardDescription>Sizes include indexes. Row counts are estimates.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadSpace} disabled={loading || cleaning} aria-label="Refresh sizes">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button onClick={cleanNow} disabled={cleaning}>
              {cleaning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              {cleaning ? `Cleaning… ${progress.toLocaleString()} rows` : "Clean now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {result !== null && (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground">
              Deleted {result.toLocaleString()} old rows
            </p>
          )}
          {Object.entries(failures).map(([target, message]) => (
            <p key={target} className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
              Couldn't clean {labelFor(target)}: {message}
            </p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Records</th>
                  <th className="py-2 pr-3 font-medium">Kept for</th>
                  <th className="py-2 pr-3 text-right font-medium">Size</th>
                  <th className="py-2 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.target} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground">{t.label}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{t.rule}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">{formatBytes(t.total_bytes)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{t.approx_rows.toLocaleString()}</td>
                  </tr>
                ))}
                {tables.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      {loading ? "Loading…" : "No size information yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Give the space back to disk (one time)</CardTitle>
          <CardDescription>
            Deleting rows lets the database reuse the space, but the size Supabase reports only drops after a
            "compact". Do this once, after the first big cleanup has finished.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Run the steps <strong className="text-foreground">one at a time</strong>: paste one line into a new SQL
              editor query, run it, then do the next. Pasting them together fails.
            </li>
            <li>
              Each step stops <strong className="text-foreground">reading and writing</strong> to that table until it
              finishes (seconds to a few minutes), so customers may see delays. Do it at a quiet hour.
            </li>
            <li>
              If the first step says it skipped the table or permission was denied, run{" "}
              <code className="rounded bg-muted px-1 text-foreground">{CRON_HISTORY_FALLBACK_SQL}</code> instead — it
              only clears scheduled-job history.
            </li>
          </ul>
          <ol className="space-y-2">
            {COMPACT_STEPS.map((step, i) => (
              <li key={step.sql} className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
                  {step.sql}
                </code>
                <Button variant="outline" size="sm" onClick={() => copySql(step.sql)} aria-label={`Copy step ${i + 1}: ${step.label}`}>
                  <Copy className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Only full admins signed in with 2FA can run the cleanup.
      </p>
    </div>
  );
}
