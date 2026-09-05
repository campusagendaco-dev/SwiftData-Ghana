import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearchTerm, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckCircle2, PlayCircle, UserCheck, Download,
  Phone, Coins, ShieldAlert, MoreHorizontal, GraduationCap,
  FileSpreadsheet, Printer, Copy, Check, Eye, XCircle, DollarSign, Sparkles, AlertCircle, RefreshCcw
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import UserDetailDrawer from "@/components/UserDetailDrawer";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import { WAECLogo, BECELogo } from "@/components/BrandLogos";

interface OrderRow {
  id: string;
  order_type: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  amount: number;
  profit: number;
  parent_profit: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  is_sub_agent?: boolean;
  metadata?: any;
  auto_refunded?: boolean;
  refund_amount?: number;
}

interface AgentProfile {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_agent: boolean;
  agent_approved: boolean;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  created_at: string;
  wallet_balance?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  processing: "bg-sky-500/20 text-sky-400 border-sky-500/30 animate-pulse",
  fulfilled: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  fulfillment_failed: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  cancelled: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  failed: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "last_30_days";
const PAGE_SIZE = 50;

export default function AdminCheckerOrders() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [allOrders, setAllOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("agent") || "";
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkerTypeFilter, setCheckerTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedUserForDrawer, setSelectedUserForDrawer] = useState<AgentProfile | null>(null);

  // Date Range Filters State
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Modal State for viewing vouchers in an order
  const [selectedOrderVouchers, setSelectedOrderVouchers] = useState<any | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, checkerTypeFilter, datePreset, startDate, endDate]);

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    if (preset === "today") {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === "yesterday") {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = yesterday.toISOString().split("T")[0];
      setStartDate(yStr);
      setEndDate(yStr);
    } else if (preset === "last_7_days") {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(past7.toISOString().split("T")[0]);
      setEndDate(todayStr);
    } else if (preset === "last_30_days") {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past30.toISOString().split("T")[0]);
      setEndDate(todayStr);
    } else if (preset === "all") {
      setStartDate("");
      setEndDate("");
    }
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .or("network.eq.VOUCHER,order_type.eq.voucher")
      .order("created_at", { ascending: false })
      .range(from, to);

    // Search filter
    if (search.trim()) {
      const cleanSearch = sanitizeSearchTerm(search);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSearch);

      if (isUuid) {
        q = q.or(`id.eq.${cleanSearch},agent_id.eq.${cleanSearch}`);
      } else {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .or(`full_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`);

        const matchedUserIds = matchedProfiles?.map((p: any) => p.user_id) || [];
        
        const orParts: string[] = [
          `customer_phone.ilike.%${cleanSearch}%`,
          `customer_name.ilike.%${cleanSearch}%`,
          `package_size.ilike.%${cleanSearch}%`
        ];

        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orParts.push(`agent_id.eq.${id}`);
          });
        }

        q = q.or(orParts.join(","));
      }
    }

    // Status Filter
    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }

    // Checker Type Filter
    if (checkerTypeFilter !== "all") {
      q = q.ilike("package_size", `%${checkerTypeFilter}%`);
    }

    // Date Range Filters
    if (startDate) {
      q = q.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      q = q.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    const { data, count, error } = await q;
    
    if (error) {
      toast({ title: "Failed to fetch orders", variant: "destructive" });
      setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    const agentIds = [...new Set((data || []).map((o: any) => o.agent_id))];
    const profileMap: Record<string, AgentProfile> = { ...profiles };
    
    if (agentIds.length > 0) {
      const [profRes, walletRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email, phone, is_agent, agent_approved, is_sub_agent, sub_agent_approved, created_at")
          .in("user_id", agentIds),
        supabase
          .from("wallets")
          .select("agent_id, balance")
          .in("agent_id", agentIds)
      ]);

      const walletMap = new Map((walletRes.data || []).map((w: any) => [w.agent_id, w.balance]));
      
      (profRes.data || []).forEach(p => {
        profileMap[p.user_id] = {
          ...(p as any),
          wallet_balance: walletMap.get(p.user_id) ?? 0
        };
      });
      setProfiles(profileMap);
    }

    const enriched: OrderRow[] = (data || []).map((o: any) => {
      const profile = profileMap[o.agent_id];
      const isPlaceholder = o.agent_id === "00000000-0000-0000-0000-000000000000" || !o.agent_id;
      
      return {
        ...o,
        agent_name: profile?.full_name || (isPlaceholder ? (o.customer_name || "Guest (Direct Purchase)") : "Unknown Agent"),
        agent_email: profile?.email || "",
        agent_phone: profile?.phone || "",
        is_sub_agent: profile?.is_sub_agent ?? false,
        metadata: { ...o.metadata, wallet_balance: profile?.wallet_balance }
      };
    });

    setAllOrders(enriched);
    setLoading(false);
  }, [page, search, statusFilter, checkerTypeFilter, startDate, endDate, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useRealtimeRefresh({ tables: ["orders"], onRefresh: fetchOrders });

  // Calculate Summary Metrics
  const metrics = useMemo(() => {
    let totalSales = 0;
    let totalProfit = 0;
    let totalVouchersCount = 0;
    let wassceCount = 0;
    let beceCount = 0;

    allOrders.forEach(o => {
      totalSales += Number(o.amount || 0);
      totalProfit += Number(o.profit || 0);
      
      const vList = o.metadata?.vouchers || [];
      const qty = vList.length || 1;
      totalVouchersCount += qty;

      const pkg = (o.package_size || "").toUpperCase();
      if (pkg.includes("WASSCE")) wassceCount += qty;
      else if (pkg.includes("BECE")) beceCount += qty;
    });

    return { totalSales, totalProfit, totalVouchersCount, wassceCount, beceCount };
  }, [allOrders]);

  const copyToClipboard = (text: string, label = "Code") => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard!", description: `${label} copied.` });
  };

  const exportAllOrdersCSV = () => {
    if (!allOrders.length) return;
    const headers = ["Order ID", "Date", "Customer / Agent", "Recipient Phone", "Voucher Package", "Amount (GHS)", "Profit (GHS)", "Status"];
    const rows = allOrders.map(o => [
      `"${o.id}"`,
      `"${new Date(o.created_at).toLocaleString()}"`,
      `"${o.agent_name || 'Guest'}"`,
      `"${o.customer_phone || ''}"`,
      `"${o.package_size || ''}"`,
      o.amount,
      o.profit,
      `"${o.status}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `checker_orders_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Exported CSV", description: `${allOrders.length} orders downloaded.` });
  };

  const exportVouchersCSV = (vouchersList: any[], pkgType: string, phone: string) => {
    if (!vouchersList?.length) return;
    const headers = ["Index", "Voucher Type", "Serial", "PIN", "Recipient Phone"];
    const rows = vouchersList.map((v: any, i: number) => [
      i + 1,
      v.type || pkgType,
      `"${v.serial}"`,
      `"${v.pin}"`,
      `"${phone}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vouchers_${pkgType.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Vouchers Exported", description: "CSV file generated." });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      
      {/* Top Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 bg-amber-400/15 text-amber-500 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-amber-400/20 mb-2">
            <GraduationCap className="w-3.5 h-3.5" />
            Result Checkers Master Logs
          </div>
          <div className="flex items-center gap-3">
            <WAECLogo size={42} />
            <h1 className="font-black text-3xl tracking-tight text-foreground">Checker Purchases</h1>
          </div>
          <p className="text-muted-foreground text-sm">View, track, and export all WAEC WASSCE and BECE voucher orders across the platform.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={fetchOrders}
            disabled={loading}
            variant="outline"
            className="h-11 rounded-2xl gap-2 text-xs font-bold border-border"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>

          <Button
            onClick={exportAllOrdersCSV}
            disabled={allOrders.length === 0}
            className="h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-wider gap-2 shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Page CSV
          </Button>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Sales Revenue</p>
              <p className="text-2xl font-black text-foreground font-mono mt-1">₵{metrics.totalSales.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{totalCount} total orders</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center font-black">
              <DollarSign className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Vouchers Issued</p>
              <p className="text-2xl font-black text-foreground font-mono mt-1">{metrics.totalVouchersCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">WASSCE + BECE Pins</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center font-black">
              <GraduationCap className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Platform Profit</p>
              <p className="text-2xl font-black text-emerald-500 font-mono mt-1">₵{metrics.totalProfit.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Net profit margin</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-500/15 text-blue-500 flex items-center justify-center font-black">
              <TrendingUp className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type Breakdown</p>
              <div className="flex items-center gap-3 mt-1.5 font-mono text-xs font-black">
                <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-lg border border-primary/20">WASSCE: {metrics.wassceCount}</span>
                <span className="bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-lg border border-amber-500/20">BECE: {metrics.beceCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Controls Bar */}
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 space-y-4 shadow-sm">
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search agent, recipient, serial or pin..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 bg-secondary/40 border-border rounded-2xl text-xs font-bold"
            />
          </div>

          {/* Checker Type Filter */}
          <select
            value={checkerTypeFilter}
            onChange={(e) => setCheckerTypeFilter(e.target.value)}
            className="h-11 px-3.5 bg-secondary/40 border border-border rounded-2xl text-xs font-bold text-foreground focus:outline-none"
          >
            <option value="all">All Checker Types</option>
            <option value="WASSCE">WASSCE Results Checker</option>
            <option value="BECE">BECE Result Checker</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-11 px-3.5 bg-secondary/40 border border-border rounded-2xl text-xs font-bold text-foreground focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="pending">Pending</option>
            <option value="fulfillment_failed">Fulfillment Failed</option>
          </select>

          {/* Date Preset */}
          <select
            value={datePreset}
            onChange={(e) => applyDatePreset(e.target.value as DatePreset)}
            className="h-11 px-3.5 bg-secondary/40 border border-border rounded-2xl text-xs font-bold text-foreground focus:outline-none"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_30_days">Last 30 Days</option>
          </select>
        </div>

      </div>

      {/* Main Checker Orders Table */}
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm">
        
        {loading ? (
          <div className="p-16 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-sm font-bold text-muted-foreground">Loading Checker Orders...</p>
          </div>
        ) : allOrders.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <GraduationCap className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h3 className="font-black text-lg text-foreground">No Voucher Purchases Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">No checker purchases matching your current filter criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                  <th className="p-4 pl-6">Order ID & Date</th>
                  <th className="p-4">Customer / Agent</th>
                  <th className="p-4">Recipient</th>
                  <th className="p-4">Voucher Package</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Profit</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {allOrders.map((order) => {
                  const vouchersList = order.metadata?.vouchers || [];
                  const hasVouchers = vouchersList.length > 0;
                  const profile = profiles[order.agent_id];

                  return (
                    <tr key={order.id} className="hover:bg-secondary/20 transition-colors group">
                      <td className="p-4 pl-6 font-mono">
                        <span className="font-bold text-foreground text-xs block">{order.id.slice(0, 8)}...</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(order.created_at).toLocaleString("en-GB", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                          })}
                        </span>
                      </td>

                      <td className="p-4">
                        {profile ? (
                          <button
                            onClick={() => setSelectedUserForDrawer(profile)}
                            className="font-black text-foreground hover:text-primary transition-colors text-left block"
                          >
                            {order.agent_name}
                            <span className="block text-[10px] text-muted-foreground font-mono">{order.agent_phone}</span>
                          </button>
                        ) : (
                          <div>
                            <span className="font-black text-foreground block">{order.agent_name || "Guest"}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{order.customer_phone}</span>
                          </div>
                        )}
                      </td>

                      <td className="p-4 font-mono font-bold text-foreground">
                        {order.customer_phone || "—"}
                      </td>

                      <td className="p-4 font-bold text-foreground">
                        <div className="flex items-center gap-2">
                          {(order.package_size || "").toUpperCase().includes("BECE") ? (
                            <BECELogo size={24} />
                          ) : (
                            <WAECLogo size={24} />
                          )}
                          <span>{order.package_size}</span>
                        </div>
                      </td>

                      <td className="p-4 font-mono font-black text-foreground">
                        ₵{Number(order.amount).toFixed(2)}
                      </td>

                      <td className="p-4 font-mono font-bold text-emerald-500">
                        ₵{Number(order.profit).toFixed(2)}
                      </td>

                      <td className="p-4">
                        <span className={cn(
                          "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
                          STATUS_COLORS[order.status] || "bg-secondary text-muted-foreground"
                        )}>
                          {order.status}
                        </span>
                      </td>

                      <td className="p-4 pr-6 text-right">
                        {hasVouchers ? (
                          <Button
                            onClick={() => setSelectedOrderVouchers({
                              vouchers: vouchersList,
                              package: order.package_size,
                              phone: order.customer_phone,
                              amount: order.amount,
                              agentName: order.agent_name,
                              createdAt: order.created_at
                            })}
                            className="h-8 px-3 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 font-black text-xs gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" /> View Pins ({vouchersList.length})
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">No pins payload</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between bg-secondary/10">
            <span className="text-xs text-muted-foreground font-bold">
              Showing page {page} of {totalPages} ({totalCount} total orders)
            </span>

            <div className="flex items-center gap-2">
              <Button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                variant="outline"
                className="h-9 px-3 rounded-xl text-xs font-bold"
              >
                Previous
              </Button>
              <Button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                variant="outline"
                className="h-9 px-3 rounded-xl text-xs font-bold"
              >
                Next
              </Button>
            </div>
          </div>
        )}

      </div>

      {/* Modal: Admin View Vouchers Drawer */}
      {selectedOrderVouchers && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-2xl w-full space-y-5 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-black text-lg text-foreground flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-amber-500" />
                  {selectedOrderVouchers.package}
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  Agent: <strong>{selectedOrderVouchers.agentName}</strong> · Recipient: <strong>{selectedOrderVouchers.phone}</strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedOrderVouchers(null)}
                className="p-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Voucher Pin Cards */}
            <div className="space-y-3">
              {selectedOrderVouchers.vouchers.map((v: any, i: number) => {
                const combinedStr = `SERIAL: ${v.serial} | PIN: ${v.pin}`;
                return (
                  <div key={i} className="p-4 rounded-2xl bg-secondary/40 border border-border space-y-2 text-xs font-mono">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase flex justify-between">
                      <span>VOUCHER {i + 1}</span>
                      <span className="text-emerald-500 font-bold">ISSUED</span>
                    </div>

                    <div className="flex justify-between items-center bg-card p-2.5 rounded-xl border border-border">
                      <span><strong>SERIAL:</strong> {v.serial}</span>
                      <button onClick={() => copyToClipboard(v.serial, "Serial Number")} className="text-primary font-bold hover:underline text-[11px] flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>

                    <div className="flex justify-between items-center bg-card p-2.5 rounded-xl border border-border">
                      <span><strong>PIN:</strong> {v.pin}</span>
                      <button onClick={() => copyToClipboard(v.pin, "PIN Code")} className="text-primary font-bold hover:underline text-[11px] flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Actions Bar */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                onClick={() => exportVouchersCSV(selectedOrderVouchers.vouchers, selectedOrderVouchers.package, selectedOrderVouchers.phone)}
                className="h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" /> Export Vouchers CSV
              </Button>

              <Button
                onClick={() => {
                  const printWin = window.open("", "_blank");
                  if (!printWin) return;
                  const vHtml = selectedOrderVouchers.vouchers.map((v: any, idx: number) => `
                    <div style="border: 2px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; font-family: monospace; background: #f8fafc;">
                      <div style="font-weight: bold; color: #475569; font-size: 11px; margin-bottom: 8px;">VOUCHER ${idx + 1}</div>
                      <div><strong>SERIAL:</strong> ${v.serial}</div>
                      <div><strong>PIN:</strong> ${v.pin}</div>
                    </div>
                  `).join("");
                  printWin.document.write(`<html><body><h2>${selectedOrderVouchers.package}</h2>${vHtml}<script>window.print();window.close();</script></body></html>`);
                  printWin.document.close();
                }}
                className="h-11 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" /> Print Vouchers
              </Button>
            </div>

          </div>
        </div>
      )}

      {/* User Detail Drawer when clicking on agent name */}
      {selectedUserForDrawer && (
        <UserDetailDrawer
          user={selectedUserForDrawer}
          onClose={() => setSelectedUserForDrawer(null)}
        />
      )}

    </div>
  );
}
