import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl, getActiveStoreDomain } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import StoreNavbar from "@/components/StoreNavbar";
import StoreVisitorPopup from "@/components/StoreVisitorPopup";
import { TraditionalBackground } from "@/components/TraditionalBackground";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, Loader2, Store, MessageCircle,
  ShieldCheck, Phone, X, CreditCard, Gift, Tag, CheckCircle2,
  Smartphone, Package, Clock, ArrowRight, Wifi, Star, History,
  AlertTriangle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import StoreAuth from "@/components/StoreAuth";
import StoreDepositFlow from "@/components/StoreDepositFlow";
import StoreTransactionHistory from "@/components/StoreTransactionHistory";
import StoreManagementOverlay from "@/components/StoreManagementOverlay";
import { playSuccessSound } from "@/lib/sound";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import LiveDeliveryBadge from "@/components/LiveDeliveryBadge";
import BundleSelectorDropdown from "@/components/BundleSelectorDropdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface PromoResult {
  valid: boolean;
  promo_id?: string;
  code?: string;
  discount_percentage?: number;
  is_free?: boolean;
  error?: string;
}

type NetworkName = "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo";
type ServiceType = "data" | "airtime" | "utility";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const PAYSTACK_FEE_RATE = 0.03;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, 100);

const NETWORK_CONFIG: Record<NetworkName, { color: string; bg: string; textClass: string; borderClass: string; light: string }> = {
  MTN:          { color: "#FFCC00", bg: "bg-[#FFCC00]", textClass: "text-black", borderClass: "border-[#FFCC00]", light: "#FFCC0020" },
  "MTN Mash Up": { color: "#FFB300", bg: "bg-[#FFB300]", textClass: "text-black", borderClass: "border-[#FFB300]", light: "#FFB30020" },
  Telecel:      { color: "#E60000", bg: "bg-[#E60000]", textClass: "text-white", borderClass: "border-[#E60000]", light: "#E6000020" },
  AirtelTigo:   { color: "#00529B", bg: "bg-[#00529B]", textClass: "text-white", borderClass: "border-[#00529B]", light: "#00529B20" },
};

interface AgentProfile {
  user_id: string;
  store_name: string;
  full_name: string;
  whatsapp_number: string;
  support_number: string;
  email: string;
  whatsapp_group_link: string | null;
  agent_prices: Record<string, Record<string, string | number>>;
  sub_agent_prices?: Record<string, Record<string, string | number>>;
  registered_user_prices?: Record<string, Record<string, string | number>>;
  disabled_packages: Record<string, string[]>;
  is_sub_agent: boolean;
  parent_agent_id: string | null;
  sub_agent_activation_markup: number | null;
  store_logo_url: string | null;
  store_primary_color: string | null;
}

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
  sub_agent_price: number | null;
  public_price: number | null;
  is_unavailable: boolean;
}

const formatPackageDisplay = (size: string) => {
  // Pattern 1: GHS X (Y MB/GB)
  let match = size.match(/GHS\s*[\d.]+\s*\(([^)]+)\)/i);
  if (match) {
    return {
      main: match[1].trim(),
      sub: size.replace(/\([^)]+\)/, "").trim()
    };
  }

  // Pattern 2: X mins and Y MB @ Z GHC
  match = size.match(/(.*)\s+@\s*(.*)/i);
  if (match) {
    return {
      main: match[1].trim(),
      sub: match[2].trim()
    };
  }

  return {
    main: size,
    sub: ""
  };
};

const AgentStore = () => {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const { profile, refreshProfile, signOut } = useAuth();
  const [searchParams] = useSearchParams();

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("Welcome");
  const [storeDescription, setStoreDescription] = useState<string>("");
  const [storeBannerUrl, setStoreBannerUrl] = useState<string>("");
  const [korbaMappings, setKorbaMappings] = useState<{ package_name: string; network: string; raw_data: any }[]>([]);
  const [selectedTypeOrCategory, setSelectedTypeOrCategory] = useState<string>("affordable");

  useEffect(() => {
    const hrs = new Date().getHours();
    if (hrs < 12) setGreeting("Good Morning 🌅");
    else if (hrs < 18) setGreeting("Good Afternoon ☀️");
    else setGreeting("Good Evening 🌃");
  }, []);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [selectedService, setSelectedService] = useState<ServiceType>("data");
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [airtimeAmount, setAirtimeAmount] = useState("");
  const [utilityType, setUtilityType] = useState<"ECG" | "GWCL">("ECG");
  const [utilityNumber, setUtilityNumber] = useState("");
  const [utilityAmount, setUtilityAmount] = useState("");
  const [phone, setPhone] = useState("");
  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;
  const [buying, setBuying] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);
  const [isCheckingBeneficiary, setIsCheckingBeneficiary] = useState(false);
  const [beneficiaryError, setBeneficiaryError] = useState<string | null>(null);
  const [checkedPhone, setCheckedPhone] = useState<string>("");
  const [showBeneficiaryModal, setShowBeneficiaryModal] = useState(false);
  const [beneficiaryModalPhone, setBeneficiaryModalPhone] = useState("");
  const [pendingAction, setPendingAction] = useState<"wallet" | "paystack" | null>(null);
  const [beneficiaryCheckEnabled, setBeneficiaryCheckEnabled] = useState(true);
  const [allowNonBeneficiaryContinue, setAllowNonBeneficiaryContinue] = useState(true);

  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("auth") === "login") {
      setAuthOpen(true);
    }
  }, [searchParams]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"wallet" | "paystack">("paystack");

  const [customerWalletBalance, setCustomerWalletBalance] = useState<number>(0);

  const fetchWalletBalance = useCallback(async () => {
    if (profile?.user_id) {
      const { data }: { data: any } = await (supabase.from("wallets" as any)).select("balance").eq("agent_id", profile.user_id).maybeSingle();
      if (data) {
        setCustomerWalletBalance(Number(data.balance));
      } else {
        setCustomerWalletBalance(0);
      }
    }
  }, [profile?.user_id]);

  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  const isCustomerLoggedIn = Boolean(
    profile && 
    (profile.parent_agent_id === agent?.user_id || profile.user_id === agent?.user_id)
  );
  const customerBalance = customerWalletBalance;
  const customerName = profile?.full_name || profile?.email || "Store Customer";

  // Automatically link visiting users with no parent agent to the visited store
  useEffect(() => {
    if (profile && !profile.parent_agent_id && agent?.user_id && profile.user_id !== agent.user_id) {
      const linkAccount = async () => {
        await (supabase.from("profiles") as any)
          .update({ parent_agent_id: agent.user_id })
          .eq("user_id", profile.user_id);
        refreshProfile();
      };
      linkAccount();
    }
  }, [profile, agent?.user_id, refreshProfile]);

  // Dynamically update document title and favicon to match storefront branding
  useEffect(() => {
    if (agent?.store_name) {
      document.title = `${agent.store_name} | Buy Cheap Data Bundles Ghana`;
      
      if (agent.store_logo_url) {
        let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          document.head.appendChild(link);
        }
        link.href = agent.store_logo_url;
      }
    }
  }, [agent?.store_name, agent?.store_logo_url]);

  // Combined packages list for current network with dynamically calculated selling prices
  const availablePackages = useMemo(() => {
    const rawList = basePackages[selectedNetwork] || [];
    
    // Sort packages by size numerically (e.g. 1GB, 2GB, 5GB, 10GB, 50GB)
    const sortedList = [...rawList].sort((a, b) => {
      const getMb = (sz: string) => {
        const num = parseFloat(sz);
        if (sz.toUpperCase().includes("GB")) return num * 1024;
        if (sz.toUpperCase().includes("MB")) return num;
        return num;
      };
      return getMb(a.size) - getMb(b.size);
    });

    return sortedList;
  }, [selectedNetwork]);

  // Real-time background beneficiary validation for MTN numbers
  useEffect(() => {
    const triggerBeneficiaryCheck = async () => {
      const net = String(selectedNetwork || "").toUpperCase();
      const isMtn = net.includes("MTN") || net.includes("YELLO");
      if (!isMtn || selectedTypeOrCategory !== "affordable" || !isPhoneValid || selectedService !== "data" || !beneficiaryCheckEnabled) {
        setBeneficiaryError(null);
        setIsCheckingBeneficiary(false);
        setCheckedPhone("");
        return;
      }

      if (phoneDigits === checkedPhone) return;

      setIsCheckingBeneficiary(true);
      setBeneficiaryError(null);
      setCheckedPhone(phoneDigits);

      try {
        const { data, error } = await supabase.functions.invoke("verify-beneficiary", {
          body: {
            phone: phoneDigits,
            network: selectedNetwork
          }
        });

        if (error || !data) {
          setBeneficiaryError("Verification service is offline. Please try again shortly.");
          return;
        }

        if (data.exists === false) {
          const errMsg = data.message || "This MTN number is not whitelisted by the network.";
          setBeneficiaryError(errMsg);
          setBeneficiaryModalPhone(phoneDigits);
          setShowBeneficiaryModal(true);
        } else {
          setBeneficiaryError(null);
        }
      } catch (err) {
        console.error("Auto beneficiary check error:", err);
      } finally {
        setIsCheckingBeneficiary(false);
      }
    };

    const timer = setTimeout(triggerBeneficiaryCheck, 300);
    return () => clearTimeout(timer);
  }, [phoneDigits, selectedNetwork, selectedService, isPhoneValid, selectedTypeOrCategory, checkedPhone, beneficiaryCheckEnabled]);

  const checkBeneficiaryValidity = async (phoneToCheck: string, networkToCheck: string): Promise<boolean> => {
    if (!beneficiaryCheckEnabled) {
      return true;
    }
    const net = String(networkToCheck || "").toUpperCase();
    const isMtn = net.includes("MTN") || net.includes("YELLO");
    if (!isMtn || selectedTypeOrCategory !== "affordable") {
      return true;
    }

    if (isCheckingBeneficiary) {
      toast({
        title: "Verifying number...",
        description: "Please wait a moment while we finish verifying your MTN number.",
      });
      return false;
    }

    if (phoneToCheck === checkedPhone) {
      if (beneficiaryError) {
        setBeneficiaryModalPhone(phoneToCheck);
        setShowBeneficiaryModal(true);
        return false;
      }
      return true;
    }

    try {
      const { data, error } = await supabase.functions.invoke("verify-beneficiary", {
        body: {
          phone: phoneToCheck,
          network: networkToCheck
        }
      });

      if (error || !data) {
        console.error("Failed to invoke verify-beneficiary:", error);
        toast({
          title: "Verification Offline",
          description: data?.message || "Beneficiary verification is currently offline. Please try again shortly.",
          variant: "destructive"
        });
        return false; 
      }

      if (data.exists === false) {
        const errMsg = data.message || "This MTN number is not whitelisted by the network.";
        setBeneficiaryError(errMsg);
        setBeneficiaryModalPhone(phoneToCheck);
        setShowBeneficiaryModal(true);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Beneficiary validation error:", err);
      toast({
        title: "Verification Error",
        description: "Could not connect to the verification service. Please try again.",
        variant: "destructive"
      });
      return false; 
    }
  };

  const handleWalletBuy = async (bypassBeneficiary = false) => {
    if (!isPhoneValid) {
      toast({ title: "Invalid phone number", description: "Use a valid Ghana number.", variant: "destructive" });
      return;
    }
    setBuying(true);

    if (selectedService === "data" && !bypassBeneficiary) {
      const isValid = await checkBeneficiaryValidity(phone, selectedNetwork);
      if (!isValid) {
        setBuying(false);
        setPendingAction("wallet");
        return;
      }
    }

    const startTime = Date.now();
    const orderId = crypto.randomUUID();
    
    try {
      const { data, error } = await invokePublicFunctionAsUser("wallet-buy-data", {
        body: {
          network: selectedNetwork,
          package_size: selectedPkg!.size,
          customer_phone: phone,
          amount: selectedPkg!.price,
          reference: orderId,
          agent_id: agent?.user_id,
          bypass_beneficiary: bypassBeneficiary ? true : undefined,
        },
      });

      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 100 - elapsedTime);
      if (remainingTime > 0) await new Promise(resolve => setTimeout(resolve, remainingTime));

      if (error || data?.error) {
        const description = data?.error || await getFunctionErrorMessage(error, "Could not complete purchase.");
        toast({ title: "Purchase failed", description, variant: "destructive" });
        setBuying(false);
        return;
      }

      playSuccessSound();
      toast({ title: "Purchase successful!", description: "Order proceed. Will be delivered between 10min to 60min.", variant: "default" });
      refreshProfile();
      setShowSuccessOverlay(true);
      setPhone("");
      setSelectedPkg(null);
    } catch (err) {
      console.error("Wallet buy error:", err);
    } finally {
      setBuying(false);
    }
  };

  const verifiedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference && !verifiedRef.current) {
      verifiedRef.current = true;
      invokePublicFunctionAsUser("verify-payment", { body: { reference } })
        .then(async (res) => {
          const status = res.data?.status;
          if (status === "fulfilled" || res.data?.success) {
            toast({ title: "Success!", description: "Your store wallet balance has been credited." });
          } else {
            toast({ title: "Payment Received", description: "Updating your balance shortly." });
          }
          refreshProfile();
          let retries = 3;
          const poll = setInterval(async () => {
            refreshProfile();
            retries--;
            if (retries <= 0) clearInterval(poll);
          }, 2500);
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(() => {
          console.error("Payment verification failed");
        });
    }
  }, [refreshProfile, toast]);

  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [activeGateway, setActiveGateway] = useState<string>("paystack");
  const [subAgentBaseFee, setSubAgentBaseFee] = useState<number | null>(null);
  const [priceMultipliers, setPriceMultipliers] = useState<Record<string, number>>({ MTN: 1, Telecel: 1, AirtelTigo: 1 });

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const promoInputRef = useRef<HTMLInputElement>(null);
  const purchasePanelRef = useRef<HTMLDivElement>(null);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  useEffect(() => {
    const fetchStore = async () => {
      // 1. Try to load cached data for instant render
      try {
        const cachedPricing = localStorage.getItem("swift_pricing_cache");
        if (cachedPricing) {
          const parsed = JSON.parse(cachedPricing);
          if (parsed.expiry > Date.now()) {
            const gsMap: Record<string, GlobalPkgSetting> = {};
            (parsed.globalSettings || []).forEach((r: any) => { 
              const normSize = r.package_size.replace(/\s+/g, "").toUpperCase();
              gsMap[`${r.network}-${normSize}`] = r; 
            });
            setGlobalSettings(gsMap);
            setPriceMultipliers(parsed.multipliers || { MTN: 1, Telecel: 1, AirtelTigo: 1 });
            if (parsed.korbaMappings) setKorbaMappings(parsed.korbaMappings);
          }
        }

        const cachedSettings = localStorage.getItem("swift_system_settings");
        if (cachedSettings) {
          const parsed = JSON.parse(cachedSettings);
          if (parsed && parsed.expiry > Date.now()) {
            if (parsed.active_payment_gateway) {
              setActiveGateway(parsed.active_payment_gateway);
            }
            setBeneficiaryCheckEnabled(parsed.beneficiary_verification_enabled !== false);
            setAllowNonBeneficiaryContinue(parsed.allow_non_beneficiary_continue !== false);
          }
        }

        const cachedTenant = localStorage.getItem("current_store_tenant");
        if (cachedTenant) {
          const parsed = JSON.parse(cachedTenant);
          if (parsed.description) setStoreDescription(parsed.description);
          if (parsed.banner) setStoreBannerUrl(parsed.banner);
        }
      } catch (e) {
        console.error("[AgentStore] Cache read error:", e);
      }

      try {
        setLoading(true);
        const activeDomain = getActiveStoreDomain();
        let storeQuery = supabase
          .from("agent_stores")
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, registered_user_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");

        let resellerStoreQuery = supabase
          .from("reseller_stores")
          .select("store_description, store_banner_url");

        if (slug && slug !== "undefined" && slug !== "null") {
          const lowerSlug = slug.toLowerCase().trim();
          storeQuery = storeQuery.eq("slug", lowerSlug);
          resellerStoreQuery = resellerStoreQuery.eq("slug", lowerSlug);
        } else if (activeDomain) {
          storeQuery = storeQuery.ilike("custom_domain", activeDomain);
          resellerStoreQuery = resellerStoreQuery.ilike("custom_domain", activeDomain);
        } else {
          setNotFound(true);
          setLoading(false);
          return;
        }

        let agentRes;
        let pkgRes;
        let pricingCtx;
        let mappingsRes;
        let resellerStoreRes;
        let sysRes;

        try {
          const [res, pkgResData, pricingCtxData, sysResData, mappingsData, resellerRes] = await Promise.all([
            storeQuery.maybeSingle(),
            supabase.from("global_package_settings").select("network, package_size, agent_price, sub_agent_price, public_price, is_unavailable"),
            fetchApiPricingContext().catch(() => ({ source: "primary", multipliers: { MTN: 1, Telecel: 1, AirtelTigo: 1 }, multiplier: 1 })),
            supabase.from("system_settings").select("active_payment_gateway, beneficiary_verification_enabled, allow_non_beneficiary_continue").eq("id", 1).maybeSingle(),
            supabase.from("provider_packages").select("package_name, network, raw_data").eq("provider_id", "1177b72a-a2d7-462d-9366-9dde6e83ccd7"),
            Promise.resolve(resellerStoreQuery.maybeSingle()).catch(() => null)
          ]);
          
          pkgRes = pkgResData;
          pricingCtx = pricingCtxData;
          mappingsRes = mappingsData;
          resellerStoreRes = resellerRes;
          sysRes = sysResData;

          if (res.error) {
            const errMsg = res.error.message || "";
            const errDet = res.error.details || "";
            if (errMsg.includes("registered_user_prices") || errDet.includes("registered_user_prices")) {
              console.warn("[AgentStore] registered_user_prices column missing in view, retrying without it");
              let fallbackQuery = supabase
                .from("agent_stores")
                .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");
              
              let fallbackResellerQuery = supabase
                .from("reseller_stores")
                .select("store_description, store_banner_url");

              if (slug && slug !== "undefined" && slug !== "null") {
                const lowerSlug = slug.toLowerCase().trim();
                fallbackQuery = fallbackQuery.eq("slug", lowerSlug);
                fallbackResellerQuery = fallbackResellerQuery.eq("slug", lowerSlug);
              } else if (activeDomain) {
                fallbackQuery = fallbackQuery.eq("custom_domain", activeDomain);
                fallbackResellerQuery = fallbackResellerQuery.eq("custom_domain", activeDomain);
              }
              
              const [fallbackRes, fallbackResellerRes] = await Promise.all([
                fallbackQuery.maybeSingle(),
                Promise.resolve(fallbackResellerQuery.maybeSingle()).catch(() => null)
              ]);

              if (fallbackRes.error) {
                console.error("[AgentStore] Fallback query failed with error:", fallbackRes.error);
                setErrorDetails(`Fallback query error: ${fallbackRes.error.message} (${fallbackRes.error.details || ''})`);
                setNotFound(true);
                setLoading(false);
                return;
              }
              agentRes = fallbackRes;
              resellerStoreRes = fallbackResellerRes;
            } else {
              console.error("[AgentStore] Main query failed with error:", res.error);
              setErrorDetails(`Main query error: ${res.error.message} (${res.error.details || ''})`);
              setNotFound(true);
              setLoading(false);
              return;
            }
          } else {
            agentRes = res;
          }
        } catch (err: any) {
          console.error("Error executing store queries:", err);
          setErrorDetails(`Execution error: ${err?.message || err?.details || String(err)}`);
          setNotFound(true);
          setLoading(false);
          return;
        }

        const gsMap: Record<string, GlobalPkgSetting> = {};
        (pkgRes.data || []).forEach((r: any) => { 
          const normSize = r.package_size.replace(/\s+/g, "").toUpperCase();
          gsMap[`${r.network}-${normSize}`] = r; 
        });
        setGlobalSettings(gsMap);
        if (mappingsRes?.data) {
          setKorbaMappings(mappingsRes.data);
        }
        
        const mults = pricingCtx.multipliers || { MTN: 1, Telecel: 1, AirtelTigo: 1 };
        setPriceMultipliers(mults);

        let gateway = "paystack";
        let benEnabled = true;
        let allowContinue = true;
        if (sysRes?.data) {
          gateway = sysRes.data.active_payment_gateway || "paystack";
          benEnabled = sysRes.data.beneficiary_verification_enabled !== false;
          allowContinue = sysRes.data.allow_non_beneficiary_continue !== false;
          setActiveGateway(gateway);
          setBeneficiaryCheckEnabled(benEnabled);
          setAllowNonBeneficiaryContinue(allowContinue);
        }

        if (resellerStoreRes?.data) {
          setStoreDescription(resellerStoreRes.data.store_description || "");
          setStoreBannerUrl(resellerStoreRes.data.store_banner_url || "");
        }

        // Cache the fetched data
        try {
          localStorage.setItem("swift_pricing_cache", JSON.stringify({
            globalSettings: pkgRes.data || [],
            multipliers: mults,
            korbaMappings: mappingsRes?.data || [],
            expiry: Date.now() + 10 * 60 * 1000 // Cache for 10 minutes
          }));

          localStorage.setItem("swift_system_settings", JSON.stringify({
            active_payment_gateway: gateway,
            beneficiary_verification_enabled: benEnabled,
            allow_non_beneficiary_continue: allowContinue,
            expiry: Date.now() + 5 * 60 * 1000 // Cache for 5 minutes
          }));
        } catch (e) {
          // ignore cache read failure
        }

        if (!agentRes?.data) {
          // Fallback direct profile lookup to prevent "Store Not Found" when reseller_stores is unsynced
          const targetSlug = slug ? slug.toLowerCase().trim() : null;
          let profileQuery = (supabase
            .from("profiles") as any)
            .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, registered_user_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");

          if (targetSlug && targetSlug !== "undefined" && targetSlug !== "null") {
            profileQuery = profileQuery.eq("slug", targetSlug);
          } else if (activeDomain) {
            profileQuery = profileQuery.ilike("custom_domain", activeDomain);
          }

          const { data: profileFallback } = await profileQuery.maybeSingle();

          if (profileFallback && (profileFallback.is_agent || profileFallback.is_sub_agent || profileFallback.agent_approved || profileFallback.sub_agent_approved)) {
            agentRes = { data: profileFallback, error: null };
            
            // Auto-heal background sync into reseller_stores
            if (profileFallback.user_id && profileFallback.slug) {
              (supabase
                .from("reseller_stores") as any)
                .upsert({
                  user_id: profileFallback.user_id,
                  store_name: profileFallback.store_name || profileFallback.full_name || "Store",
                  slug: profileFallback.slug,
                  store_logo_url: profileFallback.store_logo_url,
                  store_primary_color: profileFallback.store_primary_color || "#fbbf24"
                }, { onConflict: "slug" })
                .then(({ error: syncErr }) => {
                  if (syncErr) console.warn("[AgentStore] Auto-heal sync to reseller_stores failed:", syncErr);
                });
            }
          } else {
            setNotFound(true);
            setLoading(false);
            return;
          }
        }

        const profile = agentRes.data as unknown as AgentProfile;
        setAgent(profile);

        const tenantData = {
          name: profile.store_name,
          logo: profile.store_logo_url,
          color: profile.store_primary_color,
          slug: (profile as any).slug || slug,
          custom_domain: (profile as any).custom_domain,
          description: resellerStoreRes?.data?.store_description || "",
          banner: resellerStoreRes?.data?.store_banner_url || ""
        };
        localStorage.setItem("current_store_tenant", JSON.stringify(tenantData));

        const storeSlug = slug || (profile as any).slug;
        if (storeSlug) {
          localStorage.setItem(`store_loading_${storeSlug}`, JSON.stringify({
            name: profile.store_name,
            logo: profile.store_logo_url,
            color: profile.store_primary_color
          }));
        }
        const storeDomain = activeDomain || (profile as any).custom_domain;
        if (storeDomain) {
          localStorage.setItem(`store_loading_${storeDomain}`, JSON.stringify({
            name: profile.store_name,
            logo: profile.store_logo_url,
            color: profile.store_primary_color
          }));
        }

        if (profile.is_sub_agent && profile.parent_agent_id) {
          const { data: parentProfile } = await (supabase
            .from("agent_stores") as any).select("sub_agent_prices, agent_prices").eq("user_id", profile.parent_agent_id).maybeSingle();
          if (parentProfile) {
            const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, any>;
            const parentSellingPrices = (parentProfile.agent_prices || {}) as Record<string, any>;
            const merged: Record<string, Record<string, string | number>> = {};
            for (const [network, pkgs] of Object.entries(basePackages)) {
              merged[network] = {};
              for (const pkg of pkgs) {
                const subPrice = Number(subPrices[network]?.[pkg.size]);
                const sellingPrice = Number(parentSellingPrices[network]?.[pkg.size]);
                merged[network][pkg.size] = (Number.isFinite(subPrice) && subPrice > 0) ? subPrice : sellingPrice;
              }
            }
            setParentAssignedPrices(merged);
          }
        }

        const fee = Number(profile.sub_agent_activation_markup ?? 0);
        if (Number.isFinite(fee) && fee > 0) setSubAgentBaseFee(fee);
      } catch (err: any) {
        console.error("[AgentStore] Error in fetchStore:", err);
        setErrorDetails(`Post-query error: ${err?.message || err?.details || String(err)}`);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchStore();
  }, [slug]);

  const resolveDisplayPrice = useCallback((network: string, size: string, fallbackPrice: number): number => {
    if (!agent) return fallbackPrice;
    
    // Normalize size for safe lookup in globalSettings map
    const normSize = size.replace(/\s+/g, "").toUpperCase();
    
    // Strip "Korba " prefix for multiplier key (which should be "MTN", "Telecel", "AirtelTigo")
    const multiplierKey = network.replace("Korba ", "");
    const multiplier = priceMultipliers[multiplierKey] || 1;
    
    // Check both prefixed and non-prefixed network keys in agent/parent custom prices
    const parentAssigned = Number(parentAssignedPrices?.[network]?.[size] || parentAssignedPrices?.[multiplierKey]?.[size]);
    
    const agentGuestPrice = Number(agent.agent_prices?.[network]?.[size] || agent.agent_prices?.[multiplierKey]?.[size]);
    const agentCustomerPrice = Number((agent as any).registered_user_prices?.[network]?.[size] || (agent as any).registered_user_prices?.[multiplierKey]?.[size]);
    
    // Use customer pricing if the user is logged in (and is not the owner)
    const isCustomer = profile && profile.user_id !== agent.user_id;
    let activePrice = agentGuestPrice;
    
    if (isCustomer && Number.isFinite(agentCustomerPrice) && agentCustomerPrice > 0) {
      activePrice = agentCustomerPrice;
    }

    if (agent.is_sub_agent) {
      const base = Math.max(
        Number.isFinite(parentAssigned) ? parentAssigned : 0,
        Number.isFinite(activePrice) ? activePrice : 0
      );
      if (base > 0) return applyPriceMultiplier(base, multiplier);
    } else {
      if (Number.isFinite(activePrice) && activePrice > 0) return applyPriceMultiplier(activePrice, multiplier);
    }
    
    const gs = globalSettings[`${network}-${normSize}`] || globalSettings[`${multiplierKey}-${normSize}`];
    let gsBase = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : Number(gs?.public_price);
    if (agent.is_sub_agent) {
      const gsSub = Number(gs?.sub_agent_price);
      if (Number.isFinite(gsSub) && gsSub > 0) gsBase = gsSub;
    }
    if (Number.isFinite(gsBase) && gsBase > 0) return applyPriceMultiplier(gsBase, multiplier);
    return applyPriceMultiplier(fallbackPrice, multiplier);
  }, [agent, globalSettings, parentAssignedPrices, priceMultipliers, profile]);

  // Get packages for current network and purchase type
  const displayPackages = useMemo(() => {
    const list: { size: string; price: number; validity: string; popular?: boolean; isInstant?: boolean; category?: string }[] = [];
    const dbNetwork = activeGateway === "korba" ? `Korba ${selectedNetwork}` : selectedNetwork;

    // 1. Get standard base packages (which are Affordable by default)
    const baseList = basePackages[selectedNetwork] || [];
    baseList.forEach(pkg => {
      list.push({
        size: pkg.size,
        price: pkg.price,
        validity: pkg.validity,
        popular: pkg.popular,
        isInstant: false,
        category: "Affordable SME"
      });
    });

    // 2. Add packages from global settings
    const addedSizes = new Set(baseList.map(p => p.size.replace(/\s+/g, "").toUpperCase()));

    Object.keys(globalSettings).forEach((key) => {
      const gs = globalSettings[key];
      // Note: we group 'MTN Mash Up' under MTN's Instant page
      if (gs && (gs.network === dbNetwork || (dbNetwork === "MTN" && gs.network === "MTN Mash Up"))) {
        const normSize = gs.package_size.replace(/\s+/g, "").toUpperCase();
        if (!addedSizes.has(normSize)) {
          // Check if this package is mapped to Korba
          const mapping = korbaMappings.find(
            m => m.package_name === gs.package_size && 
                 (m.network === gs.network)
          );
          
          list.push({
            size: gs.package_size,
            price: gs.public_price ?? 0,
            validity: gs.network.includes("Mash Up") ? "MTN Mash Up" : "Non-expiry",
            isInstant: !!mapping,
            category: mapping?.raw_data?.category || (gs.network === "MTN Mash Up" ? "Mash Up Bundles" : "Data Bundles")
          });
        }
      }
    });

    // 3. Process prices, unavailable states, and disabled packages
    const processed = list
      .map((pkg) => {
        const normSize = pkg.size.replace(/\s+/g, "").toUpperCase();
        
        let gs = globalSettings[`${dbNetwork}-${normSize}`];
        if (!gs && dbNetwork === "MTN") {
          gs = globalSettings[`MTN Mash Up-${normSize}`];
        }

        if (gs?.is_unavailable) return null;
        if (agent?.disabled_packages?.[dbNetwork]?.includes(pkg.size)) return null;
        
        const price = resolveDisplayPrice(dbNetwork, pkg.size, pkg.price);

        // Re-check mapping for isInstant (needed if the package was from basePackages but later mapped to Korba)
        const mapping = korbaMappings.find(
          m => m.package_name === pkg.size && 
               (m.network === dbNetwork || (dbNetwork === "MTN" && m.network === "MTN Mash Up"))
        );
        const isInstant = !!mapping;
        const category = mapping?.raw_data?.category || (pkg.validity === "MTN Mash Up" ? "Mash Up Bundles" : "Data Bundles");

        return {
          ...pkg,
          price,
          isInstant,
          category
        };
      })
      .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean; isInstant: boolean; category: string }[];

    return processed;
  }, [selectedNetwork, globalSettings, korbaMappings, agent, resolveDisplayPrice, activeGateway]);

  // Get all available dropdown options for the current network
  const dropdownOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "affordable", label: "Affordable SME Bundles" }
    ];

    // Find all unique categories of Instant packages for the selected network
    const instantPkgs = displayPackages.filter(p => p.isInstant && p.validity !== "MTN Mash Up" && p.category !== "Mash Up Bundles");
    const categories = Array.from(new Set(instantPkgs.map(p => p.category).filter(Boolean))) as string[];

    categories.sort().forEach((cat) => {
      options.push({
        value: cat,
        label: `Instant: ${cat}`
      });
    });

    if (selectedNetwork === "MTN") {
      options.push({ value: "mashup", label: "MTN Mash Up" });
    }

    return options;
  }, [displayPackages, selectedNetwork]);

  // Filter based on selectedTypeOrCategory dropdown option
  const filteredPackages = useMemo(() => {
    if (selectedTypeOrCategory === "affordable") {
      return displayPackages.filter(
        p => !p.isInstant && 
             p.validity !== "MTN Mash Up" && 
             p.category !== "Mash Up Bundles"
      );
    }
    
    if (selectedTypeOrCategory === "mashup") {
      return displayPackages.filter(
        p => p.validity === "MTN Mash Up" || p.category === "Mash Up Bundles"
      );
    }
    
    // Otherwise, filter by specific Instant category
    return displayPackages.filter(
      p => p.isInstant && 
           p.category === selectedTypeOrCategory && 
           p.validity !== "MTN Mash Up" && 
           p.category !== "Mash Up Bundles"
    );
  }, [displayPackages, selectedTypeOrCategory]);

  // If there are any instant packages mapped, we show the option to switch
  const hasInstantPackages = useMemo(() => {
    return displayPackages.some(p => p.isInstant && p.validity !== "MTN Mash Up" && p.category !== "Mash Up Bundles");
  }, [displayPackages]);

  const packages = filteredPackages;

  const validPromo = promoResult?.valid ? promoResult : null;
  const discountPct = validPromo?.discount_percentage ?? 0;
  const isFreePromo = validPromo?.is_free === true;

  const basePrice = selectedService === "data"
    ? (selectedPkg?.price || 0)
    : selectedService === "airtime"
    ? Number(airtimeAmount) || 0
    : Number(utilityAmount) || 0;

  const discountedPrice = isFreePromo ? 0 : parseFloat((basePrice * (1 - discountPct / 100)).toFixed(2));
  const fee = isFreePromo ? 0 : (selectedService === "data" ? (basePrice > 0 ? calcFee(discountedPrice) : 0) : 0);
  const total = basePrice > 0 ? parseFloat((discountedPrice + fee).toFixed(2)) : 0;

  const accentColor = agent?.store_primary_color || "#FFCC00";
  const resolvedGradient = useMemo(() => {
    const preset = [
      { color: "#f59e0b", value: "linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(245,158,11,0.15) 50%, rgba(239,68,68,0.15) 100%)" },
      { color: "#06b6d4", value: "linear-gradient(135deg, rgba(2,132,199,0.15) 0%, rgba(6,182,212,0.15) 50%, rgba(16,185,129,0.15) 100%)" },
      { color: "#8b5cf6", value: "linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(99,102,241,0.15) 50%, rgba(59,130,246,0.15) 100%)" },
      { color: "#10b981", value: "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(132,204,22,0.15) 50%, rgba(6,182,212,0.15) 100%)" }
    ].find(p => p.color === agent?.store_primary_color);
    return preset ? preset.value : `linear-gradient(135deg, ${accentColor}15 0%, rgba(255,255,255,0.02) 100%)`;
  }, [agent?.store_primary_color, accentColor]);
  const netConf = NETWORK_CONFIG[selectedNetwork];

  const handleCardClick = useCallback((size: string, price: number) => {
    const isDeselect = selectedPkg?.size === size;
    setSelectedPkg(isDeselect ? null : { size, price });
    setPromoResult(null); setPromoCode(""); setPromoOpen(false);
    if (!isDeselect) {
      setTimeout(() => {
        purchasePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        phoneInputRef.current?.focus();
      }, 120);
    }
  }, [selectedPkg]);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    if (!isPhoneValid) {
      toast({ title: "Enter your phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setPromoValidating(true);
    setPromoResult(null);
    const { data, error } = await invokePublicFunction("validate-promo", {
      body: { code: promoCode.trim(), phone: phoneDigits },
    });
    setPromoValidating(false);
    if (error || !data) { setPromoResult({ valid: false, error: "Could not validate code." }); return; }
    setPromoResult(data as PromoResult);
    if (data.valid && data.is_free) {
      toast({ title: "Free data code applied!", description: "Tap Claim Free Data to get your bundle!" });
    } else if (data.valid) {
      toast({ title: `${data.discount_percentage}% off applied!` });
    }
  };

  const handleClaimFree = async () => {
    if (!selectedPkg || !validPromo?.is_free || !agent) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setClaiming(true);
    const { data, error } = await invokePublicFunction("claim-free-data", {
      body: { promo_code: promoCode.trim(), phone: phoneDigits, network: selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork, package_size: selectedPkg.size },
    });
    setClaiming(false);
    if (error || !data) {
      toast({ title: "Claim failed", description: "Could not process your free data claim.", variant: "destructive" });
      return;
    }
    if (data.success) {
      setShowSuccessOverlay(true);
      setTimeout(() => {
        setShowSuccessOverlay(false);
        setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false);
      }, 5000);
    } else {
      toast({ title: "Claim failed", description: data.error || "Delivery failed. Contact support.", variant: "destructive" });
      setPromoResult(null); setPromoCode("");
    }
  };

  const handlePaystackBuy = async (bypassBeneficiary = false) => {
    if (!agent) return;
    if (selectedService === "data" && !selectedPkg) return;
    if (selectedService === "airtime") {
      const amt = Number(airtimeAmount);
      if (!amt || amt < 1) {
        toast({ title: "Invalid amount", description: "Minimum airtime purchase is GHS 1.00", variant: "destructive" });
        return;
      }

      // 🌙 Night Guard Rule: Restrict guest airtime from 11pm to 6am
      const currentUtcHour = new Date().getUTCHours();
      const isNightHours = currentUtcHour >= 23 || currentUtcHour < 6;
      if (isNightHours && !isRegisteredUser) {
        toast({
          title: "Night Guard Protection",
          description: "Guest airtime purchases are restricted between 11:00 PM and 6:00 AM. Please log in to purchase airtime during night hours.",
          variant: "destructive"
        });
        return;
      }
    }
    if (selectedService === "utility") {
      const amt = Number(utilityAmount);
      if (!amt || amt < 1) { toast({ title: "Invalid amount", description: "Enter a valid bill amount.", variant: "destructive" }); return; }
      if (!utilityNumber || utilityNumber.length < 5) { toast({ title: "Invalid Account Number", description: "Please check your meter/account number.", variant: "destructive" }); return; }
      if (utilityType.includes("ECG") && utilityNumber.length < 11) { toast({ title: "Invalid Meter Number", description: "ECG Meter numbers are typically 11 digits or more.", variant: "destructive" }); return; }
    }
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }

    if (selectedService === "data" && !bypassBeneficiary) {
      setBuying(true);
      const isValid = await checkBeneficiaryValidity(phoneDigits, selectedNetwork);
      setBuying(false);
      if (!isValid) {
        setPendingAction("paystack");
        return;
      }
    }

    const orderNetwork = selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork;
    const orderId = crypto.randomUUID();
    const orderType = selectedService === "utility" ? "utility" : selectedService === "airtime" ? "airtime" : "data";
    const packageSize = selectedService === "data" ? selectedPkg?.size : selectedService === "airtime" ? `${airtimeAmount} GHS Airtime` : `${utilityType} Bill`;
    const callbackParams = new URLSearchParams({
      reference: orderId, network: orderNetwork, package: packageSize || "", phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });

    const meta = {
      order_id: orderId,
      order_type: orderType,
      network: orderNetwork,
      package_size: packageSize,
      customer_phone: phoneDigits,
      fee,
      agent_id: agent.user_id,
      payment_source: "agent_store",
      is_korba: selectedService === "utility" || (selectedService === "data" && korbaMappings.some((m: any) => m.network === selectedNetwork && m.package_name === selectedPkg?.size)),
      bypass_beneficiary: bypassBeneficiary ? true : undefined,
      callback_url: slug
        ? `${window.location.origin}/store/${slug}/order-status?${callbackParams.toString()}`
        : `${window.location.origin}/order-status?${callbackParams.toString()}`,
      ...(validPromo && !validPromo.is_free ? { promo_code: promoCode.trim(), promo_id: validPromo.promo_id, discount_percentage: validPromo.discount_percentage } : {}),
      ...(selectedService === "utility" ? { bill_type: utilityType, customer_number: utilityNumber } : {}),
    };

    setCheckoutMetadata(meta);
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setSelectedPkg(null);
    setPhone("");
    setPromoCode("");
    setPromoResult(null);
    setAirtimeAmount("");
    setUtilityNumber("");
    setUtilityAmount("");
    
    const orderType = selectedService === "utility" ? "utility" : selectedService === "airtime" ? "airtime" : "data";
    const packageSize = selectedService === "data" ? selectedPkg?.size : selectedService === "airtime" ? `${airtimeAmount} GHS Airtime` : `${utilityType} Bill`;
    
    const callbackParams = new URLSearchParams({
      reference: ref,
      network: selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork,
      package: packageSize || "",
      phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });
    
    window.location.href = slug
      ? `${window.location.origin}/store/${slug}/order-status?${callbackParams.toString()}`
      : `${window.location.origin}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setBuying(false);
  };

  const handlePay = async () => {
    if (isCustomerLoggedIn && payMethod === "wallet") {
      await handleWalletBuy();
    } else {
      await handlePaystackBuy();
    }
  };

  // ── Inline purchase panel (inserted row-by-row below the selected package) ──
  const renderPurchasePanel = () => (
    <div
      ref={purchasePanelRef}
      className="animate-in fade-in slide-in-from-top-2 duration-400 rounded-[28px] overflow-hidden border border-white/20 backdrop-blur-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] relative z-20"
      style={{ background: "linear-gradient(180deg, rgba(28,28,30,0.85) 0%, rgba(10,10,15,0.95) 100%)" }}
    >
      {/* Inner Highlight for depth */}
      <div className="absolute inset-0 rounded-[28px] pointer-events-none ring-1 ring-inset ring-white/10" />

      {/* Connector notch */}
      <div className="flex px-5 pt-4 pb-2 relative z-10">
        <div
          className="w-1.5 rounded-full mr-4 shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
          style={{ backgroundColor: netConf.color, minHeight: "100%", alignSelf: "stretch" }}
        />
        <div className="flex-1 flex items-center justify-between">
          <div>
            <p className="text-base font-black text-white leading-tight flex items-center gap-2 tracking-tight">
              {selectedService === "data"
                ? `${selectedNetwork} · ${selectedPkg?.size}`
                : selectedService === "airtime"
                ? `${selectedNetwork} Airtime`
                : `${utilityType} Bill`}
              {isFreePromo && (
                <span className="text-[10px] bg-emerald-500 text-black font-black px-2 py-0.5 rounded-full shadow-md">FREE</span>
              )}
            </p>
            <p className="text-[13px] font-bold mt-1 text-white/50">
              {validPromo && !isFreePromo ? (
                <><span className="text-emerald-400">₵{discountedPrice.toFixed(2)}</span> <span className="line-through opacity-40">₵{basePrice.toFixed(2)}</span></>
              ) : (
                `₵${basePrice.toFixed(2)}`
              )}
              {fee > 0 && ` · ₵${fee.toFixed(2)} fee`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Deselect package"
            onClick={() => { setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
            className="w-8 h-8 rounded-[12px] bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all ml-3 shrink-0 active:scale-95 shadow-inner border border-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 my-4 border-t border-white/10 relative z-10" />

      {/* Phone + Pay */}
      <div className="px-5 pb-5 space-y-4 relative z-10">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none z-10 ${isPhoneValid ? "text-emerald-400" : "text-white/30"}`} />
            <input
              ref={phoneInputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Recipient number  0XX XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={12}
              className="w-full h-14 rounded-[18px] pl-11 pr-4 text-sm font-black text-white placeholder:text-white/30 focus:outline-none transition-all border shadow-inner tracking-wide"
              style={{
                background: "rgba(255,255,255,0.05)",
                borderColor: isPhoneValid ? `${netConf.color}80` : "rgba(255,255,255,0.12)",
                boxShadow: isPhoneValid ? `0 0 0 2px ${netConf.color}20 inset` : "0 2px 4px rgba(0,0,0,0.2) inset",
                WebkitTextFillColor: "white",
              }}
            />
          </div>

          {isFreePromo ? (
            <button
              type="button"
              onClick={handleClaimFree}
              disabled={claiming || !isPhoneValid}
              className="shrink-0 h-14 px-5 rounded-[18px] bg-emerald-500 text-black font-black text-[13px] uppercase tracking-wide disabled:opacity-40 flex items-center gap-2 active:scale-95 transition-all shadow-[0_4px_15px_rgba(16,185,129,0.3)]"
            >
              {claiming ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Gift className="w-4 h-4" />Claim</>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={buying || isCheckingBeneficiary || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)}
              className="shrink-0 h-14 px-5 rounded-[18px] font-black text-[13px] uppercase tracking-wide flex items-center gap-2 active:scale-[0.96] transition-all whitespace-nowrap"
              style={{
                backgroundColor: netConf.color,
                color: netConf.textClass === "text-black" ? "#000" : "#fff",
                opacity: (!isPhoneValid || buying || isCheckingBeneficiary || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? 0.5 : 1,
                boxShadow: (isPhoneValid && !isCheckingBeneficiary && !(isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? `0 8px 25px ${netConf.color}50` : "none",
                textShadow: netConf.textClass === "text-white" ? "0 2px 4px rgba(0,0,0,0.3)" : "none"
              }}
            >
              {buying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCustomerLoggedIn && payMethod === "wallet" ? (
                <><CreditCard className="w-4 h-4" />Pay ₵{total.toFixed(2)}</>
              ) : (
                <><CreditCard className="w-4 h-4 drop-shadow-sm" />Pay ₵{total.toFixed(2)}</>
              )}
            </button>
          )}
        </div>

        {/* Payment Method Selector for Storefront Customer */}
        {isCustomerLoggedIn && !isFreePromo && (
          <div className="pt-1 pb-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Select Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayMethod("wallet")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  payMethod === "wallet"
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-white/8 hover:border-white/20 bg-white/4"
                }`}
              >
                <p className="text-[10px] font-black text-white">Wallet Balance</p>
                <p className="text-[9px] text-white/50 font-bold mt-0.5 font-mono">₵{customerBalance.toFixed(2)}</p>
              </button>

              <button
                type="button"
                onClick={() => setPayMethod("paystack")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  payMethod === "paystack"
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-white/8 hover:border-white/20 bg-white/4"
                }`}
              >
                <p className="text-[10px] font-black text-white">Card / MoMo</p>
                <p className="text-[9px] text-white/50 font-bold mt-0.5">Pay online instant</p>
              </button>
            </div>
          </div>
        )}

        {/* Wallet insufficient warning */}
        {isCustomerLoggedIn && payMethod === "wallet" && !isFreePromo && customerBalance < total && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] font-bold text-amber-500 flex items-center gap-2.5 uppercase tracking-tight">
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">Insufficient wallet balance. Top up or use Card.</span>
            <button
              type="button"
              onClick={() => setDepositOpen(true)}
              className="bg-amber-500 text-black px-2.5 py-1 rounded-lg text-[9px] font-black hover:bg-amber-400 transition-colors shrink-0"
            >
              DEPOSIT
            </button>
          </div>
        )}

        {/* Phone validation */}
        {phone.length > 0 && !isPhoneValid && (
          <p className="text-[11px] font-bold text-red-400 px-1 animate-in fade-in duration-150">
            Enter a valid 10-digit Ghana number
          </p>
        )}

        {/* Real-time Beneficiary Validation status */}
        {isPhoneValid && isCheckingBeneficiary && (
          <p className="text-[11px] font-bold text-amber-400 px-1 animate-in slide-in-from-top-1 duration-150 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying MTN beneficiary status...
          </p>
        )}

        {isPhoneValid && !isCheckingBeneficiary && beneficiaryError && (
          <p className="text-[11px] font-bold text-red-400 px-1 animate-in slide-in-from-top-1 duration-150">
            ⚠️ {beneficiaryError}
          </p>
        )}

        {isPhoneValid && !isCheckingBeneficiary && !beneficiaryError && (selectedNetwork?.toUpperCase()?.includes("MTN") || selectedTypeOrCategory === "mashup") && selectedService === "data" && checkedPhone === phoneDigits && (
          <p className="text-[11px] font-bold text-emerald-400 px-1 animate-in slide-in-from-top-1 duration-150 flex items-center gap-1">
            ✓ Whitelisted on MTN beneficiary list
          </p>
        )}

        {/* Promo code */}
        <div>
          {!promoOpen && !validPromo ? (
            <button
              type="button"
              onClick={() => { setPromoOpen(true); setTimeout(() => promoInputRef.current?.focus(), 80); }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white/25 hover:text-amber-400 transition-colors"
            >
              <Tag className="w-3 h-3" /> Have a promo code?
            </button>
          ) : validPromo ? (
            <div className={`inline-flex items-center gap-2 text-[11px] font-black px-3 py-1.5 rounded-xl border ${validPromo.is_free ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-400/10 border-amber-400/20 text-amber-400"}`}>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {validPromo.code}{validPromo.is_free ? " — Free!" : ` — ${validPromo.discount_percentage}% off`}
              <button type="button" aria-label="Remove promo" onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="ml-1 opacity-50 hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 animate-in fade-in duration-200">
              <input
                ref={promoInputRef}
                type="text"
                placeholder="PROMO CODE"
                value={promoCode}
                onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                className="flex-1 h-9 rounded-xl px-3 text-white placeholder:text-white/20 text-[11px] font-black tracking-widest focus:outline-none uppercase border border-white/8"
                style={{ background: "#1c1c24" }}
              />
              <button type="button" onClick={handleApplyPromo} disabled={promoValidating || !promoCode.trim()}
                className="h-9 px-4 rounded-xl bg-amber-400 text-black text-[11px] font-black disabled:opacity-40 active:scale-95 transition-all">
                {promoValidating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
              </button>
              <button type="button" aria-label="Close promo" onClick={() => { setPromoOpen(false); setPromoCode(""); setPromoResult(null); }}
                className="h-9 w-9 rounded-xl bg-white/5 text-white/30 hover:text-white flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {promoResult && !promoResult.valid && (
            <p className="text-[10px] font-bold text-red-400 mt-1.5">{promoResult.error || "Invalid promo code"}</p>
          )}
        </div>

        {/* Trust strip */}
        <div className="flex items-center gap-2 pt-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Secured by Paystack · Instant Delivery</span>
        </div>
      </div>
    </div>
  );

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
        <div className="h-14 border-b border-white/8 flex items-center px-4 gap-3 bg-black/40">
          <Skeleton className="h-8 w-8 rounded-xl bg-white/8" />
          <Skeleton className="h-4 w-36 bg-white/8" />
          <div className="ml-auto"><Skeleton className="h-8 w-20 rounded-xl bg-white/8" /></div>
        </div>
        <div className="flex-1 px-4 pt-6 max-w-lg mx-auto w-full space-y-6">
          <Skeleton className="h-28 w-full rounded-3xl bg-white/8" />
          <div className="flex gap-2">
            {[1,2,3].map(i => <Skeleton key={i} className="flex-1 h-11 rounded-2xl bg-white/8" />)}
          </div>
          <div className="flex gap-2">
            {[1,2,3].map(i => <Skeleton key={i} className="flex-1 h-14 rounded-2xl bg-white/8" />)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-36 rounded-3xl bg-white/8" />)}
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (notFound || !agent) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-6 text-white">
        <TraditionalBackground className="fixed inset-0 z-0 opacity-[0.06]" />
        <div className="relative z-10 text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Zap className="w-8 h-8 text-white/20" />
          </div>
          <h1 className="text-2xl font-black mb-2">Store Not Found</h1>
          <p className="text-white/40 text-sm leading-relaxed mb-4">This store doesn't exist or hasn't been activated by an agent yet.</p>
          {errorDetails && (
            <div className="p-4 bg-red-950/40 border border-red-500/20 rounded-2xl text-red-200 text-xs font-mono text-left break-words">
              <span className="font-bold text-red-400 block mb-1">Debug Info:</span>
              {errorDetails}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050508] text-white selection:bg-white/30 flex flex-col relative">
      {/* Traditional Pattern Background */}
      <TraditionalBackground className="fixed inset-0 z-0 opacity-20 dark:opacity-20" />

      {/* Dynamic Mesh Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden opacity-70">
        <div
          className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full mix-blend-screen blur-[120px] opacity-40 transition-colors duration-1500"
          style={{ backgroundColor: accentColor }}
        />
        <div
          className="absolute top-[30%] -right-[20%] w-[60vw] h-[60vw] rounded-full mix-blend-screen blur-[100px] opacity-30 transition-colors duration-1500"
          style={{ backgroundColor: netConf.color }}
        />
        <div
          className="absolute -bottom-[10%] left-[20%] w-[80vw] h-[50vw] rounded-full mix-blend-screen blur-[120px] opacity-20 transition-colors duration-1500"
          style={{ backgroundColor: accentColor }}
        />
      </div>

      <StoreVisitorPopup
        agentSlug={slug}
        showSubAgentLink={!agent.is_sub_agent}
        storeName={agent.store_name}
        logoUrl={agent.store_logo_url}
        primaryColor={accentColor}
      />

      {/* Navbar */}
      <StoreNavbar
        storeName={agent.store_name}
        agentSlug={slug}
        networkAccent={netConf.color}
        whatsappNumber={agent.whatsapp_number}
        whatsappGroupLink={agent.whatsapp_group_link ?? undefined}
        supportNumber={agent.support_number}
        email={agent.email}
        showSubAgentLink={!agent.is_sub_agent}
        logoUrl={agent.store_logo_url ?? undefined}
        onOpenAuth={() => setAuthOpen(true)}
        customerBalance={customerBalance}
        isCustomerLoggedIn={isCustomerLoggedIn}
        customerName={customerName}
        onSignOut={signOut}
      />

      {/* Main content */}
      <main className="relative z-10 flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24 space-y-6">

        {/* ── Ultra-Modern Storefront Hero Card ── */}
        <div
          className="rounded-[36px] p-7 relative overflow-hidden border border-white/15 backdrop-blur-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] group transition-all duration-500"
          style={{ 
            background: storeBannerUrl 
              ? `url(${storeBannerUrl}) center/cover no-repeat` 
              : resolvedGradient 
          }}
        >
          {/* Ambient Glow Aura */}
          {!storeBannerUrl && (
            <>
              <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full blur-3xl opacity-45 pointer-events-none transition-all duration-700 group-hover:opacity-70" style={{ backgroundColor: accentColor }} />
              <div className="absolute -bottom-12 -left-12 w-52 h-52 rounded-full blur-3xl opacity-35 pointer-events-none transition-all duration-700 group-hover:opacity-60" style={{ backgroundColor: accentColor }} />
            </>
          )}

          {/* Dark Gradient Overlay for custom background readability */}
          {storeBannerUrl && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30 backdrop-blur-[1px] transition-all group-hover:opacity-90 z-0" />
          )}
          
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <span className="px-3.5 py-1 text-[10px] font-black tracking-widest text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded-full uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md">
                {greeting}
              </span>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]" />
                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Store Online</span>
              </div>
            </div>

            {/* Quick Track Order Link */}
            <a
              href="#track-section"
              className="flex items-center gap-1.5 text-[10px] font-bold text-white/50 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1 rounded-full border border-white/10"
            >
              <Clock className="w-3 h-3 text-amber-400" />
              <span>Track Order</span>
            </a>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black tracking-tight leading-[1.05] mb-3 relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-white via-white/95 to-white/70 drop-shadow-sm">
            Instant Data <br/> &amp; Connectivity.
          </h2>
          <p className="text-white/70 text-[13px] font-semibold leading-relaxed mb-4 max-w-[340px] relative z-10">
            {storeDescription || "Purchase ultra-fast internet bundles for MTN, Telecel, and AirtelTigo. Instant delivery guaranteed."}
          </p>
          <LiveDeliveryBadge className="mb-5 relative z-10 shadow-lg" />

          {/* Store Info & WhatsApp Support Bar */}
          <div className="flex items-center justify-between p-4 rounded-[26px] bg-white/[0.07] border border-white/15 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] relative z-10 group/card hover:border-white/30 transition-all">
            <div className="flex items-center gap-3 min-w-0">
              {agent.store_logo_url ? (
                <img src={agent.store_logo_url} alt="logo" className="w-11 h-11 rounded-[16px] object-cover border border-white/20 shrink-0 shadow-xl group-hover/card:scale-105 transition-transform" />
              ) : (
                <div className="w-11 h-11 rounded-[16px] flex items-center justify-center border border-white/20 shrink-0 shadow-inner group-hover/card:scale-105 transition-transform" style={{ backgroundColor: `${accentColor}25` }}>
                  <Store className="w-5 h-5" style={{ color: accentColor }} />
                </div>
              )}
              <div className="leading-tight min-w-0">
                <p className="font-black text-sm text-white truncate max-w-[140px] tracking-tight">{agent.store_name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#25D366]" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Verified Reseller</p>
                </div>
              </div>
            </div>
            
            {agent.whatsapp_number && (
              <a
                href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-[16px] bg-[#25D366] hover:bg-[#22c35e] text-black text-[11px] font-black tracking-wide transition-all duration-300 shadow-[0_4px_20px_rgba(37,211,102,0.35)] active:scale-95 shrink-0 hover:scale-105"
              >
                <MessageCircle className="w-4 h-4 fill-black/20" />
                Support
              </a>
            )}
          </div>
        </div>

        {/* ── Customer Account Dashboard Card ── */}
        {isCustomerLoggedIn && (
          <div className="bg-gradient-to-b from-white/10 to-white/4 border border-white/15 rounded-[28px] p-5 relative overflow-hidden backdrop-blur-2xl shadow-2xl">
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-35" style={{ background: accentColor }} />
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none">Customer Account</p>
                <p className="text-white text-base font-black truncate mt-1.5 leading-tight">{customerName}</p>
              </div>
              <button onClick={() => setHistoryOpen(true)} className="text-[10px] font-black px-3.5 py-1.5 rounded-xl text-black uppercase tracking-wider flex items-center gap-1 hover:brightness-110 transition-all active:scale-95 shadow-md" style={{ backgroundColor: accentColor }}>
                <History className="w-3.5 h-3.5" /> My Orders
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10">
              <div className="bg-white/5 rounded-2xl p-3.5 border border-white/5">
                <p className="text-[9px] text-white/50 font-bold uppercase leading-none">Wallet Balance</p>
                <p className="text-lg font-black text-emerald-400 mt-1.5 leading-none font-mono">GH₵ {Number(customerBalance).toFixed(2)}</p>
              </div>
              
              <button
                type="button"
                onClick={() => setDepositOpen(true)}
                className="rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition-all duration-300 hover:brightness-110 border-0 shadow-lg"
                style={{ backgroundColor: accentColor, color: "#000000" }}
              >
                <CreditCard className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider leading-none">Top-Up Wallet</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Service Tabs Switcher ── */}
        <div className="flex gap-2 p-2 rounded-[24px] bg-white/[0.04] border border-white/12 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] relative z-10">
          {[
            { id: "data",    label: "Data Bundles", icon: Wifi },
            { id: "airtime", label: "Airtime",      icon: Smartphone },
            { id: "utility", label: "Utilities",    icon: Zap },
          ].map((s) => {
            const active = selectedService === s.id;
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => { setSelectedService(s.id as ServiceType); setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-[18px] text-xs font-black uppercase tracking-wider transition-all duration-300 active:scale-[0.97] ${
                  active
                    ? "text-black shadow-[0_6px_20px_rgba(0,0,0,0.4)] scale-[1.02]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }`}
                style={active ? { 
                  background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                  boxShadow: `0 6px 20px ${accentColor}40`
                } : {}}
              >
                <s.icon className={`w-4 h-4 ${active ? "drop-shadow-sm" : ""}`} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* ── Network Pills Selector ── */}
        {(selectedService === "data" || selectedService === "airtime") && (
          <div className="flex gap-3 relative z-10">
            {NETWORKS.map((n) => {
              const active = selectedNetwork === n;
              const nc = NETWORK_CONFIG[n];
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => { setSelectedNetwork(n); setSelectedPkg(null); setSelectedTypeOrCategory("affordable"); }}
                  className={`flex-1 py-3.5 rounded-[20px] text-[11px] font-black uppercase tracking-widest border transition-all duration-300 active:scale-[0.96] ${
                    active 
                      ? `${nc.bg} ${nc.textClass} border-white/30 shadow-2xl scale-[1.02]` 
                      : "bg-white/[0.04] border-white/10 text-white/60 hover:bg-white/10 hover:text-white backdrop-blur-xl shadow-inner"
                  }`}
                  style={active ? { 
                    boxShadow: `0 10px 28px ${nc.color}45`, 
                    textShadow: nc.textClass === "text-white" ? "0 2px 4px rgba(0,0,0,0.3)" : "none" 
                  } : {}}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Dropdown Category Selector ── */}
        {selectedService === "data" && (
          <div className="animate-fade-in relative z-50">
            <BundleSelectorDropdown
              options={dropdownOptions}
              value={selectedTypeOrCategory}
              onChange={(val) => {
                setSelectedTypeOrCategory(val);
                setSelectedPkg(null);
              }}
              accentColor={accentColor}
              isDark={true}
            />
          </div>
        )}

        {/* Dedicated Instant View Header */}
        {selectedService === "data" && selectedTypeOrCategory !== "affordable" && selectedTypeOrCategory !== "mashup" && (
          <div 
            className="p-5 rounded-3xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in relative z-10"
            style={{ borderColor: `${accentColor}20`, background: `${accentColor}06` }}
          >
            <div>
              <h2 className="text-sm font-black text-white mb-0.5 uppercase tracking-wide">
                {selectedNetwork} Instant: {selectedTypeOrCategory}
              </h2>
              <p className="text-[11px] text-white/50 max-w-lg leading-relaxed">
                Direct official retail bundles routed instantly via carrier gateways.
              </p>
            </div>
            <div 
              className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider shadow-inner"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              Official API
            </div>
          </div>
        )}

        {/* Dedicated Mash Up View Header */}
        {selectedService === "data" && selectedTypeOrCategory === "mashup" && (
          <div 
            className="p-5 rounded-3xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in relative z-10"
            style={{ borderColor: `${accentColor}20`, background: `${accentColor}06` }}
          >
            <div>
              <h2 className="text-sm font-black text-white mb-0.5 uppercase tracking-wide">MTN Mash Up Bundles</h2>
              <p className="text-[11px] text-white/50 max-w-lg leading-relaxed">
                Popular hybrid voice and data packages from MTN. Fully supported and routed instantly.
              </p>
            </div>
            <div 
              className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider shadow-inner"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              Mash Up Active
            </div>
          </div>
        )}

        {/* ── Data Packages Grid ── */}
        {selectedService === "data" && (() => {
          if (packages.length === 0) {
            return (
              <div 
                className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed rounded-3xl"
                style={{ borderColor: `${accentColor}25`, backgroundColor: `${accentColor}03` }}
              >
                <div className="relative flex items-center justify-center mb-4">
                  <span className="absolute inline-flex h-16 w-16 rounded-full animate-ping" style={{ backgroundColor: `${accentColor}25` }} />
                  <div 
                    className="relative w-14 h-14 rounded-2xl flex items-center justify-center border shadow-inner"
                    style={{ backgroundColor: `${accentColor}10`, borderColor: `${accentColor}25` }}
                  >
                    <Clock className="w-7 h-7 animate-spin-slow" style={{ color: accentColor }} />
                  </div>
                </div>
                <h3 className="text-lg font-black text-white mb-2 uppercase tracking-wide">{selectedNetwork} Packages On Hold</h3>
                <p className="text-sm text-white/40 max-w-md">
                  All {selectedNetwork} packages are temporarily placed on hold. Ordering will resume shortly. Thank you for your patience!
                </p>
              </div>
            );
          }

          // Group packages into rows of 2 so we can inject the panel after the correct row
          const rows: typeof packages[] = [];
          for (let i = 0; i < packages.length; i += 2) rows.push(packages.slice(i, i + 2));
          const selectedRowIdx = selectedPkg
            ? Math.floor(packages.findIndex(p => p.size === selectedPkg.size) / 2)
            : -1;

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-black text-white/80">{selectedNetwork} Bundles</p>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Tap a card to select</p>
              </div>

              <div className="space-y-3">
                {rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {row.map((pkg) => {
                        const isSelected = selectedPkg?.size === pkg.size;
                        return (
                          <button
                            type="button"
                            key={pkg.size}
                            onClick={() => handleCardClick(pkg.size, pkg.price)}
                            className={`relative rounded-[26px] p-5 text-left transition-all duration-300 border overflow-hidden group ${
                              isSelected
                                ? "scale-[1.02] shadow-2xl border-white/40 ring-4"
                                : "border-white/10 bg-white/[0.03] backdrop-blur-xl hover:bg-white/10 hover:border-white/20 hover:shadow-lg active:scale-[0.97]"
                            }`}
                            style={{
                              background: isSelected
                                ? `linear-gradient(145deg, ${netConf.color}, ${netConf.color}dd)`
                                : undefined,
                              boxShadow: isSelected ? `0 12px 30px ${netConf.color}45` : undefined,
                              borderColor: isSelected ? "rgba(255,255,255,0.6)" : undefined,
                              ringColor: isSelected ? `${netConf.color}40` : "transparent"
                            } as any}
                          >
                            {/* Inner Highlight for depth */}
                            <div className="absolute inset-0 rounded-[26px] pointer-events-none ring-1 ring-inset ring-white/10" />

                            {isSelected && (
                              <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                                <CheckCircle2 className="w-4 h-4 text-black drop-shadow-sm" />
                              </div>
                            )}
                            {pkg.popular && !isSelected && (
                              <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center backdrop-blur-md">
                                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                              </div>
                            )}
                            <p className={`text-[10px] font-black uppercase tracking-[0.15em] mb-1.5 ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "text-black/60" : "text-white/60") : "text-white/40 group-hover:text-white/60"}`}>
                              {selectedNetwork}
                            </p>
                            {(() => {
                              const display = formatPackageDisplay(pkg.size);
                              return (
                                <>
                                  <p className={`text-lg sm:text-xl font-black tracking-tighter leading-none mb-1.5 break-words ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "text-black" : "text-white") : "text-white"}`}>
                                    {display.main}
                                  </p>
                                  {display.sub && (
                                    <p className={`text-[9px] font-bold uppercase tracking-wider mb-4 ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "text-black/60" : "text-white/60") : "text-white/40"}`}>
                                      Official: {display.sub}
                                    </p>
                                  )}
                                  {!display.sub && <div className="h-4 mb-4" />}
                                </>
                              );
                            })()}
                            <div className={`pt-4 border-t ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "border-black/20" : "border-white/20") : "border-white/10"}`}>
                              <p className={`text-xl font-black tracking-tight ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "text-black" : "text-white") : "text-white/90"}`}>
                                GH₵ {pkg.price.toFixed(2)}
                              </p>
                              <p className={`text-[10px] font-bold mt-1 ${isSelected ? ((selectedNetwork === "MTN" || selectedNetwork === "MTN Mash Up") ? "text-black/50" : "text-white/50") : "text-white/30"}`}>
                                {(pkg.validity || "NO EXPIRY").toUpperCase()}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Panel injected right after the row containing the selected package */}
                    {selectedPkg && rowIdx === selectedRowIdx && renderPurchasePanel()}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Airtime Form ── */}
        {selectedService === "airtime" && (
          <div className="rounded-3xl border border-white/12 overflow-hidden p-6 space-y-6 animate-in fade-in duration-300 bg-[#0d0d12]/90 backdrop-blur-2xl">
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">Recipient Phone Number</Label>
                <div className="relative">
                  <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none z-10 ${isPhoneValid ? "text-emerald-400" : "text-white/30"}`} />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="e.g. 054 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={12}
                    className="w-full h-14 pl-11 rounded-[18px] bg-white/[0.04] border-white/10 text-white font-bold"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">Airtime Amount (GHS)</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-bold text-sm">₵</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Enter amount (min GHS 1)"
                    value={airtimeAmount}
                    onChange={(e) => setAirtimeAmount(e.target.value)}
                    className="w-full h-14 pl-8 rounded-[18px] bg-white/[0.04] border-white/10 text-white font-bold"
                  />
                </div>
              </div>

              {/* Quick Select Amounts */}
              <div className="grid grid-cols-6 gap-2">
                {[2, 5, 10, 20, 50, 100].map((amt) => (
                  <button
                    type="button"
                    key={amt}
                    onClick={() => setAirtimeAmount(String(amt))}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all active:scale-95 ${
                      Number(airtimeAmount) === amt
                        ? "bg-white text-black border-transparent shadow-md font-black"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    ₵{amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Checkout Pricing Panel */}
            {Number(airtimeAmount) >= 1 && (
              <div className="mt-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex justify-between text-xs text-white/50">
                  <span>Airtime Value:</span>
                  <span className="text-white font-bold">GH₵ {Number(airtimeAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-white/50">
                  <span>Platform Fee:</span>
                  <span className="text-emerald-400 font-bold">GH₵ 0.00</span>
                </div>
                <div className="border-t border-white/5 pt-3 flex justify-between text-sm">
                  <span className="font-bold text-white">Total Pay:</span>
                  <span className="font-black text-amber-400">GH₵ {Number(airtimeAmount).toFixed(2)}</span>
                </div>

                <button
                  type="button"
                  disabled={buying || !isPhoneValid}
                  onClick={() => handlePaystackBuy(false)}
                  className="w-full h-12 rounded-[16px] font-black text-sm uppercase tracking-wide text-black transition-all active:scale-[0.98] mt-2 flex items-center justify-center gap-2"
                  style={{ backgroundColor: accentColor }}
                >
                  {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Purchase Airtime"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Utility Form ── */}
        {selectedService === "utility" && (
          <div className="rounded-3xl border border-white/12 overflow-hidden p-6 space-y-6 animate-in fade-in duration-300 bg-[#0d0d12]/90 backdrop-blur-2xl">
            <div className="space-y-4">
              {/* Provider Selector */}
              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">Select Utility Provider</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "ECG", label: "ECG Electricity" },
                    { id: "GWCL", label: "Ghana Water (GWCL)" }
                  ].map((prov) => (
                    <button
                      type="button"
                      key={prov.id}
                      onClick={() => { setUtilityType(prov.id as "ECG" | "GWCL"); setUtilityNumber(""); setUtilityAmount(""); }}
                      className={`py-3.5 text-xs font-black uppercase tracking-wider rounded-[18px] border transition-all active:scale-95 ${
                        utilityType === prov.id
                          ? "bg-white text-black border-transparent shadow-xl"
                          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {prov.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meter / Account Number */}
              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">
                  {utilityType === "ECG" ? "ECG Meter Number" : "GWCL Account Number"}
                </Label>
                <Input
                  type="text"
                  placeholder={utilityType === "ECG" ? "Enter ECG meter number" : "Enter GWCL account number"}
                  value={utilityNumber}
                  onChange={(e) => setUtilityNumber(e.target.value)}
                  className="w-full h-14 pl-4 rounded-[18px] bg-white/[0.04] border-white/10 text-white font-bold"
                />
              </div>

              {/* Bill Amount */}
              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">Bill Amount (GHS)</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-bold text-sm">₵</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Enter bill amount"
                    value={utilityAmount}
                    onChange={(e) => setUtilityAmount(e.target.value)}
                    className="w-full h-14 pl-8 rounded-[18px] bg-white/[0.04] border-white/10 text-white font-bold"
                  />
                </div>
              </div>

              {/* Recipient Phone (for receipt / Momo payment) */}
              <div>
                <Label className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 block">Customer Phone Number (for updates)</Label>
                <div className="relative">
                  <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none z-10 ${isPhoneValid ? "text-emerald-400" : "text-white/30"}`} />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="e.g. 054 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={12}
                    className="w-full h-14 pl-11 rounded-[18px] bg-white/[0.04] border-white/10 text-white font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Pricing Panel */}
            {Number(utilityAmount) >= 1 && utilityNumber.length >= 5 && (
              <div className="mt-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex justify-between text-xs text-white/50">
                  <span>Bill Value:</span>
                  <span className="text-white font-bold">GH₵ {Number(utilityAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-white/50">
                  <span>Platform Fee:</span>
                  <span className="text-emerald-400 font-bold">GH₵ 0.00</span>
                </div>
                <div className="border-t border-white/5 pt-3 flex justify-between text-sm">
                  <span className="font-bold text-white">Total Pay:</span>
                  <span className="font-black text-amber-400">GH₵ {Number(utilityAmount).toFixed(2)}</span>
                </div>

                <button
                  type="button"
                  disabled={buying || !isPhoneValid}
                  onClick={() => handlePaystackBuy(false)}
                  className="w-full h-12 rounded-[16px] font-black text-sm uppercase tracking-wide text-black transition-all active:scale-[0.98] mt-2 flex items-center justify-center gap-2"
                  style={{ backgroundColor: accentColor }}
                >
                  {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : `Pay ${utilityType} Bill`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Order Tracker ── */}
        <div className="pt-2" id="track-section">
          <PhoneOrderTracker
            title="Track Your Order"
            subtitle="Enter your phone number to check delivery status."
          />
        </div>

        {/* ── Sub-agent CTA (for main agents only) ── */}
        {!agent.is_sub_agent && (
          <div
            className="rounded-3xl p-5 border border-white/12 relative overflow-hidden shadow-xl"
            style={{ background: `linear-gradient(135deg, ${accentColor}20, transparent)` }}
          >
            <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: accentColor }}>Reseller Opportunity</p>
            <h3 className="text-xl font-black text-white mb-1">Start Your Own Store</h3>
            <p className="text-white/50 text-sm mb-4 leading-relaxed">
              Earn profits reselling under <span className="text-white/80 font-bold">{agent.store_name}</span>.
              {subAgentBaseFee !== null && <> Activation fee: <span className="text-white font-black">GH₵ {subAgentBaseFee.toFixed(2)}</span>.</>}
            </p>
            <Link
              to={`/store/${slug}/sub-agent`}
              className="inline-flex items-center gap-2 font-black text-sm px-5 py-2.5 rounded-2xl text-black transition-all hover:opacity-90 active:scale-95 shadow-md"
              style={{ backgroundColor: accentColor }}
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="pt-8 border-t border-white/10 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center shadow-md" style={{ backgroundColor: accentColor }}>
              <Store className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-black text-sm text-white">{agent.store_name}</span>
          </div>
          <div className="flex items-center justify-center gap-4">
            {agent.whatsapp_number && (
              <a href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`} className="text-[11px] text-white/40 hover:text-white transition-colors font-bold">WhatsApp Support</a>
            )}
            {agent.support_number && (
              <a href={`tel:${agent.support_number}`} className="text-[11px] text-white/40 hover:text-white transition-colors font-bold">{agent.support_number}</a>
            )}
          </div>
          <p className="text-[10px] text-white/20 font-bold pt-1">© {new Date().getFullYear()} {agent.store_name} · Secure Payments by Paystack</p>
        </footer>
      </main>


      {/* ── Success overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full bg-[#0A0A0C] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 animate-in zoom-in-95 duration-300 shadow-3xl">
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
            <div>
              <h2 className="text-3xl font-black text-white mb-2">Done!</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                Your <strong className="text-emerald-400">{selectedPkg?.size} {selectedNetwork}</strong> bundle is on its way. Check your phone shortly!
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowSuccessOverlay(false); setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
              className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all"
            >
              Close
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

      {/* ── Store Authentication Modal Overlay ── */}
      <StoreAuth
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        agentId={agent.user_id}
        storeName={agent.store_name}
        primaryColor={accentColor}
      />

      <StoreDepositFlow
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        agentId={agent.user_id}
        initialPhone={profile?.momo_number || profile?.phone || phone}
        accentColor={accentColor}
        onSuccess={() => {
          refreshProfile();
          fetchWalletBalance();
        }}
      />

      <StoreTransactionHistory
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        customerId={profile?.user_id || ""}
        customerPhone={profile?.momo_number || profile?.phone || phone}
        accentColor={accentColor}
      />

      {/* ── Floating WhatsApp ── */}
      {agent.whatsapp_number && (
        <a
          href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
          target="_blank" rel="noopener noreferrer"
          aria-label={`Chat with ${agent.store_name} on WhatsApp`}
          className="fixed right-4 bottom-6 z-[100] transition-all duration-300"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#25D366] flex items-center justify-center shadow-xl shadow-emerald-500/30 hover:scale-110 active:scale-95 transition-all">
            <MessageCircle className="w-6 h-6 text-white fill-white/20" />
          </div>
        </a>
      )}

      {profile && (profile.user_id === agent?.user_id || profile.is_agent || profile.is_sub_agent) && (
        <button
          onClick={() => {
            if (profile.user_id === agent?.user_id) {
              setManageOpen(true);
            } else {
              window.open("/dashboard", "_blank");
            }
          }}
          className="fixed left-4 bottom-6 z-[100] animate-bounce shrink-0 select-none outline-none"
        >
          <div className="flex items-center gap-2 h-12 px-4 rounded-2xl bg-amber-400 text-black shadow-xl shadow-amber-400/25 hover:scale-105 active:scale-95 transition-all font-black text-xs uppercase tracking-widest border border-amber-500/30">
            <Store className="w-5 h-5 shrink-0 animate-pulse" />
            {profile.user_id === agent?.user_id ? "Manage Storefront" : "Reseller Dashboard"}
          </div>
        </button>
      )}

      {/* ── Inline Store Management Overlay ── */}
      {profile?.user_id === agent?.user_id && (
        <StoreManagementOverlay
          isOpen={manageOpen}
          onClose={() => setManageOpen(false)}
          agentId={agent.user_id}
          currentStoreName={agent.store_name}
          currentWhatsapp={agent.whatsapp_number || ""}
          currentSupport={agent.support_number || ""}
          accentColor={accentColor}
          onSuccess={() => {
            // Can optionally reload or refresh agent data here
            window.location.reload();
          }}
        />
      )}

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={total}
        email={profile?.email || ""}
        recipientPhone={phoneDigits}
        recipientNetwork={selectedNetwork}
        metadata={checkoutMetadata}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />

      {/* Beneficiary Warning Modal */}
      <Dialog open={showBeneficiaryModal} onOpenChange={(open) => {
        setShowBeneficiaryModal(open);
        if (!open) setPendingAction(null);
      }}>
        <DialogContent className="max-w-md bg-white text-black p-6 rounded-[28px] border-none shadow-2xl flex flex-col gap-6">
          <DialogHeader className="sr-only">
            <DialogTitle>New beneficiary number detected!</DialogTitle>
            <DialogDescription>Carrier beneficiary list warning modal</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-[#E0560D] shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                New beneficiary number detected!
              </h2>
            </div>
          </div>

          <div className="rounded-[20px] bg-amber-50/70 border border-amber-200/60 p-5 text-sm text-slate-700 leading-relaxed font-medium space-y-4">
            <p>
              The phone number <strong className="font-extrabold text-black font-mono">{beneficiaryModalPhone}</strong> is not added to our beneficiary list at the moment.
            </p>
            {allowNonBeneficiaryContinue ? (
              <>
                <p>
                  If you continue, this order will be submitted and held for beneficiary processing. <span className="text-[#E0560D] font-bold">You can proceed safely if you wish.</span>
                </p>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 font-bold text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  ✓ 100% Instant Auto-Refund Protection Active — If fulfillment fails, your money is automatically returned to your wallet balance instantly.
                </div>
              </>
            ) : (
              <p className="text-[#B91C1C] font-bold">
                Purchases for non-beneficiary numbers are currently disabled by the administrator. You cannot proceed with this purchase until this recipient number is whitelisted.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => {
                setShowBeneficiaryModal(false);
                setPendingAction(null);
              }}
              className={`py-4 bg-[#E5E7EB] hover:bg-[#D1D5DB] active:scale-[0.98] transition-all text-[#4B5563] font-extrabold rounded-[20px] text-sm tracking-wide shadow-sm ${!allowNonBeneficiaryContinue ? "col-span-2 w-full" : "w-full"}`}
            >
              {allowNonBeneficiaryContinue ? "Cancel" : "Close"}
            </button>
            {allowNonBeneficiaryContinue && (
              <button
                type="button"
                onClick={() => {
                  setShowBeneficiaryModal(false);
                  const method = pendingAction || payMethod;
                  if (method === "wallet") {
                    handleWalletBuy(true);
                  } else if (method === "paystack") {
                    handlePaystackBuy(true);
                  }
                  setPendingAction(null);
                }}
                className="w-full py-4 bg-[#E0560D] hover:bg-[#C2410C] active:scale-[0.98] transition-all text-white font-extrabold rounded-[20px] text-sm tracking-wide shadow-md"
              >
                Continue Anyway
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentStore;
