import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users, ShoppingCart, DollarSign, ShieldCheck,
  Package, Bell, Wallet, ArrowUpRight, RefreshCw,
  CheckCircle2, Clock, XCircle,
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
  if (s === "fulfilled") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (s === "fulfillment_failed") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
  return <Clock className="w-3.5 h-3.5 text-amber-500" />;
};

const AdminOverview = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, pendingAgents: 0, swiftDataSubAgentShare: 0 });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We are performing scheduled maintenance. Please check back soon.");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [maintenanceTableReady, setMaintenanceTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [approvingPending, setApprovingPending] = useState(false);

  const fetchData = async () => {
    const [ordersRes, profilesRes, maintenanceRes, recentRes] = await Promise.all([
      supabase.from("orders").select("id, amount, status, order_type"),
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
    { title: "Total Orders", value: stats.totalOrders, icon: ShoppingCart, color: "text-blue-400" },
    { title: "Revenue (GH₵)", value: `GH₵ ${stats.totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-green-400" },
    { title: "SwiftData Share", value: `GH₵ ${stats.swiftDataSubAgentShare.toFixed(2)}`, icon: DollarSign, color: "text-amber-500" },
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-purple-400" },
    { title: "Pending Agents", value: stats.pendingAgents, icon: ShieldCheck, color: stats.pendingAgents > 0 ? "text-red-400" : "text-primary" },
  ];

  if (loading) return <div className="text-muted-foreground p-4">Loading stats...</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Admin Overview</h1>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map((card) => (
          <Card key={card.title} className="hover:border-primary/30 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground leading-tight">{card.title}</CardTitle>
              <card.icon className={`w-4 h-4 shrink-0 ${card.color}`} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="font-display text-xl font-bold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Manage Agents", icon: Users, path: "/admin/agents" },
            { label: "All Orders", icon: ShoppingCart, path: "/admin/orders" },
            { label: "Packages", icon: Package, path: "/admin/packages" },
            { label: "Notifications", icon: Bell, path: "/admin/notifications" },
            { label: "Withdrawals", icon: Wallet, path: "/admin/withdrawals" },
            { label: "Wallet Top-ups", icon: ArrowUpRight, path: "/admin/wallet-topup" },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 text-sm font-medium hover:border-primary/40 transition-colors text-left"
            >
              <a.icon className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate">{a.label}</span>
            </button>
          ))}
          {stats.pendingAgents > 0 && (
            <button
              onClick={approveAllPending}
              disabled={approvingPending}
              className="flex items-center gap-2.5 rounded-xl border border-green-500/40 bg-green-500/5 p-3 text-sm font-medium hover:border-green-500/70 transition-colors text-left col-span-2 sm:col-span-2"
            >
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span>{approvingPending ? "Approving..." : `Approve all ${stats.pendingAgents} pending agent${stats.pendingAgents !== 1 ? "s" : ""}`}</span>
            </button>
          )}
        </div>
      </div>

      {/* Order tracker */}
      <div>
        <PhoneOrderTracker
          title="Order Tracking (Phone Lookup)"
          subtitle="Check payment and delivery status by customer phone number."
        />
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Orders</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/orders")} className="text-xs gap-1">
            View all <ArrowUpRight className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentOrders.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No orders yet.</p>
            ) : recentOrders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/40 border border-border">
                <div className="shrink-0">{statusIcon(o.status)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {o.network && o.package_size ? `${o.network} ${o.package_size}` : "Order"}
                    {o.customer_phone && <span className="text-muted-foreground font-normal"> → {o.customer_phone}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">GH₵{Number(o.amount).toFixed(2)}</p>
                  <Badge variant={o.status === "fulfilled" ? "default" : o.status === "fulfillment_failed" ? "destructive" : "secondary"} className="text-[10px] h-4">
                    {o.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Maintenance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Site Maintenance Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!maintenanceTableReady && (
            <p className="text-sm text-destructive">Maintenance settings table missing. Run the latest Supabase migration and refresh.</p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Enable maintenance mode</Label>
              <p className="text-xs text-muted-foreground">Non-admin visitors see a maintenance page.</p>
            </div>
            <Switch checked={maintenanceEnabled} onCheckedChange={setMaintenanceEnabled} />
          </div>
          <div>
            <Label htmlFor="maintenance-message">Maintenance message</Label>
            <Textarea
              id="maintenance-message"
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              className="mt-1 bg-secondary min-h-[80px]"
              placeholder="Write a short message shown to visitors..."
            />
          </div>
          <Button onClick={saveMaintenance} disabled={savingMaintenance}>
            {savingMaintenance ? "Saving..." : "Save Maintenance Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminOverview;
