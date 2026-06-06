import { useState, useMemo, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Users, Send, CheckCircle2, AlertTriangle,
  Download, Info, Building2, MessageCircle, ChevronDown,
  ChevronUp, Zap, Upload, FileSpreadsheet, X,
} from "lucide-react";
import { basePackages } from "@/lib/data";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";

const normalizePackageSize = (size: string) => size.replace(/\s+/g, "").toUpperCase();

const getAssignedSubAgentPrice = (
  prices: Record<string, Record<string, string | number>> | undefined,
  network: string,
  size: string,
): number | null => {
  if (!prices) return null;
  const netKey = Object.keys(prices).find(
    (k) => k.toLowerCase() === network.toLowerCase()
  );
  if (!netKey) return null;
  const byNet = prices[netKey];
  const matchedKey = Object.keys(byNet).find(
    (k) => normalizePackageSize(k) === normalizePackageSize(size)
  );
  if (!matchedKey) return null;
  const val = Number(byNet[matchedKey]);
  return Number.isFinite(val) && val > 0 ? val : null;
};

// ─── Network config ────────────────────────────────────────────────────────────
const NET_CFG = {
  MTN:       { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)", text: "#fbbf24" },
  Telecel:   { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.35)",  text: "#ef4444" },
  AirtelTigo:{ color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.35)", text: "#3b82f6" },
} as const;

const CARD_BG  = "#111116";
const PAGE_BG  = "#0a0a0f";
const INPUT_BG = "#1a1a24";

const DashboardBulk = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [inputNumbers, setInputNumbers]       = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState<"MTN" | "Telecel" | "AirtelTigo">("MTN");
  const [selectedSize, setSelectedSize]       = useState("");
  const [isProcessing, setIsProcessing]       = useState(false);
  const [results, setResults]                 = useState<{ phone: string; size?: string; status: "success" | "failed"; error?: string }[] | null>(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [showB2B, setShowB2B]                 = useState(false);
  const [confirmOpen, setConfirmOpen]         = useState(false);

  const [globalSettings, setGlobalSettings] = useState<any[]>([]);
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    const loadPricing = async () => {
      try {
        const [settingsRes, pricingContext] = await Promise.all([
          supabase.from("global_package_settings").select("network, package_size, public_price, agent_price, sub_agent_price, is_unavailable"),
          fetchApiPricingContext(),
        ]);
        setGlobalSettings(settingsRes.data || []);
        if (pricingContext?.multipliers) {
          setPriceMultiplier(pricingContext.multipliers[selectedNetwork] || 1);
        }
        
        if (profile?.is_sub_agent && profile?.parent_agent_id) {
          const { data: parentProfile } = await supabase
            .from("profiles")
            .select("sub_agent_prices")
            .eq("user_id", profile.parent_agent_id)
            .maybeSingle();
          setParentAssignedPrices((parentProfile?.sub_agent_prices || {}) as Record<string, Record<string, string | number>>);
        }
      } catch (err) {
        console.error("Error loading pricing in bulk:", err);
      } finally {
        setSettingsLoading(false);
      }
    };
    void loadPricing();
  }, [profile, selectedNetwork]);

  const cfg      = NET_CFG[selectedNetwork];
  
  const packages = useMemo(() => {
    const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
    
    return (basePackages[selectedNetwork] || [])
      .map((item) => {
        const setting = globalSettings.find(
          (s) => s.network === selectedNetwork && normalizePackageSize(s.package_size) === normalizePackageSize(item.size),
        );
        const assignedFromParent = getAssignedSubAgentPrice(parentAssignedPrices, selectedNetwork, item.size);
        const assignedFromProfile = getAssignedSubAgentPrice(
          profile?.agent_prices as Record<string, Record<string, string | number>> | undefined,
          selectedNetwork,
          item.size,
        );
        const assignedPrice = assignedFromParent || assignedFromProfile;
        const basePublic = Number(setting?.public_price);
        const baseAgent = Number(setting?.agent_price);

        const resolvedBasePrice = (() => {
          // If NOT approved, always use public price
          if (!isPaidAgent) {
            if (Number.isFinite(basePublic) && basePublic > 0) return basePublic;
            return item.price * 1.12; // public markup fallback
          }

          // Approved agent/sub-agent pricing logic
          if (assignedPrice && assignedPrice > 0) return assignedPrice;
          
          if (profile?.is_sub_agent) {
            const baseSubAgent = Number(setting?.sub_agent_price);
            if (Number.isFinite(baseSubAgent) && baseSubAgent > 0) return baseSubAgent;
            // Fallback to agent price if subagent price not set
            if (Number.isFinite(baseAgent) && baseAgent > 0) return baseAgent;
            return item.price;
          }

          if (Number.isFinite(baseAgent) && baseAgent > 0) return baseAgent;
          return item.price;
        })();

        return {
          ...item,
          isUnavailable: Boolean(setting?.is_unavailable),
          price: applyPriceMultiplier(resolvedBasePrice, priceMultiplier),
        };
      })
      .filter((item) => !item.isUnavailable);
  }, [globalSettings, profile, selectedNetwork, parentAssignedPrices, priceMultiplier]);

  const selectedPackage = packages.find(p => p.size === selectedSize);

  // Parse each line as "phone [gb]"  e.g. "0241234567 2" or just "0241234567"
  const parsedEntries = useMemo(() => {
    return inputNumbers
      .split(/\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .flatMap(line => {
        // split on whitespace/comma — first token is phone, second is GB
        const parts = line.split(/[\s,]+/);
        const phone = parts[0].replace(/\D/g, "");
        const gbRaw = parts[1]?.replace(/\D/g, "") || "";
        if (phone.length < 9 || phone.length > 12) return [];
        return [{ phone, gb: gbRaw }];
      });
  }, [inputNumbers]);

  // Resolve each entry's package: per-line GB → find matching package, else fall back to selected
  const resolvedEntries = useMemo(() => {
    return parsedEntries.map(({ phone, gb }) => {
      let pkg = selectedPackage;
      if (gb) {
        const gbNum = parseInt(gb, 10);
        const match = packages.find(p => {
          const n = parseInt(p.size.replace(/\D/g, ""), 10);
          return n === gbNum;
        });
        if (match) pkg = match;
      }
      return { phone, pkg };
    });
  }, [parsedEntries, selectedPackage, packages]);

  const validEntries = resolvedEntries.filter(e => !!e.pkg);
  const totalCost    = validEntries.reduce((sum, e) => sum + (e.pkg?.price || 0), 0);
  const canSend      = validEntries.length > 0 && !isProcessing;

  // Parse CSV/Excel — reads "Phone Number, Data Size (GB)" column format
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/[\r\n]+/).filter(Boolean);
      const rows: string[] = [];
      lines.forEach(line => {
        // skip header rows
        if (/phone|number|data|size|gb/i.test(line) && rows.length === 0) return;
        // try CSV: col A = phone, col B = gb
        const cols = line.split(/[,\t]+/);
        const phone = cols[0]?.replace(/\D/g, "").trim();
        const gb    = cols[1]?.replace(/\D/g, "").trim();
        if (phone && phone.length >= 9 && phone.length <= 12) {
          rows.push(gb ? `${phone} ${gb}` : phone);
        }
      });
      setInputNumbers(prev => prev ? prev + "\n" + rows.join("\n") : rows.join("\n"));
      toast({ title: `Loaded ${rows.length} entries from file` });
    };
    reader.readAsText(file);
  };

  const handleBulkSend = async () => {
    setConfirmOpen(false);
    setIsProcessing(true);
    setResults([]);
 
    try {
      const payload = {
        orders: validEntries.map(e => ({
          customer_phone: e.phone,
          network: selectedNetwork,
          package_size: e.pkg!.size,
          amount: e.pkg!.price
        }))
      };

      const { data, error } = await supabase.functions.invoke("agent-bulk-orders", {
        body: payload
      });

      if (error || data?.error) {
        toast({ title: "Bulk Dispatch Failed", description: data?.error || error?.message || "Transaction failed", variant: "destructive" });
        setIsProcessing(false);
        return;
      }

      // Success processing
      const batchResults: { phone: string; size?: string; status: "success" | "failed"; error?: string }[] = [];
      const errorMap = new Map((data.errors || []).map((e: any) => [e.phone, e.error]));

      validEntries.forEach(e => {
        if (errorMap.has(e.phone)) {
           batchResults.push({ phone: e.phone, size: e.pkg?.size, status: "failed", error: errorMap.get(e.phone) });
        } else {
           batchResults.push({ phone: e.phone, size: e.pkg?.size, status: "success" });
        }
      });

      setResults(batchResults);
    } catch (err: any) {
       toast({ title: "System Error", description: err.message, variant: "destructive" });
    }
 
    setIsProcessing(false);
    setShowSuccessOverlay(true);
  };

  const successCount = results?.filter(r => r.status === "success").length ?? 0;
  const failedCount  = results?.filter(r => r.status === "failed").length ?? 0;

  return (
    <div className="min-h-screen pb-24 bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-amber-400/15 border border-amber-400/25">
              <Users className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Bulk Disbursement</h1>
              <p className="text-[11px] text-white/40">Send data to many numbers at once</p>
            </div>
          </div>
          <button
            onClick={() => {
              const csv = "Phone Number,Data Size (GB)\n0241234567,1\n0551234567,2\n0591234567,5\n0248770024,10";
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = "swiftdata_bulk_template.csv";
              a.click();
            }}
            className="flex items-center gap-1.5 px-3 h-8 rounded-xl text-[11px] font-bold border transition-all bg-white/5 border-white/10 text-white/50"
          >
            <Download className="w-3.5 h-3.5" /> Sample CSV
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* ── LEFT ── */}
          <div className="lg:col-span-7 space-y-4">

            {/* Step 1 – Network */}
            <div className="rounded-3xl overflow-hidden border border-white/8 bg-[#111116]">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/6">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-black shrink-0" style={{ backgroundColor: cfg.color }}>1</span>
                <p className="text-xs font-black uppercase tracking-widest text-white/40">Select Network</p>
              </div>
              <div className="p-4 grid grid-cols-3 gap-2.5">
                {(["MTN", "Telecel", "AirtelTigo"] as const).map(net => {
                  const c = NET_CFG[net];
                  const active = selectedNetwork === net;
                  return (
                    <button
                      key={net}
                      type="button"
                      onClick={() => { setSelectedNetwork(net); setSelectedSize(""); }}
                      className="h-12 rounded-2xl flex items-center justify-center text-sm font-black transition-all border-2"
                      style={active
                        ? { background: c.bg, borderColor: c.border, color: c.text }
                        : { background: INPUT_BG, borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.40)" }}
                    >
                      {net}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 – Recipients */}
            <div className="rounded-3xl overflow-hidden border border-white/8 bg-[#111116]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-black shrink-0" style={{ backgroundColor: cfg.color }}>2</span>
                  <p className="text-xs font-black uppercase tracking-widest text-white/40">Recipients</p>
                </div>
                {parsedEntries.length > 0 && (
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                    {validEntries.length}/{parsedEntries.length} valid
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3">
                {/* Upload zone */}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt"
                  className="hidden"
                  aria-label="Upload numbers file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFileUpload(f); }}
                  className="w-full h-16 rounded-2xl border-2 border-dashed flex items-center justify-center gap-3 transition-all border-white/12 bg-[#1a1a24]"
                >
                  <FileSpreadsheet className="w-5 h-5 text-amber-400" />
                  <div className="text-left">
                    <p className="text-xs font-black text-white/70">Upload CSV / Excel file</p>
                    <p className="text-[10px] text-white/30">Column A: phone · Column B: optional</p>
                  </div>
                  <Upload className="w-4 h-4 text-white/20 ml-auto mr-1" />
                </button>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-[10px] text-white/25 font-bold">or type manually</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                <div className="relative">
                  <textarea
                    value={inputNumbers}
                    onChange={(e) => setInputNumbers(e.target.value)}
                    placeholder={"0241234567 2\n0551234567 5\n0591234567 10"}
                    rows={6}
                    className="w-full rounded-2xl px-4 py-3 text-sm font-mono text-white resize-none outline-none transition-all bg-[#1a1a24] border-white/10 border-[1.5px] leading-[1.7]"
                  />
                  {inputNumbers && (
                    <button
                      type="button"
                      onClick={() => setInputNumbers("")}
                      className="absolute top-2.5 right-2.5 w-6 h-6 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 transition-all bg-white/5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="rounded-xl px-3 py-2.5 space-y-0.5 bg-amber-400/5 border border-amber-400/10">
                  <p className="text-[10px] font-black text-amber-400/70">Format: <span className="font-mono">0241234567 2</span> (phone then GB size per line)</p>
                  <p className="text-[10px] text-white/30">Or use the global package below if all numbers get the same bundle. Valid prefixes: 024, 025, 053, 054, 055, 059.</p>
                </div>
              </div>
            </div>

            {/* Step 3 – Package */}
            <div className="rounded-3xl overflow-hidden border border-white/8 bg-[#111116]">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/6">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-black shrink-0" style={{ backgroundColor: cfg.color }}>3</span>
                <p className="text-xs font-black uppercase tracking-widest text-white/40">Choose Package</p>
              </div>
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {packages.map(p => {
                  const active = selectedSize === p.size;
                  return (
                    <button
                      key={p.size}
                      type="button"
                      onClick={() => setSelectedSize(p.size)}
                      className="p-3 rounded-2xl text-left transition-all border-2"
                      style={active
                        ? { background: cfg.bg, borderColor: cfg.border }
                        : { background: INPUT_BG, borderColor: "rgba(255,255,255,0.07)" }}
                    >
                      <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: active ? cfg.color : "rgba(255,255,255,0.30)" }}>{selectedNetwork}</p>
                      <p className="text-lg font-black text-white leading-none">{p.size}</p>
                      <p className="text-xs font-black mt-1" style={{ color: cfg.color }}>₵{p.price.toFixed(2)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── RIGHT – Summary ── */}
          <div className="lg:col-span-5 space-y-4">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-3xl overflow-hidden border border-white/8 bg-[#111116]">
                <div className="px-5 py-4 border-b border-white/6">
                  <p className="text-xs font-black uppercase tracking-widest text-white/40">Order Summary</p>
                </div>
                <div className="px-5 py-5 space-y-3">
                  {[
                    { label: "Network",     value: selectedNetwork },
                    { label: "Package",     value: selectedSize || "—" },
                    { label: "Unit price",  value: selectedPackage ? `₵${selectedPackage.price.toFixed(2)}` : "—" },
                    { label: "Recipients", value: `${validEntries.length} numbers` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-white/35">{label}</span>
                      <span className="text-xs font-bold text-white/80">{value}</span>
                    </div>
                  ))}

                  <div className="pt-3 mt-1 border-t border-white/6 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Total Cost</span>
                    <span className="text-3xl font-black" style={{ color: cfg.color }}>₵{totalCost.toFixed(2)}</span>
                  </div>
                </div>

                {/* Send button */}
                <div className="px-5 pb-5">
                  <button
                    type="button"
                    onClick={() => canSend && setConfirmOpen(true)}
                    disabled={!canSend}
                    className="w-full h-14 rounded-2xl font-black text-base text-black flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:scale-100"
                    style={{ background: `linear-gradient(135deg, ${cfg.color} 0%, ${cfg.color}cc 100%)`, boxShadow: canSend ? `0 4px 24px ${cfg.color}40` : "none" }}
                  >
                    <Zap className="w-5 h-5" /> Start Disbursement
                  </button>

                  <div className="flex items-start gap-2 mt-3">
                    <Info className="w-3.5 h-3.5 text-white/20 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-white/25 leading-relaxed">
                      Processed sequentially. Don't close the tab until complete.
                    </p>
                  </div>
                </div>
              </div>

              {/* Live results */}
              {results && results.length > 0 && (
                <div className="rounded-3xl overflow-hidden border border-white/8 bg-[#111116]">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-white/6">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Live Results</p>
                    <div className="flex gap-3">
                      {successCount > 0 && <span className="text-[10px] font-black text-emerald-400">{successCount} sent</span>}
                      {failedCount  > 0 && <span className="text-[10px] font-black text-red-400">{failedCount} failed</span>}
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-white/4">
                    {results.map((res, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-2.5">
                        <div>
                          <span className="text-xs font-mono text-white/50">{res.phone}</span>
                          {res.size && <span className="text-[10px] text-white/25 ml-2">{res.size}</span>}
                        </div>
                        {res.status === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <div className="flex items-center gap-1 text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">Failed</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {isProcessing && (
                      <div className="flex items-center gap-2 px-5 py-3">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        <span className="text-[11px] text-white/40">Processing {results.length + 1} of {validEntries.length}…</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── B2B Section ── */}
        <div className="rounded-3xl overflow-hidden border border-amber-400/15 bg-amber-400/[0.04]">
          <button
            type="button"
            onClick={() => setShowB2B(v => !v)}
            className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 bg-amber-400/10 border border-amber-400/20">
                <Building2 className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="font-black text-sm text-white">B2B & Corporate Pricing</p>
                <p className="text-[11px] text-white/40">Volume discounts for businesses, churches & schools</p>
              </div>
            </div>
            {showB2B ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
          </button>

          {showB2B && (
            <div className="px-6 pb-6 space-y-5 border-t border-amber-400/10">
              <p className="text-sm text-white/40 pt-4">Get volume discounts applied automatically. Contact us via WhatsApp to lock in your corporate rate.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: "Starter",    range: "1 – 9 numbers",  discount: "Standard rate",        highlight: false },
                  { label: "Business",   range: "10 – 49 numbers",discount: "5% off each bundle",   highlight: false },
                  { label: "Enterprise", range: "50+ numbers",    discount: "12% off + priority",   highlight: true  },
                ].map(tier => (
                  <div
                    key={tier.label}
                    className="rounded-2xl border p-4 space-y-1.5"
                    style={tier.highlight
                      ? { background: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.30)" }
                      : { background: INPUT_BG, borderColor: "rgba(255,255,255,0.08)" }}
                  >
                    <p className="text-sm font-black" style={{ color: tier.highlight ? "#fbbf24" : "rgba(255,255,255,0.80)" }}>{tier.label}</p>
                    <p className="text-[11px] text-white/35">{tier.range}</p>
                    <p className="text-xs font-bold" style={{ color: tier.highlight ? "#fbbf24" : "rgba(255,255,255,0.40)" }}>{tier.discount}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/8 p-4 space-y-2.5 bg-[#1a1a24]">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/30">What corporate clients get</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {["Volume discount on every bundle","Dedicated WhatsApp support line","Monthly usage report (CSV)","Priority fulfillment queue","Recurring bulk schedule option","Custom invoice on request"].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-xs text-white/50">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href={`https://wa.me/233${(profile?.support_number || "").replace(/^0/, "")}?text=${encodeURIComponent("Hi, I'm interested in a corporate bulk data plan. Please share pricing details.")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black text-black transition-all bg-[#fbbf24]"
                >
                  <MessageCircle className="w-4 h-4" /> Request Corporate Quote
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm Dialog ── */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setConfirmOpen(false)} />
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 p-6 space-y-5 bg-[#111116]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}40` }}>
                <Zap className="w-5 h-5" style={{ color: cfg.color }} />
              </div>
              <div>
                <p className="font-black text-white">Confirm Disbursement</p>
                <p className="text-[11px] text-white/40">This will charge your wallet</p>
              </div>
            </div>

            <div className="rounded-2xl p-4 space-y-2 border border-white/6 bg-[#1a1a24]">
              {[
                ["Network",    selectedNetwork],
                ["Package",    selectedSize],
                ["Recipients", `${validEntries.length} numbers`],
                ["Total Cost", `₵${totalCost.toFixed(2)}`],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between text-sm">
                  <span className="text-white/35">{l}</span>
                  <span className="font-bold text-white/80">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 h-12 rounded-2xl font-bold text-sm transition-all bg-white/10 text-white/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkSend}
                className="flex-[2] h-12 rounded-2xl font-black text-sm text-black flex items-center justify-center gap-2 transition-all"
                style={{ background: `linear-gradient(135deg, ${cfg.color} 0%, ${cfg.color}cc 100%)` }}
              >
                <Send className="w-4 h-4" /> Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success Overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full border border-white/10 rounded-[2.5rem] p-10 text-center space-y-6 bg-[#0f0f17]">
            {/* SVG Illustration */}
            <div className="relative mx-auto w-36 h-36">
              <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
              <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Phone Body */}
                <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGradOverlay)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                {/* Phone Screen */}
                <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                {/* Phone Notch */}
                <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                
                {/* Decorative Data Waves/Grid */}
                <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                <path d="M 65 120 Q 100 105 135 120" stroke="rgba(16,185,129,0.15)" strokeWidth="2" fill="none"/>
                
                {/* Success Badge */}
                <circle cx="100" cy="90" r="32" fill="url(#badgeGradOverlay)" />
                <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                
                {/* Success Checkmark */}
                <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                
                {/* Sparkles/Stars */}
                <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                <path d="M 155 120 L 157 123 L 161 124 L 158 127 L 159 131 L 155 129 L 151 131 L 152 127 L 149 124 L 153 123 Z" fill="#ff9f1c" opacity="0.8"/>
                <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                <circle cx="50" cy="130" r="3" fill="#10B981"/>
                
                {/* Gradients */}
                <defs>
                  <linearGradient id="phoneGradOverlay" x1="55" y1="25" x2="145" y2="175" gradientUnits="userSpaceOnUse">
                    <stop stopColor="rgba(255,255,255,0.08)"/>
                    <stop offset="1" stopColor="rgba(255,255,255,0.02)"/>
                  </linearGradient>
                  <linearGradient id="badgeGradOverlay" x1="68" y1="58" x2="132" y2="122" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#10B981"/>
                    <stop offset="1" stopColor="#059669"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="space-y-1">
              <h2 className="text-3xl font-black text-white tracking-tight">Done!</h2>
              <p className="text-sm text-white/40">
                {successCount} sent · {failedCount} failed
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl p-3 border border-emerald-500/20" style={{ background: "rgba(16,185,129,0.08)" }}>
                <p className="text-2xl font-black text-emerald-400">{successCount}</p>
                <p className="text-[10px] text-emerald-400/60 font-bold uppercase">Sent</p>
              </div>
              <div className="rounded-2xl p-3 border border-red-500/20" style={{ background: "rgba(239,68,68,0.08)" }}>
                <p className="text-2xl font-black text-red-400">{failedCount}</p>
                <p className="text-[10px] text-red-400/60 font-bold uppercase">Failed</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setShowSuccessOverlay(false); setResults(null); setInputNumbers(""); setSelectedSize(""); }}
              className="w-full h-12 rounded-2xl font-black text-sm text-black transition-all"
              style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}
            >
              Start New Batch
            </button>
          </div>
          <style>{`
            @keyframes bounce-subtle {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animate-bounce-subtle {
              animation: bounce-subtle 3s infinite ease-in-out;
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default DashboardBulk;
