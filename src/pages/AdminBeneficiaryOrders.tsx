import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, Phone, ShieldAlert, Copy, Check, Download, Users, Search, Calendar, RotateCcw, AlertTriangle, ListCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface BeneficiaryOrder {
  id: string;
  agent_id: string;
  customer_phone: string;
  network: string | null;
  package_size: string | null;
  amount: number;
  status: string;
  failure_reason: string | null;
  auto_refunded: boolean;
  created_at: string;
  agent_email?: string;
  agent_name?: string;
}

interface GroupedBeneficiaryNumber {
  phone: string;
  network: string;
  totalAttempts: number;
  totalAmount: number;
  lastAttemptAt: string;
  latestStatus: string;
  orders: BeneficiaryOrder[];
  agentEmails: string[];
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function AdminBeneficiaryOrders() {
  const { isDark } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [groupedNumbers, setGroupedNumbers] = useState<GroupedBeneficiaryNumber[]>([]);
  const [allBeneficiaryOrders, setAllBeneficiaryOrders] = useState<BeneficiaryOrder[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupedBeneficiaryNumber | null>(null);

  const fetchBeneficiaryOrders = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("orders")
        .select("id, agent_id, customer_phone, network, package_size, amount, status, failure_reason, auto_refunded, created_at")
        .or("failure_reason.ilike.%beneficiary list%,failure_reason.ilike.%not added%")
        .order("created_at", { ascending: false })
        .limit(500);

      if (timeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        q = q.gte("created_at", todayStart.toISOString());
      } else if (timeFilter === "7days") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        q = q.gte("created_at", d.toISOString());
      } else if (timeFilter === "30days") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        q = q.gte("created_at", d.toISOString());
      }

      const { data: rawOrders, error } = await q;

      if (error) {
        console.error("Error fetching beneficiary orders:", error);
      } else if (rawOrders && rawOrders.length > 0) {
        const agentIds = Array.from(new Set(rawOrders.map((o) => o.agent_id).filter(Boolean)));
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", agentIds);

        const profileMap = new Map<string, { full_name?: string; email?: string }>();
        (profiles || []).forEach((p) => profileMap.set(p.user_id, p));

        const enriched: BeneficiaryOrder[] = rawOrders.map((o) => {
          const prof = profileMap.get(o.agent_id);
          return {
            ...o,
            customer_phone: o.customer_phone || "Unknown Phone",
            agent_email: prof?.email || "Unknown Agent",
            agent_name: prof?.full_name || prof?.email?.split("@")[0] || "Agent",
          };
        });

        setAllBeneficiaryOrders(enriched);

        // Group orders by customer_phone
        const groups = new Map<string, GroupedBeneficiaryNumber>();
        enriched.forEach((ord) => {
          const phone = ord.customer_phone;
          if (!groups.has(phone)) {
            groups.set(phone, {
              phone,
              network: ord.network || "MTN",
              totalAttempts: 0,
              totalAmount: 0,
              lastAttemptAt: ord.created_at,
              latestStatus: ord.status,
              orders: [],
              agentEmails: [],
            });
          }
          const grp = groups.get(phone)!;
          grp.totalAttempts += 1;
          grp.totalAmount += Number(ord.amount || 0);
          grp.orders.push(ord);
          if (ord.agent_email && !grp.agentEmails.includes(ord.agent_email)) {
            grp.agentEmails.push(ord.agent_email);
          }
        });

        setGroupedNumbers(Array.from(groups.values()));
      } else {
        setAllBeneficiaryOrders([]);
        setGroupedNumbers([]);
      }
    } catch (err) {
      console.error("Exception fetching beneficiary orders:", err);
    } finally {
      setLoading(false);
    }
  }, [timeFilter]);

  useEffect(() => {
    fetchBeneficiaryOrders();
  }, [fetchBeneficiaryOrders]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const copyAllNumbersCsv = () => {
    const numbersList = Array.from(new Set(groupedNumbers.map((g) => g.phone))).join("\n");
    copyToClipboard(numbersList, "csv_copied");
  };

  const filteredGroups = groupedNumbers.filter((grp) => {
    if (statusFilter !== "all" && grp.latestStatus !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      grp.phone.toLowerCase().includes(q) ||
      grp.network.toLowerCase().includes(q) ||
      grp.agentEmails.some((e) => e.toLowerCase().includes(q)) ||
      grp.orders.some((o) => o.id.toLowerCase().includes(q))
    );
  });

  const totalUniqueNumbers = groupedNumbers.length;
  const totalAttempts = allBeneficiaryOrders.length;
  const totalVolume = allBeneficiaryOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl space-y-6">
      {/* Page Title & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={cn("font-display text-2xl sm:text-3xl font-bold flex items-center gap-2.5", isDark ? "text-white" : "text-gray-900")}>
            <ListCheck className="w-7 h-7 text-amber-500" /> Non-Beneficiary Number Tracker
          </h1>
          <p className={cn("text-sm mt-1", isDark ? "text-muted-foreground" : "text-gray-600")}>
            Comprehensive list of recipient numbers flagged for beneficiary whitelisting across all providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 h-9 border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400" onClick={copyAllNumbersCsv}>
            {copiedText === "csv_copied" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {copiedText === "csv_copied" ? "Copied List!" : "Copy Numbers List"}
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-9" onClick={fetchBeneficiaryOrders} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Analytics KPI Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-amber-500/20 shadow-lg shadow-amber-950/10" : "bg-white border-amber-100 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unique Flagged Numbers</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
              <Phone className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400">
            {totalUniqueNumbers} Numbers
          </div>
          <p className="text-xs text-muted-foreground mt-1">Pending carrier beneficiary whitelist</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-border shadow-lg" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Order Attempts</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <RotateCcw className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {totalAttempts} Orders
          </div>
          <p className="text-xs text-muted-foreground mt-1">Total orders attempted on these numbers</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-border shadow-lg" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Attempted Volume</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
            GH₵ {totalVolume.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Total value of blocked/refunded attempts</p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search phone number, agent email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm bg-background border-border"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-10 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
              <SelectItem value="fulfillment_failed">Fulfillment Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="w-36 h-10 text-xs">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today Only</SelectItem>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grouped Phone Numbers Table */}
      <div className={cn("rounded-2xl border overflow-hidden transition-all", isDark ? "bg-card/60 border-border" : "bg-white border-gray-200 shadow-sm")}>
        {loading ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
              <Phone className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold">No Non-Beneficiary Numbers Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              All numbers in the system are currently whitelisted or no matching beneficiary errors occurred in the selected timeframe.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={cn("border-b text-xs font-semibold uppercase tracking-wider", isDark ? "bg-muted/30 border-border text-muted-foreground" : "bg-gray-50 border-gray-100 text-gray-500")}>
                  <th className="py-3.5 px-4">Recipient Phone</th>
                  <th className="py-3.5 px-4">Network</th>
                  <th className="py-3.5 px-4">Order Attempts</th>
                  <th className="py-3.5 px-4">Total Value</th>
                  <th className="py-3.5 px-4">Last Attempt Date</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredGroups.map((grp) => {
                  const { date, time } = fmt(grp.lastAttemptAt);
                  return (
                    <tr key={grp.phone} className={cn("transition-colors hover:bg-muted/20", isDark ? "" : "hover:bg-gray-50/80")}>
                      {/* Phone Number */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-sm flex items-center gap-2">
                          {grp.phone}
                          <button onClick={() => copyToClipboard(grp.phone, grp.phone)} className="text-muted-foreground hover:text-foreground">
                            {copiedText === grp.phone ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                          Agents: {grp.agentEmails.join(", ")}
                        </div>
                      </td>

                      {/* Network */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          {grp.network}
                        </span>
                      </td>

                      {/* Attempts */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-sm">{grp.totalAttempts} {grp.totalAttempts === 1 ? "attempt" : "attempts"}</div>
                        <div className="text-[11px] text-muted-foreground">Auto-recorded for whitelist</div>
                      </td>

                      {/* Total Value */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-sm">GH₵ {grp.totalAmount.toFixed(2)}</div>
                      </td>

                      {/* Last Attempt */}
                      <td className="py-3.5 px-4">
                        <div className="text-xs font-medium">{date}</div>
                        <div className="text-[11px] text-muted-foreground">{time}</div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedGroup(grp)}>
                          View {grp.orders.length} Orders
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Orders List Dialog */}
      <Dialog open={!!selectedGroup} onOpenChange={(op) => !op && setSelectedGroup(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-lg font-bold">
              <span className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-amber-500" /> Orders for {selectedGroup?.phone}
              </span>
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => selectedGroup && copyToClipboard(selectedGroup.phone, "modal_phone")}>
                {copiedText === "modal_phone" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                Copy Phone
              </Button>
            </DialogTitle>
          </DialogHeader>

          {selectedGroup && (
            <div className="space-y-3 pt-2">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                Carrier Response: <strong>"{selectedGroup.phone} is not added to our beneficiary list"</strong>
              </div>

              <div className="space-y-2">
                {selectedGroup.orders.map((ord) => {
                  const { date, time } = fmt(ord.created_at);
                  return (
                    <div key={ord.id} className="p-3.5 rounded-xl border border-border bg-card/60 flex items-center justify-between gap-4 text-xs">
                      <div>
                        <div className="font-mono font-bold text-foreground">{ord.id.slice(0, 8)} • {ord.package_size}</div>
                        <div className="text-muted-foreground font-mono mt-0.5">{ord.agent_email}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{date} at {time}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm text-foreground">GH₵ {Number(ord.amount).toFixed(2)}</div>
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mt-1", ord.status === "refunded" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" : "bg-red-500/15 text-red-600 dark:text-red-400")}>
                          {ord.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
