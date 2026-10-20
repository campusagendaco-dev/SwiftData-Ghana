import React, { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Copy,
  Check,
  Download,
  UploadCloud,
  FileSpreadsheet,
  Send,
  Zap,
  ShoppingBag,
  ArrowRight,
  RefreshCw,
  Trash2,
  Filter,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";
import { invokePublicFunction } from "@/lib/public-function-client";
import { cn } from "@/lib/utils";

export interface BeneficiaryCheckResult {
  phone_number: string;
  network?: string;
  status: "verified" | "not_verified" | "pending" | "not_required" | string;
  verification_status: "VERIFIED" | "NOT_VERIFIED" | "PENDING" | string;
  can_order: boolean;
  message?: string;
}

export interface BeneficiaryWhitelistCheckerProps {
  onTransferToSubmit?: (numbers: string[]) => void;
  initialPhone?: string;
  className?: string;
}

function normalizeGhanaPhone(phone: string): { normalized: string; isValid: boolean; raw: string } {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");

  let normalized = "";
  if (digits.startsWith("233") && digits.length === 12) {
    normalized = "0" + digits.slice(3);
  } else if (digits.length === 9) {
    normalized = "0" + digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    normalized = digits;
  }

  const isValid = /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(normalized);

  return {
    normalized: isValid ? normalized : raw,
    isValid,
    raw,
  };
}

function detectNetwork(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  const p = clean.startsWith("233") ? "0" + clean.slice(3) : clean;
  if (/^0(24|25|53|54|55|59)\d{7}$/.test(p)) return "MTN";
  if (/^0(20|50)\d{7}$/.test(p)) return "Telecel";
  if (/^0(27|57|26|56)\d{7}$/.test(p)) return "AirtelTigo";
  return "MTN";
}

export const BeneficiaryWhitelistChecker: React.FC<BeneficiaryWhitelistCheckerProps> = ({
  onTransferToSubmit,
  initialPhone = "",
  className,
}) => {
  const { toast } = useToast();
  const { isDark } = useAppTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Single Check State
  const [singlePhone, setSinglePhone] = useState(initialPhone);
  const [singleNetwork, setSingleNetwork] = useState<string>("MTN");
  const [singleChecking, setSingleChecking] = useState(false);
  const [singleResult, setSingleResult] = useState<BeneficiaryCheckResult | null>(null);

  // Bulk Check State
  const [bulkText, setBulkText] = useState("");
  const [bulkNetwork, setBulkNetwork] = useState<string>("MTN");
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkResults, setBulkResults] = useState<BeneficiaryCheckResult[]>([]);
  const [bulkSummary, setBulkSummary] = useState<{
    total: number;
    verified: number;
    not_verified: number;
    pending: number;
  } | null>(null);

  // Filter & Search in Results
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "not_verified">("all");
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Quick 1-click submit single state
  const [submittingSingle, setSubmittingSingle] = useState(false);
  const [submittedSingleSuccess, setSubmittedSingleSuccess] = useState(false);

  // Parse bulk text
  const parsedBulk = useMemo(() => {
    if (!bulkText.trim()) return { valid: [], invalid: [] };
    const items = bulkText.split(/[\n,\s]+/).map((n) => n.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const item of items) {
      const res = normalizeGhanaPhone(item);
      if (res.isValid) {
        if (!valid.includes(res.normalized)) valid.push(res.normalized);
      } else {
        if (!invalid.includes(res.raw)) invalid.push(res.raw);
      }
    }
    return { valid, invalid };
  }, [bulkText]);

  // Handle single check
  const handleSingleCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const res = normalizeGhanaPhone(singlePhone);
    if (!res.isValid) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid 10-digit Ghana phone number (e.g. 055 123 4567).",
        variant: "destructive",
      });
      return;
    }

    setSingleChecking(true);
    setSingleResult(null);
    setSubmittedSingleSuccess(false);

    try {
      const { data, error } = await invokePublicFunction("verify-beneficiary", {
        body: {
          phone: res.normalized,
          network: singleNetwork,
          check_only: true,
        },
      });

      if (error || !data) {
        throw new Error(error?.message || "Verification gateway unreachable");
      }

      const isVerified = data.verification_status === "VERIFIED" || (data.exists && !data.is_non_beneficiary);
      const isNotRequired = data.status === "not_required" || data.verification_status === "NOT_REQUIRED" || !singleNetwork.toUpperCase().includes("MTN");

      const result: BeneficiaryCheckResult = {
        phone_number: res.normalized,
        network: singleNetwork,
        status: isNotRequired ? "not_required" : isVerified ? "verified" : "not_verified",
        verification_status: isNotRequired ? "VERIFIED" : isVerified ? "VERIFIED" : "NOT_VERIFIED",
        can_order: isNotRequired || isVerified,
        message: data.message || (isVerified ? "Whitelisted on MTN carrier list. Ready for ordering." : "Not found on MTN beneficiary whitelist."),
      };

      setSingleResult(result);
      if (data.auto_submitted && !isVerified && !isNotRequired) {
        setSubmittedSingleSuccess(true);
      }
    } catch (err: any) {
      toast({
        title: "Check Failed",
        description: err.message || "Failed to reach verification endpoint. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSingleChecking(false);
    }
  };

  // Quick submit single number
  const handleQuickSubmitSingle = async () => {
    if (!singleResult) return;
    setSubmittingSingle(true);
    try {
      const { data, error } = await invokePublicFunction("verify-beneficiary", {
        body: {
          action: "submit_numbers",
          numbers: singleResult.phone_number,
        },
      });

      if (error || !data?.success) {
        await invokePublicFunction("submit-numbers", {
          body: { numbers: singleResult.phone_number },
        });
      }

      setSubmittedSingleSuccess(true);
      toast({
        title: "Submitted for Approval! 🎉",
        description: `${singleResult.phone_number} queued for carrier whitelisting (usually takes 5-15 mins).`,
      });
    } catch (err: any) {
      toast({
        title: "Submission Error",
        description: "Could not submit automatically. Please use the Submission tab.",
        variant: "destructive",
      });
    } finally {
      setSubmittingSingle(false);
    }
  };

  // Handle bulk check
  const handleBulkCheck = async () => {
    if (parsedBulk.valid.length === 0) {
      toast({
        title: "No valid numbers",
        description: "Please paste at least one valid phone number or upload a spreadsheet.",
        variant: "destructive",
      });
      return;
    }

    setBulkChecking(true);
    setBulkProgress(10);
    setBulkResults([]);
    setBulkSummary(null);

    const CHUNK_SIZE = 500;
    const chunks: string[][] = [];
    for (let i = 0; i < parsedBulk.valid.length; i += CHUNK_SIZE) {
      chunks.push(parsedBulk.valid.slice(i, i + CHUNK_SIZE));
    }

    const allResults: BeneficiaryCheckResult[] = [];
    let completedChunks = 0;

    try {
      for (const chunk of chunks) {
        const { data, error } = await invokePublicFunction("verify-beneficiary", {
          body: {
            network: bulkNetwork,
            phone_numbers: chunk,
          },
        });

        if (!error && data?.data?.results) {
          const chunkResults: BeneficiaryCheckResult[] = data.data.results.map((r: any) => ({
            phone_number: r.phone_number,
            network: bulkNetwork,
            status: r.status || (r.verification_status === "VERIFIED" ? "verified" : "not_verified"),
            verification_status: r.verification_status || (r.status === "verified" ? "VERIFIED" : "NOT_VERIFIED"),
            can_order: r.can_order === true || r.verification_status === "VERIFIED",
            message: r.message || (r.can_order ? "Verified" : "Not whitelisted"),
          }));
          allResults.push(...chunkResults);
        } else {
          // Fallback individual mapping
          chunk.forEach((p) => {
            allResults.push({
              phone_number: p,
              network: bulkNetwork,
              status: "not_verified",
              verification_status: "NOT_VERIFIED",
              can_order: false,
              message: "Unable to confirm whitelist status",
            });
          });
        }

        completedChunks++;
        setBulkProgress(Math.round((completedChunks / chunks.length) * 100));
      }

      setBulkResults(allResults);

      const verifiedCount = allResults.filter((r) => r.can_order || r.verification_status === "VERIFIED").length;
      const unverifiedCount = allResults.length - verifiedCount;

      setBulkSummary({
        total: allResults.length,
        verified: verifiedCount,
        not_verified: unverifiedCount,
        pending: 0,
      });

      toast({
        title: "Bulk Check Complete! 🎯",
        description: `Checked ${allResults.length} numbers: ${verifiedCount} Whitelisted, ${unverifiedCount} Unverified.`,
      });
    } catch (err: any) {
      toast({
        title: "Bulk Check Failed",
        description: err.message || "An error occurred during verification.",
        variant: "destructive",
      });
    } finally {
      setBulkChecking(false);
      setBulkProgress(100);
    }
  };

  // Excel / CSV File Dropzone
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const extracted: string[] = [];
        json.forEach((row) => {
          row.forEach((cell) => {
            if (cell !== undefined && cell !== null) {
              const res = normalizeGhanaPhone(String(cell));
              if (res.isValid && !extracted.includes(res.normalized)) {
                extracted.push(res.normalized);
              }
            }
          });
        });

        if (extracted.length > 0) {
          setBulkText(extracted.join("\n"));
          toast({
            title: "File Loaded! 📑",
            description: `Extracted ${extracted.length} valid phone numbers from ${file.name}.`,
          });
        } else {
          toast({
            title: "No numbers found",
            description: "Could not find valid Ghana phone numbers in the uploaded file.",
            variant: "destructive",
          });
        }
      } catch (err) {
        toast({
          title: "File Read Error",
          description: "Could not read this file. Please ensure it's a valid Excel or CSV spreadsheet.",
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Export Results to Excel
  const handleExportExcel = async () => {
    if (bulkResults.length === 0) return;
    const XLSX = await import("xlsx");
    const exportData = bulkResults.map((r, i) => ({
      "#": i + 1,
      "Phone Number": r.phone_number,
      "Network": r.network || "MTN",
      "Status": r.verification_status,
      "Whitelisted (Ready to Order)": r.can_order ? "YES" : "NO",
      "Carrier Message": r.message || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Whitelist Check Results");
    XLSX.writeFile(wb, `swiftdata_whitelist_check_${Date.now()}.xlsx`);

    toast({
      title: "Report Exported",
      description: "Downloaded spreadsheet report.",
    });
  };

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(id);
    setTimeout(() => setCopiedPhone(null), 2000);
    toast({ title: "Copied to Clipboard!" });
  };

  // Copy all verified / unverified
  const handleCopyBatch = (type: "verified" | "not_verified") => {
    const list = bulkResults.filter((r) =>
      type === "verified"
        ? r.can_order || r.verification_status === "VERIFIED"
        : !r.can_order && r.verification_status !== "VERIFIED"
    );
    if (list.length === 0) return;
    const str = list.map((r) => r.phone_number).join("\n");
    navigator.clipboard.writeText(str);
    toast({
      title: `Copied ${list.length} ${type === "verified" ? "Whitelisted" : "Unverified"} Numbers`,
    });
  };

  // Transfer unverified numbers to submission tab
  const handleTransferUnverified = () => {
    const unverifiedList = bulkResults
      .filter((r) => !r.can_order && r.verification_status !== "VERIFIED")
      .map((r) => r.phone_number);

    if (unverifiedList.length === 0) {
      toast({ title: "No unverified numbers to transfer!" });
      return;
    }

    if (onTransferToSubmit) {
      onTransferToSubmit(unverifiedList);
    } else {
      navigate(`/submit-numbers?tab=submit&numbers=${encodeURIComponent(unverifiedList.join(","))}`);
    }
  };

  // Filtered results list
  const filteredResults = useMemo(() => {
    return bulkResults.filter((item) => {
      const matchSearch = item.phone_number.includes(searchQuery.replace(/\D/g, ""));
      const isV = item.can_order || item.verification_status === "VERIFIED";
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "verified" && isV) ||
        (statusFilter === "not_verified" && !isV);
      return matchSearch && matchStatus;
    });
  }, [bulkResults, searchQuery, statusFilter]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Mode Navigation Tabs */}
      <div className="flex items-center justify-between gap-2 p-1.5 rounded-2xl bg-muted/50 border border-border">
        <div className="grid grid-cols-2 gap-1 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
              mode === "single"
                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Single Check</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
              mode === "bulk"
                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Bulk & File Check</span>
          </button>
        </div>

        <Badge
          variant="outline"
          className="hidden sm:inline-flex text-[10px] font-mono font-bold text-amber-500 border-amber-500/30 bg-amber-500/10 px-2.5 py-1"
        >
          ⚡ Instant & Free Provider Precheck
        </Badge>
      </div>

      {/* ── MODE 1: SINGLE NUMBER CHECK ── */}
      {mode === "single" && (
        <Card className={cn("border shadow-xl rounded-2xl backdrop-blur-xl overflow-hidden", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  Instant Beneficiary Whitelist Lookup
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Verify whether an MTN number is approved to receive Affordable SME bundles.
                </CardDescription>
              </div>
              <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-bold">
                Wallet-Safe (0 Debits)
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-4">
            <form onSubmit={handleSingleCheck} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Phone Number
                  </label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={singlePhone}
                      onChange={(e) => setSinglePhone(e.target.value)}
                      placeholder="0XX XXXXXXX (e.g. 0551234567)"
                      maxLength={12}
                      className="w-full h-12 rounded-xl bg-muted/50 border border-border px-4 text-foreground placeholder:text-muted-foreground/60 text-sm font-mono font-bold focus:outline-none focus:border-amber-500 transition-all"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                        {detectNetwork(singlePhone)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Network
                  </label>
                  <select
                    value={singleNetwork}
                    onChange={(e) => setSingleNetwork(e.target.value)}
                    className="w-full h-12 rounded-xl bg-muted/50 border border-border px-3 text-foreground text-xs font-bold focus:outline-none focus:border-amber-500 transition-all cursor-pointer"
                  >
                    <option value="MTN">MTN / Yello (Requires Whitelist)</option>
                    <option value="Telecel">Telecel (No Whitelist Needed)</option>
                    <option value="AirtelTigo">AirtelTigo (No Whitelist Needed)</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={singleChecking || !singlePhone.trim()}
                className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all"
              >
                {singleChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Querying Carrier SME Whitelist...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Check Whitelist Status
                  </>
                )}
              </Button>
            </form>

            {/* Single Result Presentation */}
            <AnimatePresence>
              {singleResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={cn(
                    "p-4 rounded-2xl border transition-all mt-4",
                    singleResult.can_order
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-amber-500/10 border-amber-500/25 text-amber-300"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {singleResult.can_order ? (
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                          <AlertTriangle className="w-6 h-6 text-amber-400" />
                        </div>
                      )}

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-black text-foreground">
                            {singleResult.phone_number}
                          </span>
                          <Badge
                            className={cn(
                              "text-[10px] font-black uppercase px-2 py-0.5",
                              singleResult.can_order
                                ? "bg-emerald-500 text-black"
                                : "bg-amber-500 text-black"
                            )}
                          >
                            {singleResult.verification_status}
                          </Badge>
                        </div>
                        <p className="text-xs font-semibold mt-1 opacity-90 leading-snug">
                          {singleResult.message}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy(singleResult.phone_number, "single")}
                      className="p-2 rounded-lg bg-black/20 hover:bg-black/40 text-foreground transition-all"
                    >
                      {copiedPhone === "single" ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  {/* Contextual Next Step Actions */}
                  <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2 justify-between">
                    {singleResult.can_order ? (
                      <Link
                        to={`/buy-data?network=${singleNetwork}&phone=${singleResult.phone_number}`}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-md transition-all active:scale-95"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        Buy Data for this Number Now ➔
                      </Link>
                    ) : submittedSingleSuccess ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Submitted to MTN! Carrier approval usually takes 5-15 mins.
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          onClick={handleQuickSubmitSingle}
                          disabled={submittingSingle}
                          className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs h-9 rounded-xl shadow-md transition-all active:scale-95"
                        >
                          {submittingSingle ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          Whitelist This Number Now (Free)
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            if (onTransferToSubmit) onTransferToSubmit([singleResult.phone_number]);
                          }}
                          className="text-xs font-bold text-amber-400 hover:underline px-2"
                        >
                          Open in Batch Submission ➔
                        </button>
                      </div>
                    )}

                    <span className="text-[10px] text-muted-foreground font-mono">
                      Query Ref: {Date.now().toString(36).toUpperCase()}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      {/* ── MODE 2: BULK & EXCEL CHECK ── */}
      {mode === "bulk" && (
        <Card className={cn("border shadow-xl rounded-2xl backdrop-blur-xl overflow-hidden", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  Bulk Beneficiary Whitelist Audit (Up to 1,000 Numbers)
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Paste recipient lists or drag & drop spreadsheets to scan which numbers are approved on the carrier database.
                </CardDescription>
              </div>

              <div className="text-right">
                <span className="text-[11px] font-mono font-bold text-muted-foreground bg-muted px-2.5 py-1 rounded-lg border border-border">
                  <span className={cn(parsedBulk.valid.length > 0 ? "text-amber-500 font-bold" : "")}>
                    {parsedBulk.valid.length}
                  </span>{" "}
                  Numbers Detected
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-4">
            {/* Drag & Drop Excel Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
              className={cn(
                "relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer",
                isDragOver
                  ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-950/20"
                  : isDark
                  ? "border-slate-800 bg-slate-950/40 hover:border-emerald-500/50 hover:bg-slate-900/60"
                  : "border-gray-200 bg-slate-50/50 hover:border-emerald-500/50 hover:bg-emerald-50/30"
              )}
            >
              <input
                type="file"
                accept=".xlsx, .xls, .csv, .txt"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                <UploadCloud className="w-6 h-6 text-emerald-400" />
                <p className="text-xs font-bold text-foreground">
                  Drop Excel (.xlsx, .xls) or CSV here, or click to browse
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Automatically extracts valid Ghana numbers from any column
                </p>
              </div>
            </div>

            {/* Multiline Paste Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span>Or Paste Numbers (One per line or comma-separated)</span>
                {bulkText.trim() && (
                  <button
                    type="button"
                    onClick={() => setBulkText("")}
                    className="text-red-400 hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear Text
                  </button>
                )}
              </div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"0551234567\n0241234567\n0598458971\n..."}
                rows={5}
                className="w-full rounded-xl bg-muted/50 border border-border p-3 text-foreground placeholder:text-muted-foreground/60 text-xs font-mono font-medium focus:outline-none focus:border-amber-500 transition-all resize-y"
              />
            </div>

            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-xs font-bold text-muted-foreground shrink-0">Network:</label>
                <select
                  value={bulkNetwork}
                  onChange={(e) => setBulkNetwork(e.target.value)}
                  className="h-10 rounded-xl bg-muted/50 border border-border px-3 text-foreground text-xs font-bold focus:outline-none focus:border-amber-500 transition-all cursor-pointer"
                >
                  <option value="MTN">MTN / Yello (Carrier Whitelist)</option>
                  <option value="Telecel">Telecel</option>
                  <option value="AirtelTigo">AirtelTigo</option>
                </select>
              </div>

              <Button
                type="button"
                onClick={handleBulkCheck}
                disabled={bulkChecking || parsedBulk.valid.length === 0}
                className="w-full sm:w-auto min-w-[200px] h-11 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all"
              >
                {bulkChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Scanning {parsedBulk.valid.length} Numbers ({bulkProgress}%)...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Check Whitelist Status ({parsedBulk.valid.length})
                  </>
                )}
              </Button>
            </div>

            {/* Progress bar */}
            {bulkChecking && (
              <div className="space-y-1">
                <Progress value={bulkProgress} className="h-2 bg-muted rounded-full" />
                <p className="text-[10px] text-muted-foreground text-center font-mono">
                  Checking in chunks of 500 with BundleZone carrier check...
                </p>
              </div>
            )}

            {/* ── BULK RESULTS DASHBOARD ── */}
            {bulkSummary && bulkResults.length > 0 && (
              <div className="pt-4 border-t border-border/50 space-y-4">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-muted/40 border border-border">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Checked</p>
                    <p className="text-xl font-black text-foreground mt-0.5">{bulkSummary.total}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Whitelisted</p>
                    <p className="text-xl font-black text-emerald-500 mt-0.5">{bulkSummary.verified}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Not Whitelisted</p>
                    <p className="text-xl font-black text-amber-500 mt-0.5">{bulkSummary.not_verified}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Whitelist Rate</p>
                    <p className="text-xl font-black text-blue-500 mt-0.5">
                      {Math.round((bulkSummary.verified / bulkSummary.total) * 100)}%
                    </p>
                  </div>
                </div>

                {/* Operations Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-muted/30 border border-border">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {bulkSummary.not_verified > 0 && (
                      <Button
                        type="button"
                        onClick={handleTransferUnverified}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs h-8 px-3 rounded-lg shadow-sm"
                      >
                        <Send className="w-3 h-3 mr-1.5" />
                        Submit All Unverified ({bulkSummary.not_verified}) for Whitelist Approval
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleCopyBatch("verified")}
                      className="text-xs h-8 px-3 rounded-lg border-border"
                    >
                      <Copy className="w-3 h-3 mr-1.5 text-emerald-400" />
                      Copy Whitelisted ({bulkSummary.verified})
                    </Button>
                    {bulkSummary.not_verified > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleCopyBatch("not_verified")}
                        className="text-xs h-8 px-3 rounded-lg border-border"
                      >
                        <Copy className="w-3 h-3 mr-1.5 text-amber-400" />
                        Copy Unverified ({bulkSummary.not_verified})
                      </Button>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportExcel}
                    className="text-xs h-8 px-3 rounded-lg border-border"
                  >
                    <Download className="w-3 h-3 mr-1.5 text-emerald-400" />
                    Export (.xlsx)
                  </Button>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setStatusFilter("all")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                        statusFilter === "all"
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      All ({bulkResults.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("verified")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                        statusFilter === "verified"
                          ? "bg-emerald-500 text-black"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Whitelisted ({bulkSummary.verified})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("not_verified")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                        statusFilter === "not_verified"
                          ? "bg-amber-500 text-black"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Unverified ({bulkSummary.not_verified})
                    </button>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search phone number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted/50 border border-border text-xs font-mono font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {/* Results Table */}
                <div className="border border-border rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/80 text-[10px] uppercase font-bold text-muted-foreground sticky top-0 backdrop-blur-md">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Phone Number</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Message</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono">
                      {filteredResults.map((item, idx) => {
                        const isV = item.can_order || item.verification_status === "VERIFIED";
                        return (
                          <tr key={idx} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-3 text-muted-foreground font-normal">{idx + 1}</td>
                            <td className="py-2 px-3 font-bold text-foreground">{item.phone_number}</td>
                            <td className="py-2 px-3">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full",
                                  isV
                                    ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/25"
                                    : "bg-amber-500/15 text-amber-500 border border-amber-500/25"
                                )}
                              >
                                {isV ? <CheckCircle2 className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
                                {item.verification_status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-[11px] font-sans text-muted-foreground max-w-xs truncate">
                              {item.message}
                            </td>
                            <td className="py-2 px-3 text-right font-sans">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(item.phone_number, `bulk-${idx}`)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                  title="Copy"
                                >
                                  {copiedPhone === `bulk-${idx}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                                {isV ? (
                                  <Link
                                    to={`/buy-data?network=${bulkNetwork}&phone=${item.phone_number}`}
                                    className="text-[10px] font-bold text-emerald-500 hover:underline px-1"
                                  >
                                    Buy Data
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onTransferToSubmit) onTransferToSubmit([item.phone_number]);
                                    }}
                                    className="text-[10px] font-bold text-amber-500 hover:underline px-1"
                                  >
                                    Submit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredResults.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground font-sans">
                            No matching phone numbers found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BeneficiaryWhitelistChecker;
