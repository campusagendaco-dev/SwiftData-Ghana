import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Key,
  Globe,
  Webhook,
  Copy,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Code2,
  Send,
  CreditCard,
} from "lucide-react";

const GATEWAY_BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/gateway-collect";

interface GatewayMerchant {
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

interface GatewayCollection {
  id: string;
  reference: string;
  client_reference: string;
  base_amount: number;
  customer_fee: number;
  total_charged: number;
  net_settlement: number;
  channel: string | null;
  customer_phone: string | null;
  status: string;
  failure_reason: string | null;
  paid_at: string | null;
  settle_after: string | null;
  settled_at: string | null;
  created_at: string;
}

interface WebhookDelivery {
  id: string;
  event: string;
  target_url: string;
  attempt_count: number;
  max_attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  status: string;
  delivered_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  settled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  delivered: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paid: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  suspended: "bg-red-500/15 text-red-400 border-red-500/30",
  revoked: "bg-red-500/15 text-red-400 border-red-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  disputed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const NODE_SNIPPET = `import crypto from "node:crypto";

const BASE = "${GATEWAY_BASE_URL}";
const SECRET_KEY = process.env.SWIFTDATA_GATEWAY_KEY; // swft_gsk_live_...
const WEBHOOK_SECRET = process.env.SWIFTDATA_WEBHOOK_SECRET; // swft_whsec_...

export async function initializeCollection({ clientReference, amount, redirectUrl, customerEmail }) {
  const path = "/v1/initialize";
  const body = JSON.stringify({
    client_reference: clientReference,
    amount, // GHS base amount — customer pays Paystack fee on top
    redirect_url: redirectUrl, // Must match your allowed_domains
    customer_email: customerEmail,
    description: "Order #" + clientReference,
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(\`\${timestamp}.\${nonce}.POST.\${path}.\${body}\`)
    .digest("hex");

  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${SECRET_KEY}\`,
      "X-Swift-Timestamp": timestamp,
      "X-Swift-Nonce": nonce,
      "X-Swift-Signature": signature,
    },
    body,
  });
  return res.json();
}

// Verify inbound webhook from SwiftData
export function verifyWebhook(rawBody, sigHeader) {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ""));
}`;

const PHP_SNIPPET = `<?php
$base = "${GATEWAY_BASE_URL}";
$path = "/v1/initialize";
$secretKey = getenv("SWIFTDATA_GATEWAY_KEY");
$webhookSecret = getenv("SWIFTDATA_WEBHOOK_SECRET");

$body = json_encode([
  "client_reference" => "ORD-" . time(),
  "amount" => 50.00,
  "payment_phone" => "0241234567",
  "payment_network" => "MTN", // MTN | TELECEL | AIRTELTIGO
  "description" => "Store Purchase",
]);

$ts = (string) time();
$nonce = bin2hex(random_bytes(16));
$sig = hash_hmac("sha256", "{$ts}.{$nonce}.POST.{$path}.{$body}", $webhookSecret);

$ch = curl_init($base . $path);
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POSTFIELDS => $body,
  CURLOPT_HTTPHEADER => [
    "Content-Type: application/json",
    "Authorization: Bearer {$secretKey}",
    "X-Swift-Timestamp: {$ts}",
    "X-Swift-Nonce: {$nonce}",
    "X-Swift-Signature: {$sig}",
  ],
]);
$response = json_decode(curl_exec($ch), true);`;

export default function DashboardPaymentGateway() {
  const { user, session } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState<GatewayMerchant | null>(null);
  const [collections, setCollections] = useState<GatewayCollection[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookDelivery[]>([]);

  // Application / Settings form
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [domainsInput, setDomainsInput] = useState("");
  const [ipsInput, setIpsInput] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Key rotation modal
  const [rotating, setRotating] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<{
    secret_key: string | null;
    webhook_secret: string | null;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: m } = await (supabase as any)
        .from("gateway_merchants")
        .select(
          "id, user_id, business_name, website_url, status, secret_key_prefix, require_hmac, allowed_domains, allowed_ips, webhook_url, allowed_channels, settlement_wallet, settlement_hold_hours, settlement_frozen, max_tx_amount, daily_limit, monthly_limit, rate_limit_per_min, fee_percent, platform_fee_percent, created_at",
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (m) {
        setMerchant(m);
        setBusinessName(m.business_name || "");
        setWebsiteUrl(m.website_url || "");
        setDomainsInput((m.allowed_domains || []).join(", "));
        setIpsInput((m.allowed_ips || []).join(", "));
        setWebhookUrl(m.webhook_url || "");

        const [colsRes, whRes] = await Promise.all([
          (supabase as any)
            .from("gateway_collections")
            .select(
              "id, reference, client_reference, base_amount, customer_fee, total_charged, net_settlement, channel, customer_phone, status, failure_reason, paid_at, settle_after, settled_at, created_at",
            )
            .eq("merchant_id", m.id)
            .order("created_at", { ascending: false })
            .limit(50),
          (supabase as any)
            .from("gateway_webhook_deliveries")
            .select("id, event, target_url, attempt_count, max_attempts, last_http_status, last_error, status, delivered_at, created_at")
            .eq("merchant_id", m.id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        setCollections(colsRes.data || []);
        setWebhooks(whRes.data || []);
      } else {
        setMerchant(null);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const parseCsvList = (raw: string) =>
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!businessName.trim() || !websiteUrl.trim()) {
      toast({ title: "Missing fields", description: "Business name and HTTPS website URL are required.", variant: "destructive" });
      return;
    }
    if (!websiteUrl.trim().startsWith("https://")) {
      toast({ title: "HTTPS Required", description: "Website URL must start with https://", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const domains = parseCsvList(domainsInput);
      if (domains.length === 0) {
        try {
          domains.push(new URL(websiteUrl.trim()).hostname);
        } catch {
          // ignore
        }
      }
      const { error } = await (supabase as any).from("gateway_merchants").insert({
        user_id: user.id,
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        allowed_domains: domains,
        allowed_ips: parseCsvList(ipsInput),
        webhook_url: webhookUrl.trim() || null,
      });
      if (error) throw error;
      toast({
        title: "Application Submitted",
        description: "Your Payment Gateway merchant request is pending admin approval.",
      });
      await loadData();
    } catch (err: any) {
      toast({ title: "Application failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchant) return;
    if (webhookUrl.trim() && !webhookUrl.trim().startsWith("https://")) {
      toast({ title: "Invalid Webhook URL", description: "Webhook URL must use HTTPS.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("gateway_merchants")
        .update({
          business_name: businessName.trim(),
          website_url: websiteUrl.trim(),
          allowed_domains: parseCsvList(domainsInput),
          allowed_ips: parseCsvList(ipsInput),
          webhook_url: webhookUrl.trim() || null,
        })
        .eq("id", merchant.id);
      if (error) throw error;
      toast({ title: "Settings saved", description: "Gateway security allowlists updated." });
      await loadData();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRotateKeys = async () => {
    if (!session?.access_token) return;
    setRotating(true);
    try {
      const res = await fetch(`${GATEWAY_BASE_URL}/v1/merchant/rotate-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rotate_api_key: true, rotate_webhook_secret: true }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || "Key rotation failed");
      setRevealedSecrets({
        secret_key: data.data?.secret_key || null,
        webhook_secret: data.data?.webhook_secret || null,
      });
      await loadData();
    } catch (err: any) {
      toast({ title: "Key rotation failed", description: err.message, variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  const handleReplayWebhook = async (deliveryId: string) => {
    if (!session?.access_token) return;
    setReplayingId(deliveryId);
    try {
      const res = await fetch(`${GATEWAY_BASE_URL}/v1/merchant/replay-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ delivery_id: deliveryId }),
      });
      const data = await res.json();
      toast({
        title: data?.success ? "Webhook Delivered" : "Webhook Replay Failed",
        description: data?.success ? `HTTP ${data.data?.status || 200}` : data?.data?.error || data?.error,
        variant: data?.success ? "default" : "destructive",
      });
      await loadData();
    } catch (err: any) {
      toast({ title: "Replay error", description: err.message, variant: "destructive" });
    } finally {
      setReplayingId(null);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" />
            Payment Gateway Collection
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accept secure Mobile Money & Paystack payments on your own website with HMAC-SHA256 signing, anti-replay nonces, and domain allowlists.
          </p>
        </div>
        {merchant && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={STATUS_BADGE[merchant.status] || ""}>
              {merchant.status.toUpperCase()}
            </Badge>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>
        )}
      </div>

      {!merchant ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Apply for Payment Gateway Access
            </CardTitle>
            <CardDescription>
              Any SwiftData user or external site owner can request payment collection access. All applications are reviewed by an administrator before live keys are enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleApply} className="space-y-4 max-w-xl">
              <div className="space-y-1.5">
                <Label>Business / Site Name *</Label>
                <Input
                  placeholder="e.g. Accra Gadgets Shop"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Website URL (HTTPS) *</Label>
                <Input
                  placeholder="https://myshop.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Allowed Redirect Domains (comma-separated)</Label>
                <Input
                  placeholder="myshop.com, checkout.myshop.com"
                  value={domainsInput}
                  onChange={(e) => setDomainsInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Webhook URL (HTTPS, optional)</Label>
                <Input
                  placeholder="https://myshop.com/api/webhooks/swiftdata"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Gateway Application
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          {merchant.status === "pending" && (
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-amber-300">Pending Admin Approval</p>
                <p className="text-muted-foreground">
                  Your gateway merchant profile for <strong>{merchant.business_name}</strong> is under review. Live secret keys can be generated once approved.
                </p>
              </div>
            </div>
          )}

          {merchant.settlement_frozen && (
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex items-start gap-3">
              <Lock className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-red-300">Settlements Temporarily Frozen</p>
                <p className="text-muted-foreground">
                  Settlements for this merchant are currently on hold pending review (e.g. open payment dispute). Contact support for assistance.
                </p>
              </div>
            </div>
          )}

          {/* Risk & Settlement Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Per-Tx / Daily Cap</p>
                <p className="text-lg font-bold mt-1">
                  GH₵ {Number(merchant.max_tx_amount).toLocaleString()} / {Number(merchant.daily_limit).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Settlement Target</p>
                <p className="text-lg font-bold mt-1 uppercase">
                  {merchant.settlement_wallet} Wallet ({merchant.settlement_hold_hours}h hold)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Channels</p>
                <p className="text-lg font-bold mt-1">{(merchant.allowed_channels || ["mobile_money"]).join(", ")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">HMAC Anti-Replay</p>
                <p className="text-lg font-bold mt-1 text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> {merchant.require_hmac ? "Enforced" : "Optional"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="security" className="space-y-4">
            <TabsList>
              <TabsTrigger value="security">Keys & Security</TabsTrigger>
              <TabsTrigger value="collections">Collections ({collections.length})</TabsTrigger>
              <TabsTrigger value="webhooks">Webhook Logs ({webhooks.length})</TabsTrigger>
              <TabsTrigger value="docs">Integration Guide</TabsTrigger>
            </TabsList>

            <TabsContent value="security" className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" /> Gateway Credentials
                  </CardTitle>
                  <CardDescription>
                    Keep both keys strictly on your backend server. Never expose them in browser JavaScript.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded-lg bg-muted/40 border text-sm flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Active Secret Key</p>
                      <p className="font-mono font-semibold">{merchant.secret_key_prefix || "Not generated yet"}</p>
                    </div>
                    <Badge variant="outline">SHA-256 Hashed</Badge>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Endpoint Base URL</p>
                    <div className="flex items-center justify-between gap-2">
                      <code className="break-all">{GATEWAY_BASE_URL}</code>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copyText(GATEWAY_BASE_URL, "Base URL")}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <Button
                    onClick={handleRotateKeys}
                    disabled={rotating || merchant.status !== "active"}
                    className="w-full"
                  >
                    {rotating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                    {merchant.secret_key_prefix ? "Rotate Secret & Webhook Keys" : "Generate Live Gateway Keys"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" /> Allowlists & Webhook
                  </CardTitle>
                  <CardDescription>
                    Redirect URLs are restricted to Allowed Domains. Server IP allowlist is strongly recommended.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveSettings} className="space-y-3">
                    <div className="space-y-1">
                      <Label>Allowed Redirect Domains (comma-separated)</Label>
                      <Input
                        value={domainsInput}
                        onChange={(e) => setDomainsInput(e.target.value)}
                        placeholder="myshop.com, pay.myshop.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Allowed Server IPs (optional, comma-separated)</Label>
                      <Input
                        value={ipsInput}
                        onChange={(e) => setIpsInput(e.target.value)}
                        placeholder="e.g. 203.0.113.10, 198.51.100.4"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="flex items-center gap-1">
                        <Webhook className="w-3.5 h-3.5" /> Webhook URL (HTTPS)
                      </Label>
                      <Input
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://myshop.com/api/webhooks/swiftdata"
                      />
                    </div>
                    <Button type="submit" disabled={saving} className="w-full">
                      {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Security Settings
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="collections">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Client Ref</TableHead>
                        <TableHead>Base / Fee / Total</TableHead>
                        <TableHead>Net Settlement</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {collections.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No collections yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        collections.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                            <TableCell className="font-mono text-xs">{c.client_reference}</TableCell>
                            <TableCell className="text-xs">
                              GH₵ {Number(c.base_amount).toFixed(2)} + {Number(c.customer_fee).toFixed(2)} ={" "}
                              <strong>GH₵ {Number(c.total_charged).toFixed(2)}</strong>
                            </TableCell>
                            <TableCell className="font-semibold text-emerald-400">
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

            <TabsContent value="webhooks">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>HTTP / Error</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {webhooks.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No webhook deliveries yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        webhooks.map((w) => (
                          <TableRow key={w.id}>
                            <TableCell className="font-mono text-xs">{w.event}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={STATUS_BADGE[w.status] || ""}>
                                {w.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {w.attempt_count}/{w.max_attempts}
                            </TableCell>
                            <TableCell className="text-xs max-w-[260px] truncate">
                              {w.last_http_status ? `HTTP ${w.last_http_status}` : ""} {w.last_error || ""}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(w.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={replayingId === w.id}
                                onClick={() => handleReplayWebhook(w.id)}
                              >
                                {replayingId === w.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5 mr-1" />
                                )}
                                Replay
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

            <TabsContent value="docs" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-primary" /> Node.js / TypeScript Example
                  </CardTitle>
                  <CardDescription>
                    Every request must include <code>Authorization: Bearer swft_gsk_live_...</code>, <code>X-Swift-Timestamp</code>, <code>X-Swift-Nonce</code>, and <code>X-Swift-Signature</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2"
                      onClick={() => copyText(NODE_SNIPPET, "Node.js snippet")}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                    </Button>
                    <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-100 text-xs overflow-x-auto">
                      <code>{NODE_SNIPPET}</code>
                    </pre>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">PHP (Direct MoMo STK Push) Example</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2"
                      onClick={() => copyText(PHP_SNIPPET, "PHP snippet")}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                    </Button>
                    <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-100 text-xs overflow-x-auto">
                      <code>{PHP_SNIPPET}</code>
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* One-Time Key Reveal Dialog */}
      <Dialog open={Boolean(revealedSecrets)} onOpenChange={() => setRevealedSecrets(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Your New Gateway Secrets</DialogTitle>
            <DialogDescription>
              Copy and store these secrets in your server environment variables now. For security, they will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {revealedSecrets?.secret_key && (
              <div className="space-y-1">
                <Label>Gateway Secret Key (Bearer Token)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={revealedSecrets.secret_key} className="font-mono text-xs" />
                  <Button variant="outline" onClick={() => copyText(revealedSecrets.secret_key!, "Secret Key")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            {revealedSecrets?.webhook_secret && (
              <div className="space-y-1">
                <Label>HMAC / Webhook Signing Secret</Label>
                <div className="flex gap-2">
                  <Input readOnly value={revealedSecrets.webhook_secret} className="font-mono text-xs" />
                  <Button variant="outline" onClick={() => copyText(revealedSecrets.webhook_secret!, "Webhook Secret")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedSecrets(null)}>I Have Saved These Keys</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
