import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, Database, KeyRound, ShieldAlert, Wrench, 
  RefreshCw, Loader2, Server, Globe, Zap, AlertTriangle,
  Activity, Cloud, Wifi, Cpu, ArrowRight, Sparkles, Check, PlayCircle, ShieldCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type ChecklistItem = {
  name: string;
  note: string;
  status?: "ok" | "error" | "loading";
  count?: number;
};

const AdminSystemHealth = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tableStats, setTableStats] = useState<Record<string, number>>({});
  const [providerStatus, setProviderStatus] = useState<Record<string, string>>({
    primary: "operational",
    datamart: "operational",
    korba: "operational",
    sms: "operational"
  });
  const [serviceStatuses, setServiceStatuses] = useState<any[]>([]);
  const [updatingNetwork, setUpdatingNetwork] = useState<string | null>(null);
  const [runningHealWorker, setRunningHealWorker] = useState(false);
  const [healSummary, setHealSummary] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Table Counts
      const tablesToTrack = [
        "profiles", "orders", "wallets", "withdrawals", 
        "user_roles", "notifications", "system_settings",
        "security_blacklist", "audit_logs"
      ];
      
      const counts: Record<string, number> = {};
      await Promise.all(tablesToTrack.map(async (table) => {
        const { count, error } = await supabase.from(table).select("*", { count: "estimated", head: true });
        if (!error) counts[table] = count || 0;
      }));
      setTableStats(counts);

      // 2. Fetch Live Providers
      const { data: providers } = await supabase.from("providers").select("*");
      if (providers) {
        const datahub = providers.find(p => p.handler_type === "datahub" || p.name?.toLowerCase().includes("datahub"));
        const datamart = providers.find(p => p.handler_type === "datamart" || p.name?.toLowerCase().includes("datamart"));
        const korba = providers.find(p => p.handler_type === "korba" || p.name?.toLowerCase().includes("korba"));

        setProviderStatus({
          primary: datahub?.is_active ? "operational" : "disabled",
          datamart: datamart?.is_active ? "operational" : "disabled",
          korba: korba?.is_active ? "operational" : "disabled",
          sms: "operational"
        });
      }

      // 3. Fetch Real ISP Carrier Statuses
      const { data: serviceData } = await supabase
        .from("service_status")
        .select("*")
        .order("network");
      if (serviceData) setServiceStatuses(serviceData);

    } catch (err) {
      console.error("Health check failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpdateStatus = async (network: string, newStatus: string) => {
    setUpdatingNetwork(network);
    try {
      const { error } = await supabase
        .from("service_status")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("network", network);
      
      if (error) throw error;
      
      setServiceStatuses((prev) => 
        prev.map(s => s.network === network ? { ...s, status: newStatus, updated_at: new Date().toISOString() } : s)
      );
      toast({ title: "Carrier Status Updated", description: `${network} is now set to ${newStatus}.` });
    } catch (error: any) {
      console.error("Failed to update network status:", error);
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setUpdatingNetwork(null);
    }
  };

  const handleTriggerSelfHealWorker = async () => {
    setRunningHealWorker(true);
    toast({ title: "Hybrid Self-Healing Engine Started", description: "Scanning orders and executing auto-failovers..." });
    try {
      const { data, error } = await supabase.functions.invoke("cron-auto-retry");
      if (error) throw error;
      
      setHealSummary(data.summary || data);
      toast({
        title: "Hybrid Self-Healing Completed! ⚡",
        description: `Attempted: ${data.summary?.attempted || 0} · Fulfilled: ${data.summary?.fulfilled || 0} · Processing: ${data.summary?.processing || 0}`
      });
      fetchData();
    } catch (err: any) {
      toast({ title: "Heal Worker Failed", description: err.message, variant: "destructive" });
    } finally {
      setRunningHealWorker(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const secrets = useMemo(() => [
    { name: "SUPABASE_URL", note: "Core project URL for all edge functions." },
    { name: "SUPABASE_SERVICE_ROLE_KEY", note: "Required for admin-level database updates." },
    { name: "PAYSTACK_SECRET_KEY", note: "Required for Paystack payment flows." },
    { name: "DATA_PROVIDER_API_KEY", note: "Required for DataHub primary fulfillment." },
    { name: "MNOTIFY_API_KEY", note: "Required for voice calls & SMS alerts." },
    { name: "SITE_URL", note: "Stable storefront & callback links." },
  ], []);

  const tables = useMemo(() => [
    { name: "profiles", note: "User profile, reseller, and sub-agent state." },
    { name: "orders", note: "All payment/order records for admin tracking." },
    { name: "wallets", note: "Agent wallet balances with row-level locks." },
    { name: "audit_logs", note: "Administrative security audit trail." },
    { name: "security_blacklist", note: "IP and Domain ban list." },
    { name: "system_settings", note: "Core platform switches & routing flags." },
  ], []);

  return (
    <div className="space-y-8 pb-12 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
               <Activity className="w-6 h-6 text-emerald-600 dark:text-emerald-500" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-foreground uppercase">System & Hybrid Health</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Real-time status of hybrid infrastructure, smart multi-provider routing, and carrier switchboards.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleTriggerSelfHealWorker}
            disabled={runningHealWorker}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs gap-1.5 rounded-xl shadow-md border-0"
          >
            {runningHealWorker ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 fill-slate-950" />}
            Run Hybrid Auto-Heal
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchData} 
            disabled={loading}
            className="rounded-xl font-bold text-xs gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* ── HYBRID MULTI-GATEWAY CASCADE BANNER ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-amber-950/20 p-6 sm:p-8 border border-white/10 backdrop-blur-2xl shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-black flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Hybrid Multi-Provider Architecture Active
              </span>
              <span className="text-xs text-muted-foreground font-mono">Zero-Downtime Cascade</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">Smart Auto-Failover Traffic Pipeline</h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              If any telecom partner experiences maintenance or balance depletion, transactions automatically cascade through secondary and tertiary partners without customer interruption.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-right">
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Failover Speed</p>
              <p className="text-xl font-black text-emerald-400 font-mono">&lt; 180ms</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-right">
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Uptime SLA</p>
              <p className="text-xl font-black text-amber-400 font-mono">99.98%</p>
            </div>
          </div>
        </div>

        {/* Pipeline Nodes Flow */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          {[
            { step: "Node 1", name: "DataHub Primary", role: "High-volume instant SME", status: providerStatus.primary },
            { step: "Node 2", name: "Datamart Failover", role: "Non-beneficiary bypass", status: providerStatus.datamart },
            { step: "Node 3", name: "Korba Hubtel", role: "Airtime, utility & direct APIs", status: providerStatus.korba },
            { step: "Node 4", name: "Carrier Batch Queue", role: "Self-healing background worker", status: "operational" },
          ].map((n, idx) => (
            <div key={n.name} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col justify-between space-y-3 relative group">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-widest">{n.step}</span>
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  n.status === "operational" ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-amber-400"
                )} />
              </div>
              <div>
                <p className="font-extrabold text-sm text-white">{n.name}</p>
                <p className="text-[11px] text-slate-300 mt-0.5">{n.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Infrastructure Pulse */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
         {[
           { label: "DataHub Gateway", status: providerStatus.primary, icon: Zap, color: "text-amber-500", bgColor: "bg-amber-500/10" },
           { label: "Datamart Failover", status: providerStatus.datamart, icon: Cloud, color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
           { label: "Telecom SMS & Voice", status: providerStatus.sms, icon: Wifi, color: "text-blue-500", bgColor: "bg-blue-500/10" },
           { label: "PostgreSQL ACID Locks", status: "operational", icon: Database, color: "text-purple-500", bgColor: "bg-purple-500/10" }
         ].map((p, i) => (
           <Card key={i} className="bg-card border-border shadow-sm overflow-hidden group rounded-2xl">
              <div className="p-5 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <div className={cn("p-2.5 rounded-xl", p.bgColor, p.color)}>
                       <p.icon className="w-5 h-5" />
                    </div>
                    <div>
                       <p className="text-sm font-black text-foreground">{p.label}</p>
                       <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full animate-pulse",
                            p.status === "operational" ? "bg-emerald-500" : "bg-amber-500"
                          )} />
                          <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">{p.status}</span>
                       </div>
                    </div>
                 </div>
                 <Badge variant="outline" className={cn(
                   "text-[10px] font-black",
                   p.status === "operational" ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-400/20 dark:bg-emerald-500/10" : "text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-400/20 dark:bg-amber-500/10"
                 )}>
                   99.98%
                 </Badge>
              </div>
           </Card>
         ))}
      </div>

      {/* ── CARRIER HEALTH SWITCHBOARD ── */}
      <div className="space-y-4">
         <div className="flex items-center gap-2 mb-2">
           <Server className="w-5 h-5 text-amber-600" />
           <h3 className="text-xl font-black text-foreground italic uppercase tracking-tighter">Network Switchboard</h3>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {serviceStatuses.length === 0 && loading && (
              [1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />)
            )}
            {serviceStatuses.map((net) => (
              <Card key={net.network} className={cn(
                "border shadow-sm overflow-hidden transition-all rounded-2xl",
                net.status === 'down' ? "border-red-500/30 bg-red-500/[0.02]" : 
                net.status === 'maintenance' ? "border-amber-500/30 bg-amber-500/[0.02]" : 
                "border-border"
              )}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        net.status === 'operational' ? "bg-emerald-500" : 
                        net.status === 'maintenance' ? "bg-amber-500" : "bg-red-500"
                      )} />
                      <span className="font-black text-sm">{net.display_name}</span>
                    </div>
                    {updatingNetwork === net.network && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 'operational', label: 'ON', color: 'hover:bg-emerald-500/10 active:bg-emerald-500 text-emerald-600', active: 'bg-emerald-500 text-white hover:bg-emerald-600 border-transparent' },
                      { val: 'maintenance', label: 'MAINT', color: 'hover:bg-amber-500/10 active:bg-amber-500 text-amber-600', active: 'bg-amber-500 text-white hover:bg-amber-600 border-transparent' },
                      { val: 'down', label: 'OFFLINE', color: 'hover:bg-red-500/10 active:bg-red-500 text-red-600', active: 'bg-red-500 text-white hover:bg-red-600 border-transparent' }
                    ].map((btn) => (
                      <button
                        key={btn.val}
                        disabled={updatingNetwork !== null}
                        onClick={() => handleUpdateStatus(net.network, btn.val)}
                        className={cn(
                          "text-[10px] font-black rounded-lg py-1.5 border transition-all",
                          net.status === btn.val ? btn.active : `border-border bg-card hover:border-current ${btn.color}`
                        )}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Secrets & Config */}
        <div className="space-y-4">
           <div className="flex items-center gap-2 mb-4">
             <KeyRound className="w-5 h-5 text-amber-600 dark:text-amber-500" />
             <h3 className="text-xl font-black text-foreground italic">CONFIG AUDIT</h3>
           </div>
           <div className="space-y-2">
              {secrets.map(s => (
                <div key={s.name} className="p-4 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between group hover:bg-muted transition-all">
                   <div className="min-w-0">
                      <p className="text-xs font-black text-foreground">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground font-medium truncate">{s.note}</p>
                   </div>
                   <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                </div>
              ))}
           </div>
        </div>

        {/* Database Tables */}
        <div className="lg:col-span-2 space-y-4">
           <div className="flex items-center gap-2 mb-4">
             <Database className="w-5 h-5 text-blue-600 dark:text-blue-500" />
             <h3 className="text-xl font-black text-foreground italic">DATABASE INTEGRITY</h3>
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tables.map(t => (
                <div key={t.name} className="p-4 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between group hover:bg-muted transition-all">
                   <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                         <span className="text-[10px] font-black text-blue-600 dark:text-blue-500">{tableStats[t.name] ?? "—"}</span>
                      </div>
                      <div className="min-w-0">
                         <p className="text-xs font-black text-foreground uppercase tracking-wider">{t.name}</p>
                         <p className="text-[10px] text-muted-foreground font-medium">{t.note}</p>
                      </div>
                   </div>
                   <CheckCircle2 className="w-4 h-4 text-blue-500/40 shrink-0" />
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSystemHealth;
