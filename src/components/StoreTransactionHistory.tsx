import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Loader2, ArrowLeft, History, Package, Zap, CheckCircle2, XCircle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

interface StoreTransactionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerPhone?: string;
  accentColor?: string;
}

const StoreTransactionHistory = ({
  isOpen,
  onClose,
  customerId,
  customerPhone,
  accentColor = "#FFCC00"
}: StoreTransactionHistoryProps) => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchHistory = async () => {
      setLoading(true);
      try {
        // Build the OR query. The user is either the direct agent_id (for wallet buys) 
        // or they are the customer_id in metadata (for deposits).
        let query = supabase
          .from("orders")
          .select("*")
          .or(`agent_id.eq.${customerId},metadata->>customer_id.eq.${customerId}`)
          .order("created_at", { ascending: false })
          .limit(30);

        const { data, error } = await query;
        if (error) throw error;
        setOrders(data || []);
      } catch (err) {
        console.error("Error fetching history:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [isOpen, customerId, customerPhone]);

  if (!isOpen) return null;

  const slideVariants = {
    initial: { y: "100%", opacity: 0.5 },
    animate: { y: 0, opacity: 1 },
    exit: { y: "100%", opacity: 0.5 }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
        {/* Header */}
        <div className="relative h-14 border-b border-white/10 flex items-center justify-between px-4 bg-black/40 shrink-0 z-10">
          <button 
            onClick={onClose}
            className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-black text-sm uppercase tracking-widest text-white/80">
            Transaction History
          </span>
          <div className="w-9" /> {/* Spacer */}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: accentColor }} />
              <p className="text-xs font-bold text-white/40 uppercase tracking-widest">Loading Records...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <History className="w-8 h-8 text-white/20" />
              </div>
              <div>
                <h3 className="font-black text-lg text-white mb-1">No History Found</h3>
                <p className="text-xs text-white/40 font-semibold max-w-[200px] mx-auto">
                  Your recent deposits and purchases will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-w-md mx-auto pb-8">
              {orders.map((order) => {
                const isDeposit = order.order_type === "store_wallet_topup";
                const isFailed = order.status === "failed";
                const isPending = order.status === "pending" || order.status === "processing";
                const isSuccess = order.status === "fulfilled" || order.status === "completed" || order.status === "paid";

                return (
                  <div key={order.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDeposit ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-400/10 text-amber-400"}`}>
                      {isDeposit ? <Zap className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-white truncate">
                        {isDeposit ? "Wallet Deposit" : `${order.network} ${order.package_size || "Data Bundle"}`}
                      </p>
                      <p className="text-xs text-white/40 font-semibold mt-0.5 truncate">
                        {format(new Date(order.created_at), "MMM d, h:mm a")} · {order.customer_phone || customerPhone}
                      </p>
                    </div>

                    {/* Amount & Status */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-white font-mono">
                        {isDeposit ? "+" : "-"}GHS {Number(order.amount).toFixed(2)}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        {isSuccess && <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Success</span></>}
                        {isFailed && <><XCircle className="w-3 h-3 text-red-400" /><span className="text-[9px] font-black uppercase text-red-400 tracking-wider">Failed</span></>}
                        {isPending && <><Clock className="w-3 h-3 text-amber-400 animate-pulse" /><span className="text-[9px] font-black uppercase text-amber-400 tracking-wider">Pending</span></>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AnimatePresence>
  );
};

export default StoreTransactionHistory;
