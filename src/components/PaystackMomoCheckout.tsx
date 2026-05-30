import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, KeyRound, AlertTriangle, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";

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

  // Initialize network once, but do NOT auto-fill the phone number
  useEffect(() => {
    if (recipientNetwork) {
      setPaymentNetwork(recipientNetwork);
    }
  }, [recipientNetwork]);

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
        if (paymentNetwork === "MTN") bankCode = "MTN";
        else if (paymentNetwork === "Telecel") bankCode = "VOD";
        else if (paymentNetwork === "AirtelTigo") bankCode = "ATL";

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
      if (paymentNetwork === "MTN") bankCode = "MTN";
      else if (paymentNetwork === "Telecel") bankCode = "VOD";
      else if (paymentNetwork === "AirtelTigo") bankCode = "ATL";

      let resolvePhone = paymentPhone;
      if (resolvePhone.startsWith("233") && resolvePhone.length === 12) {
        resolvePhone = "0" + resolvePhone.slice(3);
      } else if (resolvePhone.length === 9) {
        resolvePhone = "0" + resolvePhone;
      }

      if (bankCode) {
        const { data: resolveData, error: resolveError } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: resolvePhone, bank_code: bankCode }
        });
        
        if (resolveError || !resolveData?.success) {
           throw new Error(resolveData?.error || "Could not verify this Mobile Money number. Please check it and try again.");
        }
        
        if (resolveData.account_name && resolveData.account_name !== "TESTING ACCOUNT NAME") {
           toast({ title: "Account Verified", description: resolveData.account_name, duration: 3000 });
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
            customer_phone: paymentPhone,
            network: paymentNetwork,
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
        setTimeout(() => {
          onSuccess(data.reference || orderId);
        }, 20000);
      } else {
        throw new Error("Invalid payment response structure");
      }
    } catch (err: any) {
      console.error("Direct payment initiation error:", err);
      const msg = err.message || "Failed to trigger direct MoMo prompt";
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
        setTimeout(() => {
          onSuccess(reference);
        }, 1200);
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
            disabled={step === 'initiating' || step === 'otp_verifying' || step === 'success'}
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/5 border border-white/5 text-white/40 hover:text-white transition-all disabled:opacity-20 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative z-10 flex flex-col items-center px-5">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-500 mb-1">MoMo Direct Pay</span>
            <h3 className="text-3xl font-black tracking-tight text-white">GH₵{amount.toFixed(2)}</h3>
          </div>
        </div>

        {/* Modal content viewport */}
        <div className="p-6 space-y-5 relative bg-card">
          <AnimatePresence mode="wait">
            
            {/* STEP 1: payment_number selection */}
            {step === 'payment_number' && (
              <motion.div
                key="payment_number"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-white uppercase tracking-wide">Enter Payment Number</h4>
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
                      className="w-full h-12 bg-background border border-white/10 rounded-xl px-4 text-white text-base font-bold tracking-wide focus:outline-none focus:border-primary/40 focus:bg-accent/5 transition-all"
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
                              ? "bg-white/10 border-white/40 text-white font-black shadow-lg"
                              : "border-white/5 bg-background text-muted-foreground hover:border-white/20 hover:text-white"
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
                  <Loader2 className="w-12 h-12 text-amber-500 animate-spin relative z-10" />
                </div>
                <div className="space-y-1 px-4">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider animate-pulse">Contacting Operator</h4>
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
                  <h4 className="text-sm font-black text-white uppercase tracking-wide">Enter OTP Code</h4>
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
                        className="w-11 h-12 bg-background border border-white/10 rounded-xl text-center text-xl font-extrabold text-white focus:outline-none focus:border-amber-500/50 focus:bg-white/5 transition-all"
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
                        Resend in <span className="text-white font-mono font-bold">{countdown}s</span>
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
                      className="text-muted-foreground hover:text-white font-bold tracking-wide select-none"
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
                  <Loader2 className="w-12 h-12 text-primary animate-spin relative z-10" style={{ color: `hsl(${theme.primary})` }} />
                </div>
                <div className="space-y-1 px-4">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider animate-pulse">Securing Verification</h4>
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
                  <Loader2 className="w-16 h-16 animate-spin text-emerald-400 relative z-10" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-black text-white uppercase tracking-tight">Authorize Payment</h4>
                  <p className="text-[13px] text-emerald-400/80 font-bold max-w-[240px] mx-auto leading-relaxed px-2">
                    Please check your phone now and enter your Mobile Money PIN to approve the transaction.
                  </p>
                </div>
                <div className="w-full max-w-[200px] h-1 bg-white/10 rounded-full overflow-hidden mt-2 relative">
                  <motion.div 
                    className="h-full bg-emerald-500 rounded-full absolute left-0 top-0"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 20, ease: "linear" }}
                  />
                </div>
                
                <button
                  onClick={() => onSuccess(reference)}
                  className="mt-4 px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all active:scale-95 flex items-center gap-2"
                >
                  I've Approved It <ArrowRight className="w-3.5 h-3.5" />
                </button>
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
