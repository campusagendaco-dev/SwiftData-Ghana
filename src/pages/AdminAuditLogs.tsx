import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileSearch, ShieldAlert, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface AuditLog {
  id: string;
  action: string;
  details: any;
  created_at: string;
  profiles: { full_name: string } | null;
}

const AdminAuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch the raw audit logs
      const { data: logData, error: logError } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (logError) throw logError;

      if (logData && logData.length > 0) {
        // 2. Get unique admin IDs to fetch their names
        const adminIds = [...new Set(logData.map(l => l.admin_id).filter(Boolean))];
        
        let profileMap: Record<string, string> = {};
        if (adminIds.length > 0) {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", adminIds);
          
          if (profileData) {
            profileMap = profileData.reduce((acc, curr) => ({
              ...acc,
              [curr.user_id]: curr.full_name
            }), {});
          }
        }

        // 3. Map the names back to the logs
        const enrichedLogs = logData.map(log => ({
          ...log,
          profiles: log.admin_id ? { full_name: profileMap[log.admin_id] || "Unknown Admin" } : null
        }));

        setLogs(enrichedLogs as any[]);
      } else {
        setLogs([]);
      }
    } catch (err: any) {
      console.error("Fetch logs error:", err);
      setError(err.message || "Could not load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatAction = (action: string) => {
    return action.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  };

  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Track all administrative actions for security and compliance.</p>
        </div>
        <button 
          onClick={fetchLogs} 
          disabled={loading}
          className="flex items-center gap-2 text-xs font-semibold bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg transition-colors border border-white/10"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSearch className="w-3 h-3" />}
          Refresh Logs
        </button>
      </div>

      {error && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="p-4 text-red-500 text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Error: {error}
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-4">
          <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-500">Security Notice</p>
            <p className="text-xs text-muted-foreground mt-1 text-pretty">
              Audit logs are **immutable and permanent**. They record every sensitive action taken by administrators to ensure accountability and platform integrity.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest administrative actions across the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <FileSearch className="w-8 h-8 text-muted-foreground opacity-30" />
              </div>
              <p className="text-base font-semibold text-white/80">Audit Log is Empty</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                No administrative actions have been recorded yet. The system will automatically log actions like price updates, wallet top-ups, and user management.
              </p>
              <button 
                onClick={fetchLogs}
                className="mt-6 text-xs text-amber-400 hover:underline font-medium"
              >
                Check again
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-white/5 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white/5 hover:bg-white/5 border-white/5">
                    <TableHead className="w-[180px] text-white/50 uppercase text-[10px] font-black tracking-widest">Timestamp</TableHead>
                    <TableHead className="text-white/50 uppercase text-[10px] font-black tracking-widest">Admin</TableHead>
                    <TableHead className="text-white/50 uppercase text-[10px] font-black tracking-widest">Action</TableHead>
                    <TableHead className="text-white/50 uppercase text-[10px] font-black tracking-widest">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} className="border-white/5 hover:bg-white/[0.02] transition-colors">
                      <TableCell className="text-[11px] text-muted-foreground font-mono">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-semibold text-sm text-white/90">
                        {log.profiles?.full_name || "System"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px] bg-amber-400/5 text-amber-400 border-amber-400/20">
                          {formatAction(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[300px] truncate group hover:text-white transition-colors cursor-help">
                        {JSON.stringify(log.details)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAuditLogs;
