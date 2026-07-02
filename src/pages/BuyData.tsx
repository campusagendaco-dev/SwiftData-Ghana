import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { ShieldCheck, Zap, Loader2, AlertTriangle, X, CreditCard, Gift, Tag, CheckCircle2, Clock } from "lucide-react";
import { basePackages, getPublicPrice } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction } from "@/lib/public-function-client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppTheme } from "@/contexts/ThemeContext";
import SEO from "@/components/SEO";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import LiveDeliveryBadge from "@/components/LiveDeliveryBadge";
import BundleSelectorDropdown from "@/components/BundleSelectorDropdown";

const NETWORK_GLASS_ACTIVE: Record<string, Record<string, string>> = {
  MTN: {
    background: "linear-gradient(135deg, rgba(251,191,36,0.92) 0%, rgba(245,158,11,0.88) 100%)",
    boxShadow: "0 4px 18px rgba(251,191,36,0.38), inset 0 1px 0 rgba(255,255,255,0.35)",
    color: "#000",
  },
  Telecel: {
    background: "linear-gradient(135deg, rgba(220,38,38,0.9) 0%, rgba(185,28,28,0.86) 100%)",
    boxShadow: "0 4px 18px rgba(220,38,38,0.32), inset 0 1px 0 rgba(255,255,255,0.18)",
    color: "#fff",
  },
  AirtelTigo: {
    background: "linear-gradient(135deg, rgba(37,99,235,0.9) 0%, rgba(29,78,216,0.86) 100%)",
    boxShadow: "0 4px 18px rgba(37,99,235,0.32), inset 0 1px 0 rgba(255,255,255,0.18)",
    color: "#fff",
  },
};

interface PromoResult {
  valid: boolean;
  promo_id?: string;
  code?: string;
  discount_percentage?: number;
  is_free?: boolean;
  error?: string;
}

type NetworkName = "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  public_price: number | null;
  is_unavailable: boolean;
}

const networkTabStyles: Record<NetworkName, { active: string; idle: string }> = {
  MTN: { active: "bg-amber-400 text-black border-amber-400", idle: "border-border hover:border-amber-400/50" },
  "MTN Mash Up": { active: "bg-amber-500 text-black border-amber-500", idle: "border-border hover:border-amber-500/50" },
  Telecel: { active: "bg-red-600 text-white border-red-600", idle: "border-border hover:border-red-400/50" },
  AirtelTigo: { active: "bg-blue-600 text-white border-blue-600", idle: "border-border hover:border-blue-400/50" },
};

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

const getPackageDetails = (pkg: any): string => {
  const size = pkg.size || "";
  const category = pkg.category || "";
  const rawData = pkg.rawData || {};
  const productId = rawData.product_id || rawData.bundle_id || "";

  if (productId.includes("Kokrokoo")) {
    return "400MB + 20 Mins Call (5am - 8am)";
  }
  
  if (category.toLowerCase().includes("midnight") || String(rawData.category).toLowerCase().includes("midnight") || String(rawData.category).toLowerCase().includes("night")) {
    return rawData.validity || "Midnight Bundle (12am - 5am)";
  }

  if (category.toLowerCase().includes("social") || String(rawData.category).toLowerCase().includes("social")) {
    return "Social Media (WhatsApp, FB, etc.)";
  }

  if (category.toLowerCase().includes("video") || String(rawData.category).toLowerCase().includes("video")) {
    return "Video Bundle (YouTube, TikTok, etc.)";
  }

  if (pkg.validity === "MTN Mash Up") {
    return "MTN Mash Up voice + data";
  }

  if (rawData.validity) {
    return rawData.validity;
  }

  return "";
};

const BuyData = () => {
  const { toast } = useToast();
  const { theme, isDark } = useAppTheme();
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);
  const [email, setEmail] = useState("");
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [pkgLoading, setPkgLoading] = useState(true);
  const [holidayMode, setHolidayMode] = useState(false);
  const [holidayMessage, setHolidayMessage] = useState("");
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const [priceMultipliers, setPriceMultipliers] = useState<Record<string, number>>({ MTN: 1, Telecel: 1, AirtelTigo: 1 });
  const [networkStatusMap, setNetworkStatusMap] = useState<Record<string, string>>({});
  const [activeGateway, setActiveGateway] = useState<string>("paystack");
  const [korbaMappings, setKorbaMappings] = useState<{ package_name: string; network: string; raw_data: any }[]>([]);
  const [selectedTypeOrCategory, setSelectedTypeOrCategory] = useState<string>("affordable");
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const promoInputRef = useRef<HTMLInputElement>(null);

  // Promo code state
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvingName, setResolvingName] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);

  // Traditional Adinkra symbols cycling state
  const adinkraSymbols = useMemo(() => [
    {
      name: "Gye Nyame",
      meaning: "Except for God",
      path: "M20.763 5.13303C20.732 9.04703 20.236 11.724 18.317 14.581C16.398 17.438 13.117 18.145 12.731 16.544C12.345 14.943 16.519 15.361 17.114 13.954C17.2395 13.683 17.2812 13.3807 17.2338 13.0858C17.1864 12.791 17.052 12.517 16.8479 12.2989C16.6438 12.0809 16.3794 11.9287 16.0883 11.8619C15.7972 11.7951 15.4927 11.8168 15.214 11.924C14.032 12.257 12.438 13.235 13.124 11.724C13.81 10.213 17.731 10.589 17.185 8.18702C16.639 5.78502 14.005 8.83503 13.385 8.43403C12.833 8.07703 13.2851 7.41002 13.9851 6.54902C15.3551 5.07302 16.7761 5.19703 16.9591 3.89903C17.1421 2.60103 16.024 1.44602 14.185 1.73502C12.346 2.02402 12.376 3.98403 11.409 3.89903C10.442 3.81403 11.0231 1.59102 9.64406 1.13102C9.3752 1.01368 9.08332 0.958399 8.79017 0.969307C8.49703 0.980215 8.21015 1.05704 7.95076 1.19404C7.69137 1.33104 7.46617 1.5247 7.29188 1.76066C7.1176 1.99662 6.99871 2.26881 6.94404 2.55701C6.89749 2.84792 6.91833 3.14566 7.00502 3.42722C7.09171 3.70879 7.24193 3.96666 7.44404 4.18101C5.82804 4.60401 3.58503 5.90901 2.48903 9.52601C1.63593 12.6298 1.89777 15.9344 3.22902 18.865C3.26002 14.951 3.756 12.275 5.675 9.41703C7.594 6.55903 10.8751 5.85202 11.2611 7.45402C11.6471 9.05602 7.473 8.63601 6.878 10.044C6.75255 10.315 6.71091 10.6173 6.75831 10.9122C6.80572 11.2071 6.94004 11.4811 7.14412 11.6991C7.3482 11.9172 7.61273 12.0693 7.90382 12.1361C8.19491 12.2029 8.4993 12.1813 8.77803 12.074C9.96003 11.741 11.5541 10.762 10.8681 12.274C10.1821 13.786 6.26202 13.409 6.80702 15.812C7.35202 18.215 9.98701 15.164 10.607 15.565C11.158 15.922 10.707 16.589 10.007 17.449C8.63603 18.926 7.21506 18.802 7.03206 20.1C6.84906 21.398 7.96704 22.552 9.80604 22.264C11.645 21.976 11.616 20.015 12.582 20.1C13.548 20.185 12.9681 22.408 14.3471 22.868C14.6159 22.9854 14.9077 23.0406 15.2009 23.0297C15.494 23.0188 15.7809 22.942 16.0403 22.805C16.2997 22.668 16.5249 22.4743 16.6992 22.2384C16.8735 22.0024 16.9923 21.7302 17.047 21.442C17.0935 21.1511 17.0726 20.8534 16.9859 20.5719C16.8992 20.2903 16.7491 20.0324 16.547 19.818C18.163 19.395 20.406 18.089 21.502 14.472C22.3554 11.3684 22.0939 8.06382 20.763 5.13303Z"
    },
    {
      name: "Sankofa",
      meaning: "Retrieve from the past",
      path: "M19.6709 9.689C19.5889 9.289 22.2649 8.92599 22.4889 7.74199C22.7129 6.55799 19.075 9.198 18.668 8.989C18.261 8.78 21.1299 7.18899 20.9369 5.58899C20.7439 3.98899 17.548 9.30299 17.08 8.92699C16.612 8.55099 19.7399 5.554 19.1999 3.766C18.6599 1.978 16.606 7.7 15.053 9.30899C14.2063 10.0785 13.1784 10.6208 12.0653 10.8854C10.9522 11.15 9.79034 11.1282 8.68798 10.822C7.77921 10.6882 6.90711 10.371 6.12475 9.88961C5.34239 9.40826 4.6661 8.77285 4.13696 8.02199C3.38296 6.82999 3.78991 4.95 6.15991 4.903C8.52991 4.856 9.93591 8.765 9.93591 8.765L10.36 7.318L11.37 8.247C11.37 8.247 11.718 7.847 11.688 6.304C11.658 4.761 11.288 1.519 7.20996 2.049C3.13196 2.579 0.366953 7.59099 1.13195 11.363C1.89695 15.135 6.28997 18.754 9.77697 19.106C10.0281 19.1318 10.2805 19.1431 10.533 19.14V21.014H9.02099C8.88871 21.0113 8.76075 21.0612 8.66516 21.1526C8.56956 21.2441 8.51413 21.3697 8.51098 21.502C8.51413 21.6343 8.56956 21.7599 8.66516 21.8514C8.76075 21.9428 8.88871 21.9927 9.02099 21.99H15.7489C15.8812 21.9927 16.0091 21.9428 16.1047 21.8514C16.2003 21.7599 16.2558 21.6343 16.2589 21.502C16.2558 21.3697 16.2003 21.2441 16.1047 21.1526C16.0091 21.0612 15.8812 21.0113 15.7489 21.014H14.2369V18.002H14.1909C14.5114 17.809 14.8712 17.6903 15.2436 17.6549C15.6161 17.6194 15.9917 17.668 16.3429 17.797C16.2258 17.1142 16.1501 16.4249 16.116 15.733C16.17 15.686 17.6159 16.258 17.6809 16.222C17.7459 16.186 17.2629 14.893 17.4619 14.722C17.6609 14.551 18.562 14.81 18.673 14.79C18.784 14.77 18.4659 13.855 18.2439 13.535C18.0219 13.215 19.2939 13.258 19.3009 13.063C19.3079 12.868 18.8559 12.417 18.4299 12.283C18.0039 12.149 19.868 11.892 20.052 11.748C20.236 11.604 19.557 10.914 19.704 10.868C19.851 10.822 22.1039 10.789 22.8979 10.068C23.6919 9.347 19.7499 10.09 19.6709 9.689ZM1.88 10.262C1.64 9.362 2.93899 8.7 3.61499 9.236C3.26556 9.26049 2.92652 9.36594 2.62487 9.54401C2.32323 9.72208 2.06721 9.96789 1.87695 10.262H1.88ZM2.38 11.829C1.865 10.6 3.5699 9.435 4.6289 10.071C4.14096 10.1662 3.68231 10.375 3.29003 10.6804C2.89776 10.9858 2.58294 11.3793 2.37097 11.829H2.38ZM3.328 13.676C2.311 12.294 4.073 10.368 5.583 10.86C5.00855 11.1146 4.50337 11.5031 4.10998 11.9931C3.71659 12.483 3.44635 13.0601 3.32189 13.676H3.328ZM4.78491 15.405C3.37191 13.642 5.57596 11.022 7.58496 11.59C6.84611 11.9542 6.2056 12.4905 5.71728 13.1539C5.22897 13.8173 4.90711 14.5883 4.77893 15.402L4.78491 15.405ZM13.0279 21.023H11.7429V19.002C12.1849 18.8984 12.6155 18.7507 13.0279 18.561V21.023ZM11.88 17.717C9.451 18.375 6.52397 16.017 6.71997 15.823C7.62997 14.553 10.331 17.535 11.606 16.865C12.881 16.195 6.94997 15.23 7.09997 14.248C7.24997 13.266 13.407 16.52 13.808 15.717C14.209 14.914 7.56593 13.952 8.00793 13.112C8.44993 12.272 14.992 15.112 15.292 14.119C15.592 13.126 8.69789 12.757 8.61889 12.119C8.53989 11.481 15.8639 12.071 16.2989 13.019C16.7339 13.967 14.303 17.059 11.871 17.717H11.88ZM16.8199 11.724C16.6649 12.124 15.1739 11.565 15.1659 10.816C15.1579 10.067 16.5399 9.36599 16.7899 9.70499C17.0399 10.044 16.253 10.344 16.231 10.834C16.203 11.36 16.9709 11.327 16.8149 11.724H16.8199ZM18.428 10.978C18.344 11.055 17.737 10.828 17.563 10.618C17.389 10.408 18.1989 9.697 18.2849 10.066C18.3709 10.435 18.507 10.902 18.423 10.978H18.428Z"
    },
    {
      name: "Adinkrahene",
      meaning: "King of Adinkra symbols (Greatness)",
      path: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 17a7 7 0 110-14 7 7 0 010 14zm0-11a4 4 0 100 8 4 4 0 000-8z"
    },
    {
      name: "Osram ne Nsoromma",
      meaning: "The moon and the star (Love & Harmony)",
      path: "M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 7.5-3.4 9 9 0 1 1-1.1-13.2A10 10 0 0 0 12 2zm6 3.5l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z"
    }
  ], []);

  const [adinkraIndex, setAdinkraIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setAdinkraIndex((prev) => (prev + 1) % adinkraSymbols.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [adinkraSymbols.length]);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;

  useEffect(() => {
    const load = async () => {
      setPkgLoading(true);
      const [{ data }, { data: sys }, pricingCtx, { data: svc }, { data: mappings }] = await Promise.all([
        supabase.from("global_package_settings").select("network, package_size, public_price, is_unavailable"),
        supabase.functions.invoke("system-settings", { body: { action: "get" } }),
        fetchApiPricingContext(),
        supabase.from("service_status").select("network, status"),
        supabase.from("provider_packages").select("package_name, network, raw_data").eq("provider_id", "1177b72a-a2d7-462d-9366-9dde6e83ccd7")
      ]);
      const map: Record<string, GlobalPkgSetting> = {};
      (data || []).forEach((r: any) => { 
        const normSize = r.package_size.replace(/\s+/g, "").toUpperCase();
        map[`${r.network}-${normSize}`] = r; 
      });
      setGlobalSettings(map);
      if (mappings) {
        setKorbaMappings(mappings);
      }

      const svcMap: Record<string, string> = {};
      (svc || []).forEach((s: any) => { svcMap[s.network.toUpperCase()] = s.status; });
      setNetworkStatusMap(svcMap);
      if (sys) {
        setHolidayMode(Boolean(sys.holiday_mode_enabled));
        setHolidayMessage(String(sys.holiday_message || "Holiday mode active. Orders will resume soon."));
        setOrderingDisabled(Boolean(sys.disable_ordering));
        if (sys.active_payment_gateway) {
          setActiveGateway(sys.active_payment_gateway);
        }
      }
      setPriceMultipliers(pricingCtx.multipliers);
      setPkgLoading(false);
    };
    load();
  }, []);

  useEffect(() => { 
    setSelectedPkg(null); 
    setPhone(""); 
    setEmail(""); 
    setResolvedName(null);
    setSelectedTypeOrCategory("affordable");
  }, [selectedNetwork]);

  const lastAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    setResolvedName(null);
    lastAttemptRef.current = null;
  }, [phone]);

  // Auto-focus phone input on modal open for blazing fast speeds
  useEffect(() => {
    if (selectedPkg) {
      setTimeout(() => phoneInputRef.current?.focus(), 100);
    }
  }, [selectedPkg]);

  // Auto-resolve recipient name
  useEffect(() => {
    const attemptKey = `${selectedNetwork}-${phoneDigits}`;
    if (!isPhoneValid || resolvedName || resolvingName || lastAttemptRef.current === attemptKey) return;

    const timer = setTimeout(async () => {
      setResolvingName(true);
      try {
        let bankCode = "MTN";
        const net = selectedNetwork.toUpperCase();
        if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
        if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: phoneDigits, bank_code: bankCode }
        });
        lastAttemptRef.current = attemptKey;
        if (!error && data?.success) {
          setResolvedName(data.account_name);
        }
      } catch (e) {
        console.error("Auto-resolution failed:", e);
        lastAttemptRef.current = attemptKey;
      } finally {
        setResolvingName(false);
      }
    }, 300); // 300ms debounce for faster response

    return () => clearTimeout(timer);
  }, [selectedNetwork, isPhoneValid, resolvedName, resolvingName, phoneDigits]);

  // Get packages for current network and purchase type
  const displayPackages = useMemo(() => {
    const list: { size: string; price: number; validity: string; popular?: boolean; isInstant?: boolean; category?: string; rawData?: any }[] = [];
    const dbNetwork = selectedNetwork;

    // 1. Get standard base packages (which are Affordable by default)
    const baseList = basePackages[dbNetwork] || [];
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
            category: mapping?.raw_data?.category || (gs.network === "MTN Mash Up" ? "Mash Up Bundles" : "Data Bundles"),
            rawData: mapping?.raw_data
          });
        }
      }
    });

    // 3. Process prices, unavailable states
    const processed = list
      .map((pkg) => {
        const normSize = pkg.size.replace(/\s+/g, "").toUpperCase();
        
        // Find in global settings
        let gs = globalSettings[`${dbNetwork}-${normSize}`];
        if (!gs && dbNetwork === "MTN") {
          gs = globalSettings[`MTN Mash Up-${normSize}`];
        }

        if (gs?.is_unavailable) return null;
        
        const base = gs?.public_price ?? getPublicPrice(pkg.price);
        const multiplier = priceMultipliers[dbNetwork] || (dbNetwork.includes("MTN") ? priceMultipliers["MTN"] : 1) || 1;
        const price = applyPriceMultiplier(base, multiplier);

        // Re-check mapping for isInstant (needed if the package was from basePackages but later mapped to Korba)
        const mapping = korbaMappings.find(
          m => m.package_name === pkg.size && 
               (m.network === dbNetwork || (dbNetwork === "MTN" && m.network === "MTN Mash Up"))
        );
        const isInstant = !!mapping;
        const category = mapping?.raw_data?.category || (pkg.validity === "MTN Mash Up" ? "Mash Up Bundles" : "Data Bundles");
        const rawData = mapping?.raw_data;

        return {
          ...pkg,
          price,
          isInstant,
          category,
          rawData
        };
      })
      .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean; isInstant: boolean; category: string; rawData?: any }[];

    processed.sort((a, b) => a.price - b.price);
    return processed;
  }, [basePackages, selectedNetwork, globalSettings, priceMultipliers, korbaMappings]);

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

  // Apply promo discount to price
  const validPromo = promoResult?.valid ? promoResult : null;
  const discountPct = validPromo?.discount_percentage ?? 0;
  const isFreePromo = validPromo?.is_free === true;
  const discountedPkgPrice = selectedPkg
    ? isFreePromo ? 0 : parseFloat((selectedPkg.price * (1 - discountPct / 100)).toFixed(2))
    : 0;
  const fee = isFreePromo ? 0 : (selectedPkg ? calcFee(discountedPkgPrice) : 0);
  const total = selectedPkg ? parseFloat((discountedPkgPrice + fee).toFixed(2)) : 0;

  const handleCardClick = useCallback((size: string, price: number) => {
    setSelectedPkg((prev) => (prev?.size === size ? null : { size, price }));
    setPromoResult(null); setPromoCode(""); setPromoOpen(false);
    setTimeout(() => phoneInputRef.current?.focus(), 120);
  }, []);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    if (!isPhoneValid) {
      toast({ title: "Enter your phone number first", description: "We need it to check if you've already used this code.", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setPromoValidating(true);
    setPromoResult(null);
    const { data, error } = await invokePublicFunction("validate-promo", {
      body: { code: promoCode.trim(), phone: phoneDigits },
    });
    setPromoValidating(false);
    if (error || !data) {
      setPromoResult({ valid: false, error: "Could not validate code. Try again." });
      return;
    }
    setPromoResult(data as PromoResult);
    if (data.valid && data.is_free) {
      toast({ title: "Free data code applied!", description: `${promoCode.trim().toUpperCase()} — your bundle is FREE. Tap Claim!` });
    } else if (data.valid) {
      toast({ title: `${data.discount_percentage}% discount applied!`, description: `Code: ${promoCode.trim().toUpperCase()}` });
    }
  };

  const handleClaimFree = async () => {
    if (!selectedPkg || !validPromo?.is_free) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    if (orderingDisabled) {
      toast({ title: "Ordering disabled", description: holidayMessage, variant: "destructive" });
      return;
    }
    setClaiming(true);
    const { data, error } = await invokePublicFunction("claim-free-data", {
      body: {
        promo_code: promoCode.trim(),
        phone: phoneDigits,
        network: selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork,
        package_size: selectedPkg.size,
      },
    });
    setClaiming(false);
    if (error || !data) {
      toast({ title: "Claim failed", description: "Could not process your free data claim. Try again.", variant: "destructive" });
      return;
    }
    if (data.success) {
      toast({ title: "Free data sent!", description: `Your ${selectedPkg.size} ${selectedNetwork} bundle is on its way!` });
      setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false);
    } else {
      toast({ title: "Claim failed", description: data.error || "Delivery failed. Contact support with ref: " + (data.order_id || "unknown"), variant: "destructive" });
      setPromoResult(null); setPromoCode(""); // reset so they can try another code
    }
  };

  const handlePay = async () => {
    if (!selectedPkg) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    if (orderingDisabled) {
      toast({ title: "Ordering disabled", description: holidayMessage, variant: "destructive" });
      return;
    }
    
    // Active System Check for Network Status
    let netKey = selectedNetwork.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : selectedNetwork.toUpperCase();
    if (selectedNetwork.toUpperCase().includes("MTN")) netKey = "MTN";
    if (networkStatusMap[netKey] === "down") {
      toast({ title: "Network Down", description: `${selectedNetwork} is currently unavailable. Please try another network.`, variant: "destructive" });
      return;
    }

    const orderNetwork = selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork;
    const orderId = crypto.randomUUID();
    const callbackParams = new URLSearchParams({
      reference: orderId,
      network: orderNetwork,
      package: selectedPkg.size,
      phone: phoneDigits,
    });

    const meta = {
      order_id: orderId,
      order_type: "data",
      network: orderNetwork,
      package_size: selectedPkg.size,
      customer_phone: phoneDigits,
      customer_name: resolvedName,
      fee,
      payment_source: "direct",
      is_korba: korbaMappings.some((m: any) => m.network === selectedNetwork && m.package_name === selectedPkg.size),
      callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
      ...(validPromo && !validPromo.is_free ? {
        promo_code: promoCode.trim(),
        promo_id: validPromo.promo_id,
        discount_percentage: validPromo.discount_percentage,
      } : {}),
    };

    setCheckoutMetadata(meta);
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setSelectedPkg(null);
    setPhone("");
    setEmail("");
    setPromoCode("");
    setPromoResult(null);
    setPromoOpen(false);
    
    const callbackParams = new URLSearchParams({
      reference: ref,
      network: selectedTypeOrCategory === "mashup" ? "MTN Mash Up" : selectedNetwork,
      package: selectedPkg?.size || "",
      phone: phoneDigits,
    });
    
    window.location.href = `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setBuying(false);
  };

  const colors = getNetworkCardColors(selectedNetwork);
  
  const memoizedGrid = useMemo(() => {
    if (packages.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-amber-500/20 bg-amber-500/[0.02] rounded-3xl">
          <div className="relative flex items-center justify-center mb-4">
            <span className="absolute inline-flex h-16 w-16 rounded-full bg-amber-500/20 animate-ping" />
            <div className="relative w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20 shadow-[0_10px_30px_rgba(245,158,11,0.05)]">
              <Clock className="w-7 h-7 text-amber-500 animate-spin-slow" />
            </div>
          </div>
          <h3 className="text-lg font-black text-foreground mb-2 uppercase tracking-wide">{selectedNetwork} On Hold</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            All {selectedNetwork} packages are temporarily placed on hold. Ordering will resume shortly. Thank you for your patience!
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {packages.map((pkg) => {
          const isSelected = selectedPkg?.size === pkg.size;
          return (
            <button
              key={pkg.size}
              onClick={() => handleCardClick(pkg.size, pkg.price)}
              className={`${colors.card} rounded-2xl p-4 sm:p-5 flex flex-col gap-2.5 border-2 text-left transition-all duration-200 relative ${
                isSelected
                  ? "border-white/80 shadow-2xl scale-[1.04]"
                  : "border-transparent hover:border-white/30 hover:scale-[1.02]"
              }`}
            >
              {/* Selected indicator */}
              {isSelected && (
                <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow">
                  <span className="w-2.5 h-2.5 rounded-full bg-black" />
                </span>
              )}
              {pkg.popular && !isSelected && (
                <span className="absolute top-2 right-2 text-[9px] font-black bg-black/25 text-white px-1.5 py-0.5 rounded">
                  HOT
                </span>
              )}
              <span className={`${colors.label} text-[11px] font-bold uppercase tracking-wide opacity-70`}>{selectedNetwork}</span>
              
              {(() => {
                const display = formatPackageDisplay(pkg.size);
                const details = getPackageDetails(pkg);
                return (
                  <div className="flex flex-col gap-0.5">
                    <p className={`${colors.size} text-lg sm:text-xl font-black leading-tight tracking-tight break-words`}>
                      {display.main}
                    </p>
                    {display.sub && (
                      <p className={`${colors.label} text-[9px] font-bold opacity-75 uppercase`}>
                        Official: {display.sub}
                      </p>
                    )}
                    {details && (
                      <p className="text-[10px] font-bold text-emerald-500 dark:text-emerald-400 mt-0.5 leading-snug uppercase">
                        {details}
                      </p>
                    )}
                    <p className={`${colors.size} text-sm sm:text-base font-black opacity-90 mt-1`}>
                      ₵{pkg.price.toFixed(2)}
                    </p>
                  </div>
                );
              })()}
              
              <div className="mt-auto pt-1">
                <p className={`${colors.label} text-[9px] font-medium uppercase tracking-wider opacity-60`}>{pkg.validity || "No Expiry"}</p>
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [packages, selectedPkg?.size, colors, handleCardClick, selectedNetwork]);

  return (
    <div className="min-h-screen pt-12 md:pt-20 pb-24 transition-all duration-300">
      <SEO 
        title="Buy Cheap Data Bundles — MTN, Telecel & AirtelTigo"
        description="Select your network and buy cheap non-expiry data bundles in Ghana. We support MTN, Telecel and AirtelTigo with instant delivery."
        keywords="buy MTN data Ghana, buy Telecel data, buy AirtelTigo data, cheap data bundles, non-expiry data"
        canonical="https://swiftdatagh.shop/buy-data"

      />
      {/* Hero header */}
      <div className="text-white py-6 md:py-10 px-4 mb-4 md:mb-6" style={{ background: theme.heroHex }}>
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold uppercase tracking-widest">No Account Needed</span>
          </div>
          <h1 className="font-display text-3xl md:text-5xl font-black mb-2">Buy Data Bundles</h1>
          <p className="text-white/60 text-sm md:text-base max-w-lg">
            Pick a network, tap a bundle &amp; pay instantly with card or mobile money.
          </p>
          <LiveDeliveryBadge />
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs text-white/45">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant delivery</span>
            <span className="flex items-center gap-1.5">📦 Non-expiry bundles</span>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4">
        {/* Warning bar */}
        <div
          className="mb-5 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs font-medium"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(252,165,165)" }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Delivery times vary &bull; No refunds for wrong numbers &bull;{" "}
          <Link to="/order-status" className="underline underline-offset-2">Track order</Link>
        </div>

        {holidayMode && (
          <div className="mb-5 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-300">
            {holidayMessage}
          </div>
        )}

        {/* ── Glassmorphic network tab bar ── */}
        <div
          className="flex gap-1.5 p-1.5 mb-5 sm:mb-6 rounded-2xl"
          style={{
            background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            backdropFilter: "blur(14px) saturate(1.5)",
            WebkitBackdropFilter: "blur(14px) saturate(1.5)",
            border: isDark
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(0,0,0,0.07)",
            boxShadow: isDark
              ? "0 2px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)"
              : "0 2px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)",
          }}
        >
          {NETWORKS.filter(n => !(activeGateway === "korba" && n === "MTN Mash Up")).map((n) => {
            const active = selectedNetwork === n;
            return (
              <button
                key={n}
                onClick={() => setSelectedNetwork(n)}
                className="flex-1 py-2.5 sm:py-3 rounded-xl text-sm font-bold transition-all duration-200 relative overflow-hidden"
                style={
                  active
                    ? NETWORK_GLASS_ACTIVE[n]
                    : {
                        color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
                        background: "transparent",
                      }
                }
              >
                {/* Hover shimmer (idle only) */}
                {!active && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-0 hover:opacity-100 transition-opacity duration-150"
                    style={{
                      background: isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.04)",
                    }}
                    aria-hidden
                  />
                )}
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  {n === "MTN Mash Up" ? (
                    <>
                      <Zap className="w-4 h-4 fill-current" />
                      <span>MTN Mash Up</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        active ? "bg-black/20 text-black" : "bg-white/10 text-muted-foreground"
                      }`}>4</span>
                    </>
                  ) : (
                    n
                  )}
                  {networkStatusMap[n.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : (n.toUpperCase().includes("MTN") ? "MTN" : n.toUpperCase())] === "down" && (
                    <span className="w-2 h-2 rounded-full bg-red-500 border-2 border-white/30 shadow-[0_0_6px_rgba(239,68,68,0.8)]" title="Service Offline" />
                  )}
                  {networkStatusMap[n.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : (n.toUpperCase().includes("MTN") ? "MTN" : n.toUpperCase())] === "maintenance" && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Service Maintenance" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        
        {/* Dropdown Selector for Package Type / Category */}
        <div className="mb-6 animate-fade-in relative z-50">
          <BundleSelectorDropdown
            options={dropdownOptions}
            value={selectedTypeOrCategory}
            onChange={(val) => {
              setSelectedTypeOrCategory(val);
              setSelectedPkg(null);
            }}
            accentColor={selectedNetwork === "MTN" ? "#FFCC00" : selectedNetwork === "Telecel" ? "#E60000" : "#00529B"}
            isDark={isDark}
          />
        </div>

        {/* Dedicated Instant View Header */}
        {selectedTypeOrCategory !== "affordable" && selectedTypeOrCategory !== "mashup" && (
          <div className="mb-6 p-5 rounded-2xl border border-primary/10 bg-primary/[0.02] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in">
            <div>
              <h2 className="text-sm font-black text-foreground mb-0.5 uppercase tracking-wide">
                {selectedNetwork} Instant: {selectedTypeOrCategory}
              </h2>
              <p className="text-[11px] text-muted-foreground max-w-lg">
                Direct official retail bundles routed instantly via carrier gateways.
              </p>
            </div>
            <div className="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 rounded-full text-[9px] font-black uppercase tracking-wider">
              Official API
            </div>
          </div>
        )}

        {/* Dedicated Mash Up View Header */}
        {selectedTypeOrCategory === "mashup" && (
          <div className="mb-6 p-5 rounded-2xl border border-amber-500/10 bg-amber-500/[0.02] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in">
            <div>
              <h2 className="text-sm font-black text-foreground mb-0.5 uppercase tracking-wide">MTN Mash Up Bundles</h2>
              <p className="text-[11px] text-muted-foreground max-w-lg">
                Popular hybrid voice and data packages from MTN. Fully supported and routed instantly.
              </p>
            </div>
            <div className="px-2.5 py-1 bg-amber-500/10 text-amber-500 rounded-full text-[9px] font-black uppercase tracking-wider">
              Mash Up Active
            </div>
          </div>
        )}


        {/* Active Service Barrier warning */}
        {networkStatusMap[selectedNetwork.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : (selectedNetwork.toUpperCase().includes("MTN") ? "MTN" : selectedNetwork.toUpperCase())] === "down" ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-red-500/20 bg-red-500/[0.02] rounded-3xl transition-all">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20 shadow-[0_10px_30px_rgba(239,68,68,0.1)]">
               <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-xl font-black text-foreground mb-2 uppercase italic">{selectedNetwork} Offline</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              This network is currently undergoing critical maintenance. Purchases are temporarily paused to protect your funds. Please select another network or check back soon.
            </p>
          </div>
        ) : (
          /* Package grid */
          pkgLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-2xl" />)}
            </div>
          ) : (
            memoizedGrid
          )
        )}

        {/* Footer promo */}
        <div className="mt-10 rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="font-semibold text-sm mb-0.5">Want agent prices?</p>
            <p className="text-muted-foreground text-xs">Agents unlock wholesale rates + their own Paystack-powered store.</p>
          </div>
          <Link
            to="/login"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Sign in or create account
          </Link>
        </div>
      </div>

      {/* ── Pro Level Transaction Modal ── */}
      <AnimatePresence>
        {selectedPkg && (
          <div className="fixed inset-0 z-[999] flex flex-col items-center justify-start pt-8 sm:pt-16 p-4 overflow-y-auto">
            {/* High Definition Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setSelectedPkg(null); setPhone(""); setEmail(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
              className="absolute inset-0 bg-background/80 backdrop-blur-[6px] cursor-pointer"
            />
            
            {/* Premium Modal Enclosure */}
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 20 }}
              transition={{ 
                type: "spring", 
                damping: 25, 
                stiffness: 300,
                mass: 0.8 
              }}
              className="relative w-full max-w-[360px] bg-card border border-border shadow-[0_32px_80px_-20px_rgba(0,0,0,0.5)] dark:shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8)] rounded-[2.5rem] overflow-hidden flex flex-col select-none text-card-foreground"
            >
              {/* Dynamic Header Section */}
              <div className="relative w-full pt-8 pb-6 text-center rounded-b-[3rem] overflow-hidden z-10 shadow-[0_10px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
                {/* Traditional Symbols Overlay (Embedded Culturally) */}
                <div 
                  className="absolute inset-0 opacity-[0.15] pointer-events-none mix-blend-overlay z-0"
                  style={{ 
                    backgroundImage: "url('/assets/adinkra_pattern.png')",
                    backgroundSize: "160px",
                    backgroundRepeat: "repeat"
                  }}
                />
                
                {/* Thematic Ambient Glow Vector */}
                <div 
                  className="absolute inset-0 opacity-50 blur-3xl z-0"
                  style={{ 
                    background: `radial-gradient(circle at 50% 20%, hsl(${theme.primary}), transparent 70%)`
                  }} 
                />
                
                {/* Absolute Background Shell (Gradient overlay to darken the top slightly) */}
                <div className="absolute inset-0 bg-gradient-to-b from-foreground/10 via-transparent to-card z-[1]" />

                {/* Close Vector */}
                <button 
                  onClick={() => { setSelectedPkg(null); setPhone(""); setEmail(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
                  className="absolute top-3 right-3 z-30 p-2 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/50 text-muted-foreground hover:text-foreground transition-all active:scale-90"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Content Group */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="relative z-20 flex flex-col items-center px-5"
                >
                  {/* Network Indicator Pill */}
                  <div 
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] border border-primary/20 backdrop-blur-md mb-3"
                    style={{
                      color: `hsl(${theme.primary})`,
                      backgroundColor: `hsl(${theme.primary} / 0.1)`
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: `hsl(${theme.primary})` }} />
                    {selectedNetwork} Network
                  </div>

                  {/* Magnitude Display */}
                  <h3 className="text-4xl font-black tracking-tighter text-foreground drop-shadow-[0_4px_10px_rgba(0,0,0,0.1)] dark:drop-shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                    {selectedPkg.size}
                  </h3>

                  {/* Cultural Centerpiece Icon (Cycles traditional Adinkra symbols dynamically) */}
                  <div className="flex items-center justify-center my-2 h-10 w-10 relative">
                    <AnimatePresence mode="wait">
                      <motion.div 
                        key={adinkraIndex}
                        initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
                        transition={{ duration: 0.4 }}
                        className="absolute flex items-center justify-center"
                      >
                        <div className="relative">
                          {/* Ambient Ring Glow behind Icon */}
                          <div className="absolute inset-0 blur-xl opacity-50 rounded-full bg-amber-500/40 animate-pulse" />
                          <svg 
                            width="36" height="36" viewBox="0 0 24 24" 
                            fill="currentColor" 
                            className="relative z-10 text-amber-400 drop-shadow-[0_4px_12px_rgba(245,158,11,0.5)]"
                          >
                            <path d={adinkraSymbols[adinkraIndex].path} />
                          </svg>
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Pricing Metrics */}
                  {isFreePromo ? (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500 text-black text-[10px] font-black uppercase tracking-wider shadow-lg shadow-green-500/30 animate-bounce-subtle">
                      <Gift className="w-3 h-3" /> Free Reward
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-foreground/80 text-xs font-bold bg-foreground/5 border border-border/50 rounded-full px-3 py-0.5 backdrop-blur-sm">
                      {validPromo ? (
                        <>
                          <span className="opacity-40 line-through font-medium">GH₵{selectedPkg.price.toFixed(2)}</span> 
                          <span style={{ color: `hsl(${theme.primary})` }} className="font-black">GH₵{discountedPkgPrice.toFixed(2)}</span>
                        </>
                      ) : (
                        <span className="font-black">GH₵{selectedPkg.price.toFixed(2)}</span>
                      )}
                      <span className="w-1 h-1 rounded-full bg-foreground/20" />
                      <span className="text-[10px] opacity-60 font-medium">+GH₵{fee.toFixed(2)}</span>
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Interactive Surface */}
              <div className="p-5 pb-6 space-y-4 bg-card relative z-20">
                
                {/* Sequential Entrance Group */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-3"
                >
                  {/* Field Header */}
                  <div className="flex items-center justify-between px-1">
                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
                      Direct Delivery To
                    </label>
                  </div>

                  {/* High Fidelity Input Nest */}
                  <div className="relative group">
                    <input
                      ref={phoneInputRef}
                      type="tel" inputMode="numeric"
                      placeholder="Enter Phone (0XX XXXXXXX)"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      maxLength={12}
                      className="w-full h-[56px] bg-background border border-foreground/10 dark:border-border/60 rounded-[1.25rem] pl-4 pr-12 text-foreground placeholder:text-muted-foreground/60 text-lg font-bold tracking-wide focus:outline-none focus:border-primary/50 focus:bg-accent/5 focus:shadow-[0_0_0_4px_hsl(var(--primary)/0.1)] transition-all duration-300 selection:bg-primary/30"
                      style={resolvedName ? { 
                        borderColor: "rgba(16, 185, 129, 0.4)",
                        background: isDark ? "rgba(16, 185, 129, 0.04)" : "rgba(16, 185, 129, 0.02)",
                        boxShadow: "0 0 20px -5px rgba(16, 185, 129, 0.15)"
                      } : undefined}
                    />
                    
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8">
                      <AnimatePresence mode="wait">
                        {resolvingName ? (
                          <motion.div key="loading" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </motion.div>
                        ) : resolvedName ? (
                          <motion.div key="done" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2, rotate: [0, -15, 15, 0] }} transition={{ type: "spring", bounce: 0.5 }}>
                            <div className="bg-emerald-500 rounded-full p-1 shadow-lg shadow-emerald-500/30">
                              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <ShieldCheck className="w-4 h-4 text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Reactive Identity Banner */}
                  <AnimatePresence>
                    {resolvedName && (
                      <motion.div 
                        key="identity-confirmed"
                        initial={{ opacity: 0, height: 0, scale: 0.9 }}
                        animate={{ opacity: 1, height: "auto", scale: 1 }}
                        transition={{ type: "spring", bounce: 0.4 }}
                        exit={{ opacity: 0, height: 0, scale: 0.9 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5 shadow-sm">
                          <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                            {resolvedName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[8px] font-black uppercase tracking-widest text-emerald-600/60 dark:text-emerald-500/60 leading-none mb-0.5">Identity Confirmed</p>
                            <p className="text-xs font-black text-emerald-700 dark:text-emerald-300 uppercase truncate leading-tight tracking-wide">
                              {resolvedName}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {phone.length > 0 && !isPhoneValid && (
                      <motion.p 
                        key="invalid-phone-alert"
                        initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                        className="text-[10px] text-red-400/90 font-bold px-2 flex items-center gap-1.5"
                      >
                        <AlertTriangle className="w-3 h-3" /> Check number!
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Tertiary Settings Nest */}
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-2"
                >
                  {/* Animated Email Collapse */}
                  <AnimatePresence>
                    {isPhoneValid && !isFreePromo && (
                      <motion.div 
                        key="email-collapse"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-1.5 overflow-hidden border-t border-border/50 pt-2.5"
                      >
                        <label className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/70 px-1 block">
                          Email <span className="text-muted-foreground/40 normal-case font-medium">(Optional)</span>
                        </label>
                        <input
                          type="email" inputMode="email"
                          placeholder="For delivery receipt..."
                          value={email} onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                          className="w-full h-[42px] bg-background border border-foreground/10 dark:border-border/60 rounded-lg px-3.5 text-foreground placeholder:text-muted-foreground/60 text-sm focus:outline-none focus:border-primary/50 transition-all"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Dynamic Promo Component */}
                  <div className="pt-0.5">
                    {!promoOpen && !validPromo ? (
                      <button 
                        onClick={() => { setPromoOpen(true); setTimeout(() => promoInputRef.current?.focus(), 80); }}
                        className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-muted-foreground/70 hover:text-amber-500 hover:bg-accent/50 px-2.5 py-1.5 rounded-lg transition-all group"
                      >
                        <Tag className="w-3 h-3 group-hover:rotate-12 transition-transform" /> Code?
                      </button>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-1.5"
                      >
                        {validPromo ? (
                          <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-black border ${validPromo.is_free ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400"} shadow-sm`}>
                            <div className="flex items-center gap-1.5 truncate uppercase tracking-wide">
                              <Tag className="w-3 h-3 shrink-0" />
                              <span className="truncate text-[10px]">{validPromo.is_free ? "FREE ACTIVATED" : `${validPromo.discount_percentage}% OFF!`}</span>
                            </div>
                            <button onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="p-1 hover:bg-foreground/10 rounded-lg transition-colors text-current opacity-60 hover:opacity-100">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <input
                              ref={promoInputRef}
                              type="text" placeholder="TYPE CODE"
                              value={promoCode} onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                              className="flex-1 h-9 bg-background border border-foreground/10 dark:border-border/60 rounded-lg px-3 text-foreground placeholder:text-muted-foreground/50 text-[10px] font-mono font-black tracking-widest uppercase focus:outline-none focus:border-amber-500/50 transition-colors"
                            />
                            <button 
                              onClick={handleApplyPromo} disabled={promoValidating || !promoCode.trim()}
                              className="h-9 px-3 rounded-lg text-[9px] font-black bg-amber-500 text-white dark:text-black hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                              {promoValidating ? <Loader2 className="w-3 h-3 animate-spin" /> : "APPLY"}
                            </button>
                            <button onClick={() => { setPromoOpen(false); setPromoCode(""); setPromoResult(null); }} className="h-9 w-9 flex items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-all">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {promoResult && !promoResult.valid && (
                          <p className="text-[9px] font-bold text-red-400/80 px-1 tracking-tight">Code inactive</p>
                        )}
                      </motion.div>
                    )}
                  </div>
                </motion.div>

                {/* Prime Execution Node */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, type: "spring", bounce: 0.3 }}
                  className="pt-1 relative"
                >
                  {isFreePromo ? (
                            <button 
                      onClick={handleClaimFree} 
                      disabled={claiming || !isPhoneValid || !resolvedName}
                      className="w-full h-[64px] font-black text-base tracking-wider rounded-[1.5rem] bg-green-500 hover:bg-green-400 text-black shadow-[0_12px_30px_-8px_rgba(34,197,94,0.6)] transition-all active:scale-[0.95] hover:-translate-y-0.5 disabled:opacity-30 disabled:grayscale disabled:transform-none flex items-center justify-center gap-2"
                    >
                      {claiming ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> SECURING...</>
                      ) : (
                        <><Gift className="w-5 h-5" /> CLAIM DATA</>
                      )}
                    </button>
                  ) : (
                    <div className="relative group">
                      {/* Kinetic Dynamic Pulsating Ring behind button */}
                      <div 
                        className="absolute -inset-1 opacity-25 rounded-[1.7rem] blur-lg transition-all duration-500 group-hover:opacity-50 group-hover:blur-xl pointer-events-none"
                        style={{ background: `hsl(${theme.primary})` }}
                      />
                      
                      <button 
                        onClick={handlePay} 
                        disabled={buying || !resolvedName}
                        className="w-full h-[72px] relative overflow-hidden rounded-[1.5rem] shadow-[0_15px_40px_-10px_rgba(0,0,0,0.3)] dark:shadow-[0_15px_40px_-10px_rgba(0,0,0,0.6)] transition-all active:scale-[0.95] hover:-translate-y-1 disabled:opacity-30 disabled:grayscale disabled:transform-none flex items-center justify-center group/btn bg-primary text-primary-foreground"
                      >
                        {/* Internal Light Shimmer */}
                        <div className="absolute inset-0 bg-white/20 transform -translate-x-full group-hover/btn:animate-shimmer pointer-events-none" style={{ width: '60%', skewX: '-25deg' }} />

                        <div className="relative z-10 flex flex-col items-center justify-center leading-none">
                          {buying ? (
                            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-widest">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Checking Out...</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-90">
                                <CreditCard className="w-3 h-3" />
                                Pay & Deliver
                              </div>
                              <div className="flex items-baseline gap-0.5 font-black text-3xl tracking-tighter transition-transform duration-300 group-hover/btn:scale-105">
                                <span className="text-sm font-black align-top opacity-80">GH₵</span>
                                {total.toFixed(2)}
                              </div>
                            </>
                          )}
                        </div>
                      </button>
                    </div>
                  )}
                  
                  {/* Final Verification Anchor */}
                  <div className="flex items-center justify-center gap-1.5 mt-4 opacity-40 hover:opacity-70 transition-opacity duration-500">
                    <ShieldCheck className="w-3 h-3 text-muted-foreground" />
                    <p className="text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                      Safe & Encrypted
                    </p>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={total}
        email={email}
        recipientPhone={phoneDigits}
        recipientNetwork={selectedNetwork}
        metadata={checkoutMetadata}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-200%) skewX(-25deg); }
          100% { transform: translateX(400%) skewX(-25deg); }
        }
        .group-hover\\:animate-shimmer, .group-hover\\/btn\\:animate-shimmer {
          animation: shimmer 1.8s ease-out infinite;
        }
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default BuyData;
