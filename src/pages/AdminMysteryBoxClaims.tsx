import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Gift,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type CampaignOption = {
  id: string;
  title: string;
  is_active: boolean;
};

type ClaimRow = {
  id: string;
  campaign_id: string;
  campaign_title: string;
  user_id: string;
  user_name: string;
  user_email: string;
  store_name: string | null;
  box_day: string;
  box_number: number;
  prize_label: string;
  recipient_phone: string;
  order_id: string;
  order_status: string;
  order_network: string | null;
  order_package: string | null;
  failure_reason: string | null;
  created_at: string;
};

const statusBadge = (status: string) => {
  const s = (status || "unknown").toLowerCase();
  if (s === "fulfilled" || s === "completed") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20">
        Fulfilled
      </Badge>
    );
  }
  if (s === "processing" || s === "paid" || s === "pending") {
    return (
      <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/20 capitalize">
        {s}
      </Badge>
    );
  }
  if (s === "failed" || s === "fulfillment_failed") {
    return (
      <Badge className="bg-rose-500/15 text-rose-500 border-rose-500/30 hover:bg-rose-500/20">
        Failed
      </Badge>
    );
  }
  return <Badge variant="outline" className="capitalize">{s}</Badge>;
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
};

export default function AdminMysteryBoxClaims() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

  const [search, setSearch] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const fetchClaims = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const [opensRes, campsRes] = await Promise.all([
        (supabase as any)
          .from("mystery_box_opens")
          .select("id, campaign_id, user_id, box_day, box_number, prize_label, recipient_phone, order_id, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("mystery_box_campaigns")
          .select("id, title, is_active")
          .order("created_at", { ascending: false }),
      ]);

      if (opensRes.error) throw opensRes.error;

      const rawOpens: any[] = opensRes.data || [];
      const campList: CampaignOption[] = campsRes.data || [];
      setCampaigns(campList);

      const campMap = new Map<string, string>(campList.map((c) => [c.id, c.title]));
      const userIds = Array.from(new Set(rawOpens.map((o) => o.user_id).filter(Boolean)));
      const orderIds = Array.from(new Set(rawOpens.map((o) => o.order_id).filter(Boolean)));

      const profileMap = new Map<string, { full_name: string; email: string; store_name: string | null }>();
      const orderMap = new Map<string, { status: string; network: string | null; package_size: string | null; failure_reason: string | null }>();

      // Chunk fetches to stay safely within PostgREST IN limits
      for (let i = 0; i < userIds.length; i += 200) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, store_name")
          .in("user_id", userIds.slice(i, i + 200));
        for (const p of profs || []) {
          profileMap.set(p.user_id, {
            full_name: p.full_name || "Unknown User",
            email: p.email || "",
            store_name: p.store_name || null,
          });
        }
      }

      for (let i = 0; i < orderIds.length; i += 200) {
        const { data: ords } = await supabase
          .from("orders")
          .select("id, status, network, package_size, failure_reason")
          .in("id", orderIds.slice(i, i + 200));
        for (const ord of ords || []) {
          orderMap.set(ord.id, {
            status: ord.status || "unknown",
            network: ord.network || null,
            package_size: ord.package_size || null,
            failure_reason: ord.failure_reason || null,
          });
        }
      }

      const enriched: ClaimRow[] = rawOpens.map((row) => {
        const prof = profileMap.get(row.user_id);
        const ord = orderMap.get(row.order_id);
        return {
          id: row.id,
          campaign_id: row.campaign_id,
          campaign_title: campMap.get(row.campaign_id) || "Mystery Box",
          user_id: row.user_id,
          user_name: prof?.full_name || "Unknown User",
          user_email: prof?.email || row.user_id.slice(0, 8),
          store_name: prof?.store_name || null,
          box_day: row.box_day,
          box_number: row.box_number,
          prize_label: row.prize_label,
          recipient_phone: row.recipient_phone,
          order_id: row.order_id,
          order_status: ord?.status || "unknown",
          order_network: ord?.network || null,
          order_package: ord?.package_size || null,
          failure_reason: ord?.failure_reason || null,
          created_at: row.created_at,
        };
      });

      setClaims(enriched);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load Mystery Box claims");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchClaims(false);
  }, [fetchClaims]);

  const filteredClaims = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const todayIso = new Date().toISOString().slice(0, 10);

    return claims.filter((c) => {
      if (campaignFilter !== "all" && c.campaign_id !== campaignFilter) return false;

      if (statusFilter !== "all") {
        const s = c.order_status.toLowerCase();
        if (statusFilter === "fulfilled" && s !== "fulfilled" && s !== "completed") return false;
        if (statusFilter === "processing" && s !== "processing" && s !== "paid" && s !== "pending") return false;
        if (statusFilter === "failed" && s !== "failed" && s !== "fulfillment_failed") return false;
      }

      if (dateFilter !== "all") {
        const createdMs = new Date(c.created_at).getTime();
        if (dateFilter === "today" && c.box_day !== todayIso) return false;
        if (dateFilter === "7d" && now - createdMs > 7 * 86400_000) return false;
        if (dateFilter === "30d" && now - createdMs > 30 * 86400_000) return false;
      }

      if (q) {
        const hay = `${c.user_name} ${c.user_email} ${c.store_name || ""} ${c.recipient_phone} ${c.prize_label} ${c.order_id} ${c.campaign_title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [claims, search, campaignFilter, statusFilter, dateFilter]);

  const stats = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const uniqueUsers = new Set(filteredClaims.map((c) => c.user_id)).size;
    const todayCount = filteredClaims.filter((c) => c.box_day === todayIso).length;
    const fulfilledCount = filteredClaims.filter((c) => {
      const s = c.order_status.toLowerCase();
      return s === "fulfilled" || s === "completed";
    }).length;
    const failedCount = filteredClaims.filter((c) => {
      const s = c.order_status.toLowerCase();
      return s === "failed" || s === "fulfillment_failed";
    }).length;
    return { total: filteredClaims.length, uniqueUsers, todayCount, fulfilledCount, failedCount };
  }, [filteredClaims]);

  const exportCsv = () => {
    if (!filteredClaims.length) {
      toast.info("No claims to export");
      return;
    }
    const headers = [
      "Claimed At",
      "Box Day",
      "Box #",
      "User Name",
      "Email",
      "Store",
      "Campaign",
      "Prize",
      "Network",
      "Package",
      "Recipient Phone",
      "Order Status",
      "Order ID",
    ];
    const rows = filteredClaims.map((c) => [
      c.created_at,
      c.box_day,
      c.box_number,
      c.user_name,
      c.user_email,
      c.store_name || "",
      c.campaign_title,
      c.prize_label,
      c.order_network || "",
      c.order_package || "",
      c.recipient_phone,
      c.order_status,
      c.order_id,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => JSON.stringify(String(cell ?? ""))).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `mystery-box-claims-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyText = (val: string, label: string) => {
    navigator.clipboard?.writeText(val).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Copy failed")
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gift className="h-6 w-6 text-amber-500" />
            Mystery Box Claims
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All users who opened a Mystery Box and claimed free data prizes, with live delivery status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/mystery-box">
              <Settings className="h-4 w-4 mr-1.5" />
              Manage Campaigns
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
          <Button size="sm" onClick={() => void fetchClaims(true)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Claims</CardTitle>
            <Gift className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{stats.todayCount} claimed today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Unique Users</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.uniqueUsers}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Distinct winners</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Fulfilled</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{stats.fulfilledCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Delivered successfully</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{stats.failedCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Retry from Admin Orders</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Claimed Data History</CardTitle>
              <CardDescription>Showing {filteredClaims.length} of {claims.length} total Mystery Box claims</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search user, phone, prize, order..."
                  className="pl-9 h-9"
                />
              </div>

              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="all">All Campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="processing">Processing / Pending</option>
                <option value="failed">Failed</option>
              </select>

              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading Mystery Box claims...</span>
            </div>
          ) : filteredClaims.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <Gift className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No Mystery Box claims found</p>
              <p className="text-xs mt-1">Adjust your filters or check back once users unlock boxes.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                    <th className="py-3 pr-4 font-semibold">Claimed At</th>
                    <th className="py-3 pr-4 font-semibold">User</th>
                    <th className="py-3 pr-4 font-semibold">Campaign</th>
                    <th className="py-3 pr-4 font-semibold">Prize Won</th>
                    <th className="py-3 pr-4 font-semibold">Recipient Phone</th>
                    <th className="py-3 pr-4 font-semibold">Delivery Status</th>
                    <th className="py-3 font-semibold">Order Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredClaims.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <div className="font-medium text-xs">{fmtDate(row.created_at)}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {row.box_day} · Box #{row.box_number}
                        </div>
                      </td>

                      <td className="py-3 pr-4">
                        <div className="font-semibold text-xs">{row.user_name}</div>
                        <div className="text-[11px] text-muted-foreground">{row.user_email}</div>
                        {row.store_name && (
                          <span className="inline-block text-[10px] text-amber-500 font-medium mt-0.5">
                            {row.store_name}
                          </span>
                        )}
                      </td>

                      <td className="py-3 pr-4 text-xs font-medium">{row.campaign_title}</td>

                      <td className="py-3 pr-4">
                        <div className="font-semibold text-xs text-amber-500">{row.prize_label}</div>
                        {(row.order_network || row.order_package) && (
                          <div className="text-[11px] text-muted-foreground">
                            {[row.order_network, row.order_package].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>

                      <td className="py-3 pr-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => copyText(row.recipient_phone, "Phone")}
                          className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-primary"
                          title="Copy recipient phone"
                        >
                          {row.recipient_phone}
                          <Copy className="h-3 w-3 opacity-50" />
                        </button>
                      </td>

                      <td className="py-3 pr-4">
                        {statusBadge(row.order_status)}
                        {row.failure_reason && (
                          <p className="text-[11px] text-rose-500 mt-1 max-w-[200px] truncate" title={row.failure_reason}>
                            {row.failure_reason}
                          </p>
                        )}
                      </td>

                      <td className="py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => copyText(row.order_id, "Order ID")}
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
                          title={row.order_id}
                        >
                          #{row.order_id.slice(0, 8)}
                          <Copy className="h-3 w-3 opacity-50" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
