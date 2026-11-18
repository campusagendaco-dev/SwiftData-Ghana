import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Shield,
  CreditCard,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Ban,
  Snowflake,
  Settings2,
  Play,
} from "lucide-react";

const GATEWAY_BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/gateway-collect";

interface AdminGatewayMerchant {
  id: string;
  user_id: string;
  business_name: string;
  website_url: string;
  status: "pending" | "active" | "suspended" | "revoked";
  secret_key_prefix: string | null;
  require_hmac: boolean;
  allowed_domains: string[];
  allowed_ips: string[];
  webhook_url: string | null;
  allowed_channels: string[];
  settlement_wallet: "api" | "main";
  settlement_hold_hours: number;
  settlement_frozen: boolean;
  max_tx_amount: number;
  daily_limit: number;
  monthly_limit: number;
  rate_limit_per_min: number;
  fee_percent: number | null;
  platform_fee_percent: number;
  created_at: string;
}

interface AdminCollectionRow {
  id: string;
  merchant_id: string;
  reference: string;
  client_reference: string;
  base_amount: number;
  customer_fee: number;
  total_charged: number;
  net_settlement: number;
  channel: string | null;
  status: string;
  failure_reason: string | null;
  settle_after: string | null;
  settled_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  settled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paid: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  suspended: "bg-red-500/15 text-red-400 border-red-500/30",
  revoked: "bg-red-500/15 text-red-400 border-red-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  disputed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

export default function AdminPaymentGateway() {
  const { user, session } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState<AdminGatewayMerchant[]>([]);
  const [collections, setCollections] = useState<AdminCollectionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sweeping, setSweeping] = useState(false);

  // Edit modal state
  const [editing, setEditing] = useState<AdminGatewayMerchant | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, cRes] = await Promise.all([
        (supabase as any)
          .from("gateway_merchants")
          .select(
            "id, user_id, business_name, website_url, status, secret_key_prefix, require_hmac, allowed_domains, allowed_ips, webhook_url, allowed_channels, settlement_wallet, settlement_hold_hours, settlement_frozen, max_tx_amount, daily_limit, monthly_limit, rate_limit_per_min, fee_percent, platform_fee_percent, created_at",
          )
          .order("created_at", { ascending: false }),
        (supabase as any)
          .from("gateway_collections")
          .select(
            "id, merchant_id, reference, client_reference, base_amount, customer_fee, total_charged, net_settlement, channel, status, failure_reason, settle_after, settled_at, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setMerchants(mRes.data || []);
      setCollections(cRes.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const updateMerchantStatus = async (m: AdminGatewayMerchant, nextStatus: AdminGatewayMerchant["status"]) => {
    try {
      const patch: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "active") {
        patch.approved_at = new Date().toISOString();
        patch.approved_by = user?.id || null;
      }
      const { error } = await (supabase as any).from("gateway_merchants").update(patch).eq("id", m.id);
      if (error) throw error;
      toast({ title: "Merchant updated", description: `${m.business_name} is now ${nextStatus}.` });
      await loadAll();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const toggleFreeze = async (m: AdminGatewayMerchant) => {
    try {
      const { error } = await (supabase as any)
        .from("gateway_merchants")
        .update({ settlement_frozen: !m.settlement_frozen })
        .eq("id", m.id);
      if (error) throw error;
      toast({
        title: m.settlement_frozen ? "Settlements Unfrozen" : "Settlements Frozen",
        description: m.business_name,
      });
      await loadAll();
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const { error } = await (supabase as any)
        .from("gateway_merchants")
        .update({
          settlement_wallet: editing.settlement_wallet,
          settlement_hold_hours: Number(editing.settlement_hold_hours),
          max_tx_amount: Number(editing.max_tx_amount),
          daily_limit: Number(editing.daily_limit),
          monthly_limit: Number(editing.monthly_limit),
          rate_limit_per_min: Number(editing.rate_limit_per_min),
          platform_fee_percent: Number(editing.platform_fee_percent),
          allowed_channels: editing.allowed_channels,
          require_hmac: editing.require_hmac,
        })
        .eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Risk & settlement settings saved" });
      setEditing(null);
      await loadAll();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleManualSweep = async () => {
    if (!session?.access_token) return;
    setSweeping(true);
    try {
      const res = await fetch(`${GATEWAY_BASE_URL}/v1/admin/sweep`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Sweep failed");
      toast({
        title: "Settlement & Webhook Sweep Complete",
        description: `Settled: ${data.data?.settlement_sweep?.settled_count ?? 0} | Webhooks retried: ${data.data?.webhooks_retried ?? 0}`,
      });
      await loadAll();
    } catch (err: any) {
      toast({ title: "Sweep failed", description: err.message, variant: "destructive" });
    } finally {
      setSweeping(false);
    }
  };

  const filteredMerchants = merchants.filter((m) => statusFilter === "all" || m.status === statusFilter);
  const merchantNameById = Object.fromEntries(merchants.map((m) => [m.id, m.business_name]));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" />
            Payment Gateway Merchants
          </h1>
          <p className="text-sm text-muted-foreground">
            Approve external site merchants, enforce risk caps, control settlement holds, and monitor disputes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleManualSweep} disabled={sweeping}>
            {sweeping ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Run Settlement Sweep
          </Button>
          <Button variant="outline" size="sm" onClick={loadAll}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="merchants" className="space-y-4">
        <TabsList>
          <TabsTrigger value="merchants">Merchants ({merchants.length})</TabsTrigger>
          <TabsTrigger value="collections">Recent Collections ({collections.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="merchants" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {["all", "pending", "active", "suspended", "revoked"].map((st) => (
              <Button
                key={st}
                size="sm"
                variant={statusFilter === st ? "default" : "outline"}
                onClick={() => setStatusFilter(st)}
              >
                {st.toUpperCase()}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business / Website</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Settlement</TableHead>
                    <TableHead>Limits (Tx / Day / Mo)</TableHead>
                    <TableHead>Channels</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMerchants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No gateway merchants found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMerchants.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-semibold text-sm">{m.business_name}</p>
                          <p className="text-xs text-muted-foreground">{m.website_url}</p>
                          {m.settlement_frozen && (
                            <Badge variant="outline" className="mt-1 bg-rose-500/15 text-rose-400 border-rose-500/30 text-[10px]">
                              SETTLEMENT FROZEN
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_BADGE[m.status] || ""}>
                            {m.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="uppercase font-semibold">{m.settlement_wallet}</span> ({m.settlement_hold_hours}h hold)
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {Number(m.max_tx_amount).toLocaleString()} / {Number(m.daily_limit).toLocaleString()} /{" "}
                          {Number(m.monthly_limit).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{(m.allowed_channels || []).join(", ")}</TableCell>
                        <TableCell className="text-right space-x-1 whitespace-nowrap">
                          {m.status !== "active" && (
                            <Button size="sm" variant="default" onClick={() => updateMerchantStatus(m, "active")}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                            </Button>
                          )}
                          {m.status === "active" && (
                            <Button size="sm" variant="destructive" onClick={() => updateMerchantStatus(m, "suspended")}>
                              <Ban className="w-3.5 h-3.5 mr-1" /> Suspend
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => toggleFreeze(m)}>
                            <Snowflake className="w-3.5 h-3.5 mr-1" />
                            {m.settlement_frozen ? "Unfreeze" : "Freeze"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing({ ...m })}>
                            <Settings2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collections">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Base / Fee / Total</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No gateway collections recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    collections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium">
                          {merchantNameById[c.merchant_id] || c.merchant_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                        <TableCell className="text-xs">
                          GH₵ {Number(c.base_amount).toFixed(2)} + {Number(c.customer_fee).toFixed(2)} ={" "}
                          <strong>GH₵ {Number(c.total_charged).toFixed(2)}</strong>
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-emerald-400">
                          GH₵ {Number(c.net_settlement).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_BADGE[c.status] || ""}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Risk & Settlement Dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Risk & Settlement Policy
            </DialogTitle>
            <DialogDescription>{editing?.business_name}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Settlement Wallet</Label>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    value={editing.settlement_wallet}
                    onChange={(e) => setEditing({ ...editing, settlement_wallet: e.target.value as "api" | "main" })}
                  >
                    <option value="api">API Wallet (Spend-Only)</option>
                    <option value="main">Main Wallet (Withdrawable)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Settlement Hold (Hours)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={720}
                    value={editing.settlement_hold_hours}
                    onChange={(e) => setEditing({ ...editing, settlement_hold_hours: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Max Tx (GH₵)</Label>
                  <Input
                    type="number"
                    value={editing.max_tx_amount}
                    onChange={(e) => setEditing({ ...editing, max_tx_amount: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Daily Cap (GH₵)</Label>
                  <Input
                    type="number"
                    value={editing.daily_limit}
                    onChange={(e) => setEditing({ ...editing, daily_limit: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Monthly Cap (GH₵)</Label>
                  <Input
                    type="number"
                    value={editing.monthly_limit}
                    onChange={(e) => setEditing({ ...editing, monthly_limit: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Rate Limit (req/min)</Label>
                  <Input
                    type="number"
                    value={editing.rate_limit_per_min}
                    onChange={(e) => setEditing({ ...editing, rate_limit_per_min: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Platform Commission (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={20}
                    value={editing.platform_fee_percent}
                    onChange={(e) => setEditing({ ...editing, platform_fee_percent: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Require HMAC-SHA256 + Nonce</p>
                  <p className="text-xs text-muted-foreground">Strongly recommended for all merchants</p>
                </div>
                <Switch
                  checked={editing.require_hmac}
                  onCheckedChange={(v) => setEditing({ ...editing, require_hmac: v })}
                />
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Allow Card Payments</p>
                  <p className="text-xs text-muted-foreground">Higher chargeback risk — enable only for verified merchants</p>
                </div>
                <Switch
                  checked={(editing.allowed_channels || []).includes("card")}
                  onCheckedChange={(v) =>
                    setEditing({
                      ...editing,
                      allowed_channels: v ? ["mobile_money", "card"] : ["mobile_money"],
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
