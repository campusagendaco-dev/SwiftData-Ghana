import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunction } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  PhoneCall,
  ShieldCheck,
  Search,
  Copy,
  Check,
  Download,
  Send,
  Sparkles,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface SubmittedNumberRecord {
  id: string;
  phone: string;
  network: string;
  status: "whitelisted" | "submitted" | "failed";
  source: string;
  submitted_by?: string;
  created_at: string;
  notes?: string;
}

function detectNetwork(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  const p = clean.startsWith("233") ? "0" + clean.slice(3) : clean;
  if (/^0(24|25|53|54|55|59)\d{7}$/.test(p)) return "MTN";
  if (/^0(20|50)\d{7}$/.test(p)) return "Telecel";
  if (/^0(27|57|26|56)\d{7}$/.test(p)) return "AirtelTigo";
  return "Ghana Mobile";
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function AdminSubmittedBeneficiaryNumbers() {
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SubmittedNumberRecord[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  // Re-submission state
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sendingSmsPhone, setSendingSmsPhone] = useState<string | null>(null);

  const handleSendBeneficiarySms = async (phone: string) => {
    setSendingSmsPhone(phone);
    toast({ title: "Sending Beneficiary Guide SMS...", description: `Sending step-by-step approval guide to ${phone}...` });

    try {
      const { data, error } = await supabase.functions.invoke("send-order-sms", {
        body: {
          phone,
          action: "non_beneficiary",
        },
      });

      if (error || !data?.success) {
        toast({
          title: "SMS Sending Failed",
          description: error?.message || data?.error || "Could not send SMS guide to customer",
          variant: "destructive",
        });
      } else {
        toast({
          title: "SMS Guide Sent! 📱",
          description: `Sent step-by-step beneficiary approval guide to ${phone}.`,
        });
      }
    } catch (err: any) {
      toast({ title: "SMS Error", description: err.message || "Failed to send SMS", variant: "destructive" });
    } finally {
      setSendingSmsPhone(null);
    }
  };
  
  // Quick Add Drawer State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addRawText, setAddRawText] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const fetchSubmittedNumbers = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch non-beneficiary orders directly from the orders table
      const { data: orders, error: ordersErr } = await supabase
        .from("orders")
        .select("id, customer_phone, network, status, failure_reason, created_at, agent_id")
        .eq("status", "fulfillment_failed")
        .order("created_at", { ascending: false })
        .limit(300);

      if (ordersErr) throw ordersErr;

      const phoneMap = new Map<string, SubmittedNumberRecord>();
      const rawOrders: any[] = (orders as any[]) || [];
      rawOrders
        .filter((ord: any) => {
          const reason = (ord.failure_reason || "").toLowerCase();
          return reason.includes("beneficiary") || reason.includes("not added") || reason.includes("whitelist");
        })
        .forEach((ord: any) => {
          if (!ord.customer_phone) return;
          const clean = ord.customer_phone.replace(/\D/g, "");
          const formatted = clean.startsWith("233") && clean.length === 12 ? "0" + clean.slice(3) : clean;
          if (!phoneMap.has(formatted)) {
            phoneMap.set(formatted, {
              id: ord.id,
              phone: formatted,
              network: ord.network || detectNetwork(formatted),
              status: ord.status === "completed" ? "whitelisted" : "submitted",
              source: "Order Submission",
              created_at: ord.created_at,
              notes: ord.failure_reason || "Non-beneficiary approval pending",
            });
          }
        });

      setRecords(Array.from(phoneMap.values()));
    } catch (err: any) {
      console.error("[AdminSubmittedNumbers] Error loading numbers:", err);
      toast({
        title: "Failed to load records",
        description: err.message || "Could not retrieve submitted numbers list.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSubmittedNumbers();
  }, [fetchSubmittedNumbers]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchesSearch =
        !search.trim() ||
        rec.phone.includes(search.trim()) ||
        rec.network.toLowerCase().includes(search.toLowerCase()) ||
        (rec.source && rec.source.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "whitelisted" && rec.status === "whitelisted") ||
        (statusFilter === "submitted" && rec.status === "submitted") ||
        (statusFilter === "failed" && rec.status === "failed");

      return matchesSearch && matchesStatus;
    });
  }, [records, search, statusFilter]);

  // Bulk Selection Handlers
  const toggleSelectAll = () => {
    if (selectedIds.length === filteredRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map((r) => r.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Re-submit numbers to DataHub API
  const handleBatchResubmit = async (numbersToSubmit: string[]) => {
    if (numbersToSubmit.length === 0) return;
    setSubmitting(true);

    toast({
      title: "Submitting to Carrier Whitelist...",
      description: `Sending ${numbersToSubmit.length} numbers to DataHub API...`,
    });

    try {
      // Routed through the submit-numbers edge function rather than a direct
      // client-side call — the provider key never needs to reach the browser
      // this way, and it comes with its own retry-with-backoff for transient errors.
      const { data, error } = await invokePublicFunction("submit-numbers", {
        body: { numbers: numbersToSubmit.join(", ") },
      });

      if (data && (data.success || data.data)) {
        const d = data.data || data;
        toast({
          title: "Submission Successful! 🚀",
          description: `Submitted ${d.submitted ?? numbersToSubmit.length} number(s) to DataHub.`,
        });
        fetchSubmittedNumbers();
      } else {
        const description = data?.error || (await getFunctionErrorMessage(error, "Provider error"));
        toast({
          title: "Submission Error",
          description,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Execution Error",
        description: err.message || "Failed to contact whitelisting endpoint",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const dataToExport = selectedIds.length > 0
      ? records.filter((r) => selectedIds.includes(r.id))
      : filteredRecords;

    if (dataToExport.length === 0) {
      toast({ title: "No numbers to export" });
      return;
    }

    const headers = "Phone Number,Network,Status,Source,Date Submitted\n";
    const csvContent = "data:text/csv;charset=utf-8," + headers + dataToExport.map((r) => `"${r.phone}","${r.network}","${r.status}","${r.source}","${r.created_at}"`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `submitted_beneficiary_numbers_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "CSV Exported", description: `Exported ${dataToExport.length} phone records.` });
  };

  const copyList = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(label);
    toast({ title: "Copied to Clipboard", description: `Copied ${label} phone list.` });
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Quick submit inside admin modal
  const handleQuickAddSubmit = async () => {
    if (!addRawText.trim()) return;
    setAddLoading(true);

    const items = addRawText
      .split(/[\n,\s]+/)
      .map((n) => n.trim())
      .filter(Boolean);

    try {
      await handleBatchResubmit(items);
      setAddRawText("");
      setShowAddModal(false);
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header Grid ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-slate-900/60 to-purple-500/10 p-5 rounded-2xl border border-amber-500/20 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-3xl font-black tracking-tight text-foreground flex items-center gap-2">
              <PhoneCall className="w-6 h-6 text-amber-500" /> Submitted Beneficiary Numbers
            </h1>
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-xs px-2.5 font-bold">
              Carrier Whitelist
            </Badge>
          </div>
          <p className={cn("text-xs sm:text-sm", isDark ? "text-gray-300" : "text-gray-600")}>
            Manage and view all mobile phone numbers submitted for MTN, Telecel, & AirtelTigo beneficiary approval.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <Button
            onClick={() => setShowAddModal(true)}
            className="h-10 px-4 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 gap-1.5 shadow-md flex-1 sm:flex-initial"
          >
            <Plus className="w-4 h-4" /> Submit New Numbers
          </Button>

          <Link to="/submit-numbers" target="_blank">
            <Button variant="outline" size="sm" className="h-10 px-3 text-xs font-bold rounded-xl border-slate-700 text-slate-300 hover:bg-slate-800 gap-1">
              Public Form <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Key Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className={cn("border shadow-sm rounded-xl p-3.5", isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-gray-200")}>
          <div className="text-xs text-muted-foreground font-semibold">Total Unique Numbers</div>
          <div className="text-xl font-mono font-black text-amber-400 mt-1">{records.length}</div>
        </Card>

        <Card className={cn("border shadow-sm rounded-xl p-3.5", isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-gray-200")}>
          <div className="text-xs text-muted-foreground font-semibold">Whitelisted / Active</div>
          <div className="text-xl font-mono font-black text-emerald-400 mt-1">
            {records.filter((r) => r.status === "whitelisted").length}
          </div>
        </Card>

        <Card className={cn("border shadow-sm rounded-xl p-3.5", isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-gray-200")}>
          <div className="text-xs text-muted-foreground font-semibold">Submitted / Pending</div>
          <div className="text-xl font-mono font-black text-blue-400 mt-1">
            {records.filter((r) => r.status === "submitted").length}
          </div>
        </Card>

        <Card className={cn("border shadow-sm rounded-xl p-3.5", isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-gray-200")}>
          <div className="text-xs text-muted-foreground font-semibold">MTN Numbers</div>
          <div className="text-xl font-mono font-black text-amber-500 mt-1">
            {records.filter((r) => r.network === "MTN").length}
          </div>
        </Card>
      </div>

      {/* ── Search & Action Controls ── */}
      <Card className={cn("border shadow-md rounded-2xl overflow-hidden", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  placeholder="Search phone number or source..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-10 text-xs rounded-xl bg-slate-950/50 border-slate-800"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-[140px] text-xs rounded-xl border-slate-800 bg-slate-950/50">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="whitelisted">Whitelisted</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSubmittedNumbers}
                className="h-10 text-xs font-bold rounded-xl border-slate-800 hover:bg-slate-800 gap-1.5"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading ? "animate-spin" : "")} /> Refresh
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                className="h-10 text-xs font-bold rounded-xl border-slate-800 hover:bg-slate-800 gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" /> Export CSV
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => copyList(filteredRecords.map((r) => r.phone).join("\n"), "Filtered")}
                className="h-10 text-xs font-bold rounded-xl border-slate-800 hover:bg-slate-800 gap-1.5"
              >
                {copiedIndex === "Filtered" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 text-amber-400" />} Copy Phone List
              </Button>
            </div>
          </div>

          {/* Bulk Selection Actions Bar */}
          {selectedIds.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="text-amber-400">
                Selected {selectedIds.length} number(s)
              </span>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const numbers = records.filter((r) => selectedIds.includes(r.id)).map((r) => r.phone);
                    handleBatchResubmit(numbers);
                  }}
                  disabled={submitting}
                  className="h-8 px-3 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white gap-1"
                >
                  <Send className="w-3 h-3" /> Re-submit Selected ({selectedIds.length})
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds([])}
                  className="h-8 px-2 text-xs text-slate-400 hover:text-white"
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          )}

          {/* ── Table View ── */}
          <div className="rounded-xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-muted-foreground uppercase font-mono text-[10px] border-b border-white/5">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filteredRecords.length && filteredRecords.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-700 bg-slate-900"
                      />
                    </th>
                    <th className="p-3">Phone Number</th>
                    <th className="p-3">Network</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Submitted At</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/5 font-mono">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={idx}>
                        <td colSpan={7} className="p-4">
                          <Skeleton className="h-6 w-full bg-slate-800/50" />
                        </td>
                      </tr>
                    ))
                  ) : filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        No submitted numbers found. Use "Submit New Numbers" to add phone numbers for whitelisting.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(rec.id)}
                            onChange={() => toggleSelect(rec.id)}
                            className="rounded border-slate-700 bg-slate-900"
                          />
                        </td>
                        <td className="p-3 font-bold text-foreground">
                          {rec.phone}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">
                            {rec.network}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {rec.status === "whitelisted" ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                              Whitelisted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
                              Submitted
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground text-[11px] font-sans">
                          {rec.source}
                        </td>
                        <td className="p-3 text-slate-400 text-[11px] font-sans">
                          {fmtDate(rec.created_at).date} {fmtDate(rec.created_at).time}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSendBeneficiarySms(rec.phone)}
                              disabled={sendingSmsPhone === rec.phone}
                              title="Send Step-by-Step Beneficiary Guide SMS"
                              className="h-7 px-2 text-[10px] font-bold text-purple-400 hover:bg-purple-500/10"
                            >
                              <Send className="w-3 h-3 mr-1" /> 📱 Guide SMS
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleBatchResubmit([rec.phone])}
                              disabled={submitting}
                              title="Re-submit to DataHub Whitelist"
                              className="h-7 px-2 text-[10px] font-bold text-amber-400 hover:bg-amber-500/10"
                            >
                              <Send className="w-3 h-3 mr-1" /> Re-submit
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyList(rec.phone, rec.phone)}
                              className="h-7 px-2 text-[10px] text-slate-400 hover:text-white"
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── QUICK SUBMIT MODAL (Admin Modal) ── */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className={cn("w-[92vw] sm:max-w-md border shadow-2xl rounded-2xl p-5 space-y-4", isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-900 border-slate-800 text-white")}>
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-black text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-500" /> Submit Numbers for Whitelisting
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-300">
              Paste phone numbers (one per line or comma separated). These will be submitted directly to DataHub for carrier approval.
            </DialogDescription>
          </DialogHeader>

          <textarea
            value={addRawText}
            onChange={(e) => setAddRawText(e.target.value)}
            placeholder={`0538122730\n0241234567\n0554226398`}
            className="w-full min-h-[140px] font-mono text-xs p-3 rounded-xl bg-slate-900 border border-slate-800 text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddModal(false)}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-transparent border-slate-700 text-slate-300"
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={handleQuickAddSubmit}
              disabled={addLoading || !addRawText.trim()}
              className="h-9 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 text-white gap-1.5 shadow-lg"
            >
              {addLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Submit Numbers
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
