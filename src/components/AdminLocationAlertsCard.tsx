import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { callLocationCheck } from "@/lib/locationAlerts";

type Stats = {
  granted: number;
  declined: number;
  sent_today: number;
  sent_total: number;
  mode: "off" | "consent";
  daily_limit: number;
};
type Saved = { ok: boolean };
type TestResult = { ok: boolean; error?: string };

export function AdminLocationAlertsCard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState("");
  const [town, setTown] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    callLocationCheck<Stats>({ action: "admin_stats" }).then((res) => {
      if (!active) return;
      setStats(res);
      if (res) {
        setEnabled(res.mode === "consent");
        setLimit(String(res.daily_limit));
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    const res = await callLocationCheck<Saved>({ action: "admin_set_settings", mode: next ? "consent" : "off" });
    if (res?.ok !== true) {
      setEnabled(previous);
      toast.error("Could not save the location SMS setting");
    }
  };

  const saveLimit = async () => {
    const value = Number(limit);
    if (limit.trim() === "" || !Number.isInteger(value) || value < 0) {
      toast.error("Daily SMS limit must be a whole number, 0 or more");
      return;
    }
    const res = await callLocationCheck<Saved>({ action: "admin_set_settings", daily_limit: value });
    if (res?.ok === true) toast.success("Daily SMS limit saved");
    else {
      toast.error("Could not save the daily SMS limit");
      if (stats) setLimit(String(stats.daily_limit));
    }
  };

  const sendTest = async () => {
    const name = town.trim();
    if (!name) {
      toast.error("Enter a town to test");
      return;
    }
    setBusy(true);
    const res = await callLocationCheck<TestResult>({ action: "admin_test_send", town: name });
    setBusy(false);
    if (res?.ok === true) toast.success(`Test SMS sent for ${name}`);
    else toast.error(`Test SMS failed: ${res?.error ?? "no response"}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Location Welcome SMS</CardTitle>
        <CardDescription>Text customers who agreed to location alerts when they arrive in a new town.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-foreground">
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !stats ? (
          <p className="text-sm text-muted-foreground">Could not load location SMS settings. Try again shortly.</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <span className="text-sm font-medium">Send location welcome SMS</span>
              <Switch checked={enabled} onCheckedChange={toggle} aria-label="Location welcome SMS" />
            </div>

            <div className="space-y-2">
              <label htmlFor="location-sms-limit" className="text-sm font-medium">Daily SMS limit</label>
              <div className="flex gap-2">
                <Input
                  id="location-sms-limit"
                  type="number"
                  min={0}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={saveLimit}>Save limit</Button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Granted: {stats.granted} · Declined: {stats.declined} · Sent today: {stats.sent_today} · Sent total: {stats.sent_total}
            </p>

            <div className="space-y-2">
              <label htmlFor="location-sms-test-town" className="text-sm font-medium">Test town</label>
              <div className="flex gap-2">
                <Input
                  id="location-sms-test-town"
                  value={town}
                  placeholder="e.g. Kumasi"
                  onChange={(e) => setTown(e.target.value)}
                />
                <Button type="button" variant="outline" disabled={busy} onClick={sendTest}>Send test</Button>
              </div>
            </div>

            <Link to="/admin/sms-templates" className="inline-block text-sm text-primary underline">
              Edit the message in SMS templates
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
