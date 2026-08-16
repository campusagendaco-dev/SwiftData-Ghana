import { useState, useEffect } from "react";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { useToast } from "@/hooks/use-toast";
import { X, Loader2, ArrowLeft, CheckCircle2, ShieldCheck, Smartphone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];

const NETWORK_CONFIG: Record<NetworkName, { bg: string; textClass: string; borderClass: string; color: string }> = {
  MTN:        { color: "#FFCC00", bg: "bg-[#FFCC00]", textClass: "text-black", borderClass: "border-[#FFCC00]" },
  Telecel:    { color: "#E60000", bg: "bg-[#E60000]", textClass: "text-white", borderClass: "border-[#E60000]" },
  AirtelTigo: { color: "#00529B", bg: "bg-[#00529B]", textClass: "text-white", borderClass: "border-[#00529B]" },
};

interface StoreDepositFlowProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  initialPhone?: string;
  accentColor?: string;
  onSuccess: () => void;
}

type Step = "input" | "confirm" | "processing" | "success";

const StoreDepositFlow = ({
  isOpen,
  onClose,
  agentId,
  initialPhone = "",
  accentColor = "#FFCC00",
  onSuccess
}: StoreDepositFlowProps) => {
  const { toast } = useToast();
  
  const [step, setStep] = useState<Step>("input");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [network, setNetwork] = useState<NetworkName>("MTN");
  const [pollingId, setPollingId] = useState("");

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setStep("input");
      setAmount("");
      setPhone(initialPhone);
      setNetwork("MTN");
      setPollingId("");
    }
  }, [isOpen, initialPhone]);

  // Polling logic
  useEffect(() => {
    if (!pollingId || step !== "processing") return;
    
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await invokePublicFunctionAsUser("paystack-store-deposit", {
          body: { action: "check-status", transaction_id: pollingId }
        });
        
        if (data?.status === "successful" || data?.status === "failed") {
          clearInterval(pollInterval);
          setPollingId("");
          
          if (data.status === "successful") {
            setStep("success");
            onSuccess();
          } else {
            toast({ title: "Deposit Failed", description: data.reason || "Transaction was not completed.", variant: "destructive" });
            setStep("input");
          }
        }
      } catch (err) {
        // Silently continue polling on network errors
      }
    }, 5000);
    
    return () => clearInterval(pollInterval);
  }, [pollingId, step, onSuccess, toast]);

  if (!isOpen) return null;

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 1) {
      toast({ title: "Invalid amount", description: "Minimum deposit is GHS 1.00", variant: "destructive" });
      return;
    }
    const phoneDigits = phone.replace(/\D+/g, "");
    if (phoneDigits.length < 9) {
      toast({ title: "Invalid phone", description: "Enter a valid mobile money number.", variant: "destructive" });
      return;
    }
    setStep("confirm");
  };

  const handleInitiatePayment = async () => {
    setStep("processing");
    try {
      const { data, error } = await invokePublicFunctionAsUser("paystack-store-deposit", {
        body: {
          action: "initiate-deposit",
          amount: Number(amount),
          phone: phone.replace(/\D+/g, ""),
          network,
          agent_id: agentId
        }
      });

      if (error || data?.error) {
        throw new Error(data?.error || "Could not initiate deposit.");
      }

      if (data.status === "successful" || data.status === "approved" || data.code === "000") {
        setStep("success");
        onSuccess();
      } else {
        setPollingId(data.order_id);
      }
    } catch (err: any) {
      toast({ title: "Deposit failed", description: err.message, variant: "destructive" });
      setStep("input");
    }
  };

  // Variants for sliding animation
  const slideVariants = {
    initial: { x: "100%", opacity: 0.5 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-100%", opacity: 0.5 }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
        {/* Header */}
        <div className="relative h-14 border-b border-white/10 flex items-center justify-between px-4 bg-black/40 shrink-0 z-10">
          <button 
            onClick={() => step === "confirm" ? setStep("input") : onClose()}
            className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors"
          >
            {step === "confirm" ? <ArrowLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
          </button>
          <span className="font-black text-sm uppercase tracking-widest text-white/80">
            {step === "success" ? "Receipt" : "Fund Wallet"}
          </span>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 relative overflow-y-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            {step === "input" && (
              <motion.div 
                key="input"
                variants={slideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 p-5 space-y-6 max-w-md mx-auto"
              >
                <div>
                  <h2 className="text-2xl font-black mb-1">Add Funds</h2>
                  <p className="text-sm text-white/50 font-semibold">Instantly top-up your wallet using Mobile Money.</p>
                </div>

                <form onSubmit={handleProceedToConfirm} className="space-y-5">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Deposit Amount (GHS)</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-lg font-black">₵</div>
                      <input
                        type="number"
                        required min="1" step="0.01" placeholder="50.00"
                        value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-10 pr-4 text-lg font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Select Network</label>
                    <div className="flex gap-2">
                      {NETWORKS.map((n) => {
                        const nc = NETWORK_CONFIG[n];
                        const active = network === n;
                        return (
                          <button
                            type="button" key={n} onClick={() => setNetwork(n)}
                            className={`flex-1 h-12 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                              active ? `${nc.bg} ${nc.textClass} ${nc.borderClass} shadow-lg` : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                            }`}
                            style={active ? { boxShadow: `0 8px 20px ${nc.color}25` } : {}}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">MoMo Number</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <input
                        type="tel" required placeholder="054 123 4567"
                        value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button 
                      type="submit"
                      className="w-full h-14 rounded-2xl text-black font-black text-sm uppercase tracking-wider transition-all active:scale-[0.98]"
                      style={{ backgroundColor: accentColor, boxShadow: `0 8px 24px -8px ${accentColor}80` }}
                    >
                      Proceed
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {step === "confirm" && (
              <motion.div 
                key="confirm"
                variants={slideVariants}
                initial={{ x: "100%", opacity: 0.5 }}
                animate="animate"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 p-5 space-y-6 max-w-md mx-auto"
              >
                <div>
                  <h2 className="text-2xl font-black mb-1">Confirm Payment</h2>
                  <p className="text-sm text-white/50 font-semibold">Please review your deposit details below.</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-white/10">
                    <span className="text-xs text-white/40 uppercase font-black tracking-widest">Amount to Fund</span>
                    <span className="text-xl font-black">GHS {Number(amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40 uppercase font-black tracking-widest">Processing Fee (3%)</span>
                    <span className="text-sm font-black text-white/80">GHS {(Number(amount) * 0.03).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40 uppercase font-black tracking-widest">Network</span>
                    <span className="text-sm font-black" style={{ color: NETWORK_CONFIG[network].color }}>{network} Mobile Money</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40 uppercase font-black tracking-widest">Phone Number</span>
                    <span className="text-sm font-black">{phone}</span>
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-white/10">
                    <span className="text-xs text-white/40 uppercase font-black tracking-widest">Total Charge</span>
                    <span className="text-lg font-black text-emerald-400">GHS {(Number(amount) * 1.03).toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 justify-center pt-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Secured 256-bit Encryption</span>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleInitiatePayment}
                    className="w-full h-14 rounded-2xl text-black font-black text-sm uppercase tracking-wider transition-all active:scale-[0.98]"
                    style={{ backgroundColor: accentColor, boxShadow: `0 8px 24px -8px ${accentColor}80` }}
                  >
                    Confirm & Pay
                  </button>
                </div>
              </motion.div>
            )}

            {step === "processing" && (
              <motion.div 
                key="processing"
                variants={slideVariants}
                initial={{ x: "100%", opacity: 0.5 }}
                animate="animate"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center space-y-6 max-w-md mx-auto"
              >
                <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-2xl opacity-40 animate-pulse bg-amber-500/40" />
                  <motion.img 
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="w-16 h-16 object-contain select-none relative z-10 rounded-full drop-shadow-[0_0_25px_rgba(245,158,11,0.7)]"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div>
                  <h2 className="text-2xl font-black mb-2 text-white uppercase tracking-tight">Authorize Payment</h2>
                  <p className="text-sm text-emerald-400 font-extrabold leading-relaxed max-w-[280px] mx-auto">
                    Please check your phone and enter your Mobile Money PIN to authorize the transaction.
                  </p>
                </div>
                <div className="w-full max-w-[240px] h-3 bg-black/60 border border-amber-500/30 rounded-full mt-4 relative overflow-visible shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-yellow-500/20 to-emerald-500/20 rounded-full" />
                  <motion.div 
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.img 
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="absolute -top-2.5 w-8 h-8 object-contain select-none rounded-full drop-shadow-[0_2px_10px_rgba(245,158,11,0.9)]"
                    initial={{ left: "0%", rotate: 0 }}
                    animate={{ left: "100%", rotate: 720 }}
                    style={{ transform: "translateX(-50%)" }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
                <p className="text-xs font-black text-amber-400 uppercase tracking-widest animate-pulse mt-2">WAITING FOR APPROVAL...</p>
              </motion.div>
            )}

            {step === "success" && (
              <motion.div 
                key="success"
                variants={slideVariants}
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center max-w-md mx-auto"
              >
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}
                  className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 border border-emerald-500/30"
                >
                  <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                </motion.div>

                <h2 className="text-3xl font-black mb-2 text-white">Deposit Successful!</h2>
                <p className="text-white/60 font-semibold mb-8 max-w-[250px]">
                  Your wallet has been credited with GHS {Number(amount).toFixed(2)}.
                </p>

                <button 
                  onClick={onClose}
                  className="w-full h-14 rounded-2xl text-black font-black text-sm uppercase tracking-wider transition-all active:scale-[0.98]"
                  style={{ backgroundColor: accentColor, boxShadow: `0 8px 24px -8px ${accentColor}80` }}
                >
                  Back to Store
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AnimatePresence>
  );
};

export default StoreDepositFlow;
