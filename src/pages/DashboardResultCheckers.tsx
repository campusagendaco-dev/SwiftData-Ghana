import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  GraduationCap, Loader2, ShieldCheck,
  CreditCard, Wallet, ChevronRight, RotateCcw,
  CheckCircle2, Hash, Smartphone, Copy,
  AlertTriangle, FlaskConical, ClipboardList,
  Clock, CopyCheck, XCircle, Download, Printer, FileSpreadsheet, Check,
  Sparkles, Plus, Minus, UserCheck, Eye, Zap, RefreshCw, ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/hooks/useConnectivity";
import { WifiOff } from "lucide-react";
import { playSuccessSound } from "@/lib/sound";
import { Link } from "react-router-dom";
import { WAECLogo, BECELogo } from "@/components/BrandLogos";

type VoucherType = "WASSCE" | "BECE";

interface VoucherItem {
  id: VoucherType;
  label: string;
  price: number;
  description: string;
  badge?: string;
}

const DEFAULT_VOUCHERS: VoucherItem[] = [
  { id: "WASSCE", label: "WAEC / WASSCE 2026", price: 18.00, description: "Valid for checking 2026 & Previous WASSCE Results", badge: "2026 Stock Ready" },
  { id: "BECE",   label: "BECE Result Checker", price: 15.00, description: "Valid for checking BECE Results & Placement", badge: "Instant Pin" },
];

const QUICK_QUANTITIES = [1, 2, 5, 10, 20, 50, 100];

const DashboardResultCheckers = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isOnline } = useConnectivity();

  const [vouchers, setVouchers] = useState<VoucherItem[]>(DEFAULT_VOUCHERS);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [voucherType, setVoucherType] = useState<VoucherType | null>("WASSCE");
  const [quantity, setQuantity] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(false);
  const [successData, setSuccessData] = useState<any | null>(null);

  // Additional UX state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [userProfilePhone, setUserProfilePhone] = useState<string>("");
  const [selectedPastVouchers, setSelectedPastVouchers] = useState<any | null>(null);

  // Fetch live prices from system settings
  useEffect(() => {
    supabase
      .from("public_system_settings")
      .select("wassce_price, bece_price")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setVouchers([
            { id: "WASSCE", label: "WAEC / WASSCE 2026", price: Number(data.wassce_price || 18.00), description: "Valid for checking 2026 & Previous WASSCE Results", badge: "2026 Stock Ready" },
            { id: "BECE",   label: "BECE Result Checker", price: Number(data.bece_price || 15.00), description: "Valid for checking BECE Results & Placement", badge: "Instant Pin" },
          ]);
        }
      })
      .finally(() => setPricesLoading(false));
  }, []);

  // Fetch logged-in user profile phone & wallet balance
  const fetchWalletBalance = useCallback(async () => {
    if (!user?.id) return;
    setWalletLoading(true);

    const [{ data: walletData }, { data: profileData }] = await Promise.all([
      supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
      supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle()
    ]);

    setWalletBalance(walletData?.balance ?? null);
    if (profileData?.phone) {
      setUserProfilePhone(profileData.phone);
      if (!recipient) {
        setRecipient(profileData.phone);
      }
    }
    setWalletLoading(false);
  }, [user?.id, recipient]);

  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  // Fetch recent voucher orders
  const fetchRecentOrders = useCallback(async () => {
    if (!user?.id) return;
    setOrdersLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, package_size, amount, status, created_at, metadata, customer_phone")
      .eq("agent_id", user.id)
      .eq("network", "VOUCHER")
      .order("created_at", { ascending: false })
      .limit(6);
    setRecentOrders(data || []);
    setOrdersLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchRecentOrders();
  }, [fetchRecentOrders]);

  const copyToClipboard = (text: string, label = "Code") => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to Clipboard", description: `${label} copied successfully!` });
  };

  const copyAllVouchers = (voucherList: any[]) => {
    if (!voucherList?.length) return;
    const formatted = voucherList
      .map((v, i) => `VOUCHER ${i + 1}: SERIAL: ${v.serial} | PIN: ${v.pin}`)
      .join("\n");
    navigator.clipboard.writeText(formatted);
    setCopiedAll(true);
    toast({ title: "All Vouchers Copied!", description: `${voucherList.length} voucher pins copied to clipboard.` });
    setTimeout(() => setCopiedAll(false), 3000);
  };

  const reset = () => {
    setVoucherType("WASSCE");
    setQuantity("1");
    if (userProfilePhone) setRecipient(userProfilePhone);
    setSuccessData(null);
    setErrorMessage(null);
    setCopiedAll(false);
    setSelectedPastVouchers(null);
  };

  const handlePurchase = async () => {
    setErrorMessage(null);

    if (!voucherType) {
      toast({ title: "Select a checker type", variant: "destructive" });
      return;
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 100) {
      toast({ title: "Invalid Quantity", description: "Enter a quantity between 1 and 100", variant: "destructive" });
      return;
    }

    const digits = recipient.replace(/\D/g, "");
    if (digits.length !== 10 || !digits.startsWith("0")) {
      toast({ title: "Invalid Recipient", description: "Please enter a valid 10-digit phone number starting with 0", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("voucher-purchase", {
        body: {
          VoucherType: voucherType,
          Recipient: digits,
          Quantity: qty,
        }
      });

      if (error || !data?.success) {
        let msg = data?.error;
        if (!msg && error) {
          try {
            const errContext = (error as any).context;
            if (errContext && typeof errContext.json === "function") {
              const parsed = await errContext.json();
              if (parsed?.error) msg = parsed.error;
            }
          } catch {}
          if (!msg) {
            msg = error.message?.includes("non-2xx")
              ? "Unable to complete purchase. Please ensure you have sufficient wallet balance or try again later."
              : error.message;
          }
        }
        if (!msg) msg = "Insufficient balance or provider stock empty.";
        setErrorMessage(msg);
        toast({ 
          title: "Purchase Failed", 
          description: msg, 
          variant: "destructive" 
        });
      } else {
        playSuccessSound();
        toast({ title: "Purchase Successful!", description: `${qty} voucher(s) generated & sent via SMS to ${digits}` });
        setSuccessData(data);
        fetchWalletBalance();
        fetchRecentOrders();
      }
    } catch (err: any) {
      const msg = err.message || "Network error occurred.";
      setErrorMessage(msg);
      toast({ title: "Network Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const activePrice = voucherType ? vouchers.find(v => v.id === voucherType)?.price || 0 : 0;
  const qtyNum = parseInt(quantity, 10) || 0;
  const totalCost = activePrice * qtyNum;
  const insufficientBalance = walletBalance !== null && totalCost > 0 && totalCost > walletBalance;
  const canSubmit = voucherType && qtyNum > 0 && recipient.replace(/\D/g, "").length === 10 && isOnline && !insufficientBalance;

  const exportToCSV = (voucherList: any[], vType: string, targetPhone: string) => {
    if (!voucherList?.length) return;
    const headers = ["Index", "Voucher Type", "Serial", "PIN", "Recipient Phone", "Date Purchased"];
    const rows = voucherList.map((v: any, i: number) => [
      i + 1,
      v.type || `${vType} Results Checker`,
      `"${v.serial}"`,
      `"${v.pin}"`,
      `"${targetPhone}"`,
      `"${v.purchasedAt || new Date().toISOString()}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e: any) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${vType.toLowerCase()}_vouchers_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "CSV Exported", description: "Voucher details downloaded to your device." });
  };

  const printVoucherCards = (voucherList: any[], vType: string, targetPhone: string, totalAmount: number) => {
    if (!voucherList?.length) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Print Blocked", description: "Please allow popups to print voucher cards.", variant: "destructive" });
      return;
    }

    const vouchersHtml = voucherList.map((v: any, i: number) => `
      <div style="border: 2px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; font-family: monospace; background: #f8fafc; page-break-inside: avoid;">
        <div style="font-weight: bold; color: #475569; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; tracking: 0.1em;">
          VOUCHER ${i + 1} — ${v.type || vType + ' RESULTS CHECKER'}
        </div>
        <div style="font-size: 16px; margin-bottom: 4px; color: #0f172a;"><strong>SERIAL:</strong> ${v.serial}</div>
        <div style="font-size: 16px; margin-bottom: 8px; color: #0f172a;"><strong>PIN:</strong> ${v.pin}</div>
        <div style="font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
          COMBINED: SERIAL: ${v.serial} | PIN: ${v.pin}
        </div>
      </div>
    `).join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Voucher Cards — ${vType}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #0f172a; max-width: 800px; margin: 0 auto; }
            h2 { margin-bottom: 4px; font-size: 22px; font-weight: 800; }
            p { color: #64748b; margin-top: 0; font-size: 14px; }
          </style>
        </head>
        <body>
          <h2>${vType} Results Checker Vouchers</h2>
          <p>Recipient: <strong>${targetPhone}</strong> | Quantity: <strong>${voucherList.length}</strong> | Total Amount: <strong>₵${totalAmount.toFixed(2)}</strong></p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin-bottom: 20px;" />
          ${vouchersHtml}
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // SUCCESS MODAL VIEW
  if (successData) {
    const formattedBalance = walletBalance !== null ? Number(walletBalance).toFixed(2) : "0.00";
    const vouchersList = successData.vouchers || [];
    const isTestModePurchase = successData.test_mode === true;

    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 animate-in zoom-in-95 duration-300">
        
        {/* Header Badge & Title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 text-xs font-black uppercase tracking-widest mx-auto">
            <CheckCircle2 className="w-4 h-4" />
            Voucher Purchased Successfully!
          </div>

          <h1 className="font-black text-3xl tracking-tight text-foreground">Voucher Purchased Successfully!</h1>
          
          {isTestModePurchase && (
            <div className="inline-flex items-center gap-1.5 bg-violet-500/15 text-violet-400 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-violet-500/20 mx-auto">
              <FlaskConical className="w-3.5 h-3.5" />
              Test Mode — Demo Voucher
            </div>
          )}
        </div>

        {/* Voucher Meta Overview Grid */}
        <div className="bg-card border border-border rounded-3xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4 shadow-sm text-sm">
          <div>
            <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider block mb-1">Voucher Type</span>
            <span className="font-black text-foreground">{voucherType === "WASSCE" ? "WASSCE Results Checker" : `${voucherType} Results Checker`}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider block mb-1">Recipient</span>
            <span className="font-black text-foreground font-mono">{recipient}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider block mb-1">Quantity</span>
            <span className="font-black text-foreground">{qtyNum}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider block mb-1">Amount</span>
            <span className="font-black text-emerald-500 text-base">₵{totalCost.toFixed(2)}</span>
          </div>
        </div>

        {/* Bulk Copy All Bar */}
        {vouchersList.length > 1 && (
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-primary/10 border border-primary/20">
            <span className="text-xs font-bold text-foreground">Got multiple vouchers? Copy all at once:</span>
            <button
              onClick={() => copyAllVouchers(vouchersList)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-black text-xs hover:opacity-90 transition-all shadow-sm"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedAll ? "All Copied!" : "Copy All Vouchers"}
            </button>
          </div>
        )}

        {/* Generated Voucher Cards Container */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-xs uppercase tracking-wider text-muted-foreground">Voucher Codes:</h3>
            <span className="text-xs text-muted-foreground font-bold">{vouchersList.length} Voucher{vouchersList.length > 1 ? "s" : ""} Available</span>
          </div>

          {vouchersList.length > 0 ? (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {vouchersList.map((v: any, i: number) => {
                const combinedStr = `SERIAL: ${v.serial} | PIN: ${v.pin}`;
                return (
                  <div key={i} className="p-4 rounded-2xl bg-secondary/40 border border-border space-y-2.5 group hover:border-emerald-500/40 transition-all">
                    <div className="flex items-center justify-between text-[11px] font-black text-muted-foreground uppercase tracking-widest">
                      <span>Voucher {i + 1}</span>
                      <span className="text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md">Valid</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                      <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border">
                        <div className="truncate mr-2">
                          <span className="font-sans text-[10px] font-bold text-muted-foreground uppercase mr-2 block text-muted-foreground/70">SERIAL:</span>
                          <span className="font-black text-foreground tracking-wider text-sm">{v.serial}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(v.serial, "Serial Number")}
                          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline shrink-0 bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                      </div>

                      <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border">
                        <div className="truncate mr-2">
                          <span className="font-sans text-[10px] font-bold text-muted-foreground uppercase mr-2 block text-muted-foreground/70">PIN:</span>
                          <span className="font-black text-foreground tracking-wider text-sm">{v.pin}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(v.pin, "PIN Code")}
                          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline shrink-0 bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border text-xs font-mono">
                      <div className="truncate mr-2">
                        <span className="font-sans text-[10px] font-bold text-muted-foreground uppercase mr-2">COMBINED:</span>
                        <span className="font-black text-foreground tracking-wide text-xs">{combinedStr}</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(combinedStr, "Combined Serial & PIN")}
                        className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 hover:underline shrink-0 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy All
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
              <p className="text-amber-600 font-bold text-sm">Vouchers were generated successfully and will be delivered via SMS shortly.</p>
            </div>
          )}
        </div>

        {/* Action Buttons: Export CSV & Print Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => exportToCSV(vouchersList, voucherType || "WASSCE", recipient)}
            className="h-13 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/20"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export CSV
          </button>

          <button
            onClick={() => printVoucherCards(vouchersList, voucherType || "WASSCE", recipient, totalCost)}
            className="h-13 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md shadow-rose-500/20"
          >
            <Printer className="w-4 h-4" />
            Print Cards
          </button>
        </div>

        {/* New Balance & Delivery Status */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl bg-secondary/30 border border-border text-xs font-bold gap-2">
          <div>
            <span className="text-muted-foreground mr-1">New Balance:</span>
            <span className="font-black text-foreground text-sm font-mono">₵{formattedBalance}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Delivery Status:</span>
            <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-500 px-2.5 py-1 rounded-lg border border-emerald-500/20 text-[11px] font-black uppercase">
              <Check className="w-3.5 h-3.5" /> SMS Sent
            </span>
          </div>
        </div>

        {/* Note Alert Box */}
        <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
          <strong>Note:</strong> The voucher codes have been sent via SMS to <strong>{recipient}</strong>
        </div>

        {/* Close Button */}
        <button
          onClick={reset}
          className="w-full h-14 bg-primary text-primary-foreground font-black rounded-2xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 text-base"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl space-y-8 animate-in fade-in duration-500 mx-auto">
      
      {/* Modern Hero Header */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-amber-500/5 p-6 md:p-8 shadow-sm">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 bg-amber-400/15 text-amber-500 px-3.5 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-amber-400/20">
              <Sparkles className="w-3.5 h-3.5 animate-spin-slow" />
              WASSCE 2026 Ready · Instant Delivery
            </div>
            <div className="flex items-center gap-3">
              <WAECLogo size={44} />
              <h1 className="font-black text-3xl md:text-4xl tracking-tight text-foreground">Result Checkers Portal</h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-xl">
              Purchase WAEC WASSCE & BECE result checker pins individually or in bulk with instant SMS dispatch and printable cards.
            </p>
          </div>

          {/* Quick Wallet Summary Badge in Header */}
          <div className="bg-card/90 border border-border rounded-2xl p-4 flex items-center gap-4 shrink-0 shadow-sm backdrop-blur-md">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-black">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">Wallet Balance</span>
              {walletLoading ? (
                <div className="h-6 w-24 bg-secondary animate-pulse rounded mt-1" />
              ) : (
                <span className="font-black text-xl text-foreground font-mono">
                  ₵{(walletBalance ?? 0).toFixed(2)}
                </span>
              )}
            </div>
            <Link
              to="/dashboard/wallet"
              className="p-2 rounded-xl bg-secondary hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground"
              title="Top up wallet"
            >
              <Plus className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        
        {/* Main Procurement Form Card */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-8 shadow-sm">
          
          {/* Step 1: Select Checker Type */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground flex items-center">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-black mr-2">1</span>
                Select Checker Type
              </p>
              {pricesLoading && <span className="text-xs text-muted-foreground animate-pulse">Loading live prices...</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vouchers.map((v) => {
                const isSelected = voucherType === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setVoucherType(v.id)}
                    className={cn(
                      "relative flex flex-col justify-between p-5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01]",
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                    )}
                  >
                    {v.badge && (
                      <span className={cn(
                        "absolute top-3 right-3 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                      )}>
                        {v.badge}
                      </span>
                    )}

                    <div className="flex items-center gap-3.5 mb-3">
                      <div className="shrink-0">
                        {v.id === "WASSCE" ? (
                          <WAECLogo size={46} />
                        ) : (
                          <BECELogo size={46} />
                        )}
                      </div>
                      <div>
                        <h4 className="font-black text-base text-foreground leading-tight">{v.label}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border/50">
                      <span className="text-xs text-muted-foreground font-bold">Unit Price</span>
                      {pricesLoading ? (
                        <span className="w-16 h-6 rounded bg-secondary animate-pulse" />
                      ) : (
                        <span className="font-black text-base text-foreground bg-background px-3 py-1 rounded-xl border border-border font-mono">
                          ₵{v.price.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Recipient Number */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground flex items-center">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-black mr-2">2</span>
                Recipient Phone Number
              </p>
              
              {userProfilePhone && (
                <button
                  type="button"
                  onClick={() => setRecipient(userProfilePhone)}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                  <UserCheck className="w-3.5 h-3.5" /> Use My Number ({userProfilePhone})
                </button>
              )}
            </div>

            <div className="relative">
              <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="tel"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter 10-digit phone number (e.g. 0592366289)"
                className="w-full h-13 pl-11 pr-4 bg-secondary/40 border border-border rounded-2xl text-sm font-black focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Voucher serial & PIN will be delivered via instant SMS to this recipient.</p>
          </div>

          {/* Step 3: Quantity & Quick Presets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground flex items-center">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-black mr-2">3</span>
                Quantity (Bulk Purchase Supported)
              </p>
              <span className="text-xs text-muted-foreground font-bold">Max 100 per transaction</span>
            </div>

            {/* Quick Quantity Preset Chips */}
            <div className="flex flex-wrap gap-2">
              {QUICK_QUANTITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuantity(q.toString())}
                  className={cn(
                    "px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border",
                    parseInt(quantity, 10) === q
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary/60 text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {q === 1 ? "Single (1)" : `Bulk (${q})`}
                </button>
              ))}
            </div>

            {/* Quantity Input with Steppers */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const current = Math.max(1, (parseInt(quantity, 10) || 1) - 1);
                  setQuantity(current.toString());
                }}
                className="w-13 h-13 rounded-2xl bg-secondary border border-border flex items-center justify-center text-foreground hover:bg-secondary/80 font-black text-lg transition-colors shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>

              <div className="relative flex-1">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full h-13 pl-11 pr-4 bg-secondary/40 border border-border rounded-2xl text-base font-black text-center focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  const current = Math.min(100, (parseInt(quantity, 10) || 1) + 1);
                  setQuantity(current.toString());
                }}
                className="w-13 h-13 rounded-2xl bg-secondary border border-border flex items-center justify-center text-foreground hover:bg-secondary/80 font-black text-lg transition-colors shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Inline Error Banner */}
          {errorMessage && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="w-8 h-8 bg-red-500/15 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <XCircle className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-red-500 mb-0.5">Purchase Error</p>
                <p className="text-xs text-red-400/80 leading-relaxed">{errorMessage}</p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400/60 hover:text-red-400 transition-colors p-1 shrink-0"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Insufficient Balance Warning */}
          {insufficientBalance && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-amber-500 font-black text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" /> Insufficient Wallet Balance
              </div>
              <p className="text-xs text-amber-600 font-medium">
                You need an additional <strong>₵{(totalCost - (walletBalance || 0)).toFixed(2)}</strong> to complete this purchase of {qtyNum} voucher(s).
              </p>
              <Link
                to="/dashboard/wallet"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-white font-black text-xs uppercase tracking-wider hover:opacity-90 transition-all shadow-sm mt-1"
              >
                Top Up Wallet Now <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {/* Main Action Submit Button */}
          <button
            onClick={handlePurchase}
            disabled={loading || !canSubmit}
            className="w-full h-15 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-lg transition-all shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Processing Voucher Order...
              </>
            ) : !isOnline ? (
              <>
                <WifiOff className="w-6 h-6" />
                Waiting for Internet Connection...
              </>
            ) : insufficientBalance ? (
              <>
                <AlertTriangle className="w-6 h-6" />
                Insufficient Wallet Balance
              </>
            ) : (
              <>
                <Wallet className="w-6 h-6" />
                Pay ₵{totalCost.toFixed(2)} From Wallet
              </>
            )}
          </button>

        </div>

        {/* Payment Summary & Order Info Sidebar */}
        <div className="space-y-6">
          
          {/* Summary Breakdown */}
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-5 shadow-sm">
            <h3 className="font-black text-foreground text-lg border-b border-border/50 pb-3">Order Summary</h3>
            
            <div className="space-y-3 text-sm">
              <SummaryRow label="Selected Voucher" value={voucherType ? (voucherType === "WASSCE" ? "WASSCE 2026" : "BECE Result") : "—"} />
              <SummaryRow label="Unit Price" value={voucherType ? `₵${activePrice.toFixed(2)}` : "—"} />
              <SummaryRow label="Quantity" value={`${qtyNum} Voucher${qtyNum > 1 ? "s" : ""}`} />
              <SummaryRow label="SMS Delivery" value="FREE (GH₵ 0.00)" />
              
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <span className="text-muted-foreground font-bold">Total Cost</span>
                <span className="font-black text-foreground text-2xl font-mono text-emerald-500">
                  ₵{totalCost.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Wallet Balance Status Card */}
          <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Available Wallet</p>
                  {walletLoading ? (
                    <span className="inline-block w-20 h-5 rounded bg-secondary animate-pulse" />
                  ) : (
                    <p className={cn(
                      "font-black text-base font-mono",
                      insufficientBalance ? "text-red-500" : "text-foreground"
                    )}>
                      ₵{(walletBalance ?? 0).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={fetchWalletBalance}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Refresh balance"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {totalCost > 0 && walletBalance !== null && !walletLoading && (
              <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs font-bold">
                <span className="text-muted-foreground">Balance After Purchase:</span>
                <span className={cn(
                  "font-mono font-black",
                  insufficientBalance ? "text-red-500" : "text-emerald-500"
                )}>
                  {insufficientBalance ? "Insufficient" : `₵${(walletBalance - totalCost).toFixed(2)}`}
                </span>
              </div>
            )}
          </div>

          {/* Security & Instant Delivery Guarantee */}
          <div className="bg-card/40 border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-black text-foreground">Instant SMS Delivery</p>
              <p className="text-[11px] text-muted-foreground">Serial & PIN codes are sent directly to the recipient phone.</p>
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Form
          </button>
        </div>

      </div>

      {/* Recent Purchases & Re-View Past Vouchers Table */}
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-black text-foreground text-xl flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Recent Voucher Purchases
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Click "View Pins" on any order to re-view or reprint vouchers.</p>
          </div>

          <button
            onClick={fetchRecentOrders}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {ordersLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-secondary/30 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-secondary" />
                <div className="flex-1 space-y-2">
                  <div className="w-32 h-3.5 rounded bg-secondary" />
                  <div className="w-24 h-3 rounded bg-secondary" />
                </div>
                <div className="w-16 h-5 rounded bg-secondary" />
              </div>
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-3 text-muted-foreground">
              <GraduationCap className="w-7 h-7 opacity-50" />
            </div>
            <p className="text-base font-bold text-foreground">No recent voucher purchases</p>
            <p className="text-xs text-muted-foreground mt-1">Your generated serials and PINs will be saved here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentOrders.map((order) => {
              const vouchersInOrder = order.metadata?.vouchers || [];
              const hasVouchers = vouchersInOrder.length > 0;
              const isTest = order.metadata?.test_mode === true;
              const orderDate = new Date(order.created_at);
              const timeAgo = getTimeAgo(orderDate);

              return (
                <div key={order.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-secondary/20 border border-border/50 hover:border-border transition-all">
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0",
                      order.status === "fulfilled" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
                    )}>
                      {order.status === "fulfilled" ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-sm text-foreground truncate">{order.package_size}</p>
                        {isTest && (
                          <span className="inline-flex items-center gap-1 bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border border-violet-500/20 shrink-0">
                            Test
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        Recipient: {order.customer_phone} · {timeAgo}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-border/40">
                    <div className="text-left sm:text-right">
                      <p className="font-black text-sm text-foreground font-mono">₵{Number(order.amount).toFixed(2)}</p>
                      <p className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        order.status === "fulfilled" ? "text-emerald-500" : "text-amber-500"
                      )}>
                        {order.status}
                      </p>
                    </div>

                    {hasVouchers && (
                      <button
                        onClick={() => setSelectedPastVouchers({
                          vouchers: vouchersInOrder,
                          type: order.package_size,
                          phone: order.customer_phone,
                          amount: Number(order.amount)
                        })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-black hover:bg-primary/20 transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Pins
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Re-View Past Vouchers Modal */}
      {selectedPastVouchers && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-2xl w-full space-y-5 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-black text-lg text-foreground">{selectedPastVouchers.type} Vouchers</h3>
                <p className="text-xs text-muted-foreground font-mono">Recipient: {selectedPastVouchers.phone}</p>
              </div>
              <button
                onClick={() => setSelectedPastVouchers(null)}
                className="p-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Voucher Cards */}
            <div className="space-y-3">
              {selectedPastVouchers.vouchers.map((v: any, i: number) => {
                const combinedStr = `SERIAL: ${v.serial} | PIN: ${v.pin}`;
                return (
                  <div key={i} className="p-4 rounded-2xl bg-secondary/40 border border-border space-y-2 text-xs font-mono">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase">Voucher {i + 1}</div>
                    <div className="flex justify-between items-center bg-card p-2.5 rounded-xl border border-border">
                      <span><strong>SERIAL:</strong> {v.serial}</span>
                      <button onClick={() => copyToClipboard(v.serial)} className="text-primary font-bold hover:underline text-[11px] flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                    <div className="flex justify-between items-center bg-card p-2.5 rounded-xl border border-border">
                      <span><strong>PIN:</strong> {v.pin}</span>
                      <button onClick={() => copyToClipboard(v.pin)} className="text-primary font-bold hover:underline text-[11px] flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Actions */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => exportToCSV(selectedPastVouchers.vouchers, selectedPastVouchers.type, selectedPastVouchers.phone)}
                className="h-11 rounded-xl bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </button>
              <button
                onClick={() => printVoucherCards(selectedPastVouchers.vouchers, selectedPastVouchers.type, selectedPastVouchers.phone, selectedPastVouchers.amount)}
                className="h-11 rounded-xl bg-rose-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-rose-600 transition-colors"
              >
                <Printer className="w-4 h-4" /> Print Cards
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground font-medium">{label}</span>
    <span className="font-bold text-foreground text-right">{value}</span>
  </div>
);

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default DashboardResultCheckers;
