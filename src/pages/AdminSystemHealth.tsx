import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

type SecretCheck = {
  key: string;
  present: boolean;
  required_for: string[];
};

type TableCheck = {
  table: string;
  exists: boolean;
  error?: string | null;
};

type FunctionCheck = {
  name: string;
  reachable: boolean;
  status?: number;
  error?: string | null;
};

type HealthResponse = {
  timestamp: string;
  checks: {
    secrets: SecretCheck[];
    tables: TableCheck[];
    functions: FunctionCheck[];
  };
  summary: {
    missing_secrets: number;
    missing_tables: number;
    missing_functions: number;
    healthy: boolean;
  };
};

const StatusBadge = ({ ok }: { ok: boolean }) => (
  <Badge className={ok ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
    {ok ? "OK" : "Missing"}
  </Badge>
);

const AdminSystemHealth = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const loadHealth = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-system-health", { body: {} });

    if (error || data?.error) {
      toast({
        title: "Health check failed",
        description: data?.error || error?.message || "Could not load system health.",
        variant: "destructive",
      });
      setHealth(null);
      setLoading(false);
      return;
    }

    setHealth(data as HealthResponse);
    setLoading(false);
  };

  useEffect(() => {
    loadHealth();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Check critical secrets, required tables, and deployed edge functions.
          </p>
        </div>
        <Button onClick={loadHealth} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      {health && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Overall Status
              <Badge className={health.summary.healthy ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}>
                {health.summary.healthy ? "Healthy" : "Needs Attention"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Missing Secrets</p>
              <p className="text-xl font-bold">{health.summary.missing_secrets}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Missing Tables</p>
              <p className="text-xl font-bold">{health.summary.missing_tables}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Missing Functions</p>
              <p className="text-xl font-bold">{health.summary.missing_functions}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Secrets</CardTitle>
        </CardHeader>
        <CardContent>
          {!health ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading..." : "No data yet."}</p>
          ) : (
            <div className="space-y-2">
              {health.checks.secrets.map((item) => (
                <div key={item.key} className="flex items-start justify-between rounded-md border p-3 gap-4">
                  <div>
                    <p className="font-medium">{item.key}</p>
                    <p className="text-xs text-muted-foreground">Used by: {item.required_for.join(", ")}</p>
                  </div>
                  <StatusBadge ok={item.present} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tables</CardTitle>
        </CardHeader>
        <CardContent>
          {!health ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading..." : "No data yet."}</p>
          ) : (
            <div className="space-y-2">
              {health.checks.tables.map((item) => (
                <div key={item.table} className="flex items-start justify-between rounded-md border p-3 gap-4">
                  <div>
                    <p className="font-medium">{item.table}</p>
                    {!item.exists && item.error ? (
                      <p className="text-xs text-destructive">{item.error}</p>
                    ) : null}
                  </div>
                  <StatusBadge ok={item.exists} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Edge Functions</CardTitle>
        </CardHeader>
        <CardContent>
          {!health ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading..." : "No data yet."}</p>
          ) : (
            <div className="space-y-2">
              {health.checks.functions.map((item) => (
                <div key={item.name} className="flex items-start justify-between rounded-md border p-3 gap-4">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      HTTP status: {item.status ?? "n/a"} {item.error ? `- ${item.error}` : ""}
                    </p>
                  </div>
                  <StatusBadge ok={item.reachable} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSystemHealth;
