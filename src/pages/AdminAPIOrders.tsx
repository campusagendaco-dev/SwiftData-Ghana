import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, RotateCcw, Loader2, RefreshCw, Clipboard, ExternalLink,
  Calendar, Filter, Users, ShieldAlert, BadgePercent, Coins, CheckCircle2,
  XCircle, Clock, CheckCircle, HelpCircle, ArrowRightRight, Trash2, ArrowUpRight
} from "lucide-react";
import { format, startOfDay, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { logAudit } from "@/utils/auditLogger";

interface OrderRow {
  id: string;
  order_type: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  profit: number;
  parent_profit: number;
  parent_agent_id: string | null;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_id: string;
  auto_refunded?: boolean;
  refund_amount?: number;
  refund_reason?: string;
  metadata?: any;
}

interface DeveloperProfile {
  user_id: string;
  full_name: string;
  email: string;
  is_sub_agent: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  processing: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  fulfilled: "bg-green-500/20 text-green-400 border-green-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  fulfillment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const GIG_EMAILS = ["zionkay40@gmail.com", "onegig365@gmail.com"];
const TOPS_EMAILS = ["mtopupgh@gmail.com", "topazicg@gmail.com"];

const PAGE_SIZE = 50;

export default function AdminAPIOrders() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<"all" | "gig" | "tops">("all");

  // Filters
  const [timeFilter, setTimeFilter] = useState<string>("since_june_2");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [networkFilter, setNetworkFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  // States
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, DeveloperProfile>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [retrying, setRetrying] = useState<string | null>(null);

  // Developer specific User IDs mapped on load
  const [devProfileMap, setDevProfileMap] = useState<Record<string, DeveloperProfile>>({});
  const [gigUserIds, setGigUserIds] = useState<string[]>([]);
  const [topsUserIds, setTopsUserIds] = useState<string[]>([]);

  // Fetch API Developer profiles
  const fetchDevProfiles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, is_sub_agent")
        .or(`email.in.(${[...GIG_EMAILS, ...TOPS_EMAILS].join(",")}),api_access_enabled.eq.true`);

      if (error) throw error;

      if (data) {
        const profileMap: Record<string, DeveloperProfile> = {};
        const gigIds: string[] = [];
        const topsIds: string[] = [];

        data.forEach((p: any) => {
          const prof: DeveloperProfile = {
            user_id: p.user_id,
            full_name: p.full_name || "Unknown",
            email: p.email || "",
            is_sub_agent: p.is_sub_agent || false,
          };
          profileMap[p.user_id] = prof;

          if (GIG_EMAILS.includes(p.email.toLowerCase())) {
            gigIds.push(p.user_id);
          }
          if (TOPS_EMAILS.includes(p.email.toLowerCase())) {
            topsIds.push(p.user_id);
          }
        });

        setDevProfileMap(profileMap);
        setProfiles(prev => ({ ...prev, ...profileMap }));
        setGigUserIds(gigIds);
        setTopsUserIds(topsIds);
      }
    } catch (err: any) {
      console.error("Failed to load developer profiles:", err);
      toast({
        title: "Error loading profiles",
        description: err.message,
        variant: "destructive",
      });
    }
  }, [toast]);

  // Load profiles once
  useEffect(() => {
    fetchDevProfiles();
  }, [fetchDevProfiles]);

  // Build the time boundary GTE date string
  const getSinceDate = useCallback(() => {
    const now = new Date();
    switch (timeFilter) {
      case "today":
        return startOfDay(now).toISOString();
      case "yesterday":
        return startOfDay(subDays(now, 1)).toISOString();
      case "last_7_days":
        return subDays(now, 7).toISOString();
      case "since_june_2":
        return new Date("2026-06-02T00:00:00Z").toISOString();
      case "all":
      default:
        return null;
    }
  }, [timeFilter]);

  // Fetch orders matching filters
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "exact" })
      .eq("order_type", "api")
      .order("created_at", { ascending: false })
      .range(from, to);

    // Apply active tab user-id filtering
    if (activeTab === "gig") {
      if (gigUserIds.length === 0) {
        setOrders([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      q = q.in("agent_id", gigUserIds);
    } else if (activeTab === "tops") {
      if (topsUserIds.length === 0) {
        setOrders([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      q = q.in("agent_id", topsUserIds);
    }

    // Apply Time filter
    const sinceStr = getSinceDate();
    if (sinceStr) {
      q = q.gte("created_at", sinceStr);
    }

    // Apply Status filter
    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }

    // Apply Network filter
    if (networkFilter !== "all") {
      q = q.eq("network", networkFilter);
    }

    // Apply text search
    if (searchQuery.trim()) {
      const term = searchQuery.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);

      if (isUuid) {
        q = q.eq("id", term);
      } else {
        // Resolve matching user ids to search email/name
        const matchedUserIds = Object.values(profiles)
          .filter(p => p.email.toLowerCase().includes(term.toLowerCase()) || p.full_name.toLowerCase().includes(term.toLowerCase()))
          .map(p => p.user_id);

        let orClause = `customer_phone.ilike.%${term}%,network.ilike.%${term}%`;
        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orClause += `,agent_id.eq.${id}`;
          });
        }
        q = q.or(orClause);
      }
    }

    const { data, count, error } = await q;

    if (error) {
      toast({ title: "Failed to fetch orders", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Capture agent IDs that need profile lookup
    const returnedAgentIds = [...new Set((data || []).map((o: any) => o.agent_id))];
    const missingAgentIds = returnedAgentIds.filter(id => !profiles[id]);

    const updatedProfiles = { ...profiles };
    if (missingAgentIds.length > 0) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, is_sub_agent")
        .in("user_id", missingAgentIds);

      if (profilesData) {
        profilesData.forEach((p: any) => {
          updatedProfiles[p.user_id] = {
            user_id: p.user_id,
            full_name: p.full_name || "Unknown",
            email: p.email || "",
            is_sub_agent: p.is_sub_agent || false,
          };
        });
        setProfiles(updatedProfiles);
      }
    }

    setOrders((data as OrderRow[]) || []);
    setTotalCount(count || 0);
    setLoading(false);
  }, [page, activeTab, gigUserIds, topsUserIds, getSinceDate, statusFilter, networkFilter, searchQuery, profiles, toast]);

  // Stats computation
  const [stats, setStats] = useState({
    totalCount: 0,
    totalVolume: 0,
    successRate: 0,
    pendingCount: 0,
    gigVolume: 0,
    topsVolume: 0
  });

  const fetchStats = useCallback(async () => {
    let q = supabase
      .from("orders")
      .select("amount, status, agent_id")
      .eq("order_type", "api");

    const sinceStr = getSinceDate();
    if (sinceStr) {
      q = q.gte("created_at", sinceStr);
    }

    const { data } = await q;

    if (data) {
      let volume = 0;
      let fulfilled = 0;
      let pending = 0;
      let gigVol = 0;
      let topsVol = 0;

      data.forEach((o: any) => {
        const amt = Number(o.amount || 0);
        volume += amt;

        if (o.status === "fulfilled" || o.status === "completed") {
          fulfilled++;
        }
        if (o.status === "pending" || o.status === "processing" || o.status === "paid") {
          pending++;
        }

        if (gigUserIds.includes(o.agent_id)) {
          gigVol += amt;
        }
        if (topsUserIds.includes(o.agent_id)) {
          topsVol += amt;
        }
      });

      setStats({
        totalCount: data.length,
        totalVolume: volume,
        successRate: data.length > 0 ? parseFloat(((fulfilled / data.length) * 100).toFixed(1)) : 0,
        pendingCount: pending,
        gigVolume: gigVol,
        topsVolume: topsVol
      });
    }
  }, [getSinceDate, gigUserIds, topsUserIds]);

  // Trigger loading when tab or filters change
  useEffect(() => {
    setPage(1);
  }, [activeTab, timeFilter, statusFilter, networkFilter, searchQuery]);

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [fetchOrders, fetchStats]);

  // Actions
  const handleRetry = async (orderId: string) => {
    setRetrying(orderId);
    try {
      const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
        body: { reference: orderId },
      });

      if (error) {
        toast({
          title: "Retry failed",
          description: error.message || "An error occurred during verification",
          variant: "destructive"
        });
      } else if (data?.status === "fulfilled") {
        if (currentUser) {
          await logAudit(currentUser.id, "manual_api_order_retry", { order_id: orderId, status: "fulfilled" });
        }
        toast({ title: "Order fulfilled successfully!" });
        fetchOrders();
        fetchStats();
      } else {
        toast({
          title: "Retry completed",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: data?.status === "fulfilled" ? "default" : "destructive",
        });
        fetchOrders();
        fetchStats();
      }
    } catch (e: any) {
      toast({
        title: "Retry failed",
        description: e.message || "Network execution error",
        variant: "destructive"
      });
    } finally {
      setRetrying(null);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">API Developer Orders</h1>
          <p className="text-white/40 text-sm mt-1">
            Audit, inspect, and recover API orders placed since June 2nd
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => { fetchOrders(); fetchStats(); }}
            variant="outline"
            size="sm"
            className="gap-1.5 border-white/10 text-white/70 hover:bg-white/5"
            disabled={loading}
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white/5 border-white/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Total API volume</p>
            <Coins className="w-3.5 h-3.5 text-white/40" />
          </div>
          <p className="text-3xl font-black text-white mt-1">GHS {stats.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-white/30 text-[10px] mt-1 font-bold">{stats.totalCount} total API orders</p>
        </Card>

        <Card className="bg-white/5 border-white/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">API Success Rate</p>
            <BadgePercent className="w-3.5 h-3.5 text-green-400" />
          </div>
          <p className="text-3xl font-black text-green-400 mt-1">{stats.successRate}%</p>
          <p className="text-white/30 text-[10px] mt-1 font-bold">Fulfilled orders ratio</p>
        </Card>

        <Card className={cn("p-4 border transition-colors", stats.pendingCount > 0 ? "bg-amber-500/5 border-amber-500/20" : "bg-white/5 border-white/10")}>
          <div className="flex items-center justify-between">
            <p className={cn("text-[10px] font-black uppercase tracking-widest", stats.pendingCount > 0 ? "text-amber-400/80" : "text-white/40")}>Stuck/Pending API</p>
            <Clock className={cn("w-3.5 h-3.5", stats.pendingCount > 0 ? "text-amber-400" : "text-white/40")} />
          </div>
          <p className={cn("text-3xl font-black mt-1", stats.pendingCount > 0 ? "text-amber-400" : "text-white")}>{stats.pendingCount}</p>
          <p className="text-white/30 text-[10px] mt-1 font-bold">Needs manual check or retry</p>
        </Card>

        <Card className="bg-white/5 border-white/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Gig vs Tops Volume</p>
            <Users className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span>Gig:</span>
              <span>GHS {stats.gigVolume.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span>Tops:</span>
              <span>GHS {stats.topsVolume.toFixed(2)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit border border-white/5">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
            activeTab === "all" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70")}
        >
          All API Orders
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("gig")}
          className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
            activeTab === "gig" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70")}
        >
          Gig Agents
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tops")}
          className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
            activeTab === "tops" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70")}
        >
          Tops Agents
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Time Filter */}
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-56 bg-white/5 border-white/10 text-white h-9 text-xs">
            <Calendar className="w-3.5 h-3.5 mr-1.5 text-white/40" />
            <SelectValue placeholder="Date Range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="since_june_2">Since June 2, 2026 (Audit)</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="last_7_days">Last 7 Days</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white h-9 text-xs">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-white/40" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed / F failed</SelectItem>
            <SelectItem value="fulfillment_failed">Fulfillment Failed</SelectItem>
          </SelectContent>
        </Select>

        {/* Network Filter */}
        <Select value={networkFilter} onValueChange={setNetworkFilter}>
          <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white h-9 text-xs">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-white/40" />
            <SelectValue placeholder="Network" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Networks</SelectItem>
            <SelectItem value="MTN">MTN</SelectItem>
            <SelectItem value="Telecel">Telecel</SelectItem>
            <SelectItem value="AirtelTigo">AirtelTigo</SelectItem>
          </SelectContent>
        </Select>

        {/* Text Search */}
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            placeholder="Search by UUID reference, Recipient, Agent Email/Name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-white/5 border-white/10 text-white placeholder:text-white/20 text-xs"
          />
        </div>

        <span className="text-white/20 text-xs shrink-0">{totalCount} matches</span>
      </div>

      {/* Orders Table */}
      <Card className="bg-[#0f1115]/80 border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-white/40 text-xs font-bold">Fetching developer transactions...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <CheckCircle2 className="w-12 h-12 text-white/20" />
            <p className="text-white/40 text-sm font-bold">No API orders found</p>
            <p className="text-white/20 text-xs">Try adjusting your filters or date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02] text-white/40 uppercase tracking-wider font-black text-[10px]">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Order Details</th>
                  <th className="px-4 py-3">Agent / Developer</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Wholesale Cost</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80 font-medium">
                {orders.map((o) => {
                  const agent = profiles[o.agent_id];
                  const statusColor = STATUS_COLORS[o.status] || "bg-white/10 text-white/40 border-white/10";
                  const canRetry = ["pending", "paid", "processing", "fulfillment_failed", "failed"].includes(o.status);

                  return (
                    <tr key={o.id} className="hover:bg-white/[0.01] transition-colors">
                      {/* Timestamp */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-white/50">
                        {format(new Date(o.created_at), "yyyy-MM-dd HH:mm:ss")}
                      </td>

                      {/* Order Details */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-white">{o.network}</span>
                            <span className="text-white/40 font-bold">·</span>
                            <span className="text-white/70">{o.package_size}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-white/30 font-mono text-[10px] tracking-tight">{o.id.slice(0, 13)}...</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(o.id, "Order reference")}
                              className="text-white/20 hover:text-white/60 p-0.5"
                              title="Copy full reference UUID"
                            >
                              <Clipboard className="w-3 h-3" />
                            </button>
                            {o.metadata?.client_reference && (
                              <span className="text-amber-500/60 font-mono text-[9px] bg-amber-500/5 border border-amber-500/10 px-1 rounded">
                                req: {String(o.metadata.client_reference).slice(0, 10)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Agent / Developer */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-0.5">
                          <p className="text-white font-bold max-w-[150px] truncate">{agent?.full_name || "Loading..."}</p>
                          <div className="flex items-center gap-1 max-w-[170px]">
                            <p className="text-white/40 text-[10px] truncate">{agent?.email || "Resolving ID..."}</p>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(agent?.user_id || o.agent_id, "User ID")}
                              className="text-white/10 hover:text-white/40 p-0.5 shrink-0"
                              title="Copy developer user ID"
                            >
                              <Clipboard className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Recipient */}
                      <td className="px-4 py-3.5 font-bold font-mono">
                        {o.customer_phone || "N/A"}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3.5 text-right font-black text-white">
                        {o.amount.toFixed(2)}
                      </td>

                      {/* Cost */}
                      <td className="px-4 py-3.5 text-right text-white/50">
                        {o.cost_price != null ? o.cost_price.toFixed(2) : "0.00"}
                      </td>

                      {/* Profit */}
                      <td className="px-4 py-3.5 text-right space-y-0.5">
                        <p className="text-green-400 font-bold">+{o.profit.toFixed(2)}</p>
                        {o.parent_profit > 0 && (
                          <p className="text-white/30 text-[9px] font-bold">parent: +{o.parent_profit.toFixed(2)}</p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <Badge className={cn("px-2 py-0.5 text-[9px] uppercase border font-black", statusColor)}>
                            {o.status.replace(/_/g, " ")}
                          </Badge>
                          {o.auto_refunded && (
                            <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[8px] font-extrabold flex items-center gap-0.5 uppercase tracking-wide">
                              <ShieldAlert className="w-2 h-2 shrink-0" /> Auto-Refunded
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* Retry */}
                          {canRetry && (
                            <Button
                              type="button"
                              onClick={() => handleRetry(o.id)}
                              disabled={retrying === o.id}
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 border-amber-500/20 text-amber-400 hover:bg-amber-500/10 text-[10px] font-bold gap-1 shrink-0"
                            >
                              {retrying === o.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              Retry
                            </Button>
                          )}

                          {/* View Logs */}
                          <Button
                            type="button"
                            onClick={() => navigate(`/admin/system-logs?order_id=${o.id}`)}
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 border-white/10 text-white/50 hover:bg-white/5 hover:text-white text-[10px] font-bold gap-1 shrink-0"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Logs
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3.5 border-t border-white/5 bg-white/[0.01]">
            <span className="text-white/35 text-xs">
              Page {page} of {totalPages} · {totalCount.toLocaleString()} orders
            </span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="h-8 border-white/10 text-white/60 hover:bg-white/5 text-xs font-bold"
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 border-white/10 text-white/60 hover:bg-white/5 text-xs font-bold"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
