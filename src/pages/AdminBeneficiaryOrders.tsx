import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { RefreshCw, Phone, ShieldAlert, Copy, Check, Users, Search, Calendar, RotateCcw, ListCheck, Play, Wallet, Loader2, Sparkles, ExternalLink, ArrowRight, Zap, CheckCircle2, Send, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";
import { invokePublicFunction } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";

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
  metadata?: any;
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
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [groupedNumbers, setGroupedNumbers] = useState<GroupedBeneficiaryNumber[]>([]);
  const [allBeneficiaryOrders, setAllBeneficiaryOrders] = useState<BeneficiaryOrder[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupedBeneficiaryNumber | null>(null);

  // Processing Action States
  const [processingBatch, setProcessingBatch] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [routingDatamart, setRoutingDatamart] = useState(false);
  const [submittingNumbers, setSubmittingNumbers] = useState(false);
  const [submittingPhone, setSubmittingPhone] = useState<string | null>(null);
  const [sendingSmsPhone, setSendingSmsPhone] = useState<string | null>(null);
  const [sendingBulkSms, setSendingBulkSms] = useState(false);

  // Auto-Submit Sentinel: newly-detected non-beneficiary numbers get submitted
  // for carrier approval automatically 5s after they first appear here, with no
  // admin click needed. If the provider reports the number was already on the
  // beneficiary list, status flips to "In Queue" and its pending orders are
  // auto-retried; otherwise it shows "Submitted for Approval" (pending carrier review).
  const AUTO_SUBMIT_DELAY_MS = 5000;
  type AutoStatus = "pending" | "submitting" | "submitted" | "in_queue";
  const [autoStatus, setAutoStatus] = useState<Record<string, AutoStatus>>({});
  const scheduledPhonesRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const allOrdersRef = useRef<BeneficiaryOrder[]>([]);

  // Shared submission core: sends numbers to DataHub in batches of 30 AND
  // records every outcome (success or failure) into beneficiary_submissions
  // so admin's records stay complete regardless of which entry point was used.
  const submitNumbersToDataHub = async (
    numbers: string[],
    sourceLabel: string
  ): Promise<{ submitted: number; failed: number; alreadyOnList: number }> => {
    const BATCH_SIZE = 30;
    let totalSubmitted = 0;
    let totalFailed = 0;
    let totalAlreadyOnList = 0;

    const { data: provider } = await supabase
      .from("providers")
      .select("api_key, base_url")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .maybeSingle();

    // No hardcoded fallback key here on purpose — it would ship in the JS bundle
    // for anyone who fetches this chunk. Without a real (RLS-gated) key, Attempt 1
    // below is skipped entirely and every batch goes straight to the edge function,
    // which fetches the key server-side and never exposes it to the client.
    const providerData = (provider || {}) as Record<string, any>;
    const apiKey = (providerData.api_key || "") as string;
    const baseUrl = ((providerData.base_url || "https://user.datahubgh.com/api/external") as string).trim().replace(/\/+$/, "");
    const targetUrl = baseUrl.endsWith("/purchases/submit-numbers")
      ? baseUrl
      : baseUrl.includes("/purchases")
      ? `${baseUrl}/submit-numbers`
      : `${baseUrl}/purchases/submit-numbers`;

    for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
      const batch = numbers.slice(i, i + BATCH_SIZE);
      let ok = false;
      let statusCode: number | null = null;
      let errDetail = "";
      let submittedCount = 0;
      let alreadyOnListCount = 0;

      // Attempt 1: direct browser -> DataHub (fast path when it isn't CORS-blocked),
      // only when we actually have a real key visible to this caller.
      // Bounded with a timeout so a stalled request can't hang the whole batch loop.
      if (apiKey) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify({ numbers: batch.join(", ") }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          statusCode = res.status;
          const text = await res.text();
          let parsed: any = null;
          try { parsed = JSON.parse(text); } catch (_err) { /* ignore parse error */ }

          if (res.ok || parsed?.success) {
            ok = true;
            submittedCount = parsed?.data?.submitted ?? batch.length;
            alreadyOnListCount = parsed?.data?.already_on_list ?? parsed?.data?.alreadyOnList ?? 0;
          } else {
            errDetail = `HTTP ${res.status}: ${text.slice(0, 200)}`;
          }
        } catch (err: any) {
          errDetail = err?.name === "AbortError"
            ? "Direct request timed out after 8s"
            : `Connection error: ${err.message || err}`;
        }
      }

      // Attempt 2: fall back to the submit-numbers edge function — the same
      // proven-reliable path the public Submit Numbers form uses, which also
      // has its own built-in retry-with-backoff for transient network errors.
      if (!ok) {
        try {
          const { data, error } = await invokePublicFunction("submit-numbers", {
            body: { numbers: batch.join(", ") },
          });
          if (data && (data.success || data.data)) {
            ok = true;
            const d = data.data || data;
            submittedCount = d.submitted ?? batch.length;
            alreadyOnListCount = d.already_on_list ?? d.alreadyOnList ?? 0;
            statusCode = 200;
            errDetail = "";
          } else if (error) {
            errDetail = await getFunctionErrorMessage(error, errDetail || "Edge function submission failed");
          }
        } catch (err: any) {
          errDetail = err.message || errDetail || "Edge function submission failed";
        }
      }

      if (ok) {
        totalSubmitted += submittedCount;
        totalAlreadyOnList += alreadyOnListCount;
      } else {
        totalFailed += batch.length;
      }

      try {
        const records = batch.map((num) => ({
          phone_number: num,
          network: "MTN",
          status: !ok ? "failed" : alreadyOnListCount > 0 ? "whitelisted" : "submitted",
          source: sourceLabel,
          submitted_by: "Admin",
          notes: ok
            ? `Submitted via ${sourceLabel} — provider responded ${statusCode}`
            : errDetail || "Submission failed",
          provider_status_code: statusCode,
        }));
        try {
          await supabase
            .from("beneficiary_submissions" as any)
            .upsert(records as any, { onConflict: "phone_number" });
        } catch {
          // Table optional; safe fallback
        }
      } catch (e) {
        // Safe fallback
      }

      // Small pause between batches on large submissions to avoid tripping
      // provider-side rate limits.
      if (i + BATCH_SIZE < numbers.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return { submitted: totalSubmitted, failed: totalFailed, alreadyOnList: totalAlreadyOnList };
  };

  // Shared "this number is confirmed on the beneficiary list right now" path —
  // flips the badge to In Queue and immediately retries its pending orders.
  // handleRetrySingle does its own fresh beneficiary check first, so this is
  // safe even if the list changed between whatever check triggered this and now.
  const promoteToInQueue = async (phone: string) => {
    setAutoStatus((prev) => ({ ...prev, [phone]: "in_queue" }));
    const pendingOrders = allOrdersRef.current.filter(
      (o) => o.customer_phone === phone && o.status !== "fulfilled" && o.status !== "completed"
    );
    for (const ord of pendingOrders) {
      await handleRetrySingle(ord);
    }
  };

  // Fires automatically AUTO_SUBMIT_DELAY_MS after a number is first confirmed
  // NOT yet on the beneficiary list — submits it for carrier approval with no
  // admin click required, then reacts to what the provider reports back.
  const runAutoSubmit = async (phone: string) => {
    setAutoStatus((prev) => ({ ...prev, [phone]: "submitting" }));
    try {
      const { submitted, alreadyOnList } = await submitNumbersToDataHub(
        [phone],
        "Auto-Submit Sentinel (5s)"
      );

      if (alreadyOnList > 0) {
        await promoteToInQueue(phone);
      } else if (submitted > 0) {
        setAutoStatus((prev) => ({ ...prev, [phone]: "submitted" }));
      } else {
        // Failed — leave it visible as still-pending so the manual "Submit for
        // Approval" button remains the obvious next step.
        setAutoStatus((prev) => ({ ...prev, [phone]: "pending" }));
      }
    } catch (e) {
      console.error("[AutoSubmit] failed for", phone, e);
      setAutoStatus((prev) => ({ ...prev, [phone]: "pending" }));
    }
  };

  // Entry point for every number in the Non-Beneficiary Hub — runs an
  // immediate, cheap "is this already whitelisted?" check FIRST (covers
  // numbers that were submitted a while ago and may have been approved
  // since — no reason to make those wait), and only falls back to the 5s
  // delayed auto-submit for numbers genuinely not on the list yet.
  const checkAndScheduleAutoSubmit = async (phone: string, network: string) => {
    setAutoStatus((prev) => ({ ...prev, [phone]: "pending" }));
    try {
      const { data: vData } = await supabase.functions.invoke("verify-beneficiary", {
        body: { phone, network: network || "MTN" },
      });
      if (vData?.exists) {
        await promoteToInQueue(phone);
        return;
      }
    } catch (e) {
      console.error("[AutoSubmit] immediate beneficiary check failed for", phone, e);
      // Fall through to the scheduled submit regardless — worst case it
      // re-submits a number that was already pending, which is harmless.
    }

    const timer = setTimeout(() => {
      timersRef.current.delete(phone);
      runAutoSubmit(phone);
    }, AUTO_SUBMIT_DELAY_MS);
    timersRef.current.set(phone, timer);
  };

  const handleSubmitAllToBeneficiaryApproval = async () => {
    const numbersToSubmit = Array.from(new Set(groupedNumbers.map((g) => g.phone).filter(Boolean)));
    if (numbersToSubmit.length === 0) {
      toast({ title: "No numbers to submit", description: "There are no non-beneficiary numbers to submit for approval." });
      return;
    }

    if (!confirm(`Submit all ${numbersToSubmit.length} unique non-beneficiary numbers directly to DataHub for carrier approval?`)) {
      return;
    }

    setSubmittingNumbers(true);
    toast({ title: "Submitting Numbers for Approval...", description: `Sending ${numbersToSubmit.length} numbers in batches to DataHub...` });

    try {
      const { submitted, failed } = await submitNumbersToDataHub(numbersToSubmit, "Admin Non-Beneficiary Hub (bulk)");
      toast({
        title: "Whitelisting Submitted! 🚀",
        description: `Successfully submitted ${submitted} number(s) to DataHub for beneficiary approval.${failed > 0 ? ` ${failed} failed — check the Submitted Numbers page for details.` : ""}`,
      });
    } catch (err: any) {
      toast({
        title: "Submission Error",
        description: err.message || "Failed to submit numbers to DataHub",
        variant: "destructive",
      });
    } finally {
      setSubmittingNumbers(false);
    }
  };

  // Submit a single flagged number for approval — the per-row action for
  // when one specific number is detected as not part of the beneficiary list.
  const handleSubmitSingleForApproval = async (phone: string) => {
    setSubmittingPhone(phone);
    toast({ title: "Submitting for Approval...", description: `Sending ${phone} to DataHub for carrier whitelisting...` });

    try {
      const { submitted } = await submitNumbersToDataHub([phone], "Admin Non-Beneficiary Hub (single)");
      if (submitted > 0) {
        toast({ title: "Submitted for Approval! 🚀", description: `${phone} was sent to DataHub for carrier whitelisting.` });
      } else {
        toast({
          title: "Submission Failed",
          description: `Could not submit ${phone} to the provider. Check the Submitted Numbers page for details.`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Submission Error", description: err.message || "Failed to submit number", variant: "destructive" });
    } finally {
      setSubmittingPhone(null);
    }
  };

  const handleSendBeneficiarySms = async (phone: string, amount?: number) => {
    setSendingSmsPhone(phone);
    toast({ title: "Sending Beneficiary Guide SMS...", description: `Sending step-by-step approval guide to ${phone}...` });

    try {
      const { data, error } = await supabase.functions.invoke("send-order-sms", {
        body: {
          phone,
          action: "non_beneficiary",
          amount: amount || 0,
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

  const handleBulkSendBeneficiarySms = async () => {
    const numbers = Array.from(new Set(groupedNumbers.map((g) => g.phone).filter(Boolean)));
    if (numbers.length === 0) {
      toast({ title: "No numbers to notify", description: "No non-beneficiary numbers found." });
      return;
    }

    if (!confirm(`Send Step-by-Step Beneficiary Guide SMS to all ${numbers.length} unique phone numbers?`)) {
      return;
    }

    setSendingBulkSms(true);
    toast({ title: "Sending Bulk SMS Guides...", description: `Notifying ${numbers.length} numbers with step-by-step approval guide...` });

    let sent = 0;
    for (const phone of numbers) {
      try {
        const { data } = await supabase.functions.invoke("send-order-sms", {
          body: { phone, action: "non_beneficiary" },
        });
        if (data?.success) sent++;
      } catch (e) { /* ignore */ }
    }

    toast({
      title: "Bulk SMS Complete! 📱",
      description: `Sent Step-by-Step Approval Guide SMS to ${sent} of ${numbers.length} numbers.`,
    });
    setSendingBulkSms(false);
  };

  const handleRouteAllToDatamart = async () => {
    if (!confirm(`Are you sure you want to FORCE-ROUTE all ${allBeneficiaryOrders.length} non-beneficiary orders directly to Datamart API?`)) {
      return;
    }

    setRoutingDatamart(true);
    toast({ title: "Routing Orders to Datamart API...", description: "Connecting to Datamart API and submitting orders..." });

    try {
      const { data, error } = await supabase.functions.invoke("route-to-datamart", {
        body: { target: "all_beneficiary" }
      });

      if (error || !data?.success) {
        toast({
          title: "Datamart Routing Failed",
          description: error?.message || data?.error || "Could not route orders to Datamart API",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Datamart Routing Complete! ⚡",
          description: data.message || `Successfully routed ${data.routedCount || 0} orders to Datamart API.`,
        });
        fetchBeneficiaryOrders();
      }
    } catch (err: any) {
      toast({
        title: "Routing Error",
        description: err.message || "Failed to call Datamart API router",
        variant: "destructive"
      });
    } finally {
      setRoutingDatamart(false);
    }
  };

  const fetchBeneficiaryOrders = useCallback(async () => {
    setLoading(true);
    try {
      let q: any = supabase
        .from("orders")
        .select("id, agent_id, customer_phone, network, package_size, amount, status, failure_reason, auto_refunded, metadata, created_at")
        .eq("status", "fulfillment_failed")
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
        const filteredBeneficiaryOrders = rawOrders.filter((o) => {
          const reason = (o.failure_reason || "").toLowerCase();
          return reason.includes("beneficiary") || reason.includes("not added");
        });

        const agentIds = Array.from(new Set(filteredBeneficiaryOrders.map((o) => o.agent_id).filter(Boolean)));
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", agentIds);

        const profileMap = new Map<string, { full_name?: string; email?: string }>();
        (profiles || []).forEach((p) => profileMap.set(p.user_id, p));

        const enriched: BeneficiaryOrder[] = filteredBeneficiaryOrders.map((o) => {
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

  // Keep a ref mirror of the latest orders so runAutoSubmit (fired from a
  // setTimeout closure) always sees fresh data instead of whatever was
  // current when its timer was scheduled.
  useEffect(() => {
    allOrdersRef.current = allBeneficiaryOrders;
  }, [allBeneficiaryOrders]);

  // Process every non-beneficiary number exactly once per phone, the first
  // time it's seen (including ones that were already "submitted" from before
  // this feature existed, or from an earlier page load) — scheduledPhonesRef
  // prevents re-processing on every refetch, and timers live in a ref (not
  // effect-cleanup-tied) so an unrelated refetch within the 5s window can't
  // cancel a still-pending auto-submit.
  useEffect(() => {
    groupedNumbers.forEach((grp) => {
      if (scheduledPhonesRef.current.has(grp.phone)) return;
      scheduledPhonesRef.current.add(grp.phone);
      checkAndScheduleAutoSubmit(grp.phone, grp.network);
    });
  }, [groupedNumbers, checkAndScheduleAutoSubmit]);

  // Only clear pending timers on actual unmount (navigating away) — not on
  // every re-render.
  useEffect(() => {
    const currentTimers = timersRef.current;
    return () => {
      currentTimers.forEach((t) => clearTimeout(t));
      currentTimers.clear();
    };
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const copyAllNumbersCsv = () => {
    const numbersList = Array.from(new Set(groupedNumbers.map((g) => g.phone))).join("\n");
    copyToClipboard(numbersList, "csv_copied");
  };

  // RETRY SINGLE ORDER WITH BENEFICIARY CHECK FIRST
  const handleRetrySingle = async (ord: BeneficiaryOrder) => {
    setProcessingId(ord.id);
    try {
      // 1. Verify beneficiary status first
      const { data: vData } = await supabase.functions.invoke("verify-beneficiary", {
        body: { phone: ord.customer_phone, network: ord.network || "MTN" }
      });

      if (!vData?.exists) {
        toast({
          title: "Still Not Whitelisted",
          description: `${ord.customer_phone} is still not added to the carrier beneficiary list. Order remains safely refunded.`,
          variant: "destructive"
        });
        setProcessingId(null);
        return;
      }

      // 2. If verified, update order metadata to bypass_beneficiary = true & status = 'paid'
      await (supabase.from("orders") as any).update({
        status: "paid",
        auto_refunded: false,
        failure_reason: null,
        metadata: { ...(ord.metadata || {}), bypass_beneficiary: true }
      }).eq("id", ord.id);

      // Instantly remove from local list so it leaves the page immediately!
      setAllBeneficiaryOrders((prev) => prev.filter((o) => o.id !== ord.id));

      // 3. Invoke verify-payment Edge function (with automatic 429 rate-limit backoff)
      let res = await supabase.functions.invoke("verify-payment", {
        body: { reference: ord.id, order_id: ord.id, force: true, action: "retry_order" }
      });

      if (res.error && (res.error.status === 429 || String(res.error.message).includes("429") || String(res.error.message).includes("Too many"))) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await supabase.functions.invoke("verify-payment", {
          body: { reference: ord.id, order_id: ord.id, force: true, action: "retry_order" }
        });
      }

      const { data, error } = res;

      if (error) {
        toast({ title: "Retry failed", description: error.message || "Failed to contact provider", variant: "destructive" });
      } else {
        toast({
          title: "Order Re-submitted!",
          description: `Order ${ord.id.slice(0, 8)} status: ${data?.status || "processing"}`,
        });

        // Trigger SMS
        supabase.functions.invoke("send-order-sms", {
          body: {
            action: "retry",
            phone: ord.customer_phone,
            order_id: ord.id,
            amount: ord.amount,
            network: ord.network,
            package_size: ord.package_size,
            agent_id: ord.agent_id
          }
        }).catch(console.error);
      }
    } catch (err: any) {
      toast({ title: "Retry exception", description: err.message || "Error retrying order", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  // REFUND SINGLE ORDER
  const handleRefundSingle = async (ord: BeneficiaryOrder) => {
    if (ord.status === "refunded" || ord.auto_refunded) {
      toast({ title: "Already Refunded", description: "This order has already been credited to wallet." });
      return;
    }

    if (!confirm(`Are you sure you want to refund GH₵ ${Number(ord.amount).toFixed(2)} to ${ord.agent_email}?`)) {
      return;
    }

    setProcessingId(ord.id);
    try {
      let isRefunded = false;
      let statusMsg = "";

      try {
        const { data: edgeData, error: edgeErr } = await supabase.functions.invoke("verify-and-refund", {
          body: { order_id: ord.id }
        });
        if (!edgeErr && edgeData?.success) {
          isRefunded = true;
          statusMsg = edgeData.message || `GH₵ ${Number(ord.amount).toFixed(2)} returned to wallet.`;
        } else if (!edgeErr && edgeData?.error) {
          toast({ title: "Refund Blocked", description: edgeData.error, variant: "destructive" });
          setProcessingId(null);
          return;
        }
      } catch (e) {
        console.warn("[Admin Refund] Edge function error, falling back to direct server RPC...", e);
      }

      if (!isRefunded) {
        const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)("refund_failed_order", { p_order_id: ord.id });
        if (rpcErr || !rpcData) {
          toast({ title: "Refund Failed", description: rpcErr?.message || "This order is ineligible for refund.", variant: "destructive" });
          setProcessingId(null);
          return;
        }
        isRefunded = true;
        statusMsg = `GH₵ ${Number(ord.amount).toFixed(2)} returned to wallet.`;
      }

      if (isRefunded) {
        toast({ title: "Order Refunded!", description: statusMsg });
        supabase.functions.invoke("send-order-sms", {
          body: {
            action: "refund",
            phone: ord.customer_phone,
            order_id: ord.id,
            amount: ord.amount,
            agent_id: ord.agent_id
          }
        }).catch(console.error);
      }
      await fetchBeneficiaryOrders();
    } catch (err: any) {
      toast({ title: "Refund Error", description: err.message || "Could not execute refund", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  // BATCH RETRY ALL
  const handleRetryAllBeneficiary = async () => {
    const targetOrders = allBeneficiaryOrders.filter((o) => o.status !== "fulfilled" && o.status !== "completed");
    if (targetOrders.length === 0) {
      toast({ title: "No Orders to Retry", description: "There are no pending or failed beneficiary orders to retry." });
      return;
    }

    if (!confirm(`Are you sure you want to RE-SUBMIT all ${targetOrders.length} non-beneficiary orders with beneficiary bypass?`)) {
      return;
    }

    setProcessingBatch(true);
    toast({ title: "Batch Retrying Orders...", description: `Re-submitting ${targetOrders.length} orders in parallel batches...` });

    let successCount = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < targetOrders.length; i += BATCH_SIZE) {
      const chunk = targetOrders.slice(i, i + BATCH_SIZE);

      await Promise.all(
        chunk.map(async (ord) => {
          try {
            await (supabase.from("orders") as any).update({
              status: "paid",
              auto_refunded: false,
              failure_reason: null,
              metadata: { ...(ord.metadata || {}), bypass_beneficiary: true }
            }).eq("id", ord.id);

            let res = await supabase.functions.invoke("verify-payment", {
              body: { reference: ord.id, order_id: ord.id, force: true, action: "retry_order" }
            });
            if (res.error && (res.error.status === 429 || String(res.error.message).includes("429"))) {
              await new Promise((r) => setTimeout(r, 2000));
              res = await supabase.functions.invoke("verify-payment", {
                body: { reference: ord.id, order_id: ord.id, force: true, action: "retry_order" }
              });
            }
            const data = res.data;
            if (data?.status === "fulfilled" || data?.status === "processing") {
              successCount++;
            }
          } catch {
            // continue batch
          }
        })
      );
      if (i + BATCH_SIZE < targetOrders.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    toast({ title: "Batch Retry Complete", description: `Processed ${targetOrders.length} orders. ${successCount} successfully submitted.` });
    setProcessingBatch(false);
    await fetchBeneficiaryOrders();
  };

  // BATCH REFUND ALL
  const handleRefundAllBeneficiary = async () => {
    const unrefunded = allBeneficiaryOrders.filter((o) => !o.auto_refunded && o.status !== "refunded" && o.status !== "fulfilled");
    if (unrefunded.length === 0) {
      toast({ title: "All Orders Already Refunded", description: "Every non-beneficiary order is already refunded to agent wallets." });
      return;
    }

    const totalUnrefundedAmount = unrefunded.reduce((sum, o) => sum + Number(o.amount || 0), 0);

    if (!confirm(`Are you sure you want to REFUND all ${unrefunded.length} unrefunded orders totaling GH₵ ${totalUnrefundedAmount.toFixed(2)} to agent wallets?`)) {
      return;
    }

    setProcessingBatch(true);
    toast({ title: "Processing Batch Refunds...", description: `Refunding ${unrefunded.length} orders to agent wallets...` });

    let refundedCount = 0;
    let totalRefunded = 0;

    for (const ord of unrefunded) {
      try {
        const { data } = await supabase.functions.invoke("verify-and-refund", {
          body: { order_id: ord.id }
        });
        if (data?.success) {
          refundedCount++;
          totalRefunded += Number(ord.amount || 0);
        }
      } catch {
        // continue
      }
    }

    toast({
      title: "Batch Refund Complete!",
      description: `Refunded ${refundedCount} of ${unrefunded.length} orders totaling GH₵ ${totalRefunded.toFixed(2)}.`,
    });
    setProcessingBatch(false);
    await fetchBeneficiaryOrders();
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
  const unrefundedCount = allBeneficiaryOrders.filter((o) => !o.auto_refunded && o.status !== "refunded" && o.status !== "fulfilled").length;

  // Sentinel status badge — reflects the auto-submit lifecycle for this phone.
  const renderAutoStatusBadge = (phone: string) => {
    const status = autoStatus[phone];
    if (status === "submitting") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Submitting...
        </span>
      );
    }
    if (status === "submitted") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400">
          <Send className="w-3 h-3" /> Submitted for Approval
        </span>
      );
    }
    if (status === "in_queue") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          <Clock className="w-3 h-3" /> In Queue
        </span>
      );
    }
    return null;
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Premium Mobile-Optimized Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-purple-500/10 p-5 sm:p-8 border border-amber-500/20 backdrop-blur-xl shadow-xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] sm:text-xs font-extrabold bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
              <Sparkles className="w-3.5 h-3.5" /> Carrier Whitelist Sentinel Active
            </div>
            <h1 className={cn("font-display text-2xl sm:text-4xl font-black tracking-tight flex items-center gap-2.5", isDark ? "text-white" : "text-gray-900")}>
              Non-Beneficiary Hub
            </h1>
            <p className={cn("text-xs sm:text-base max-w-2xl leading-relaxed", isDark ? "text-white/70" : "text-gray-600")}>
              Real-time monitoring and 1-click batch whitelisting for numbers blocked by carrier beneficiary requirements.
            </p>
          </div>

          {/* Touch-Optimized Action Button Grid */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5">
            <Button
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-950/30 transition-all active:scale-95 text-xs sm:text-sm"
              onClick={handleSubmitAllToBeneficiaryApproval}
              disabled={submittingNumbers || loading || totalUniqueNumbers === 0}
            >
              {submittingNumbers ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit All to Carrier Whitelist ({totalUniqueNumbers})
            </Button>

            <Button
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold rounded-2xl shadow-lg shadow-purple-950/30 transition-all active:scale-95 text-xs sm:text-sm"
              onClick={handleBulkSendBeneficiarySms}
              disabled={sendingBulkSms || loading || totalUniqueNumbers === 0}
            >
              {sendingBulkSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              📱 Send Bulk Guide SMS ({totalUniqueNumbers})
            </Button>

            <Button
              asChild
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 text-white font-extrabold rounded-2xl shadow-lg shadow-blue-950/30 transition-all active:scale-95 text-xs sm:text-sm border border-blue-400/40"
            >
              <Link to="/admin/submitted-numbers">
                <Phone className="w-4 h-4" /> All Submitted Numbers Page
              </Link>
            </Button>

            <Button
              asChild
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-500 text-white font-extrabold rounded-2xl shadow-lg shadow-amber-950/30 transition-all active:scale-95 text-xs sm:text-sm border border-amber-400/40"
            >
              <Link to="/submit-numbers">
                <ExternalLink className="w-4 h-4" /> Submit New Numbers Page
              </Link>
            </Button>

            <Button
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-500 text-white font-extrabold rounded-2xl shadow-lg shadow-amber-950/30 transition-all active:scale-95 text-xs sm:text-sm border border-amber-400/40"
              onClick={handleRouteAllToDatamart}
              disabled={routingDatamart || loading || allBeneficiaryOrders.length === 0}
            >
              {routingDatamart ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-amber-200 text-amber-200 animate-pulse" />}
              ⚡ Route All to Datamart API ({allBeneficiaryOrders.length})
            </Button>

            <Button
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-950/20 transition-all active:scale-95 text-xs sm:text-sm"
              onClick={handleRetryAllBeneficiary}
              disabled={processingBatch || loading}
            >
              {processingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
              Retry All ({allBeneficiaryOrders.length})
            </Button>

            <Button
              variant="default"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 sm:px-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-purple-950/20 transition-all active:scale-95 text-xs sm:text-sm"
              onClick={handleRefundAllBeneficiary}
              disabled={processingBatch || loading || unrefundedCount === 0}
            >
              {processingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Refund All ({unrefundedCount})
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto gap-2 h-11 px-4 rounded-2xl border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold backdrop-blur-sm text-xs sm:text-sm"
              onClick={copyAllNumbersCsv}
            >
              {copiedText === "csv_copied" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {copiedText === "csv_copied" ? "Copied List!" : "Export CSV"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-11 h-11 p-0 rounded-2xl border-white/10 hover:bg-white/10 flex items-center justify-center"
              onClick={fetchBeneficiaryOrders}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-amber-500/20 shadow-xl shadow-amber-950/10" : "bg-white border-amber-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Unique Flagged</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500">
              <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400">
            {totalUniqueNumbers}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span> Whitelist Pending
          </p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-purple-500/20 shadow-xl shadow-purple-950/10" : "bg-white border-purple-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Attempts</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-purple-500/15 flex items-center justify-center text-purple-500">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400">
            {totalAttempts}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Total transactions</p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-emerald-500/20 shadow-xl shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Volume</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-emerald-500/15 flex items-center justify-center text-emerald-500">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
            GH₵ {totalVolume.toFixed(2)}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Gross value</p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-blue-500/20 shadow-xl shadow-blue-950/10" : "bg-white border-blue-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Sentinel</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center text-blue-500">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-lg sm:text-2xl font-extrabold tracking-tight text-blue-600 dark:text-blue-400">
            100% Guard
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Zero balance loss</p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl bg-card/40 border border-border backdrop-blur-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search phone number, agent email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs sm:text-sm bg-background/80 border-border"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
              <SelectItem value="fulfillment_failed">Fulfillment Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="w-full sm:w-40 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today Only</SelectItem>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Responsive View: Desktop Table vs Mobile Cards */}
      <div className={cn("rounded-2xl sm:rounded-3xl border overflow-hidden transition-all backdrop-blur-xl shadow-xl", isDark ? "bg-card/70 border-border" : "bg-white border-gray-200")}>
        {loading ? (
          <div className="p-8 sm:p-10 space-y-4">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-12 sm:p-16 text-center space-y-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto shadow-inner">
              <Phone className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h3 className="text-base sm:text-lg font-bold">No Flagged Numbers Found</h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
              All numbers in the system are currently whitelisted or no matching beneficiary errors occurred in the selected timeframe.
            </p>
          </div>
        ) : (
          <>
            {/* DESKTOP TABLE VIEW */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className={cn("border-b text-xs font-bold uppercase tracking-wider", isDark ? "bg-muted/40 border-border text-muted-foreground" : "bg-gray-50/80 border-gray-100 text-gray-500")}>
                    <th className="py-4 px-6">Recipient Number</th>
                    <th className="py-4 px-6">Carrier</th>
                    <th className="py-4 px-6">Attempts & Urgency</th>
                    <th className="py-4 px-6">Total Value</th>
                    <th className="py-4 px-6">Last Attempt</th>
                    <th className="py-4 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredGroups.map((grp) => {
                    const { date, time } = fmt(grp.lastAttemptAt);
                    const isHighPriority = grp.totalAttempts >= 3;
                    return (
                      <tr key={grp.phone} className={cn("transition-colors hover:bg-muted/30 group", isDark ? "" : "hover:bg-gray-50/80")}>
                        <td className="py-4 px-6">
                          <div className="font-mono font-black text-base flex items-center gap-2.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            {grp.phone}
                            <button onClick={() => copyToClipboard(grp.phone, grp.phone)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                              {copiedText === grp.phone ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-[240px] mt-0.5">
                            Agents: {grp.agentEmails.join(", ")}
                          </div>
                          {renderAutoStatusBadge(grp.phone) && (
                            <div className="mt-1.5">{renderAutoStatusBadge(grp.phone)}</div>
                          )}
                        </td>

                        <td className="py-4 px-6">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                            {grp.network}
                          </span>
                        </td>

                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm">{grp.totalAttempts} {grp.totalAttempts === 1 ? "attempt" : "attempts"}</span>
                            {isHighPriority && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 animate-pulse">
                                High Priority
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">Auto-logged for whitelist</div>
                        </td>

                        <td className="py-4 px-6">
                          <div className="font-black text-sm text-foreground">GH₵ {grp.totalAmount.toFixed(2)}</div>
                        </td>

                        <td className="py-4 px-6">
                          <div className="text-xs font-bold">{date}</div>
                          <div className="text-[11px] text-muted-foreground">{time}</div>
                        </td>

                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border-purple-500/30 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400 transition-all"
                              onClick={() => handleSendBeneficiarySms(grp.phone, grp.totalAmount)}
                              disabled={sendingSmsPhone === grp.phone}
                            >
                              {sendingSmsPhone === grp.phone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              📱 Send Guide SMS
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border-blue-500/30 hover:bg-blue-500/10 text-blue-600 dark:text-blue-400 transition-all"
                              onClick={() => handleSubmitSingleForApproval(grp.phone)}
                              disabled={submittingPhone === grp.phone || submittingNumbers}
                            >
                              {submittingPhone === grp.phone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              Submit for Approval
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 px-4 rounded-xl text-xs font-bold gap-2 border border-border/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                              onClick={() => setSelectedGroup(grp)}
                            >
                              View Orders ({grp.orders.length}) <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS VIEW */}
            <div className="block md:hidden divide-y divide-border/40">
              {filteredGroups.map((grp) => {
                const { date, time } = fmt(grp.lastAttemptAt);
                const isHighPriority = grp.totalAttempts >= 3;
                return (
                  <div key={grp.phone} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-mono font-black text-base flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                        {grp.phone}
                        <button onClick={() => copyToClipboard(grp.phone, grp.phone)} className="text-muted-foreground p-1">
                          {copiedText === grp.phone ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        {grp.network}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <div>
                        <span className="text-muted-foreground">Attempts: </span>
                        <span className="font-extrabold text-foreground">{grp.totalAttempts}</span>
                        {isHighPriority && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-red-500/15 text-red-600 dark:text-red-400">
                            High
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Volume: </span>
                        <span className="font-black text-emerald-600 dark:text-emerald-400">GH₵ {grp.totalAmount.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      Agents: {grp.agentEmails.join(", ")}
                    </div>

                    {renderAutoStatusBadge(grp.phone)}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] text-muted-foreground shrink-0">{date} at {time}</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border-blue-500/30 hover:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          onClick={() => handleSubmitSingleForApproval(grp.phone)}
                          disabled={submittingPhone === grp.phone || submittingNumbers}
                        >
                          {submittingPhone === grp.phone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Submit
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="h-9 px-4 rounded-xl text-xs font-bold gap-1.5 bg-amber-500 hover:bg-amber-600 text-black shadow-md"
                          onClick={() => setSelectedGroup(grp)}
                        >
                          View {grp.orders.length} <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Orders Detail Dialog */}
      <Dialog open={!!selectedGroup} onOpenChange={(op) => !op && setSelectedGroup(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-lg sm:text-xl font-black">
              <span className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-amber-500" /> Orders for {selectedGroup?.phone}
              </span>
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 rounded-xl gap-1.5 font-bold border-blue-500/30 hover:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  onClick={() => selectedGroup && handleSubmitSingleForApproval(selectedGroup.phone)}
                  disabled={!selectedGroup || submittingPhone === selectedGroup.phone || submittingNumbers}
                >
                  {selectedGroup && submittingPhone === selectedGroup.phone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Submit for Approval
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-8 rounded-xl gap-1.5 font-bold" onClick={() => selectedGroup && copyToClipboard(selectedGroup.phone, "modal_phone")}>
                  {copiedText === "modal_phone" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  Copy Phone
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review flagged non-beneficiary order details and trigger carrier whitelisting retries.
            </DialogDescription>
          </DialogHeader>

          {selectedGroup && (
            <div className="space-y-4 pt-2">
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 font-medium leading-relaxed">
                Carrier Response: <strong>"{selectedGroup.phone} is not added to our beneficiary list"</strong>
              </div>

              <div className="space-y-3">
                {selectedGroup.orders.map((ord) => {
                  const { date, time } = fmt(ord.created_at);
                  const isBusy = processingId === ord.id;
                  return (
                    <div key={ord.id} className="p-3.5 sm:p-4 rounded-2xl border border-border bg-card/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-mono font-black text-sm text-foreground">{ord.id.slice(0, 8)} • {ord.package_size}</div>
                        <div className="text-muted-foreground font-mono mt-0.5 truncate max-w-[220px]">{ord.agent_email}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{date} at {time}</div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                        <div className="text-left sm:text-right">
                          <div className="font-black text-sm sm:text-base text-foreground">GH₵ {Number(ord.amount).toFixed(2)}</div>
                          <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold mt-0.5", ord.status === "refunded" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" : "bg-red-500/15 text-red-600 dark:text-red-400")}>
                            {ord.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8.5 px-3 rounded-xl text-xs font-bold gap-1 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            onClick={() => handleRetrySingle(ord)}
                            disabled={isBusy || processingBatch}
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            Retry
                          </Button>

                          {ord.status !== "refunded" && !ord.auto_refunded && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8.5 px-3 rounded-xl text-xs font-bold gap-1 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                              onClick={() => handleRefundSingle(ord)}
                              disabled={isBusy || processingBatch}
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                              Refund
                            </Button>
                          )}
                        </div>
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
