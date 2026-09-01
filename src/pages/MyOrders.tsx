import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Package, Clock, CheckCircle2, 
  XCircle, Loader2, ArrowLeft, RefreshCw,
  Activity, ExternalLink, ShieldCheck, Zap, ArrowRight, ReceiptText, AlertTriangle,
  Copy
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getActiveStoreDomain } from "@/lib/app-base-url";

interface Order {
  id: string;
  agent_id: string;
  customer_phone: string;
  customer_name?: string;
  network: string;
  package_size: string;
  amount: number;
  status: string;
  created_at: string;
  order_type: string;
}

const MyOrders = () => {
  const [searchParams] = useSearchParams();
  const phoneParam = searchParams.get("phone") || "";
  const navigate = useNavigate();
  
  const [phone, setPhone] = useState(phoneParam);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showReceipt, setShowReceipt] = useState<Order | null>(null);

  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const storeParam = searchParams.get("store") || searchParams.get("slug") || routeSlug || "";
  const activeDomain = getActiveStoreDomain();
  const isStoreRoute = !!activeDomain || !!storeParam || window.location.pathname.startsWith("/store/");

  // Load cached store tenant information
  const [storeInfo, setStoreInfo] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("current_store_tenant");
      const parsed = saved ? JSON.parse(saved) : null;
      if (storeParam && parsed?.slug === storeParam) {
        return parsed;
      }
      if (activeDomain && parsed?.custom_domain === activeDomain) {
        return parsed;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const loadStoreDetails = async () => {
      if (storeInfo && (storeInfo.slug === storeParam || (activeDomain && storeInfo.custom_domain === activeDomain))) {
        return;
      }

      const lookupSlug = storeParam;
      const lookupDomain = activeDomain;

      if (!lookupSlug && !lookupDomain) return;

      try {
        let query = supabase
          .from("agent_stores")
          .select("store_name, store_logo_url, store_primary_color, slug, custom_domain");
        
        if (lookupSlug) {
          query = query.eq("slug", lookupSlug);
        } else if (lookupDomain) {
          query = query.ilike("custom_domain", lookupDomain);
        }

        const { data, error } = await query.maybeSingle();
        if (data && !error) {
          const loaded = {
            name: data.store_name,
            logo: data.store_logo_url,
            color: data.store_primary_color,
            slug: data.slug,
            custom_domain: data.custom_domain
          };
          setStoreInfo(loaded);
          localStorage.setItem("current_store_tenant", JSON.stringify(loaded));
        }
      } catch (err) {
        console.error("Error loading store brand:", err);
      }
    };

    loadStoreDetails();
  }, [storeParam, activeDomain]);

  const storeName = isStoreRoute && storeInfo?.name ? storeInfo.name : "SwiftData Ghana";
  const brandLogoUrl = isStoreRoute ? storeInfo?.logo : "/logo.png";
  const brandColor = isStoreRoute ? (storeInfo?.color || "#f59e0b") : "#f59e0b";
  const brandDomain = isStoreRoute ? (activeDomain || (storeInfo?.custom_domain) || window.location.host) : "swiftdatagh.shop";

  const handleDispute = async (order: Order) => {
    const reason = prompt("Please describe the issue (e.g., Data not received):");
    if (!reason) return;

    try {
      toast.loading("Awakening AI Judge...");
      const { error } = await supabase
        .from("order_disputes")
        .insert({
          order_id: order.id,
          user_id: order.agent_id,
          reason: reason,
          status: 'pending'
        });

      if (error) throw error;
      toast.success("AI Judge activated. Investigation underway.");
    } catch (err: any) {
      toast.error("Failed to trigger AI Judge: " + err.message);
    }
  };

  const fetchOrders = async (targetPhone: string) => {
    if (!targetPhone) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-orders", {
        body: { phone: targetPhone },
      });

      if (error || !data) throw error || new Error("Failed to fetch orders");
      setOrders(data.orders || []);
    } catch (err) {
      console.error("Fetch orders error:", err);
      toast.error("Could not load orders. Please try again.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const copyReceipt = (order: Order) => {
    const now = new Date(order.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `    ${storeName} — Receipt`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Ref       : ${order.id.slice(0, 12).toUpperCase()}`,
      `Date      : ${now}`,
      "─────────────────────────────────",
      `Network   : ${order.network}`,
      `Package   : ${order.package_size}`,
      `Recipient : ${order.customer_phone}`,
      `Status    : ✅ ${order.status.toUpperCase()}`,
      "─────────────────────────────────",
      `  ${brandDomain}`,

      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    const text = lines.join("\n");
    
    if (navigator.share) {
      navigator.share({
        title: `${storeName} Receipt`,
        text: text,
      }).catch(() => {
        navigator.clipboard.writeText(text);
        toast.success("Receipt copied to clipboard!");
      });
    } else {
      navigator.clipboard.writeText(text);
      toast.success("Receipt copied to clipboard!");
    }
  };

  useEffect(() => {
    if (phoneParam) {
      fetchOrders(phoneParam);
    }
  }, [phoneParam]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    if (isStoreRoute && storeInfo?.slug) {
      navigate(`/store/${storeInfo.slug}/my-orders?phone=${phone}`);
    } else {
      navigate(`/my-orders?phone=${phone}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fulfilled': return 'text-emerald-400 bg-emerald-400/10';
      case 'processing': return 'text-amber-400 bg-amber-400/10';
      case 'paid': return 'text-blue-400 bg-blue-400/10';
      case 'fulfillment_failed': 
      case 'error': return 'text-red-400 bg-red-400/10';
      default: return 'text-white/40 bg-white/5';
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-sans antialiased">
      <div className="max-w-md mx-auto space-y-8 pt-12 pb-24">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <button 
            onClick={() => {
              if (activeDomain) {
                navigate("/");
              } else if (storeInfo?.slug) {
                navigate(`/store/${storeInfo.slug}`);
              } else {
                navigate("/");
              }
            }}
            className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-black uppercase tracking-widest text-white/90">My Orders</h1>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-tighter">Guest Tracking Portal</p>
          </div>
          <div className="w-10" /> {/* Spacer */}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative group">
          <input 
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Search by phone number..."
            className="w-full py-4 px-6 rounded-[2rem] bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-all shadow-2xl"
          />
          <button 
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all"
            style={{ backgroundColor: brandColor, boxShadow: `0 10px 15px -3px ${brandColor}33` }}
          >
            <Search className="w-4 h-4 text-black" />
          </button>
        </form>

        {/* Orders List */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: brandColor }} />
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Scanning Records...</p>
            </div>
          ) : orders.length > 0 ? (
            orders.map((order) => (
              <div 
                key={order.id}
                onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status?reference=${order.id}` : `/order-status?reference=${order.id}`)}
                className="group relative overflow-hidden rounded-[2rem] bg-white/[0.03] border border-white/10 p-5 hover:bg-white/[0.05] transition-all cursor-pointer active:scale-[0.98]"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center">
                      <Package className="w-5 h-5 text-white/40" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-white/90">{order.package_size || 'Bundle'}</p>
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-tighter">{order.network} • {order.order_type || 'Data'}</p>
                    </div>
                  </div>
                  <div className={cn("px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest", getStatusColor(order.status))}>
                    {order.status}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2 text-[9px] font-bold text-white/20 uppercase tracking-widest">
                    <Clock className="w-3 h-3" />
                    {new Date(order.created_at).toLocaleDateString()} • {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest" style={{ color: `${brandColor}99` }}>
                    View Details
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                   <button 
                    onClick={(e) => { e.stopPropagation(); setShowReceipt(order); }}
                    className="flex-1 h-9 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-[9px] font-black uppercase tracking-widest text-white/40 flex items-center justify-center gap-2 transition-all"
                   >
                     <ReceiptText className="w-3 h-3" />
                     Receipt
                   </button>
                   <button 
                    onClick={(e) => { e.stopPropagation(); handleDispute(order); }}
                    className="flex-1 h-9 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-[9px] font-black uppercase tracking-widest text-red-400 flex items-center justify-center gap-2 transition-all"
                   >
                     <AlertTriangle className="w-3 h-3" />
                     Dispute
                   </button>
                   <button 
                    onClick={(e) => { e.stopPropagation(); navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status?reference=${order.id}` : `/order-status?reference=${order.id}`); }}
                    className="w-9 h-9 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 flex items-center justify-center text-white/40 transition-all"
                   >
                     <ExternalLink className="w-3 h-3" />
                   </button>
                </div>
              </div>
            ))
          ) : phoneParam ? (
            <div className="text-center py-20 space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto border border-white/5">
                <Search className="w-6 h-6 text-white/10" />
              </div>
              <p className="text-sm font-bold text-white/20">No orders found for this number</p>
            </div>
          ) : (
            <div className="text-center py-20 space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto border border-white/5">
                <Activity className="w-6 h-6 text-white/10" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Enter your number to track orders</p>
            </div>
          )}
        </div>

        {/* Bottom Actions */}
        {orders.length > 0 && (
          <button 
            onClick={() => { setIsRefreshing(true); fetchOrders(phoneParam); }}
            className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 active:scale-95 transition-all"
          >
            <RefreshCw className={cn("w-4 h-4 text-white/40", isRefreshing && "animate-spin")} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Refresh Status</span>
          </button>
        )}

        {/* Receipt Modal (Portal to document.body for top z-index stacking above all page elements & footer) */}
        <AnimatePresence>
          {showReceipt && createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                onClick={() => setShowReceipt(null)}
                className="fixed inset-0 bg-black/95 backdrop-blur-xl" 
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative w-full max-w-sm bg-[#090a0f] border border-amber-500/30 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.95)] z-10"
              >
                {/* Top Bar Accent */}
                <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500" />

                <div className="p-5 sm:p-6 space-y-5">
                  {/* Header */}
                  <div className="flex justify-between items-center pb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-500/20 border border-amber-500/40">
                        <ReceiptText className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <span className="text-xs font-black uppercase tracking-widest text-white block">Digital E-Receipt</span>
                        <span className="text-[9px] text-slate-400 font-mono">Verified Order</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowReceipt(null)} 
                      className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Receipt Canvas Box */}
                  <div className="bg-[#0e0f17] border border-slate-800 rounded-2xl p-5 space-y-4 font-mono shadow-inner text-slate-100">
                    {/* Store Header */}
                    <div className="text-center pb-3.5 border-b border-dashed border-slate-700/80 space-y-1">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                        </div>
                        <p className="text-xs font-black text-white uppercase tracking-wider">{storeName}</p>
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono">{new Date(showReceipt.created_at).toLocaleString()}</p>
                    </div>
                    
                    {/* Key-Value Details */}
                    <div className="space-y-2.5 text-[11px]">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase text-[10px] tracking-wider">Reference</span>
                        <span className="text-amber-400 font-bold font-mono text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-[150px] truncate">
                          {showReceipt.id.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase text-[10px] tracking-wider">Service</span>
                        <span className="text-slate-200 font-bold">{showReceipt.order_type || "Data Bundle"}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase text-[10px] tracking-wider">Network</span>
                        <span className={cn(
                          "font-black text-[10px] px-2 py-0.5 rounded uppercase",
                          (showReceipt.network || "").includes("MTN") && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                          (showReceipt.network || "").includes("Telecel") && "bg-red-500/20 text-red-300 border border-red-500/30",
                          (showReceipt.network || "").includes("Airtel") && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        )}>
                          {showReceipt.network || "MTN"}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase text-[10px] tracking-wider">Plan / Size</span>
                        <span className="text-white font-bold">{showReceipt.package_size || "—"}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 uppercase text-[10px] tracking-wider">Recipient</span>
                        <span className="text-white font-mono font-bold tracking-wider">{showReceipt.customer_phone}</span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="pt-3 border-t border-dashed border-slate-700/80 flex justify-between items-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Status</span>
                      <div className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-xs",
                        (showReceipt.status === "fulfilled" || showReceipt.status === "processing" || showReceipt.status === "paid") && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                        (showReceipt.status === "pending" || showReceipt.status === "awaiting_payment" || showReceipt.status === "not_paid") && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                        (showReceipt.status === "failed" || showReceipt.status === "fulfillment_failed" || showReceipt.status === "error") && "bg-red-500/15 text-red-400 border border-red-500/30"
                      )}>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {showReceipt.status}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button 
                      onClick={() => copyReceipt(showReceipt)}
                      className="h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy Text
                    </button>
                    <button 
                      onClick={() => window.print()}
                      className="h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                    >
                      <Package className="w-3.5 h-3.5" />
                      Print PDF
                    </button>
                  </div>
                </div>
                
                {/* Card Footer */}
                <div className="border-t border-white/10 py-2.5 text-center bg-black/60">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-400/90 flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    VERIFIED TRANSACTION • 256-BIT ENCRYPTED
                  </p>
                </div>
              </motion.div>
            </div>,
            document.body
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MyOrders;
