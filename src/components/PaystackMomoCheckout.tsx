import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, KeyRound, AlertTriangle, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { runFraudSentinelCheck } from "@/lib/fraud-sentinel";
import { getProofOfHumanityToken } from "@/lib/device-fingerprint";

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
  const [isBeneficiaryVerified, setIsBeneficiaryVerified] = useState(true);

  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [countdown, setCountdown] = useState(60);
  const [reference, setReference] = useState<string>("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [isManualVerifying, setIsManualVerifying] = useState(false);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countdownTimer = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  const handleManualVerify = async () => {
    if (!reference || isManualVerifying) return;
    setIsManualVerifying(true);
    try {
      // 1. Instant check via DB RPC
      const { data: rpcData } = await (supabase.rpc as any)("get_public_order_status", {
        p_reference: reference
      });
      const rpcList = rpcData as any[];
      if (rpcList && rpcList.length > 0) {
        const status = rpcList[0].status;
        if (status === "fulfilled" || status === "paid" || status === "processing") {
          toast({ title: "Payment Verified!", description: "Your transaction was confirmed successfully." });
          onSuccess(reference);
          return;
        } else if (status === "failed" || status === "error" || status === "fulfillment_failed") {
          const failMsg = rpcList[0].failure_reason || "The payment failed or was declined.";
          toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
          setErrorMessage(failMsg);
          setStep('payment_number');
          return;
        }
      }

      // 2. Invoke verify-payment Edge Function with force: true
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference, force: true }
      });
      if (data?.status === "fulfilled" || data?.status === "paid" || data?.status === "processing") {
        toast({ title: "Payment Verified!", description: "Your transaction was confirmed successfully." });
        onSuccess(reference);
      } else if (data?.status === "failed" || data?.status === "error" || data?.status === "fulfillment_failed") {
        const failMsg = data?.error || data?.reason || "The payment failed or was declined.";
        toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
        setErrorMessage(failMsg);
        setStep('payment_number');
      } else {
        toast({ title: "Verification in Progress", description: "Gateway is processing your MoMo PIN entry. Retrying check..." });
      }
    } catch (err: any) {
      toast({ title: "Verification Error", description: "Could not reach gateway. Retrying automatically...", variant: "destructive" });
    } finally {
      setIsManualVerifying(false);
    }
  };

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

  // Verify recipient beneficiary status when checkout opens
  useEffect(() => {
    if (!isOpen || !recipientPhone) {
      setIsBeneficiaryVerified(true);
      return;
    }

    const verifyRecipient = async () => {
      const net = String(recipientNetwork || "").toUpperCase();
      const isMtn = net.includes("MTN") || net.includes("YELLO");
      if (!isMtn) {
        setIsBeneficiaryVerified(true);
        return;
      }

      if (metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true") {
        setIsBeneficiaryVerified(true);
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("verify-beneficiary", {
          body: {
            phone: recipientPhone.replace(/\D/g, ""),
            network: recipientNetwork
          }
        });

        if (error || !data) {
          console.warn("Failed to verify recipient beneficiary status", error);
          setIsBeneficiaryVerified(true);
          return;
        }

        if (data.exists === false) {
          setIsBeneficiaryVerified(false);
        } else {
          setIsBeneficiaryVerified(true);
        }
      } catch (e) {
        console.warn("Error verifying recipient beneficiary status", e);
        setIsBeneficiaryVerified(true);
      }
    };

    verifyRecipient();
  }, [isOpen, recipientPhone, recipientNetwork, metadata]);

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
          const settings = data as any;
          if (settings.auto_gateway_switch_by_package && (metadata?.is_korba === true || metadata?.is_korba === "true")) {
            setActiveGateway("korba");
          } else if (settings.active_payment_gateway) {
            setActiveGateway(settings.active_payment_gateway);
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

  // Real-time listener & fast polling for instant success verification
  useEffect(() => {
    let isPolling = true;
    let pollTimer: NodeJS.Timeout | null = null;
    let channel: any = null;
    
    if (step === 'success' && reference) {
      // 1. Supabase Realtime DB listener for instant webhook response
      const channelId = `momo_verify_${reference}_${Math.random().toString(36).substring(7)}`;
      channel = supabase.channel(channelId)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${reference}` }, (payload) => {
          if (!isPolling) return;
          const status = payload.new?.status;
          if (status === "fulfilled" || status === "paid" || status === "processing") {
            toast({ title: "Payment Verified", description: "Your transaction was successful!" });
            onSuccess(reference);
          } else if (status === "failed" || status === "error" || status === "fulfillment_failed") {
            const failMsg = payload.new?.failure_reason || "The transaction was unsuccessful.";
            toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
            setErrorMessage(failMsg);
            setStep('payment_number');
          }
        })
        .subscribe();

      // 2. Active Fast-Polling (1.5s interval) with force: true to check Paystack directly
      const pollVerification = async () => {
        if (inFlightRef.current) {
          if (isPolling) pollTimer = setTimeout(pollVerification, 1500);
          return;
        }
        inFlightRef.current = true;
        try {
          // Instant check via DB RPC
          const { data: rpcData } = await (supabase.rpc as any)("get_public_order_status", {
            p_reference: reference
          });
          if (!isPolling) return;

          const rpcList = rpcData as any[];
          if (rpcList && rpcList.length > 0) {
            const status = rpcList[0].status;
            if (status === "fulfilled" || status === "paid" || status === "processing") {
              toast({ title: "Payment Verified", description: "Your transaction was successful!" });
              onSuccess(reference);
              return;
            } else if (status === "failed" || status === "error" || status === "fulfillment_failed") {
              const failMsg = rpcList[0].failure_reason || "The transaction was unsuccessful.";
              toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
              setErrorMessage(failMsg);
              setStep('payment_number');
              return;
            }
          }

          const { data, error } = await supabase.functions.invoke("verify-payment", {
            body: { reference, force: true }
          });
          
          if (!isPolling) return;

          if (error) {
            const isRateLimit = error.status === 429 || String(error.message).includes("429") || String(error.message).includes("slow down");
            if (isRateLimit) {
              console.warn("[PaystackMomoCheckout] 429 rate limited, backing off polling for 4 seconds.");
              pollTimer = setTimeout(pollVerification, 4000);
              return;
            }
          }
          
          if (data?.status === "fulfilled" || data?.status === "paid" || data?.status === "processing") {
            toast({ title: "Payment Verified", description: "Your transaction was successful!" });
            onSuccess(reference);
          } else if (data?.status === "failed" || data?.status === "error" || data?.status === "fulfillment_failed") {
            const failMsg = data?.error || data?.reason || "The transaction was unsuccessful.";
            toast({ title: "Payment Failed", description: failMsg, variant: "destructive" });
            setErrorMessage(failMsg);
            setStep('payment_number');
          } else {
            // Poll every 3.0s while waiting for approval (Realtime handles instant updates)
            pollTimer = setTimeout(pollVerification, 3000);
          }
        } catch (err) {
          if (!isPolling) return;
          pollTimer = setTimeout(pollVerification, 3500);
        } finally {
          inFlightRef.current = false;
        }
      };
      
      // Instant check when user returns to browser tab after typing PIN on phone
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          console.log("[PaystackMomoCheckout] Tab focused, running immediate payment verification");
          pollVerification();
        }
      };
      window.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleVisibilityChange);

      pollVerification();

      return () => {
        isPolling = false;
        if (pollTimer) clearTimeout(pollTimer);
        if (channel) supabase.removeChannel(channel);
        window.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("focus", handleVisibilityChange);
      };
    }
    
    return () => {
      isPolling = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (channel) supabase.removeChannel(channel);
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

    const fraudCheck = await runFraudSentinelCheck({
      phone: paymentPhone || recipientPhone,
      amount,
      orderType: metadata?.order_type,
      network: paymentNetwork || recipientNetwork
    });
    if (!fraudCheck.allowed) {
      setErrorMessage(fraudCheck.reason || "Transaction blocked by Security Sentinel.");
      onFailure(fraudCheck.reason || "Transaction blocked");
      return;
    }

    setStep('initiating');
    const orderId = metadata?.order_id || crypto.randomUUID();
    
    try {
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: email.trim() || `${paymentPhone || recipientPhone || 'customer'}@swiftdata.gh`,
          amount,
          base_price: metadata?.base_price || amount,
          reference: orderId,
          network_code: "CRD",
          payment_method: "card",
          honeypot,
          device_fingerprint: getProofOfHumanityToken().deviceFingerprint,
          poh_token: getProofOfHumanityToken(),
          callback_url: metadata?.callback_url || `${window.location.origin}/order-status?reference=${orderId}`,
          metadata: {
            ...metadata,
            order_id: orderId,
            payment_phone: paymentPhone || recipientPhone,
            payment_network: paymentNetwork || recipientNetwork,
            is_fallback: true,
            bypass_beneficiary: (metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true" || !isBeneficiaryVerified) ? true : undefined,
          },
        }
      });
      
      if (error || !data?.authorization_url) {
        throw new Error(data?.error || error?.message || "Could not initialize Paystack checkout.");
      }
      
      window.location.href = data.authorization_url;
    } catch (err: any) {
      console.error("Paystack fallback checkout error:", err);
      setErrorMessage(err.message || "Failed to launch Paystack checkout.");
      setStep('payment_number');
    }
  };

  const initiateKorbaXCheckout = async () => {
    setErrorMessage(null);

    const fraudCheck = await runFraudSentinelCheck({
      phone: paymentPhone || recipientPhone,
      amount,
      orderType: metadata?.order_type,
      network: paymentNetwork || recipientNetwork
    });
    if (!fraudCheck.allowed) {
      setErrorMessage(fraudCheck.reason || "Transaction blocked by Security Sentinel.");
      setStep('payment_number');
      onFailure(fraudCheck.reason || "Transaction blocked");
      return;
    }

    setStep('initiating');
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
            bypass_beneficiary: (metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true" || !isBeneficiaryVerified) ? true : undefined,
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

  const initiatePaystackCardPay = async () => {
    setErrorMessage(null);

    const fraudCheck = await runFraudSentinelCheck({
      phone: paymentPhone || recipientPhone,
      amount,
      orderType: metadata?.order_type,
      network: paymentNetwork || recipientNetwork
    });
    if (!fraudCheck.allowed) {
      setErrorMessage(fraudCheck.reason || "Transaction blocked by Security Sentinel.");
      setStep('payment_number');
      onFailure(fraudCheck.reason || "Transaction blocked");
      return;
    }

    setStep('initiating');
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
            bypass_beneficiary: (metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true" || !isBeneficiaryVerified) ? true : undefined,
          },
        },
      });

      if (error || !data?.authorization_url) {
        throw new Error(data?.error || error?.message || "Failed to initialize Card checkout session.");
      }

      window.location.href = data.authorization_url;
    } catch (err: any) {
      console.error("Paystack Card launch error:", err);
      setErrorMessage(err.message || "Failed to trigger Card payment screen.");
      setStep('payment_number');
      onFailure(err.message || "Card Checkout error");
    }
  };

  const initiatePayment = async () => {
    if (step === 'initiating' || step === 'otp_verifying') return;

    if (!paymentPhone || paymentPhone.length < 9) {
      toast({ title: "Check Payment Phone", description: "Please enter a valid mobile money number", variant: "destructive" });
      return;
    }

    const fraudCheck = await runFraudSentinelCheck({
      phone: paymentPhone || recipientPhone,
      amount,
      orderType: metadata?.order_type,
      network: paymentNetwork || recipientNetwork
    });
    if (!fraudCheck.allowed) {
      setErrorMessage(fraudCheck.reason || "Transaction blocked by Security Sentinel.");
      setStep('payment_number');
      onFailure(fraudCheck.reason || "Transaction blocked");
      return;
    }
    
    setStep('initiating');
    setErrorMessage(null);
    const orderId = metadata.order_id || crypto.randomUUID();
    
    try {
      // 1. Initiate Payment
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: email.trim() || `${paymentPhone}@customer.swiftdata.gh`,
          amount,
          base_price: metadata.base_price || amount,
          reference: orderId,
          honeypot,
          device_fingerprint: getProofOfHumanityToken().deviceFingerprint,
          poh_token: getProofOfHumanityToken(),
          callback_url: metadata.callback_url || `${window.location.origin}/order-status?reference=${orderId}`,
          metadata: {
            ...metadata,
            base_price: metadata.base_price || amount,
            order_id: orderId,
            payment_phone: paymentPhone,
            payment_network: paymentNetwork,
            bypass_beneficiary: (metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true" || !isBeneficiaryVerified) ? true : undefined,
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

  const getNetworkGlow = () => {
    const net = (paymentNetwork || recipientNetwork || "").toUpperCase();
    if (net.includes("VODA") || net.includes("TELECEL")) return "from-red-600/30 via-red-900/20 to-transparent";
    if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) return "from-blue-600/30 via-blue-900/20 to-transparent";
    return "from-amber-500/30 via-yellow-600/20 to-transparent";
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-start pt-6 sm:pt-14 p-4 overflow-y-auto">
      {/* High Definition Backdrop with deep blur */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={step !== 'initiating' && step !== 'otp_verifying' && step !== 'success' ? onClose : undefined}
        className="absolute inset-0 bg-[#020305]/90 backdrop-blur-xl cursor-pointer"
      />
      
      {/* Premium Glassmorphic Checkout Modal enclosure */}
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 20 }}
        className="relative w-full max-w-[360px] bg-[#0b0c12]/95 border border-slate-800/80 shadow-[0_32px_90px_-15px_rgba(0,0,0,0.95)] rounded-[2.25rem] overflow-hidden flex flex-col select-none text-white backdrop-blur-3xl"
      >
        {/* Dynamic Carrier Ambient Header */}
        <div className="relative w-full pt-6 pb-4 text-center rounded-b-[2rem] overflow-hidden border-b border-slate-800/60">
          <div 
            className="absolute inset-0 opacity-[0.06] pointer-events-none mix-blend-overlay"
            style={{ 
              backgroundImage: "url('/assets/adinkra_pattern.png')",
              backgroundSize: "120px"
            }}
          />
          <div 
            className={`absolute inset-0 bg-gradient-to-b ${getNetworkGlow()} opacity-80 blur-2xl`}
          />
          
          <button 
            disabled={step === 'initiating' || step === 'otp_verifying'}
            onClick={onClose}
            className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/60 text-slate-400 hover:text-white transition-all flex items-center justify-center disabled:opacity-20 active:scale-90 z-20"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative z-10 flex flex-col items-center px-4">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-400/90 mb-1">
              {activeGateway === "korba" ? "Secure Checkout" : "MoMo Direct Pay"}
            </span>
            <h3 className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 drop-shadow-md">
              GH₵{amount.toFixed(2)}
            </h3>
            {(metadata?.package_size || recipientNetwork) && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-amber-500/30 text-amber-300 text-[10px] font-black uppercase tracking-wider font-mono shadow-md backdrop-blur-md">
                <span>{metadata?.package_size || "Bundle"}</span>
                <span className="text-amber-500/60">&bull;</span>
                <span>{metadata?.network || recipientNetwork}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal content viewport */}
        <div className="p-5 space-y-4 relative bg-[#0b0c12]/90">
          {step === 'payment_number' && (
            <div className="grid grid-cols-2 gap-1.5 bg-slate-900/90 p-1 rounded-2xl border border-slate-800/80">
              <button
                type="button"
                onClick={() => setSelectedMethod('momo')}
                className={`py-2 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all ${
                  selectedMethod === 'momo'
                    ? 'bg-amber-400 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Mobile Money
              </button>
              <button
                type="button"
                onClick={() => setSelectedMethod('card')}
                className={`py-2 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all ${
                  selectedMethod === 'card'
                    ? 'bg-amber-400 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
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
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="space-y-4"
              >
                <div className="space-y-0.5">
                  <h4 className="text-xs font-black text-white uppercase tracking-wide">Enter Payment Number</h4>
                  <p className="text-[11px] text-slate-400 leading-tight">Receive instant Mobile Money PIN prompt on your phone.</p>
                </div>

                <div className="space-y-3.5 pt-1">
                  {/* Phone input */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block px-0.5 font-mono">MoMo Number</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={paymentPhone}
                      onChange={(e) => setPaymentPhone(e.target.value.replace(/\D/g, ""))}
                      placeholder="0XX XXXXXXX"
                      maxLength={12}
                      className="w-full h-12 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 text-white text-base font-bold tracking-wider font-mono focus:outline-none focus:border-amber-400/80 transition-all shadow-inner"
                    />
                    {/* Invisible Bot Honeypot Trap */}
                    <input
                      type="text"
                      name="company_tax_id"
                      value={honeypot}
                      onChange={(e) => setHoneypot(e.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                      style={{ display: "none", opacity: 0, position: "absolute", left: "-9999px" }}
                      aria-hidden="true"
                    />
                  </div>

                  {/* Network selection with Carrier Branded Active Pills */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block px-0.5 font-mono">MoMo Provider</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "MTN", label: "MTN", activeClass: "bg-[#FFCC00] text-black font-black shadow-[0_0_15px_rgba(255,204,0,0.4)] border-amber-300" },
                        { id: "Telecel", label: "Telecel", activeClass: "bg-[#DC2626] text-white font-black shadow-[0_0_15px_rgba(220,38,38,0.4)] border-red-400" },
                        { id: "AirtelTigo", label: "AirtelTigo", activeClass: "bg-[#00529B] text-white font-black shadow-[0_0_15px_rgba(0,82,155,0.4)] border-blue-400" }
                      ].map((net) => {
                        const active = paymentNetwork === net.id;
                        return (
                          <button
                            key={net.id}
                            type="button"
                            onClick={() => setPaymentNetwork(net.id)}
                            className={`h-10 rounded-2xl border text-xs font-extrabold transition-all duration-200 ${
                              active
                                ? net.activeClass
                                : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white"
                            }`}
                          >
                            {net.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Account Name resolution indicator */}
                  {(isVerifyingName || verifiedName || nameResolveError) && paymentPhone.replace(/\D/g, "").length >= 9 && (
                    <motion.div 
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className={`flex items-center gap-2 p-3 rounded-2xl text-xs font-bold leading-snug border ${
                        isVerifyingName 
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
                          : verifiedName 
                            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" 
                            : "bg-red-500/10 border-red-500/25 text-red-400"
                      }`}
                    >
                      {isVerifyingName ? (
                        <>
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-amber-400" />
                          <span>Verifying account...</span>
                        </>
                      ) : verifiedName ? (
                        <>
                          <div className="w-5 h-5 rounded-full bg-emerald-500 text-black flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                          <span>Verified: <span className="font-black uppercase tracking-wide text-white">{verifiedName}</span></span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                          <span>{nameResolveError || "Account not found"}</span>
                        </>
                      )}
                    </motion.div>
                  )}

                  {/* Beneficiary Warning Alert */}
                  {!isBeneficiaryVerified && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-2xl text-xs font-semibold leading-snug"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      <span>{recipientPhone} is not in beneficiary list</span>
                    </motion.div>
                  )}

                  {errorMessage && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-2xl text-xs font-semibold leading-snug">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Submit trigger button */}
                  <button
                    onClick={initiatePayment}
                    className="w-full h-12 mt-2 relative overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(251,191,36,0.35)] transition-all active:scale-[0.98] hover:brightness-110 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider text-black bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500"
                  >
                    <span>Send MoMo Prompt</span>
                    <ArrowRight className="w-4 h-4 stroke-[3]" />
                  </button>

                  {/* Fallback Checkout Button */}
                  <div className="pt-1 text-center">
                    <button
                      onClick={handleFallbackCheckout}
                      className="w-full h-10 bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Standard Checkout
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {selectedMethod === 'card' && step === 'payment_number' && (
              <motion.div
                key="card_checkout"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-4 py-1"
              >
                <div className="space-y-0.5 text-center">
                  <h4 className="text-xs font-black text-white uppercase tracking-wide">Pay with Card</h4>
                  <p className="text-[11px] text-slate-400">Local &amp; international cards via Paystack.</p>
                </div>

                {/* Styled Card Graphic */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 p-5 text-black shadow-xl border border-amber-300/30 select-none">
                  <div className="flex items-start justify-between relative z-10 mb-6">
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest opacity-80">Partner Wallet</p>
                      <h4 className="text-xs font-black uppercase tracking-wider">SwiftData Collections</h4>
                    </div>
                    <div className="w-8 h-6 bg-black/80 rounded-md border border-white/20 shadow-xs flex items-center justify-center text-[8px] font-bold text-amber-400">
                      VISA
                    </div>
                  </div>

                  <div className="space-y-2 relative z-10">
                    <p className="font-mono text-lg tracking-[0.2em] font-black">•••• •••• •••• ••••</p>
                    <div className="flex justify-between items-end text-[10px]">
                      <div>
                        <p className="opacity-70 text-[7px] font-black uppercase">Card Holder</p>
                        <p className="font-black uppercase tracking-wider">{email ? email.split('@')[0] : "CUSTOMER"}</p>
                      </div>
                      <div className="text-right">
                        <p className="opacity-70 text-[7px] font-black uppercase">Expires</p>
                        <p className="font-black font-mono">12/29</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={initiatePaystackCardPay}
                    className="w-full h-12 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black font-black rounded-2xl transition-all shadow-[0_8px_25px_rgba(251,191,36,0.35)] flex items-center justify-center gap-2 text-xs uppercase active:scale-[0.98]"
                  >
                    <span>Proceed with Card (GH₵{amount.toFixed(2)})</span>
                    <ArrowRight className="w-4 h-4 stroke-[3]" />
                  </button>

                  {errorMessage && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-2xl text-xs font-semibold leading-snug text-left">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      <span>{errorMessage}</span>
                    </div>
                  )}
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
                  <div className="absolute inset-0 bg-amber-500/30 rounded-full blur-2xl animate-pulse" />
                  <motion.img
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="w-14 h-14 object-contain select-none inline-block relative z-10 rounded-full drop-shadow-[0_0_20px_rgba(245,158,11,0.6)]"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div className="space-y-1 px-3">
                  <h4 className="text-sm font-black text-amber-400 uppercase tracking-wider animate-pulse">Contacting Operator</h4>
                  <p className="text-xs text-slate-400">Requesting direct payment prompt for {paymentPhone}...</p>
                </div>
              </motion.div>
            )}

            {/* STEP 3: otp_entry page */}
            {step === 'otp_entry' && (
              <motion.div
                key="otp_entry"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                    <KeyRound className="w-3.5 h-3.5" /> Security Code
                  </div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wide">Enter OTP Code</h4>
                  <p className="text-xs text-slate-400">Enter the 6-digit code sent to your wallet phone.</p>
                </div>

                <div className="space-y-4 pt-1">
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
                        className="w-11 h-12 bg-slate-900 border border-slate-800 rounded-2xl text-center text-xl font-black text-white focus:outline-none focus:border-amber-400 transition-all shadow-inner"
                      />
                    ))}
                  </div>

                  {otpError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-2xl text-xs font-semibold leading-snug">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between px-1 text-xs">
                    {countdown > 0 ? (
                      <span className="text-slate-400 font-medium">
                        Resend in <span className="text-amber-400 font-mono font-black">{countdown}s</span>
                      </span>
                    ) : (
                      <button
                        onClick={handleResendOtp}
                        className="text-amber-400 hover:text-amber-300 font-black uppercase tracking-wider flex items-center gap-1 select-none cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5 animate-spin-reverse" /> Resend Code
                      </button>
                    )}
                    <button
                      onClick={() => setStep('payment_number')}
                      className="text-slate-400 hover:text-white font-bold tracking-wide select-none"
                    >
                      Change Number
                    </button>
                  </div>

                  <button
                    onClick={() => verifyOtp()}
                    disabled={otp.join("").length < 6}
                    className="w-full h-12 relative overflow-hidden rounded-2xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider text-black bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 disabled:opacity-30"
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
                  <div className="absolute inset-0 bg-amber-500/30 rounded-full blur-2xl animate-pulse" />
                  <motion.img
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="w-14 h-14 object-contain select-none inline-block relative z-10 rounded-full drop-shadow-[0_0_20px_rgba(245,158,11,0.6)]"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <div className="space-y-1 px-3">
                  <h4 className="text-sm font-black text-amber-400 uppercase tracking-wider animate-pulse">Securing Verification</h4>
                  <p className="text-xs text-slate-400">Confirming OTP signature...</p>
                </div>
              </motion.div>
            )}

            {/* STEP 5: success / approval waiting state */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-4 flex flex-col items-center text-center space-y-4"
              >
                {/* 3D Ghana Gold Coin with Aura */}
                <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-2xl opacity-40 animate-pulse bg-amber-500/40" />
                  <motion.img
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="w-14 h-14 object-contain select-none inline-block relative z-10 rounded-full drop-shadow-[0_0_22px_rgba(245,158,11,0.75)]"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  />
                </div>

                <div className="space-y-1">
                  <h4 className="text-xl font-black text-white uppercase tracking-wide drop-shadow-md">AUTHORIZE PAYMENT</h4>
                  <p className="text-xs text-emerald-400 font-black max-w-[240px] mx-auto leading-relaxed px-1">
                    Please check your phone now and enter your Mobile Money PIN to approve.
                  </p>
                </div>

                {/* Sleek Golden Cedi Progress Track */}
                <div className="w-full max-w-[220px] h-2.5 bg-slate-900 border border-slate-800 rounded-full mt-1 relative overflow-visible shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-yellow-500/30 to-emerald-500/30 rounded-full" />
                  <motion.div 
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.img 
                    src="/assets/golden_ghana_coin.png"
                    alt="Golden Ghanaian Coin"
                    className="absolute -top-2 w-6 h-6 object-contain select-none rounded-full drop-shadow-[0_2px_10px_rgba(245,158,11,0.9)]"
                    initial={{ left: "0%", rotate: 0 }}
                    animate={{ left: "100%", rotate: 720 }}
                    style={{ transform: "translateX(-50%)" }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>

                <p className="text-[11px] font-black text-amber-400 uppercase tracking-widest animate-pulse my-0.5">WAITING FOR APPROVAL...</p>
                
                <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 text-left space-y-1.5 w-full max-w-[290px] shadow-md">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-400">If no popup on your screen:</p>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    <span className="font-bold text-white">MTN:</span> Dial <span className="font-mono font-black text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">*170#</span> &rarr; 6 (My Wallet) &rarr; 3 (My Approvals) &rarr; Enter PIN.
                  </p>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    <span className="font-bold text-white">Telecel:</span> Dial <span className="font-mono font-black text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">*110#</span> &rarr; 4 (Make Payments) &rarr; Approvals.
                  </p>
                </div>

                <div className="flex flex-col w-full gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleManualVerify}
                    disabled={isManualVerifying}
                    className="w-full h-12 bg-emerald-500 hover:bg-emerald-400 text-black rounded-2xl text-xs font-black uppercase tracking-wider transition-all active:scale-[0.98] shadow-[0_8px_25px_rgba(16,185,129,0.35)] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isManualVerifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>Verifying Gateway...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 shrink-0 text-black stroke-[3]" />
                        <span>Instant Verify (I Entered PIN)</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleFallbackCheckout}
                    className="w-full h-11 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98]"
                  >
                    🌐 Open Online Payment Page
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep('payment_number');
                      setErrorMessage(null);
                    }}
                    className="w-full h-10 bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-white transition-all active:scale-[0.98]"
                  >
                    Change Payment Phone Number
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Secure transaction lock footer */}
        <div className="py-3 bg-[#05060a] border-t border-slate-800/60 flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-400/80">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Secure 256-Bit SSL Payment &bull; SwiftData
        </div>
      </motion.div>
    </div>
  );
};
