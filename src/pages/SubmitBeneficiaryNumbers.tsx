import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Trash2,
  Terminal,
  ArrowRight,
  UserCheck,
  ShieldCheck,
  PhoneCall,
  ChevronDown,
  FileSpreadsheet,
  UploadCloud,
  FileText,
  Download,
  FileUp,
  Layers,
  History,
  Search,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { invokePublicFunction } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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
  return "Ghana Mobile";
}

function fmtSubmissionDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function SubmitBeneficiaryNumbers() {
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentBatchText, setCurrentBatchText] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [showApiDocs, setShowApiDocs] = useState(false);

  // Dialog Modals state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  // Smart Excel / File upload state
  const [fileParsing, setFileParsing] = useState(false);
  const [excelSummary, setExcelSummary] = useState<{
    fileName: string;
    totalScanned: number;
    validNumbers: string[];
    invalidCount: number;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Response state
  const [responseResult, setResponseResult] = useState<{
    received: number;
    unique: number;
    submitted: number;
    alreadyOnList: number;
    duplicates: number;
    numbers: string[];
    invalid: string[];
    message: string;
    error?: string;
  } | null>(null);

  // My Submitted Numbers — persistent history for the logged-in user
  const [myNumbers, setMyNumbers] = useState<
    { id: string; phone: string; network: string; status: string; created_at: string; notes?: string }[]
  >([]);
  const [loadingMyNumbers, setLoadingMyNumbers] = useState(false);
  const [myNumbersSearch, setMyNumbersSearch] = useState("");
  const [myNumbersError, setMyNumbersError] = useState<string | null>(null);

  const fetchMySubmittedNumbers = useCallback(async () => {
    if (!user?.email) {
      setMyNumbers([]);
      return;
    }
    setLoadingMyNumbers(true);
    setMyNumbersError(null);
    try {
      const { data, error } = await supabase
        .from("beneficiary_submissions" as any)
        .select("*")
        .eq("submitted_by", user.email)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      setMyNumbers(
        ((data as any[]) || []).map((row) => ({
          id: row.id,
          phone: row.phone_number,
          network: row.network || detectNetwork(row.phone_number),
          status: row.status || "submitted",
          created_at: row.created_at,
          notes: row.notes,
        }))
      );
    } catch (err: any) {
      console.error("[MySubmittedNumbers] fetch error:", err);
      setMyNumbers([]);
      setMyNumbersError("Couldn't load your submission history right now.");
    } finally {
      setLoadingMyNumbers(false);
    }
  }, [user?.email]);

  useEffect(() => {
    fetchMySubmittedNumbers();
  }, [fetchMySubmittedNumbers]);

  const filteredMyNumbers = useMemo(() => {
    if (!myNumbersSearch.trim()) return myNumbers;
    const q = myNumbersSearch.trim().toLowerCase();
    return myNumbers.filter((n) => n.phone.toLowerCase().includes(q) || n.network.toLowerCase().includes(q));
  }, [myNumbers, myNumbersSearch]);

  const parseExcelFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    const rawValues: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false });
      for (const row of rows) {
        if (Array.isArray(row)) {
          for (const cell of row) {
            if (cell !== undefined && cell !== null) {
              const cellStr = String(cell).trim();
              if (cellStr) rawValues.push(cellStr);
            }
          }
        }
      }
    }

    const validNumbers: string[] = [];
    let invalidCount = 0;

    for (const val of rawValues) {
      const res = normalizeGhanaPhone(val);
      if (res.isValid) {
        if (!validNumbers.includes(res.normalized)) {
          validNumbers.push(res.normalized);
        }
      } else {
        const digits = val.replace(/\D/g, "");
        if (digits.length >= 7) {
          invalidCount++;
        }
      }
    }

    return {
      fileName: file.name,
      totalScanned: rawValues.length,
      validNumbers,
      invalidCount,
    };
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    const allowedExts = [".xlsx", ".xls", ".csv", ".tsv", ".txt"];
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExts.includes(ext)) {
      toast({
        title: "Unsupported file format",
        description: "Please upload an Excel (.xlsx, .xls) or CSV/TXT file.",
        variant: "destructive",
      });
      return;
    }

    setFileParsing(true);
    try {
      const result = await parseExcelFile(file);
      setExcelSummary(result);

      if (result.validNumbers.length === 0) {
        toast({
          title: "No valid numbers found",
          description: `Scanned ${result.totalScanned} cells/rows in ${file.name}, but found no valid Ghanaian mobile numbers.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Smart Excel Extraction Complete! 🚀",
          description: `Extracted ${result.validNumbers.length} valid number(s) from ${file.name}.`,
        });
      }
    } catch (err: any) {
      console.error("[Excel Parser Error]", err);
      toast({
        title: "Failed to parse file",
        description: err.message || "An error occurred while processing the file.",
        variant: "destructive",
      });
    } finally {
      setFileParsing(false);
    }
  };

  const handleApplyExcelNumbers = (mode: "replace" | "append") => {
    if (!excelSummary || excelSummary.validNumbers.length === 0) return;

    if (mode === "replace") {
      setRawText(excelSummary.validNumbers.join("\n"));
      toast({
        title: "Text Area Updated",
        description: `Loaded ${excelSummary.validNumbers.length} valid numbers from ${excelSummary.fileName}.`,
      });
    } else {
      const existing = rawText.trim()
        .split(/[\n,\s]+/)
        .map((n) => n.trim())
        .filter(Boolean);

      const merged = [...new Set([...existing, ...excelSummary.validNumbers])];
      setRawText(merged.join("\n"));
      toast({
        title: "Numbers Appended",
        description: `Appended ${excelSummary.validNumbers.length} numbers (Total unique: ${merged.length}).`,
      });
    }

    setExcelSummary(null);
  };

  const handleDownloadSampleExcel = () => {
    const sampleData = [
      { "Phone Number": "0538122730", "Network": "MTN", "Name": "Beneficiary 1" },
      { "Phone Number": "0241234567", "Network": "MTN", "Name": "Beneficiary 2" },
      { "Phone Number": "0554226398", "Network": "MTN", "Name": "Beneficiary 3" },
      { "Phone Number": "233241112233", "Network": "MTN", "Name": "Beneficiary 4" },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Beneficiary Numbers");
    XLSX.writeFile(wb, "sample_beneficiary_numbers.xlsx");

    toast({
      title: "Sample Template Downloaded",
      description: "Downloaded sample_beneficiary_numbers.xlsx template.",
    });
  };

  // Parse raw text in real-time
  const parsedData = useMemo(() => {
    if (!rawText.trim()) {
      return { items: [], valid: [], invalid: [], chunksCount: 0 };
    }

    const items = rawText
      .split(/[\n,\s]+/)
      .map((n) => n.trim())
      .filter(Boolean);

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

    return {
      items,
      valid,
      invalid,
      chunksCount: Math.ceil(valid.length / 500),
    };
  }, [rawText]);

  // Calculate total batch count (30 per API call)
  const batchCount = useMemo(() => {
    if (parsedData.valid.length === 0) return 0;
    return Math.ceil(parsedData.valid.length / 30);
  }, [parsedData.valid]);

  const handleFormat = () => {
    if (parsedData.valid.length === 0) {
      toast({
        title: "No valid numbers to format",
        description: "Please enter valid Ghanaian mobile phone numbers.",
        variant: "destructive",
      });
      return;
    }
    setRawText(parsedData.valid.join("\n"));
    toast({
      title: "Formatted Successfully",
      description: `Cleaned and formatted ${parsedData.valid.length} valid number(s).`,
    });
  };

  const handleLoadSample = () => {
    const sample = "0538122730\n0241234567\n0554226398";
    setRawText(sample);
    setResponseResult(null);
  };

  const handleClear = () => {
    setRawText("");
    setResponseResult(null);
    toast({
      title: "Text Cleared",
      description: "Text area cleared. Ready for new phone numbers.",
    });
  };

  // Step 1: Open Confirmation Modal
  const handleInitiateSubmit = () => {
    if (!rawText.trim()) {
      toast({
        title: "Input required",
        description: "Please enter at least one MTN phone number.",
        variant: "destructive",
      });
      return;
    }

    if (parsedData.valid.length === 0) {
      toast({
        title: "No valid numbers",
        description: "None of the entered phone numbers are valid Ghanaian mobile numbers.",
        variant: "destructive",
      });
      return;
    }

    setShowConfirmModal(true);
  };

  // Step 2: Execute actual submission logic in 500-number chunks
  const handleConfirmSubmit = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setProgressPercent(0);
    setResponseResult(null);
    const totalValid = parsedData.valid;
    const CHUNK_SIZE = 500;
    const BATCH_SIZE = 30; // sub-batches per API call

    const totalChunks = Math.ceil(totalValid.length / CHUNK_SIZE);
    let allSubmittedNumbers: string[] = [];
    let allFailedNumbers: string[] = [];
    let allInvalidNumbers: string[] = [...parsedData.invalid];
    let totalReceived = 0;
    let totalUnique = 0;
    let totalSubmitted = 0;
    let totalAlreadyOnList = 0;
    let totalDuplicates = 0;
    let successfulBatchesCount = 0;
    let lastErrorMsg = "";

    try {
      let processedValidSoFar = 0;

      for (let cIndex = 0; cIndex < totalChunks; cIndex++) {
        const chunk = totalValid.slice(cIndex * CHUNK_SIZE, (cIndex + 1) * CHUNK_SIZE);
        const chunkNum = cIndex + 1;

        // Sub-batch chunk into groups of 30 for API payloads
        const batches: string[][] = [];
        for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
          batches.push(chunk.slice(i, i + BATCH_SIZE));
        }

        for (let bIndex = 0; bIndex < batches.length; bIndex++) {
          const currentBatch = batches[bIndex];
          
          if (totalChunks > 1) {
            setCurrentBatchText(`Chunk ${chunkNum}/${totalChunks} (Numbers ${processedValidSoFar + 1}-${Math.min(processedValidSoFar + chunk.length, totalValid.length)}) — Batch ${bIndex + 1}/${batches.length}...`);
          } else {
            setCurrentBatchText(`Submitting batch ${bIndex + 1} of ${batches.length}...`);
          }

          const currentTotalProcessed = processedValidSoFar + (bIndex + 1) * BATCH_SIZE;
          setProgressPercent(Math.min(100, Math.round((currentTotalProcessed / totalValid.length) * 100)));

          let resData: any = null;
          let funcError: any = null;

          // Tier 1: Direct DataHub Provider API call (Fastest, zero edge function gateway preflight errors).
          // Only attempted when the caller can actually read the real provider key
          // (admins, via RLS) — regular/anonymous users fall straight through to
          // Tier 2+, which fetch the key server-side and never expose it client-side.
          try {
            const { data: provider } = await supabase
              .from("providers")
              .select("api_key, base_url")
              .eq("handler_type", "datahub")
              .eq("is_active", true)
              .maybeSingle();

            if (!provider?.api_key) {
              throw new Error("No client-visible provider key — falling through to server-side tiers");
            }

            const apiKey = provider.api_key;
            const baseUrl = provider.base_url || "https://user.datahubgh.com/api/external";

            const cleanBase = baseUrl.trim().replace(/\/+$/, "");
            const targetUrl = cleanBase.endsWith("/purchases/submit-numbers")
              ? cleanBase
              : cleanBase.includes("/purchases")
              ? `${cleanBase}/submit-numbers`
              : `${cleanBase}/purchases/submit-numbers`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const directRes = await fetch(targetUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
              },
              body: JSON.stringify({ numbers: currentBatch.join(", ") }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const text = await directRes.text();
            let parsed: any = null;
            try { parsed = JSON.parse(text); } catch {}

            if (directRes.ok || parsed?.success || parsed?.data?.submitted !== undefined || parsed?.data?.received !== undefined) {
              resData = parsed || {
                success: true,
                data: {
                  received: currentBatch.length,
                  unique: currentBatch.length,
                  submitted: currentBatch.length,
                  already_on_list: 0,
                  duplicates: 0,
                  numbers: currentBatch,
                  invalid: [],
                  message: `${currentBatch.length} number(s) submitted for beneficiary approval`,
                },
              };
              funcError = null;
            }
          } catch (err: any) {
            funcError = err;
          }

          // Tier 2: Try dedicated submit-numbers Edge Function if Tier 1 failed
          if (!resData?.success) {
            try {
              const sRes = await invokePublicFunction("submit-numbers", {
                body: { numbers: currentBatch.join(", ") },
              });
              if (sRes?.data && (sRes.data.success || sRes.data.data)) {
                resData = sRes.data;
                funcError = null;
              } else if (sRes?.data && !sRes.data.success) {
                resData = sRes.data;
              } else if (sRes?.error) {
                funcError = sRes.error;
              }
            } catch (err: any) {
              funcError = err;
            }
          }

          // Tier 3: Try active verify-beneficiary Edge Function with submit_numbers action
          if (!resData?.success) {
            try {
              const vRes = await invokePublicFunction("verify-beneficiary", {
                body: { action: "submit_numbers", numbers: currentBatch.join(", ") },
              });
              if (vRes?.data && (vRes.data.success || vRes.data.data)) {
                resData = vRes.data;
                funcError = null;
              } else if (vRes?.data && !vRes.data.success) {
                resData = vRes.data;
              } else if (vRes?.error) {
                funcError = vRes.error;
              }
            } catch (err: any) {
              funcError = err;
            }
          }

          // Tier 4: Try developer-api Edge Function if all previous tiers failed
          if (!resData?.success) {
            try {
              const devApiRes = await invokePublicFunction("developer-api/purchases/submit-numbers", {
                body: { numbers: currentBatch.join(", ") },
              });
              if (devApiRes?.data && (devApiRes.data.success || devApiRes.data.data)) {
                resData = devApiRes.data;
                funcError = null;
              } else if (devApiRes?.data && !devApiRes.data.success) {
                resData = devApiRes.data;
              } else if (devApiRes?.error) {
                funcError = devApiRes.error;
              }
            } catch (err: any) {
              funcError = err;
            }
          }

          if (funcError && !resData) {
            console.error(`Chunk ${chunkNum} batch ${bIndex + 1} error:`, funcError);
            const formattedErr = await getFunctionErrorMessage(funcError, "Failed to submit numbers batch");
            lastErrorMsg = formattedErr;
            allFailedNumbers = [...allFailedNumbers, ...currentBatch];
            continue;
          }

          if (resData && (resData.success || resData.data)) {
            const d = resData.data || resData;
            const batchNumbers: string[] = d.numbers || currentBatch;
            allSubmittedNumbers = [...allSubmittedNumbers, ...batchNumbers];
            if (d.invalid) {
              allInvalidNumbers = [...allInvalidNumbers, ...d.invalid];
            }

            const bSubmitted = d.submitted ?? (d.already_on_list !== undefined || d.alreadyOnList !== undefined ? 0 : batchNumbers.length);
            const bAlreadyOnList = d.already_on_list ?? d.alreadyOnList ?? (bSubmitted === 0 ? batchNumbers.length : 0);
            const bReceived = d.received ?? batchNumbers.length;
            const bUnique = d.unique ?? batchNumbers.length;
            const bDuplicates = d.duplicates ?? 0;

            totalSubmitted += bSubmitted;
            totalAlreadyOnList += bAlreadyOnList;
            totalReceived += bReceived;
            totalUnique += bUnique;
            totalDuplicates += bDuplicates;
            successfulBatchesCount++;
          } else {
            lastErrorMsg = resData?.error || resData?.message || "Batch submission failed";
            if (resData?.invalid) {
              allInvalidNumbers = [...allInvalidNumbers, ...resData.invalid];
            }
            allFailedNumbers = [...allFailedNumbers, ...currentBatch];
          }

          // Small pause between batches to avoid tripping provider-side rate
          // limits on large uploads (hundreds/thousands of numbers).
          if (bIndex < batches.length - 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }

        processedValidSoFar += chunk.length;
      }

      if (successfulBatchesCount > 0 || totalReceived > 0 || totalSubmitted > 0 || totalAlreadyOnList > 0) {
        const uniqueSubmitted = [...new Set(allSubmittedNumbers)];
        const finalMsg = `Submission complete. Received ${totalReceived} · unique ${totalUnique} · submitted for approval ${totalSubmitted} · already on list ${totalAlreadyOnList} · duplicates ${totalDuplicates}`;

        setResponseResult({
          received: totalReceived,
          unique: totalUnique,
          submitted: totalSubmitted,
          alreadyOnList: totalAlreadyOnList,
          duplicates: totalDuplicates,
          numbers: uniqueSubmitted,
          invalid: [...new Set(allInvalidNumbers)],
          message: finalMsg,
        });

        // Record submitted AND failed numbers into the database so Admin can
        // see everything that was attempted, not just what succeeded.
        // upsert (not insert) so retries/duplicate tiers update the existing
        // row per number instead of piling up duplicates.
        const uniqueFailed = [...new Set(allFailedNumbers)].filter((n) => !uniqueSubmitted.includes(n));
        try {
          const successRecords = uniqueSubmitted.map((num) => ({
            phone_number: num,
            network: detectNetwork(num),
            status: totalSubmitted > 0 ? "submitted" : "whitelisted",
            source: excelSummary ? `Excel (${excelSummary.fileName})` : "Web UI",
            submitted_by: user?.email || "Web User",
            notes: totalAlreadyOnList > 0 ? "Already whitelisted on carrier list" : "Submitted for carrier whitelisting approval",
          }));
          const failedRecords = uniqueFailed.map((num) => ({
            phone_number: num,
            network: detectNetwork(num),
            status: "failed",
            source: excelSummary ? `Excel (${excelSummary.fileName})` : "Web UI",
            submitted_by: user?.email || "Web User",
            notes: lastErrorMsg || "Submission failed after all provider attempts",
          }));

          const { error: dbErr } = await supabase
            .from("beneficiary_submissions" as any)
            .upsert([...successRecords, ...failedRecords] as any, { onConflict: "phone_number" });

          if (dbErr) {
            console.error("[DB Log] beneficiary_submissions upsert FAILED:", dbErr);
            toast({
              title: "Admin log not saved",
              description: "Numbers were processed but couldn't be recorded for admin visibility. Please notify support with this time and number count.",
              variant: "destructive",
            });
          }
        } catch (dbErr) {
          console.error("[DB Log] beneficiary_submissions upsert FAILED:", dbErr);
          toast({
            title: "Admin log not saved",
            description: "Numbers were processed but couldn't be recorded for admin visibility. Please notify support with this time and number count.",
            variant: "destructive",
          });
        }

        // Show completion modal!
        setShowCompleteModal(true);
      } else {
        const errMessage = lastErrorMsg || "Failed to submit numbers for approval";
        setResponseResult({
          received: 0,
          unique: 0,
          submitted: 0,
          alreadyOnList: 0,
          duplicates: 0,
          numbers: [],
          invalid: [...new Set(allInvalidNumbers)],
          message: errMessage,
          error: errMessage,
        });

        // Every batch failed — still record them as "failed" so admin can see
        // exactly which numbers were attempted and lost, instead of nothing.
        try {
          const failedRecords = [...new Set(allFailedNumbers)].map((num) => ({
            phone_number: num,
            network: detectNetwork(num),
            status: "failed",
            source: excelSummary ? `Excel (${excelSummary.fileName})` : "Web UI",
            submitted_by: user?.email || "Web User",
            notes: errMessage,
          }));
          if (failedRecords.length > 0) {
            await supabase
              .from("beneficiary_submissions" as any)
              .upsert(failedRecords as any, { onConflict: "phone_number" });
          }
        } catch (dbErr) {
          console.error("[DB Log] beneficiary_submissions failure-record FAILED:", dbErr);
        }

        toast({
          title: "Submission Failed",
          description: errMessage,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error("[SubmitNumbers] Execution error:", err);
      const errMsg = err.message || "Upstream approval service error. Please try again later.";
      setResponseResult({
        submitted: 0,
        numbers: [],
        invalid: [...new Set(allInvalidNumbers)],
        message: errMsg,
        error: errMsg,
      });

      toast({
        title: "Error",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setProgressPercent(0);
      setCurrentBatchText("");
      fetchMySubmittedNumbers();
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    toast({ title: "Copied to clipboard!" });
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const curlExample = `curl -X POST \\
  "https://swiftdatagh.com/api/external/purchases/submit-numbers" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: sk_live_your_swift_api_key" \\
  -d '{
    "numbers": "${parsedData.valid.length > 0 ? parsedData.valid.slice(0, 3).join(", ") : "0241234567, 0551234569, 0538122730"}"
  }'`;

  return (
    <div className="min-h-[calc(100vh-64px)] pt-16 sm:pt-6 pb-20 sm:pb-12 px-2.5 sm:px-6 lg:px-8 max-w-2xl mx-auto space-y-2.5 sm:space-y-6">
      {/* ── Ultra-Compact Header Card (Clears Fixed Navbar) ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-purple-500/10 p-2.5 sm:p-5 border border-amber-500/20 backdrop-blur-xl shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-2xl font-black tracking-tight text-foreground">
              Submit Numbers
            </h1>
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-[9px] sm:text-xs px-2 py-0.2 font-bold">
              Beneficiary Approval
            </Badge>
          </div>

          {user ? (
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[9px] px-2 py-0.2 font-bold">
              Account
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-[9px] px-2 py-0.2 font-bold">
              Guest
            </Badge>
          )}
        </div>

        <p className={cn("text-[11px] sm:text-xs leading-snug mt-1", isDark ? "text-gray-300" : "text-gray-600")}>
          Paste or upload numbers to submit for beneficiary whitelisting. Processed in chunks of 500. Check status:{" "}
          <Link to="/dashboard/buy-data/mtn" className="underline text-amber-400 font-bold">
            Verify Numbers
          </Link>
        </p>
      </div>

      {/* ── Smart Step-by-Step Beneficiary Guide Banner ── */}
      <div className={cn("p-3.5 sm:p-4 rounded-2xl border backdrop-blur-xl space-y-2.5", isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-900")}>
        <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wide">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Smart 3-Step Beneficiary Activation Guide</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] sm:text-xs">
          <div className={cn("p-2.5 rounded-xl border flex items-start gap-2", isDark ? "bg-black/30 border-white/5" : "bg-white border-amber-200/60 shadow-sm")}>
            <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-black text-[10px] flex items-center justify-center shrink-0 shadow-sm">1</span>
            <div>
              <p className="font-bold">Paste Phone Number</p>
              <p className="opacity-75 text-[10px]">Enter your MTN number in the box below or upload Excel file.</p>
            </div>
          </div>
          <div className={cn("p-2.5 rounded-xl border flex items-start gap-2", isDark ? "bg-black/30 border-white/5" : "bg-white border-amber-200/60 shadow-sm")}>
            <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-black text-[10px] flex items-center justify-center shrink-0 shadow-sm">2</span>
            <div>
              <p className="font-bold">Tap Submit for Approval</p>
              <p className="opacity-75 text-[10px]">Your number is queued for instant carrier whitelisting.</p>
            </div>
          </div>
          <div className={cn("p-2.5 rounded-xl border flex items-start gap-2", isDark ? "bg-black/30 border-white/5" : "bg-white border-amber-200/60 shadow-sm")}>
            <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-black text-[10px] flex items-center justify-center shrink-0 shadow-sm">3</span>
            <div>
              <p className="font-bold">Retry Order (5-15 mins)</p>
              <p className="opacity-75 text-[10px]">Once approved, retry your order for 100% instant delivery!</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Input Card (Fits 100% on Mobile View) ── */}
      <Card className={cn("border shadow-xl rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-300", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
        <CardHeader className="pb-2 border-b border-white/5 px-3 sm:px-5 pt-2.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5">
              <PhoneCall className="w-3.5 h-3.5 text-amber-500" /> Phone numbers
            </CardTitle>

            <div className="flex items-center gap-2">
              {rawText.trim() && (
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold">
                  <span className="text-emerald-400">{parsedData.valid.length} Valid</span>
                  {parsedData.invalid.length > 0 && <span className="text-red-400">• {parsedData.invalid.length} Invalid</span>}
                </div>
              )}
              <div className="text-[11px] font-mono font-bold text-muted-foreground bg-slate-800/60 px-2 py-0.5 rounded-lg border border-slate-700/40">
                <span className={cn(parsedData.valid.length > 0 ? "text-amber-400 font-bold" : "")}>
                  {parsedData.valid.length}
                </span>{" "}
                Numbers ({parsedData.chunksCount} Chunk{parsedData.chunksCount > 1 ? "s" : ""})
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 sm:p-5 space-y-2.5">
          {/* ── Smart Excel / CSV Upload Card & Dropzone ── */}
          <div className="space-y-2 pb-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Smart Excel / File Upload
              </span>
              <button
                type="button"
                onClick={handleDownloadSampleExcel}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 hover:underline transition-all"
              >
                <Download className="w-3 h-3" /> Sample Template (.xlsx)
              </button>
            </div>

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
                "relative border-2 border-dashed rounded-xl p-3 text-center transition-all cursor-pointer group",
                isDragOver
                  ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-950/20"
                  : isDark
                  ? "border-slate-800 bg-slate-950/40 hover:border-emerald-500/50 hover:bg-slate-900/60"
                  : "border-gray-200 bg-slate-50/50 hover:border-emerald-500/50 hover:bg-emerald-50/30"
              )}
            >
              <input
                type="file"
                accept=".xlsx, .xls, .csv, .tsv, .txt"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />

              <div className="flex items-center justify-center gap-2">
                {fileParsing ? (
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                ) : (
                  <UploadCloud className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                )}
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">
                    {fileParsing ? "Scanning & Normalizing Excel Cells..." : "Drop Excel (.xlsx, .xls) or CSV here"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Smart scanner extracts & formats Ghanaian numbers automatically
                  </p>
                </div>
              </div>
            </div>

            {/* Smart Extraction Summary Card */}
            {excelSummary && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white truncate max-w-[180px]">
                      {excelSummary.fileName}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 bg-emerald-500/10 text-[10px]">
                    {excelSummary.validNumbers.length} Valid Numbers
                  </Badge>
                </div>

                <div className="text-[11px] text-slate-300 grid grid-cols-2 gap-1 font-mono">
                  <div>Total Cells Scanned: <span className="text-white font-bold">{excelSummary.totalScanned}</span></div>
                  <div>Invalid/Skipped: <span className="text-amber-400 font-bold">{excelSummary.invalidCount}</span></div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleApplyExcelNumbers("replace")}
                    className="h-7 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex-1 gap-1"
                  >
                    <Sparkles className="w-3 h-3" /> Replace List
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleApplyExcelNumbers("append")}
                    className="h-7 text-[10px] font-bold border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 rounded-lg flex-1 gap-1"
                  >
                    <Layers className="w-3 h-3" /> Append ({excelSummary.validNumbers.length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setExcelSummary(null)}
                    className="h-7 text-[10px] text-slate-400 hover:text-white px-2"
                  >
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input Textarea - Ultra-Compact on mobile view */}
          <div className="relative">
            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`0538122730\n0241234567\n0554226398`}
              className={cn(
                "min-h-[90px] sm:min-h-[200px] max-h-[140px] sm:max-h-none font-mono text-xs sm:text-sm rounded-xl p-2.5 sm:p-4 resize-y transition-all border leading-relaxed",
                isDark
                  ? "bg-slate-950/80 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-amber-500/50"
                  : "bg-slate-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-amber-500"
              )}
            />

            {rawText && (
              <button
                onClick={handleClear}
                title="Clear text"
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-300 hover:text-red-400 transition-all border border-slate-700/50 shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Action Toolbar Pills Grid (Fits 100% of all mobile device screen widths) */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={!rawText.trim()}
                className="h-8 text-[11px] font-bold rounded-lg border-amber-500/30 text-amber-500 hover:bg-amber-500/10 gap-1 px-1 sm:px-3 justify-center"
              >
                <Trash2 className="w-3 h-3 shrink-0" /> Clear
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFormat}
                disabled={!rawText.trim()}
                className="h-8 text-[11px] font-bold rounded-lg border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white gap-1 px-1 sm:px-3 justify-center"
              >
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" /> Format
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadSample}
                className="h-8 text-[11px] font-bold rounded-lg border-slate-700 text-amber-500 hover:bg-amber-500/10 gap-1 px-1 sm:px-3 justify-center"
              >
                <Copy className="w-3 h-3 shrink-0" /> Sample
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground leading-tight text-center sm:text-left">
              One per line or separated by commas/spaces (Accepts 0XXXXXXXXX or 233XXXXXXXXX).
            </p>
          </div>

          {/* Progress indicator during bulk batching */}
          {loading && progressPercent > 0 && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-xs text-amber-400 font-medium">
                <span>{currentBatchText}</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-1.5 bg-slate-800" />
            </div>
          )}

          {/* Submit Button (Full Width Mobile CTA) */}
          <div className="pt-1">
            <Button
              onClick={handleInitiateSubmit}
              disabled={loading || !rawText.trim() || parsedData.valid.length === 0}
              className={cn(
                "w-full h-11 sm:h-12 rounded-xl font-extrabold text-xs sm:text-sm shadow-lg gap-2 transition-all active:scale-[0.98]",
                "bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 shadow-blue-950/40"
              )}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Submit numbers for approval
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Response & Output Section ── */}
      <AnimatePresence>
        {responseResult && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
          >
            <Card className={cn("border shadow-xl rounded-2xl overflow-hidden backdrop-blur-xl", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
              <CardHeader className="pb-2 border-b border-white/5 p-3.5 sm:p-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-500" /> Submission Results
                  </CardTitle>
                  <Badge variant={responseResult.submitted > 0 ? "default" : "destructive"} className="text-[10px] px-2 py-0.5 font-bold">
                    {responseResult.submitted > 0 ? `Submitted (${responseResult.submitted})` : "Failed"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-3.5 sm:p-5 space-y-3">
                <div
                  className={cn(
                    "p-3 rounded-xl border text-xs font-medium space-y-1",
                    responseResult.submitted > 0
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                  )}
                >
                  <div className="flex items-center gap-2 font-bold">
                    {responseResult.submitted > 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>{responseResult.message}</span>
                  </div>
                </div>

                {responseResult.numbers && responseResult.numbers.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                      <span>Whitelisted Numbers ({responseResult.numbers.length})</span>
                      <button
                        onClick={() => copyToClipboard(responseResult.numbers.join("\n"), "all-submitted")}
                        className="text-amber-500 hover:underline flex items-center gap-1 text-[11px]"
                      >
                        {copiedIndex === "all-submitted" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy List
                      </button>
                    </div>

                    <div className="max-h-44 overflow-y-auto rounded-xl border p-2 bg-black/30 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {responseResult.numbers.map((num, idx) => (
                        <div key={idx} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-mono bg-white/5 border border-white/5">
                          <span>{num}</span>
                          <span className="text-[9px] text-emerald-400 font-bold uppercase">Submitted</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── My Submitted Numbers (persistent history, logged-in users only) ── */}
      {user ? (
        <Card className={cn("border shadow-xl rounded-2xl overflow-hidden backdrop-blur-xl", isDark ? "bg-slate-900/90 border-slate-800" : "bg-white border-gray-200")}>
          <CardHeader className="pb-2 border-b border-white/5 px-3 sm:px-5 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-500" /> My Submitted Numbers
              </CardTitle>
              <button
                onClick={fetchMySubmittedNumbers}
                disabled={loadingMyNumbers}
                className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3 h-3", loadingMyNumbers && "animate-spin")} /> Refresh
              </button>
            </div>
            <CardDescription className="text-[10px] sm:text-xs">
              Numbers you've submitted for beneficiary approval, and their current status.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-3 sm:p-5 space-y-3">
            {myNumbers.length > 0 && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={myNumbersSearch}
                    onChange={(e) => setMyNumbersSearch(e.target.value)}
                    placeholder="Search your numbers..."
                    className={cn(
                      "w-full pl-8 pr-3 py-2 text-xs rounded-xl border outline-none transition-all",
                      isDark
                        ? "bg-slate-950/80 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-1 focus-visible:ring-amber-500/50"
                        : "bg-slate-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-amber-500"
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Whitelisted</p>
                    <p className="text-base font-black text-emerald-400">{myNumbers.filter((n) => n.status === "whitelisted").length}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400">Pending</p>
                    <p className="text-base font-black text-blue-400">{myNumbers.filter((n) => n.status === "submitted").length}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-red-400">Failed</p>
                    <p className="text-base font-black text-red-400">{myNumbers.filter((n) => n.status === "failed").length}</p>
                  </div>
                </div>
              </>
            )}

            {loadingMyNumbers ? (
              <div className="space-y-1.5">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ) : myNumbersError ? (
              <p className="text-xs text-muted-foreground text-center py-4">{myNumbersError}</p>
            ) : filteredMyNumbers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {myNumbers.length === 0 ? "No numbers submitted yet — your history will appear here." : "No numbers match your search."}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
                {filteredMyNumbers.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs",
                      isDark ? "bg-white/5 border-white/5" : "bg-gray-50 border-gray-100"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {n.status === "whitelisted" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : n.status === "failed" ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      )}
                      <span className="font-mono font-bold truncate">{n.phone}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10 shrink-0">
                        {n.network}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          "text-[9px] font-black uppercase tracking-wider",
                          n.status === "whitelisted" ? "text-emerald-400" : n.status === "failed" ? "text-red-400" : "text-blue-400"
                        )}
                      >
                        {n.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{fmtSubmissionDate(n.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={cn("p-4 rounded-2xl border text-center text-xs", isDark ? "bg-slate-900/50 border-slate-800 text-slate-400" : "bg-gray-50 border-gray-200 text-gray-500")}>
          <Link to="/login" className="text-amber-400 font-bold hover:underline">Sign in</Link> to see your submission history across visits.
        </div>
      )}

      {/* ── Collapsible Developer API Section (Zero Space Waste on Mobile View) ── */}
      <div className="pt-1">
        <button
          onClick={() => setShowApiDocs(!showApiDocs)}
          className={cn(
            "w-full px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all",
            isDark ? "bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200" : "bg-gray-100 border-gray-200 text-gray-700"
          )}
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-amber-500" /> Developer API Endpoint (cURL)
          </span>
          <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", showApiDocs ? "rotate-180" : "")} />
        </button>

        <AnimatePresence>
          {showApiDocs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden pt-2"
            >
              <Card className={cn("border shadow-md rounded-xl overflow-hidden", isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-gray-200")}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">POST /purchases/submit-numbers</span>
                    <button
                      onClick={() => copyToClipboard(curlExample, "curl-code")}
                      className="text-amber-500 hover:underline flex items-center gap-1 font-semibold"
                    >
                      {copiedIndex === "curl-code" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy cURL
                    </button>
                  </div>

                  <pre className="p-3 rounded-lg font-mono text-[10px] overflow-x-auto bg-slate-950 text-slate-100 border border-slate-800 leading-relaxed">
                    {curlExample}
                  </pre>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── 1. CONFIRMATION DIALOG MODAL (Mobile Responsive) ── */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className={cn("w-[92vw] sm:max-w-md border shadow-2xl rounded-2xl p-5", isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-900 border-slate-800 text-white")}>
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-base sm:text-xl font-extrabold text-white">
              Submit for approval?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-300 leading-relaxed">
              You are about to submit <strong className="text-white font-bold">{parsedData.valid.length}</strong> numbers for approval to be added to our beneficiary list.
            </DialogDescription>
          </DialogHeader>

          <p className="text-[11px] text-slate-400 pt-1">
            This will be processed in <strong className="text-white font-bold">{parsedData.chunksCount}</strong> chunk{parsedData.chunksCount > 1 ? "s" : ""} of 500 ({batchCount} API batch{batchCount > 1 ? "es" : ""}).
          </p>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={handleConfirmSubmit}
              className="h-9 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white gap-1.5 shadow-lg"
            >
              <Send className="w-3.5 h-3.5" /> Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 2. COMPLETION DIALOG MODAL (Pixel-Perfect DataHub Stat Cards Grid) ── */}
      <Dialog open={showCompleteModal} onOpenChange={setShowCompleteModal}>
        <DialogContent className={cn("w-[92vw] sm:max-w-md border shadow-2xl rounded-2xl p-5 space-y-4", isDark ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-900 border-slate-800 text-white")}>
          <div className="flex items-start gap-2.5">
            <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>

            <div className="space-y-1">
              <DialogTitle className="text-base sm:text-xl font-extrabold text-white">
                Submission complete
              </DialogTitle>
              <DialogDescription className="text-xs font-medium text-emerald-400 leading-relaxed">
                Submission complete. Received {responseResult?.received ?? parsedData.valid.length} · unique {responseResult?.unique ?? parsedData.valid.length} · submitted for approval {responseResult?.submitted ?? 0} · already on list {responseResult?.alreadyOnList ?? 0} · duplicates {responseResult?.duplicates ?? 0}
              </DialogDescription>
            </div>
          </div>

          {/* 4 Stat Cards Grid (Matching User Screenshot) */}
          <div className="grid grid-cols-2 gap-2.5 pt-1 font-mono">
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 font-sans">Received</span>
              <p className="text-lg font-bold text-white">{responseResult?.received ?? parsedData.valid.length}</p>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 font-sans">Unique</span>
              <p className="text-lg font-bold text-white">{responseResult?.unique ?? parsedData.valid.length}</p>
            </div>

            <div className={cn(
              "p-3 rounded-xl border space-y-1 transition-all",
              (responseResult?.submitted ?? 0) > 0
                ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-400"
                : "bg-emerald-950/10 border-emerald-500/20 text-emerald-400/80"
            )}>
              <span className="text-[11px] font-semibold font-sans text-emerald-400">Submitted</span>
              <p className="text-lg font-bold text-emerald-400">{responseResult?.submitted ?? 0}</p>
            </div>

            <div className={cn(
              "p-3 rounded-xl border space-y-1 transition-all",
              (responseResult?.alreadyOnList ?? 0) > 0
                ? "bg-blue-950/30 border-blue-500/40 text-blue-400"
                : "bg-slate-900/90 border-slate-800 text-slate-400"
            )}>
              <span className="text-[11px] font-semibold font-sans text-blue-400">Already on list</span>
              <p className="text-lg font-bold text-blue-400">{responseResult?.alreadyOnList ?? 0}</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-mono font-medium text-slate-400">
              Batches completed: {batchCount}/{batchCount}
            </span>

            <Button
              type="button"
              onClick={() => setShowCompleteModal(false)}
              className="h-9 px-6 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
