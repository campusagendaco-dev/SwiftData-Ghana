import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Users, ShoppingCart, DollarSign, ShieldCheck } from "lucide-react";

const AdminOverview = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, pendingAgents: 0 });
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We are performing scheduled maintenance. Please check back soon.");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [maintenanceTableReady, setMaintenanceTableReady] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const [ordersRes, profilesRes, maintenanceRes] = await Promise.all([
        supabase.from("orders").select("id, amount, status"),
        supabase.from("profiles").select("id, is_agent, agent_approved, onboarding_complete"),
        supabase.from("maintenance_settings" as any).select("is_enabled, message").eq("id", 1).maybeSingle(),
      ]);

      const orders = ordersRes.data || [];
      const profiles = profilesRes.data || [];
      const maintenanceRow = maintenanceRes.data as { is_enabled?: boolean; message?: string } | null;
      const maintenanceError = maintenanceRes.error;

      setStats({
        totalOrders: orders.length,
        totalRevenue: orders
          .filter((o: any) => o.status === "fulfilled")
          .reduce((sum: number, o: any) => sum + (o.amount || 0), 0),
        totalUsers: profiles.length,
        pendingAgents: profiles.filter((p: any) => p.is_agent && p.onboarding_complete && !p.agent_approved).length,
      });

      if (maintenanceError) {
        setMaintenanceTableReady(false);
      } else if (maintenanceRow) {
        setMaintenanceTableReady(true);
        setMaintenanceEnabled(!!maintenanceRow.is_enabled);
        setMaintenanceMessage(
          maintenanceRow.message?.trim() || "We are performing scheduled maintenance. Please check back soon.",
        );
      }

      setLoading(false);
    };
    fetchStats();
  }, []);

  const saveMaintenance = async () => {
    if (!maintenanceTableReady) {
      toast({
        title: "Maintenance table missing",
        description: "Run the latest Supabase migration to create public.maintenance_settings, then try again.",
        variant: "destructive",
      });
      return;
    }

    setSavingMaintenance(true);
    const { error } = await supabase
      .from("maintenance_settings" as any)
      .upsert({
        id: 1,
        is_enabled: maintenanceEnabled,
        message: maintenanceMessage.trim() || "We are performing scheduled maintenance. Please check back soon.",
        updated_at: new Date().toISOString(),
      });

    if (error) {
      const isMissingTable = error.message.toLowerCase().includes("maintenance_settings");
      toast({
        title: "Failed to save maintenance mode",
        description: isMissingTable
          ? "Table public.maintenance_settings is missing. Run the latest migration and refresh."
          : error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: maintenanceEnabled ? "Maintenance mode enabled" : "Maintenance mode disabled" });
    }
    setSavingMaintenance(false);
  };

  const cards = [
    { title: "Total Orders", value: stats.totalOrders, icon: ShoppingCart, color: "text-blue-400" },
    { title: "Revenue (GH₵)", value: `GH₵ ${stats.totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-green-400" },
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-purple-400" },
    { title: "Pending Agents", value: stats.pendingAgents, icon: ShieldCheck, color: "text-primary" },
  ];

  if (loading) {
    return <div className="text-muted-foreground">Loading stats...</div>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-6">Admin Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-bold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Site Maintenance Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!maintenanceTableReady && (
            <p className="text-sm text-destructive">
              Maintenance settings table is missing. Run your latest Supabase migration, then refresh this page.
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Enable maintenance mode</Label>
              <p className="text-xs text-muted-foreground">
                When enabled, non-admin visitors will see a maintenance page.
              </p>
            </div>
            <Switch checked={maintenanceEnabled} onCheckedChange={setMaintenanceEnabled} />
          </div>

          <div>
            <Label htmlFor="maintenance-message">Maintenance message</Label>
            <Textarea
              id="maintenance-message"
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              className="mt-1 bg-secondary min-h-[90px]"
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
