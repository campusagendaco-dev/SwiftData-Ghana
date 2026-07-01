import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, KeyRound, AlertTriangle, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getFunctionErrorMessage } from "@/lib/function-errors";

interface PaystackMomoCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  email: string;
  recipientPhone: string;
  recipientNetwork: string;
  metadata: any;
  onSuccess: (reference: string) => void;
  onFailure: (error: string) => void;
}

export const PaystackMomoCheckout: React.FC<PaystackMomoCheckoutProps> = ({
  isOpen,
  onClose,
  amount,
  email,
  recipientPhone,
  recipientNetwork,
  metadata,
  onSuccess,
  onFailure,
}) => {
  const { toast } = useToast();
  const { theme, isDark } = useAppTheme();
  
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentNetwork, setPaymentNetwork] = useState<string>("MTN");
  const [step, setStep] = useState<'payment_number' | 'initiating' | 'otp_entry' | 'otp_verifying' | 'success'>('payment_number');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'momo' | 'card'>('momo');
  
  // Real-time verification state
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [isVerifyingName, setIsVerifyingName] = useState(false);
  const [nameResolveError, setNameResolveError] = useState<string | null>(null);

  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [countdown, setCountdown] = useState(60);
  const [reference, setReference] = useState<string>("");
  const [otpError, setOtpError] = useState<string | null>(null);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countdownTimer = useRef<NodeJS.Timeout | null>(null);

  // Initialize network and pre-fill the payment phone number from the recipient if available
  useEffect(() => {
    if (recipientNetwork) {
      setPaymentNetwork(recipientNetwork);
    }
    if (recipientPhone) {
      let displayPhone = recipientPhone;
      if (recipientPhone.startsWith("233") && recipientPhone.length === 12) {
        displayPhone = "0" + recipientPhone.slice(3);
      }
      setPaymentPhone(displayPhone);
    }
  }, [recipientNetwork, recipientPhone]);

  const [activeGateway, setActiveGateway] = useState<string>("paystack");

  useEffect(() => {
    const fetchGateway = async () => {
      try {
        const { data } = await supabase
          .from("system_settings")
          .select("active_payment_gateway, auto_gateway_switch_by_package")
          .eq("id", 1)
          .maybeSingle();

        if (data) {
          if (data.auto_gateway_switch_by_package && (metadata?.is_korba === true || metadata?.is_korba === "true")) {
            setActiveGateway("korba");
          } else if (data.active_payment_gateway) {
            setActiveGateway(data.active_payment_gateway);
          }
        }
      } catch (e) {
        console.error("Failed to load active gateway inside checkout modal", e);
      }
    };
    fetchGateway();
  }, [metadata]);

  useEffect(() => {
    if (!document.getElementById("korba-xcheckout-script")) {
      const script = document.createElement("script");
      script.id = "korba-xcheckout-script";
      script.src = "https://paywithkorba.s3-eu-west-1.amazonaws.com/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Real-time verification effect
  useEffect(() => {
    setVerifiedName(null);
    setNameResolveError(null);
    const resolvePhone = paymentPhone.replace(/\D/g, "");
    if (resolvePhone.length < 9 || !paymentNetwork) return;

    const timeoutId = setTimeout(async () => {
      setIsVerifyingName(true);
      try {
        let bankCode = "";
        if (paymentNetwork === "MTN" || paymentNetwork === "MTN Mash Up") bankCode = "MTN";
        else if (paymentNetwork === "Telecel") bankCode = "VOD";
        else if (paymentNetwork === "AirtelTigo") bankCode = "ATL";

        if (!bankCode) {
          setIsVerifyingName(false);
          return;
        }

        let formattedPhone = resolvePhone;
        if (formattedPhone.startsWith("233") && formattedPhone.length === 12) {
          formattedPhone = "0" + formattedPhone.slice(3);
        } else if (formattedPhone.length === 9) {
          formattedPhone = "0" + formattedPhone;
        }

        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: formattedPhone, bank_code: bankCode }
        });

        if (error || !data?.success) {
           setNameResolveError(data?.error || "Account not found");
        } else if (data.account_name && data.account_name !== "TESTING ACCOUNT NAME") {
           setVerifiedName(data.account_name);
        }
      } catch (err) {
        setNameResolveError("Verification failed");
      } finally {
        setIsVerifyingName(false);
      }
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [paymentPhone, paymentNetwork]);

  // Countdown timer logic
  useEffect(() => {
    if (step === 'otp_entry' && countdown > 0) {
      countdownTimer.current = setTimeout(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0 && countdownTimer.current) {
      clearTimeout(countdownTimer.current);
    }
    return () => {
      if (countdownTimer.current) clearTimeout(countdownTimer.current);
    };
  }, [step, countdown]);

  // Polling for success verification
  useEffect(() => {
    let isPolling = true;
    
    if (step === 'success' && reference) {
      const pollVerification = async () => {
        try {
          const { data, error } = await supabase.functions.invoke("verify-payment", {
            body: { reference }
          });
          
          if (!isPolling) return;
          
          if (data?.status === "fulfilled" || data?.status === "paid" || data?.status === "processing") {
            toast({ title: "Payment Verified", description: "Your transaction was successful!" });
            onSuccess(reference);
          } else if (data?.status === "failed" || data?.status === "error" || data?.status === "fulfillment_failed") {
            const failMsg = data.error || data.reason || "The transaction was unsuccessful.";
            toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
            setErrorMessage(failMsg);
            setStep('payment_number');
          } else {
            // Still pending, poll again after 3 seconds
            setTimeout(pollVerification, 3000);
          }
        } catch (err) {
          if (!isPolling) return;
          // on error, wait and try again
          setTimeout(pollVerification, 5000);
        }
      };
      
      pollVerification();
    }
    
    return () => {
      isPolling = false;
    };
  }, [step, reference, onSuccess, toast]);

  // Handle single digit input
  const handleOtpChange = (value: string, index: number) => {
    if (isNaN(Number(value))) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Trigger auto-submit if full 6 digits are typed
    const fullOtp = newOtp.join("");
    if (fullOtp.length === 6) {
      verifyOtp(fullOtp);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData("text").trim();
    if (pasteData.length === 6 && !isNaN(Number(pasteData))) {
      const newOtp = pasteData.split("");
      setOtp(newOtp);
      otpRefs.current[5]?.focus();
      verifyOtp(pasteData);
    }
  };

  const handleFallbackCheckout = async () => {
    setErrorMessage(null);
    setStep('initiating');
    
    try {
      const { data, error } = await supabase.functions.invoke("wallet-topup", {
        body: {
          amount: amount,
          wallet_credit: metadata?.wallet_credit || amount,
          callback_url: metadata?.callback_url || window.location.href,
          wallet_type: metadata?.wallet_type || "main"
        }
      });
      
      if (error || !data?.authorization_url) {
        throw new Error(data?.error || "Could not initialize Paystack checkout.");
      }
      
      window.location.href = data.authorization_url;
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to launch Paystack checkout.");
      setStep('payment_number');
    }
  };

  const initiateKorbaXCheckout = async () => {
    setStep('initiating');
    setErrorMessage(null);
    const orderId = metadata.order_id || crypto.randomUUID();
    
    try {
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: email.trim() || `${paymentPhone || 'customer'}@swiftdata.gh`,
          amount,
          reference: orderId,
          callback_url: metadata.callback_url || `${window.location.origin}/order-status?reference=${orderId}`,
          metadata: {
            ...metadata,
            order_id: orderId,
            use_xcheckout: true,
            payment_phone: paymentPhone,
            payment_network: paymentNetwork,
          },
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to initialize Korba checkout session.");
      }

      const XCheckout = (window as any).XCheckout;
      if (!XCheckout) {
        throw new Error("Korba payment script not loaded. Please wait a moment or reload.");
      }

      XCheckout.configure({
        merchantID: String(data.merchant_id),
        orderID: data.reference,
        description: metadata.order_type === "wallet_topup" ? "Wallet Topup" : "Service Payment",
        amount: amount,
        redirectURL: `${window.location.origin}/order-status?reference=${data.reference}`
      });

      XCheckout.pay();
    } catch (err: any) {
      console.error("Korba XCheckout launch error:", err);
      setErrorMessage(err.message || "Failed to trigger Korba checkout screen.");
      setStep('payment_number');
      onFailure(err.message || "Korba Checkout error");
    }
  };

  const initiateKorbaCardPay = async () => {
    setStep('initiating');
    setErrorMessage(null);
    const orderId = metadata.order_id || crypto.randomUUID();
    
    try {
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: email.trim() || `${paymentPhone || 'customer'}@swiftdata.gh`,
          amount,
          reference: orderId,
          network_code: "CRD",
          payment_method: "card",
          callback_url: metadata.callback_url || `${window.location.origin}/order-status?reference=${orderId}`,
          metadata: {
            ...metadata,
            order_id: orderId,
            payment_phone: paymentPhone,
            payment_network: paymentNetwork,
          },
        },
      });

      if (error || !data?.authorization_url) {
        throw new Error(data?.error || error?.message || "Failed to initialize Card checkout session.");
      }

      window.location.href = data.authorization_url;
    } catch (err: any) {
      console.error("Korba Card launch error:", err);
      setErrorMessage(err.message || "Failed to trigger Card payment screen.");
      setStep('payment_number');
      onFailure(err.message || "Card Checkout error");
    }
  };

  const initiatePayment = async () => {
    if (!paymentPhone || paymentPhone.length < 9) {
      toast({ title: "Check Payment Phone", description: "Please enter a valid mobile money number", variant: "destructive" });
      return;
    }
    
    setStep('initiating');
    setErrorMessage(null);
    const orderId = metadata.order_id || crypto.randomUUID();
    
    try {
      // 1. Verify the MoMo number via Paystack
      let bankCode = "";
      if (paymentNetwork === "MTN" || paymentNetwork === "MTN Mash Up") bankCode = "MTN";
      else if (paymentNetwork === "Telecel") bankCode = "VOD";
      else if (paymentNetwork === "AirtelTigo") bankCode = "ATL";

      let resolvePhone = paymentPhone;
      if (resolvePhone.startsWith("233") && resolvePhone.length === 12) {
        resolvePhone = "0" + resolvePhone.slice(3);
      } else if (resolvePhone.length === 9) {
        resolvePhone = "0" + resolvePhone;
      }

      if (bankCode) {
        try {
          const { data: resolveData, error: resolveError } = await supabase.functions.invoke("paystack-resolve", {
            body: { account_number: resolvePhone, bank_code: bankCode }
          });
          
          if (!resolveError && resolveData?.success) {
            if (resolveData.account_name && resolveData.account_name !== "TESTING ACCOUNT NAME") {
              toast({ title: "Account Verified", description: resolveData.account_name, duration: 3000 });
            }
          } else {
            console.warn("Mobile Money verification failed or returned failure:", resolveError || resolveData?.error);
          }
        } catch (e) {
          console.warn("Mobile Money verification failed with exception:", e);
        }
      }

      // 2. Initiate Payment
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: email.trim() || `${paymentPhone}@customer.swiftdata.gh`,
          amount,
          reference: orderId,
          callback_url: metadata.callback_url || `${window.location.origin}/order-status?reference=${orderId}`,
          metadata: {
            ...metadata,
            order_id: orderId,
            payment_phone: paymentPhone,
            payment_network: paymentNetwork,
          },
        },
      });

      if (error) throw error;

      if (data?.status === "send_otp") {
        setReference(data.reference || orderId);
        setCountdown(60);
        setOtp(Array(6).fill(""));
        setStep('otp_entry');
        // Delay to allow focus to trigger
        setTimeout(() => otpRefs.current[0]?.focus(), 150);
        toast({ title: "OTP Sent Successfully", description: data.message || "Enter the OTP sent to your phone" });
      } else if (data?.authorization_url) {
        // Direct MoMo charge initiated successfully
        setStep('success');
        setReference(data.reference || orderId);
        // We do NOT call onSuccess automatically here. The polling useEffect will verify it!
      } else {
        throw new Error("Invalid payment response structure");
      }
    } catch (err: any) {
      console.error("Direct payment initiation error:", err);
      const msg = await getFunctionErrorMessage(err, "Failed to trigger direct MoMo prompt");
      setErrorMessage(msg);
      setStep('payment_number');
      onFailure(msg);
    }
  };

  const verifyOtp = async (fullOtp = otp.join("")) => {
    if (fullOtp.length < 6) return;
    
    setStep('otp_verifying');
    setOtpError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          action: "submit_otp",
          reference,
          otp: fullOtp,
        },
      });

      if (error) throw error;

      if (data?.status === "success") {
        setStep('success');
        toast({ title: "OTP Verified Successfully", description: "Processing your transaction..." });
        // The polling useEffect will verify it and call onSuccess
      } else {
        throw new Error(data?.message || "Invalid OTP");
      }
    } catch (err: any) {
      console.error("OTP verification error:", err);
      const msg = err.message || "Incorrect OTP. Please check and try again.";
      setOtpError(msg);
      setStep('otp_entry');
      // Refocus first box
      setOtp(Array(6).fill(""));
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;
    // Just retry initiation with same reference to trigger new OTP
    initiatePayment();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-start pt-8 sm:pt-16 p-4 overflow-y-auto">
      {/* High Definition Backdrop with deep blur */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={step !== 'initiating' && step !== 'otp_verifying' && step !== 'success' ? onClose : undefined}
        className="absolute inset-0 bg-[#030407]/90 backdrop-blur-[8px] cursor-pointer"
      />
      
      {/* Premium Checkout Modal enclosure */}
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 30 }}
        className="relative w-full max-w-[370px] bg-card border border-white/10 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8)] rounded-[2.5rem] overflow-hidden flex flex-col select-none text-card-foreground"
      >
        {/* Adinkra Ambient Header */}
        <div className="relative w-full pt-7 pb-5 text-center bg-gradient-to-b from-black/40 to-card/20 rounded-b-[2.5rem] overflow-hidden border-b border-white/5">
          <div 
            className="absolute inset-0 opacity-[0.10] pointer-events-none mix-blend-overlay"
            style={{ 
              backgroundImage: "url('/assets/adinkra_pattern.png')",
              backgroundSize: "140px"
            }}
          />
          <div 
            className="absolute inset-0 opacity-40 blur-3xl"
            style={{ background: `radial-gradient(circle at 50% 20%, hsl(${theme.primary}), transparent 70%)` }} 
          />
          
          <button 
            disabled={step === 'initiating' || step === 'otp_verifying'}
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-foreground/5 border border-border text-foreground/40 hover:text-foreground transition-all disabled:opacity-20 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative z-10 flex flex-col items-center px-5">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-500 mb-1">
              {activeGateway === "korba" ? "Secure Checkout" : "MoMo Direct Pay"}
            </span>
            <h3 className="text-3xl font-black tracking-tight text-foreground drop-shadow-sm">GH₵{amount.toFixed(2)}</h3>
          </div>
        </div>

        {/* Modal content viewport */}
        <div className="p-6 space-y-5 relative bg-card">
          {step === 'payment_number' && (
            <div className="grid grid-cols-2 gap-2 bg-muted/60 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setSelectedMethod('momo')}
                className={`py-2 text-xs font-black uppercase rounded-lg transition-all ${
                  selectedMethod === 'momo'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Mobile Money
              </button>
              <button
                type="button"
                onClick={() => setSelectedMethod('card')}
                className={`py-2 text-xs font-black uppercase rounded-lg transition-all ${
                  selectedMethod === 'card'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Card Payment
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            
            {/* STEP 1: payment_number selection */}
            {selectedMethod === 'momo' && step === 'payment_number' && (
              <motion.div
                key="payment_number"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wide">Enter Payment Number</h4>
                  <p className="text-xs text-muted-foreground">Receive the instant Mobile Money PIN approval prompt directly on this phone.</p>
                </div>

                <div className="space-y-3.5 pt-1.5">
                  {/* Phone input */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/80 block px-1">MoMo Number</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={paymentPhone}
                      onChange={(e) => setPaymentPhone(e.target.value.replace(/\D/g, ""))}
                      placeholder="0XX XXXXXXX"
                      maxLength={12}
                      className="w-full h-12 bg-background border border-border rounded-xl px-4 text-foreground text-base font-bold tracking-wide focus:outline-none focus:border-primary/40 focus:bg-accent/5 transition-all"
                    />
                  </div>

                  {/* Network selection */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/80 block px-1">Momo Provider</label>
                    <div className="grid grid-cols-3 gap-2">
                      {["MTN", "Telecel", "AirtelTigo"].map((net) => (
                        <button
                          key={net}
                          type="button"
                          onClick={() => setPaymentNetwork(net)}
                          className={`h-10 rounded-xl border text-xs font-black transition-all ${
                            paymentNetwork === net
                              ? "bg-primary border-primary/20 text-primary-foreground font-black shadow-lg"
                              : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                          }`}
                        >
                          {net}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Account Name resolution indicator */}
                  {(isVerifyingName || verifiedName || nameResolveError) && paymentPhone.replace(/\D/g, "").length >= 9 && (
                    <motion.div 
                      initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                      className={`flex items-start gap-2 p-3 rounded-xl text-xs font-semibold leading-normal border ${
                        isVerifyingName 
                          ? "bg-primary/5 border-primary/10 text-primary/80" 
                          : verifiedName 
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                            : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}
                    >
                      {isVerifyingName ? (
                        <>
                          <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
                          <span>Verifying registered account name...</span>
                        </>
                      ) : verifiedName ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>Verified: <span className="font-black tracking-wide">{verifiedName}</span></span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{nameResolveError || "Account not found"}</span>
                        </>
                      )}
                    </motion.div>
                  )}

                  {errorMessage && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs font-semibold leading-normal">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Submit trigger button */}
                  <button
                    onClick={initiatePayment}
                    className="w-full h-12 mt-3 relative overflow-hidden rounded-xl shadow-lg transition-all active:scale-[0.97] hover:-translate-y-0.5 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider text-black"
                    style={{ background: `linear-gradient(135deg, hsl(${theme.primary}) 0%, #F59E0B 100%)` }}
                  >
                    <span>Send MoMo Prompt</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  {/* Fallback Checkout Button */}
                  <div className="pt-2 text-center">
                    <p className="text-[10px] text-muted-foreground mb-2">MoMo Prompt not working? Use Standard Checkout instead.</p>
                    <button
                      onClick={handleFallbackCheckout}
                      className="w-full h-10 border border-border hover:bg-foreground/5 rounded-xl transition-all active:scale-[0.97] flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-foreground/80"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" /> Pay with Card / Standard
                    </button>
                  </div>
                </div>
              </motion.div>
            )}


            {selectedMethod === 'card' && step === 'payment_number' && (
              <motion.div
                key="card_checkout"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5 py-2 animate-in fade-in slide-in-from-right-4 duration-300"
              >
                <div className="space-y-1 text-center">
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wide">Pay with Credit/Debit Card</h4>
                  <p className="text-xs text-muted-foreground">Secure international and local card processing powered by Korba Collections.</p>
                </div>

                {/* Styled Mock Credit Card Graphic */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600 p-5 text-white shadow-xl shadow-orange-500/15 border border-white/10 select-none">
                  {/* Subtle grid lines background overlay */}
                  <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />
                  
                  <div className="flex items-start justify-between relative z-10 mb-8">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-80">Partner Wallet</p>
                      <h4 className="text-xs font-black uppercase tracking-wider">SwiftData Collections</h4>
                    </div>
                    {/* Mock Chip */}
                    <div className="w-8 h-6 bg-yellow-200/80 rounded-md border border-yellow-300 shadow-sm" />
                  </div>

                  <div className="space-y-3 relative z-10">
                    <p className="font-mono text-lg tracking-[0.25em] font-semibold">•••• •••• •••• ••••</p>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[7px] font-black uppercase tracking-widest opacity-60">Card Holder</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider">{email ? email.split('@')[0] : "CUSTOMER"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[7px] font-black uppercase tracking-widest opacity-60">Expires</p>
                        <p className="text-[10px] font-bold font-mono">12/29</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <button
                    type="button"
                    onClick={initiateKorbaCardPay}
                    className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black rounded-xl transition-all shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
                  >
                    Proceed with Card Pay (₵{amount.toFixed(2)})
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  {errorMessage && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs font-semibold leading-normal text-left">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground opacity-60 text-center">
                    You will be redirected to the secure hosted card authorization page.
                  </p>
                </div>
              </motion.div>
            )}

            {/* STEP 2: initiating state */}
            {step === 'initiating' && (
              <motion.div
                key="initiating"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="py-8 flex flex-col items-center justify-center text-center space-y-4"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
                  <motion.img
                    src="/assets/world_cup_ball_2026.png"
                    alt="2026 World Cup Ball"
                    className="w-12 h-12 object-contain select-none inline-block relative z-10 rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div className="space-y-1 px-4">
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wider animate-pulse">Contacting Operator</h4>
                  <p className="text-xs text-muted-foreground">Requesting direct payment prompt for {paymentPhone} on {paymentNetwork} network...</p>
                </div>
              </motion.div>
            )}

            {/* STEP 3: otp_entry page */}
            {step === 'otp_entry' && (
              <motion.div
                key="otp_entry"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-500">
                    <KeyRound className="w-3.5 h-3.5" /> Additional Security
                  </div>
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wide">Enter OTP Code</h4>
                  <p className="text-xs text-muted-foreground">Please enter the 6-digit verification code sent to your mobile wallet phone number.</p>
                </div>

                <div className="space-y-4 pt-2">
                  {/* OTP block input elements */}
                  <div className="flex justify-between gap-1.5">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => (otpRefs.current[idx] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(e.target.value, idx)}
                        onKeyDown={(e) => handleKeyDown(e, idx)}
                        onPaste={idx === 0 ? handlePaste : undefined}
                        className="w-11 h-12 bg-background border border-border rounded-xl text-center text-xl font-extrabold text-foreground focus:outline-none focus:border-amber-500/50 focus:bg-foreground/5 transition-all"
                      />
                    ))}
                  </div>

                  {otpError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs font-semibold leading-normal">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}

                  {/* Countdown Timer with Resend button */}
                  <div className="flex items-center justify-between px-1 text-xs">
                    {countdown > 0 ? (
                      <span className="text-muted-foreground/60 font-medium">
                        Resend in <span className="text-foreground font-mono font-bold">{countdown}s</span>
                      </span>
                    ) : (
                      <button
                        onClick={handleResendOtp}
                        className="text-amber-500 hover:text-amber-400 font-black uppercase tracking-wider flex items-center gap-1 select-none cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3 animate-spin-reverse" /> Resend Code
                      </button>
                    )}
                    <button
                      onClick={() => setStep('payment_number')}
                      className="text-muted-foreground hover:text-foreground font-bold tracking-wide select-none"
                    >
                      Change Number
                    </button>
                  </div>

                  {/* Manual verify trigger button */}
                  <button
                    onClick={() => verifyOtp()}
                    disabled={otp.join("").length < 6}
                    className="w-full h-11 relative overflow-hidden rounded-xl shadow-lg transition-all active:scale-[0.97] hover:-translate-y-0.5 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider text-black disabled:opacity-20 disabled:pointer-events-none"
                    style={{ background: `linear-gradient(135deg, hsl(${theme.primary}) 0%, #F59E0B 100%)` }}
                  >
                    <span>Verify and Approve</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 4: otp_verifying state */}
            {step === 'otp_verifying' && (
              <motion.div
                key="otp_verifying"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="py-8 flex flex-col items-center justify-center text-center space-y-4"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl animate-pulse" />
                  <motion.img
                    src="/assets/world_cup_ball_2026.png"
                    alt="2026 World Cup Ball"
                    className="w-12 h-12 object-contain select-none inline-block relative z-10 rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div className="space-y-1 px-4">
                  <h4 className="text-sm font-black text-foreground uppercase tracking-wider animate-pulse">Securing Verification</h4>
                  <p className="text-xs text-muted-foreground">Confirming OTP signature with Paystack billing engines...</p>
                </div>
              </motion.div>
            )}

            {/* STEP 5: success state */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-10 flex flex-col items-center text-center space-y-5"
              >
                <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-2xl opacity-30 animate-pulse bg-emerald-500" />
                  <motion.img
                    src="/assets/world_cup_ball_2026.png"
                    alt="2026 World Cup Ball"
                    className="w-14 h-14 object-contain select-none inline-block relative z-10 rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-black text-foreground uppercase tracking-tight">Authorize Payment</h4>
                  <p className="text-[13px] text-emerald-400/80 font-bold max-w-[240px] mx-auto leading-relaxed px-2">
                    Please check your phone now and enter your Mobile Money PIN to approve the transaction.
                  </p>
                </div>
                {/* World Cup turf progress line with rolling ball */}
                <div className="w-full max-w-[220px] h-2 bg-emerald-950/40 border border-emerald-500/25 rounded-full mt-2 relative overflow-visible">
                  <div className="absolute inset-0 bg-emerald-900/10 rounded-full" />
                  <motion.div 
                    className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.img 
                    src="/assets/world_cup_ball_2026.png"
                    alt="2026 World Cup Ball"
                    className="absolute -top-1.5 w-5 h-5 object-contain select-none rounded-full"
                    initial={{ left: "0%", rotate: 0 }}
                    animate={{ left: "100%", rotate: 360 }}
                    style={{ transform: "translateX(-50%)" }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
                <p className="text-xs font-bold text-emerald-400/80 uppercase tracking-widest animate-pulse mt-2 mb-1">Waiting for approval...</p>
                
                <p className="text-[10px] text-muted-foreground font-medium px-4">
                  Didn't receive a prompt? Dial <span className="font-bold text-foreground">*170#</span> &rarr; Option 6 (My Approvals) for MTN, or <span className="font-bold text-foreground">*110#</span> for Telecel.
                </p>

                <div className="flex w-full gap-2 mt-4 px-4">
                  <button
                    onClick={() => {
                      setStep('payment_number');
                      setErrorMessage(null);
                    }}
                    className="flex-1 py-2.5 bg-transparent hover:bg-foreground/5 border border-border rounded-xl text-[10px] font-black uppercase tracking-wider text-foreground/70 transition-all active:scale-95"
                  >
                    Change Number
                  </button>
                  <button
                    onClick={() => onSuccess(reference)}
                    className="flex-1 py-2.5 bg-foreground/5 hover:bg-foreground/10 border border-border rounded-xl text-[10px] font-black uppercase tracking-wider text-foreground transition-all active:scale-95 flex justify-center items-center gap-1"
                  >
                    Verify Now <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div className="w-full px-4 mt-2">
                  <button
                    onClick={handleFallbackCheckout}
                    className="w-full py-2.5 hover:bg-foreground/5 border border-border rounded-xl text-[10px] font-black uppercase tracking-widest text-foreground/60 transition-all active:scale-95 flex justify-center items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3 h-3" /> Still no prompt? Use Standard Checkout
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Secure transaction lock footer */}
        <div className="py-4 bg-[#0a0a0d] border-t border-white/5 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/60" /> Secure 256-Bit SSL Payment
        </div>
      </motion.div>
    </div>
  );
};
