import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users, ShoppingCart, DollarSign, ShieldCheck,
  Package, Wallet, ArrowUpRight, RefreshCw,
  CheckCircle2, Clock, XCircle, Activity, ChevronRight
} from "lucide-react";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

interface RecentOrder {
  id: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  status: string;
  created_at: string;
}

const statusIcon = (s: string) => {
  if (s === "fulfilled") return <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20"><CheckCircle2 className="w-4 h-4 text-green-500" /></div>;
  if (s === "fulfillment_failed") return <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20"><XCircle className="w-4 h-4 text-red-500" /></div>;
  return <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20"><Clock className="w-4 h-4 text-amber-500" /></div>;
};

const AdminOverview = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, pendingAgents: 0, swiftDataSubAgentShare: 0, totalAgentProfit: 0, totalSubAgentProfit: 0 });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We are performing scheduled maintenance. Please check back soon.");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [maintenanceTableReady, setMaintenanceTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [approvingPending, setApprovingPending] = useState(false);

  const fetchData = async () => {
    const [ordersRes, profilesRes, maintenanceRes, recentRes] = await Promise.all([
      supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit"),
      supabase.from("profiles").select("id, is_agent, agent_approved, onboarding_complete"),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase
        .from("orders")
        .select("id, network, package_size, customer_phone, amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const orders = ordersRes.data || [];
    const profiles = profilesRes.data || [];
    const maintenanceRow = maintenanceRes.data as { is_enabled?: boolean; message?: string; table_ready?: boolean; error?: string } | null;
    const maintenanceError = maintenanceRes.error || maintenanceRow?.error;

    setStats({
      totalOrders: orders.length,
      totalRevenue: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + (o.amount || 0), 0),
      totalUsers: profiles.length,
      pendingAgents: profiles.filter((p: any) => p.is_agent && p.onboarding_complete && !p.agent_approved).length,
      swiftDataSubAgentShare: orders
        .filter((o: any) => o.status === "fulfilled" && o.order_type === "sub_agent_activation")
        .reduce((s: number, o: any) => s + (Number(o.amount || 0) * 0.5), 0),
      totalAgentProfit: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + Number(o.profit || 0), 0),
      totalSubAgentProfit: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + Number(o.parent_profit || 0), 0),
    });

    setRecentOrders((recentRes.data || []) as RecentOrder[]);

    if (maintenanceError) {
      setMaintenanceTableReady(false);
    } else if (maintenanceRow) {
      setMaintenanceTableReady(Boolean(maintenanceRow.table_ready ?? true));
      setMaintenanceEnabled(!!maintenanceRow.is_enabled);
      setMaintenanceMessage(maintenanceRow.message?.trim() || "We are performing scheduled maintenance. Please check back soon.");
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const saveMaintenance = async () => {
    if (!maintenanceTableReady) {
      toast({ title: "Maintenance table missing", description: "Run the latest Supabase migration.", variant: "destructive" });
      return;
    }
    setSavingMaintenance(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast({ title: "Not authenticated", variant: "destructive" });
      setSavingMaintenance(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("maintenance-mode", {
      body: { action: "set", is_enabled: maintenanceEnabled, message: maintenanceMessage.trim() || "We are performing scheduled maintenance. Please check back soon." },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error || data?.error) {
      toast({ title: "Failed to save maintenance mode", description: (data?.error as string) || error?.message, variant: "destructive" });
    } else {
      toast({ title: maintenanceEnabled ? "Maintenance mode enabled" : "Maintenance mode disabled" });
    }
    setSavingMaintenance(false);
  };

  const approveAllPending = async () => {
    setApprovingPending(true);
    const { data: pending } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("is_agent", true)
      .eq("onboarding_complete", true)
      .eq("agent_approved", false);

    if (!pending || pending.length === 0) {
      toast({ title: "No pending agents to approve" });
      setApprovingPending(false);
      return;
    }

    const ids = pending.map((p: any) => p.user_id);
    const { error } = await supabase.from("profiles").update({ agent_approved: true }).in("user_id", ids);
    if (error) {
      toast({ title: "Failed to approve agents", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Approved ${ids.length} agent${ids.length !== 1 ? "s" : ""}` });
      await fetchData();
    }
    setApprovingPending(false);
  };

  const statCards = [
    { title: "Total Revenue", value: `GH₵ ${stats.totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
    { title: "Agent Profits", value: `GH₵ ${(stats.totalAgentProfit + stats.totalSubAgentProfit).toFixed(2)}`, icon: DollarSign, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
    { title: "Platform Share", value: `GH₵ ${stats.swiftDataSubAgentShare.toFixed(2)}`, icon: Activity, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
    { title: "Active Users", value: stats.totalUsers.toLocaleString(), icon: Users, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    { title: "Pending Agents", value: stats.pendingAgents, icon: ShieldCheck, color: stats.pendingAgents > 0 ? "text-red-400" : "text-emerald-400", bg: stats.pendingAgents > 0 ? "bg-red-500/10" : "bg-emerald-500/10", border: stats.pendingAgents > 0 ? "border-red-500/20" : "border-emerald-500/20" },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-white/60 font-medium tracking-widest uppercase text-xs">Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Overview
          </h1>
          <p className="text-sm text-white/50 mt-1">Monitor platform metrics and recent activities.</p>
        </div>
        <Button onClick={fetchData} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 shadow-lg rounded-xl transition-all">
          <RefreshCw className="w-4 h-4" /> Refresh Data
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((card) => (
          <div key={card.title} className="relative group p-5 rounded-2xl bg-white/[0.02] border border-white/5 shadow-xl overflow-hidden hover:bg-white/[0.04] transition-all">
            <div className={`absolute top-0 right-0 w-24 h-24 ${card.bg} blur-2xl -mr-10 -mt-10 rounded-full transition-transform group-hover:scale-150`} />
            <div className="relative z-10 flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">{card.title}</p>
              <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.border} border flex items-center justify-center`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <div className="relative z-10">
              <p className="font-display text-2xl font-black text-white tracking-tight">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">
          {/* Recent orders */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
              <div>
                <h3 className="font-bold text-lg text-white tracking-tight">Recent Transactions</h3>
                <p className="text-xs text-white/40 mt-1">The latest 8 orders on the platform.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin/orders")} className="text-xs gap-1 hover:text-amber-400 hover:bg-amber-400/10 transition-colors">
                View All <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="p-2">
              {recentOrders.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-8 h-8 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40 text-sm">No recent orders found.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentOrders.map((o) => (
                    <div key={o.id} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                      <div className="flex items-center gap-4">
                        {statusIcon(o.status)}
                        <div>
                          <p className="text-sm font-bold text-white/90">
                            {o.network && o.package_size ? `${o.network} ${o.package_size}` : "General Order"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs font-mono text-white/50">{o.customer_phone || "No phone"}</span>
                            <span className="w-1 h-1 rounded-full bg-white/20" />
                            <span className="text-xs text-white/40">{new Date(o.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 w-full sm:w-auto">
                        <p className="text-sm font-black text-amber-400">GH₵{Number(o.amount).toFixed(2)}</p>
                        <Badge 
                          variant="outline" 
                          className={`text-[9px] uppercase tracking-wider font-bold border ${o.status === 'fulfilled' ? 'bg-green-500/10 text-green-400 border-green-500/20' : o.status === 'fulfillment_failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}
                        >
                          {o.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Order tracker */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-2xl p-6">
            <PhoneOrderTracker
              title="Manual Order Tracker"
              subtitle="Quickly lookup the status of any order using the customer's phone number."
            />
          </div>
        </div>

        <div className="space-y-8">
          {/* Quick actions */}
          <div className="rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/5 shadow-2xl p-6">
            <h3 className="font-bold text-lg text-white tracking-tight mb-1">Quick Tools</h3>
            <p className="text-xs text-white/40 mb-6">Access frequent admin functions.</p>
            
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Agents", icon: Users, path: "/admin/agents", color: "text-blue-400", bg: "bg-blue-400/10" },
                { label: "Orders", icon: ShoppingCart, path: "/admin/orders", color: "text-emerald-400", bg: "bg-emerald-400/10" },
                { label: "Packages", icon: Package, path: "/admin/packages", color: "text-purple-400", bg: "bg-purple-400/10" },
                { label: "Withdrawals", icon: Wallet, path: "/admin/withdrawals", color: "text-amber-400", bg: "bg-amber-400/10" },
              ].map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.path)}
                  className="group flex flex-col items-center justify-center p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/10 transition-all gap-3"
                >
                  <div className={`w-10 h-10 rounded-full ${a.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <a.icon className={`w-5 h-5 ${a.color}`} />
                  </div>
                  <span className="text-xs font-semibold text-white/70 group-hover:text-white transition-colors">{a.label}</span>
                </button>
              ))}
            </div>

            {stats.pendingAgents > 0 && (
              <button
                onClick={approveAllPending}
                disabled={approvingPending}
                className="w-full mt-4 group flex items-center justify-between p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-amber-400">Action Required</p>
                    <p className="text-[10px] text-amber-400/70">{stats.pendingAgents} agent{stats.pendingAgents !== 1 ? 's' : ''} awaiting approval</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-400/50 group-hover:translate-x-1 transition-transform" />
              </button>
            )}
          </div>

          {/* Maintenance */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-2xl overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 ${maintenanceEnabled ? 'bg-red-500' : 'bg-green-500'}`} />
            <div className="p-6">
              <h3 className="font-bold text-lg text-white tracking-tight mb-1">System Status</h3>
              <p className="text-xs text-white/40 mb-6">Manage platform accessibility.</p>
              
              {!maintenanceTableReady && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400 font-medium">Database migration required for maintenance mode.</p>
                </div>
              )}
              
              <div className="space-y-5">
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                  <div>
                    <Label className="text-sm font-bold text-white/90">Maintenance Mode</Label>
                    <p className="text-[10px] text-white/40 mt-0.5">Restrict access to admins only</p>
                  </div>
                  <Switch checked={maintenanceEnabled} onCheckedChange={setMaintenanceEnabled} className="data-[state=checked]:bg-red-500" />
                </div>
                
                <div>
                  <Label htmlFor="maintenance-message" className="text-xs font-semibold text-white/60 mb-2 block">Display Message</Label>
                  <Textarea
                    id="maintenance-message"
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 resize-none rounded-xl text-sm focus:border-amber-400/50 focus:ring-amber-400/20"
                    placeholder="Enter message for visitors..."
                    rows={3}
                  />
                </div>
                
                <Button 
                  onClick={saveMaintenance} 
                  disabled={savingMaintenance}
                  className="w-full bg-white text-black hover:bg-white/90 font-bold rounded-xl h-11"
                >
                  {savingMaintenance ? "Saving..." : "Apply Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
