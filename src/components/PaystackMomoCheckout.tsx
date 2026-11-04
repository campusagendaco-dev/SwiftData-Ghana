import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, KeyRound, AlertTriangle, ShieldCheck, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { runFraudSentinelCheck } from "@/lib/fraud-sentinel";
import { getProofOfHumanityToken } from "@/lib/device-fingerprint";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

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

  // Prevent background page scrolling while modal is open
  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isOpen]);

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
      const recNet = String(recipientNetwork || metadata?.network || "").toUpperCase();
      const isMtn = recNet.includes("MTN") || recNet.includes("YELLO");
      const cat = String(metadata?.category || metadata?.package_category || "").toLowerCase();
      const isMashUp = recNet.includes("MASH") || cat.includes("mash");

      if (!isMtn || isMashUp) {
        setIsBeneficiaryVerified(true);
        return;
      }

      // Beneficiary verification is strictly for Affordable MTN SME packages, NEVER for Korba, Mashup, or standard retail packages
      const isKorba = metadata?.is_korba === true || metadata?.is_korba === "true" || cat === "korba" || metadata?.provider_type === "korba";
      const isNonSme = (cat !== "" && cat !== "affordable" && cat !== "sme" && !cat.includes("sme")) || (metadata?.order_type && metadata.order_type !== "data");

      if (isKorba || isNonSme || metadata?.bypass_beneficiary === true || metadata?.bypass_beneficiary === "true") {
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

        if (data.exists === false && data.can_order !== true) {
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
          const isExplicitKorba = metadata?.is_korba === true || metadata?.is_korba === "true";
          const cat = String(metadata?.category || "").toLowerCase();
          const isSmeData = cat === "affordable" || cat === "sme" || cat === "mashup" || (metadata?.order_type === "data" && !cat.includes("retail") && !cat.includes("korba"));

          if (settings.auto_gateway_switch_by_package && isExplicitKorba && !isSmeData) {
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
      script.src = "/vendor/korba-checkout.js"; // self-hosted copy (CSP: own scripts only)
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
        const upperNet = String(paymentNetwork || "").toUpperCase();
        if (upperNet.includes("MTN") || upperNet.includes("YELLO") || upperNet.includes("MASH")) bankCode = "MTN";
        else if (upperNet.includes("TELECEL") || upperNet.includes("VODA") || upperNet.includes("VDF") || upperNet === "RED") bankCode = "VOD";
        else if (upperNet.includes("AIRTEL") || upperNet.includes("TIGO") || upperNet.includes("AT") || upperNet.includes("ATL")) bankCode = "ATL";

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
            customer_phone: recipientPhone || paymentPhone || metadata?.customer_phone || metadata?.phone,
            phone: recipientPhone || paymentPhone || metadata?.phone,
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
            network: metadata?.network || recipientNetwork || paymentNetwork,
            package_size: metadata?.package_size,
            base_price: metadata.base_price || amount,
            order_id: orderId,
            customer_phone: recipientPhone || paymentPhone || metadata?.customer_phone || metadata?.phone,
            phone: recipientPhone || paymentPhone || metadata?.phone,
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

  const NETWORKS = [
    { id: "MTN", label: "MTN", short: "M", mark: "bg-[#FFCC00] text-[#1a1a1a]" },
    { id: "Telecel", label: "Telecel", short: "T", mark: "bg-[#E60000] text-white" },
    { id: "AirtelTigo", label: "AirtelTigo", short: "AT", mark: "bg-[#0047BA] text-white" },
  ];
  const busy = step === "initiating" || step === "otp_verifying";
  const stageIndex = step === "payment_number" ? 0 : step === "success" ? 2 : 1;
  const stages = ["Details", "Verify", "Approve"];
  const itemLabel =
    metadata?.package_size || metadata?.description || (metadata?.order_type === "wallet_topup" ? "Wallet top-up" : "Purchase");
  const itemNetwork = metadata?.network || recipientNetwork;
  const digits = paymentPhone.replace(/\D/g, "");
  const prettyPhone = (p: string) => {
    const d = (p || "").replace(/\D/g, "");
    return d.length >= 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : p;
  };
  const gatewayName = activeGateway === "korba" ? "Korba" : "Paystack";

  const errorNote = (msg: React.ReactNode) => (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2.5 text-[12.5px] leading-snug text-rose-700 dark:text-rose-300">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  );

  const spinner = (title: string, sub: string) => (
    <div className="py-10 flex flex-col items-center text-center gap-4" aria-live="polite">
      <div className="relative h-20 w-20">
        <span className="absolute inset-0 rounded-full border-[3px] border-muted" />
        <span className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-primary animate-spin" />
        <img src="/assets/golden_ghana_coin.png" alt="" className="absolute inset-3 h-14 w-14 object-contain rounded-full" />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-[260px]">{sub}</p>
      </div>
    </div>
  );

  const primaryBtn =
    "w-full h-12 rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold flex items-center justify-center gap-2 shadow-sm hover:brightness-105 active:scale-[0.99] transition disabled:opacity-40";
  const secondaryBtn =
    "h-11 rounded-xl border border-input bg-background text-[13px] font-semibold text-foreground hover:bg-muted transition";

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center sm:p-4 pointer-events-none" role="dialog" aria-modal="true" aria-label="Checkout">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={step !== "initiating" && step !== "otp_verifying" && step !== "success" ? onClose : undefined}
        className="fixed inset-0 bg-black/55 backdrop-blur-[3px] pointer-events-auto"
      />

      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="relative w-full sm:max-w-[420px] max-h-[94dvh] flex flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] border border-border bg-popover text-popover-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] pointer-events-auto text-left"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="sm:hidden pt-2.5 flex justify-center">
          <span className="h-1 w-10 rounded-full bg-muted-foreground/25" />
        </div>

        {/* Header + order summary */}
        <div className="shrink-0 px-5 pt-3 sm:pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="" className="h-7 w-7 rounded-lg bg-white object-contain ring-1 ring-black/5" />
              <div className="leading-tight">
                <p className="text-[13px] font-semibold text-foreground">SwiftData checkout</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" /> Secured by {gatewayName}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label="Close checkout"
              className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-muted-foreground">You’re paying</p>
                <p className="mt-0.5 text-[32px] font-bold tracking-[-0.03em] leading-none tabular-nums text-foreground">
                  <span className="text-[0.5em] font-semibold text-muted-foreground align-[0.45em] mr-1">GH₵</span>
                  {amount.toFixed(2)}
                </p>
              </div>
              {itemNetwork ? (
                <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] font-semibold text-foreground">{itemNetwork}</span>
              ) : null}
            </div>
            <dl className="mt-3 pt-3 border-t border-border/70 grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Item</dt>
                <dd className="font-semibold text-foreground truncate">{itemLabel}</dd>
              </div>
              {recipientPhone ? (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">For</dt>
                  <dd className="font-semibold text-foreground tabular-nums truncate">{prettyPhone(recipientPhone)}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Checkout progress">
            {stages.map((label, i) => (
              <li key={label} className="flex flex-col gap-1.5">
                <span className={`h-1 rounded-full transition-colors duration-300 ${i <= stageIndex ? "bg-primary" : "bg-muted"}`} />
                <span className={`text-[11px] font-medium ${i === stageIndex ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-5 overflow-y-auto overscroll-contain flex-1">
          {step === "payment_number" && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 mb-4" role="tablist" aria-label="Payment method">
              {([
                ["momo", "Mobile Money"],
                ["card", "Card"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selectedMethod === id}
                  onClick={() => setSelectedMethod(id)}
                  className={`h-9 rounded-lg text-[13px] font-semibold transition-colors ${selectedMethod === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {selectedMethod === "momo" && step === "payment_number" && (
              <motion.div key="payment_number" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                <div>
                  <label htmlFor="momo-number" className="text-[12.5px] font-semibold text-foreground">
                    Mobile Money number
                  </label>
                  <p className="text-[12px] text-muted-foreground">We’ll send a PIN prompt to this phone.</p>
                  <input
                    id="momo-number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={paymentPhone}
                    onChange={(e) => setPaymentPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="024 123 4567"
                    maxLength={12}
                    className="mt-2 w-full h-12 rounded-xl border border-input bg-background px-4 text-[17px] font-semibold tracking-wide tabular-nums text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition"
                  />
                  {/* Invisible bot honeypot */}
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

                <div>
                  <p className="text-[12.5px] font-semibold text-foreground mb-2">Network</p>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mobile Money network">
                    {NETWORKS.map((net) => {
                      const active = paymentNetwork === net.id;
                      return (
                        <button
                          key={net.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPaymentNetwork(net.id)}
                          className={`h-11 rounded-xl border px-2 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold transition ${
                            active
                              ? "border-primary bg-primary/[0.07] text-foreground ring-2 ring-primary/20"
                              : "border-input bg-background text-muted-foreground hover:text-foreground hover:border-foreground/25"
                          }`}
                        >
                          <span className={`h-5 min-w-5 px-0.5 rounded-md text-[8px] font-bold flex items-center justify-center ${net.mark}`}>{net.short}</span>
                          {net.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(isVerifyingName || verifiedName || nameResolveError) && digits.length >= 9 && (
                  <div
                    aria-live="polite"
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] border ${
                      isVerifyingName
                        ? "border-border bg-muted/50 text-muted-foreground"
                        : verifiedName
                        ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300"
                        : "border-rose-500/25 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {isVerifyingName ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Checking account name…
                      </>
                    ) : verifiedName ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Account name: <span className="font-semibold text-foreground">{verifiedName}</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4" /> {nameResolveError || "We couldn’t find that account"}
                      </>
                    )}
                  </div>
                )}

                {!isBeneficiaryVerified && errorNote(`${recipientPhone} isn’t on the beneficiary list yet.`)}
                {errorMessage && errorNote(errorMessage)}

                <button type="button" onClick={initiatePayment} className={primaryBtn}>
                  Pay GH₵{amount.toFixed(2)}
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button type="button" onClick={handleFallbackCheckout} className={`w-full ${secondaryBtn}`}>
                  Pay on the {gatewayName} page instead
                </button>
              </motion.div>
            )}

            {selectedMethod === "card" && step === "payment_number" && (
              <motion.div key="card_checkout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                <div className="rounded-2xl border border-border p-4 flex items-start gap-3">
                  <span className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">Pay with a debit or credit card</p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      You’ll enter your card on Paystack’s secure page. SwiftData never sees or stores your card number.
                    </p>
                  </div>
                </div>
                {errorMessage && errorNote(errorMessage)}
                <button type="button" onClick={initiatePaystackCardPay} className={primaryBtn}>
                  Continue to card payment
                  <ArrowRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}

            {step === "initiating" && (
              <motion.div key="initiating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {spinner("Sending the payment prompt…", digits ? `Contacting your network for ${prettyPhone(paymentPhone)}.` : "Connecting to the payment provider.")}
              </motion.div>
            )}

            {step === "otp_entry" && (
              <motion.div key="otp_entry" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">Enter the 6-digit code</p>
                    <p className="text-[12.5px] text-muted-foreground">Sent by SMS to {prettyPhone(paymentPhone)}.</p>
                  </div>
                </div>
                <div className="flex justify-between gap-2" aria-label="One-time code">
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      autoComplete={idx === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      value={digit}
                      aria-label={`Digit ${idx + 1}`}
                      onChange={(e) => handleOtpChange(e.target.value, idx)}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      onPaste={idx === 0 ? handlePaste : undefined}
                      className="w-full max-w-[52px] h-14 rounded-xl border border-input bg-background text-center text-2xl font-semibold tabular-nums text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition"
                    />
                  ))}
                </div>
                {otpError && errorNote(otpError)}
                <div className="flex items-center justify-between text-[12.5px]">
                  {countdown > 0 ? (
                    <span className="text-muted-foreground">
                      Resend code in <span className="font-semibold text-foreground tabular-nums">{countdown}s</span>
                    </span>
                  ) : (
                    <button type="button" onClick={handleResendOtp} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                      <RefreshCw className="h-3.5 w-3.5" /> Resend code
                    </button>
                  )}
                  <button type="button" onClick={() => setStep("payment_number")} className="font-semibold text-muted-foreground hover:text-foreground">
                    Change number
                  </button>
                </div>
                <button type="button" onClick={() => verifyOtp()} disabled={otp.join("").length < 6} className={primaryBtn}>
                  Confirm code
                </button>
              </motion.div>
            )}

            {step === "otp_verifying" && (
              <motion.div key="otp_verifying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {spinner("Checking your code…", "This only takes a moment.")}
              </motion.div>
            )}

            {step === "success" && (
              <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex flex-col items-center text-center pt-1">
                  <div className="relative h-20 w-20">
                    <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" style={{ animationDuration: "2s" }} />
                    <span className="absolute inset-2 rounded-full bg-primary/15" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-9 w-9 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="6" y="2" width="12" height="20" rx="2.5" />
                        <path d="M10.5 18.5h3" />
                      </svg>
                    </span>
                  </div>
                  <p className="mt-3 text-[18px] font-semibold text-foreground">Approve on your phone</p>
                  <p className="mt-1 text-[13px] text-muted-foreground max-w-[290px]">
                    Enter your Mobile Money PIN in the prompt on {digits ? prettyPhone(paymentPhone) : "your phone"}. We’ll confirm automatically.
                  </p>
                  <div aria-live="polite" className="mt-3 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for approval
                  </div>
                </div>

                <details className="group rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
                  <summary className="cursor-pointer list-none flex items-center justify-between text-[13px] font-semibold text-foreground">
                    No prompt on your phone?
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="mt-2 space-y-1.5 text-[12.5px] text-muted-foreground">
                    <p>
                      <span className="font-semibold text-foreground">MTN:</span> dial <span className="font-mono font-semibold text-foreground">*170#</span> → 6 My Wallet → 3 My Approvals → enter PIN.
                    </p>
                    <p>
                      <span className="font-semibold text-foreground">Telecel:</span> dial <span className="font-mono font-semibold text-foreground">*110#</span> → 4 Make Payments → Approvals.
                    </p>
                  </div>
                </details>

                <button type="button" onClick={handleManualVerify} disabled={isManualVerifying} className={primaryBtn}>
                  {isManualVerifying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking payment…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> I’ve approved it
                    </>
                  )}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={handleFallbackCheckout} className={secondaryBtn}>
                    Pay on {gatewayName} page
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("payment_number");
                      setErrorMessage(null);
                    }}
                    className={secondaryBtn}
                  >
                    Use another number
                  </button>
                </div>

                <PushNotificationPrompt variant="inline" title="Get a delivery alert" description="We’ll ping your lock screen the moment it’s delivered." buttonText="Alert me" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0 border-t border-border/70 px-5 py-2.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Encrypted payment · your PIN never reaches SwiftData
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
