import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { ShieldCheck, Zap, Loader2, AlertTriangle, X, CreditCard, Gift, Tag, CheckCircle2, Clock, Sparkles, Check, Search, Smartphone, ArrowRight, Lock, Package } from "lucide-react";
import { basePackages, getPublicPrice } from "@/lib/data";
import { cn, getNetworkCardColors } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
    background: "linear-gradient(135deg, rgba(251,191,36,0.95) 0%, rgba(245,158,11,0.90) 100%)",
    boxShadow: "0 8px 25px rgba(251,191,36,0.45), inset 0 1px 0 rgba(255,255,255,0.4)",
    color: "#000",
  },
  Telecel: {
    background: "linear-gradient(135deg, rgba(239,68,68,0.95) 0%, rgba(185,28,28,0.90) 100%)",
    boxShadow: "0 8px 25px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
    color: "#fff",
  },
  AirtelTigo: {
    background: "linear-gradient(135deg, rgba(59,130,246,0.95) 0%, rgba(29,78,216,0.90) 100%)",
    boxShadow: "0 8px 25px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
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

const formatPackageDisplay = (size: string) => {
  let match = size.match(/GHS\s*[\d.]+\s*\(([^)]+)\)/i);
  if (match) {
    return {
      main: match[1].trim(),
      sub: size.replace(/\([^)]+\)/, "").trim()
    };
  }

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

  if (productId.includes("Kokrokoo") || category.toLowerCase().includes("kokrokoo")) {
    return "400MB + 20 Mins Call (5am - 8am)";
  }
  
  if (category.toLowerCase().includes("midnight") || 
      String(rawData.category).toLowerCase().includes("midnight") || 
      String(rawData.category).toLowerCase().includes("night")) {
    const val = rawData.validity || "Midnight (12am - 5am)";
    return `Midnight Bundle (${val})`;
  }

  if (category.toLowerCase().includes("social") || String(rawData.category).toLowerCase().includes("social")) {
    return "Social Media (WhatsApp, FB, etc.)";
  }

  if (category.toLowerCase().includes("video") || String(rawData.category).toLowerCase().includes("video")) {
    return "Video Bundle (YouTube, TikTok, etc.)";
  }

  if (category.toLowerCase().includes("sika kokoo") || String(rawData.category).toLowerCase().includes("sika kokoo")) {
    const val = rawData.validity || pkg.validity || "";
    return val ? `Sika Kokoo (${val})` : "Sika Kokoo Bundle";
  }

  if (category.toLowerCase().includes("fuse") || String(rawData.category).toLowerCase().includes("fuse")) {
    const match = size.match(/(\d+mins?)\s+and\s+([\d.\w]+)/i);
    if (match) {
      return `${match[1]} + ${match[2]} Voice & Data`;
    }
    return "Fuse Voice & Data";
  }

  if (category.toLowerCase().includes("bigtime") || String(rawData.category).toLowerCase().includes("bigtime")) {
    return "BigTime Data (No Expiry)";
  }

  if (category.toLowerCase().includes("idd") || String(rawData.category).toLowerCase().includes("idd")) {
    return "International (IDD) Bundle";
  }

  if (pkg.validity === "MTN Mash Up") {
    return "MTN Mash Up (Voice + Data)";
  }

  if (rawData.validity) {
    return rawData.validity;
  }

  return "";
};

const BuyData = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [customPrices, setCustomPrices] = useState<Record<string, Record<string, number>>>({});
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
      path: "M19.6709 9.689C19.5889 9.289 22.2649 8.92599 22.4889 7.74199C22.7129 6.55799 19.075 9.198 18.668 8.989C18.261 8.78 21.1299 7.18899 20.9369 5.58899C20.7439 3.98899 17.548 9.30299 17.08 8.92699C16.612 8.55099 19.7399 5.554 19.1999 3.766C18.6599 1.978 16.606 7.7 15.053 9.30899C14.2063 10.0785 13.1784 10.6208 12.0653 10.8854C10.9522 11.15 9.79034 11.1282 8.68798 10.822C7.77921 10.6882 6.90711 10.371 6.12475 9.88961C5.34239 9.40826 4.6661 8.77285 4.13696 8.02199C3.38296 6.82999 3.78991 4.95 6.15991 4.903C8.52991 4.856 9.93591 8.765 9.93591 8.765L10.36 7.318L11.37 8.247C11.37 8.247 11.718 7.847 11.688 6.304C11.658 4.761 11.288 1.519 7.20996 2.049C3.13196 2.579 0.366953 7.59099 1.13195 11.363C1.89695 15.135 6.28997 18.754 9.77697 19.106C10.0281 19.1318 10.2805 19.1431 10.533 19.14V21.014H9.02099C8.88871 21.0113 8.76075 21.0612 8.66516 21.1526C8.56956 21.2441 8.51413 21.3697 8.51098 21.502C8.51413 21.6343 8.56956 21.7599 8.66516 21.8514C8.76075 21.9428 8.88871 21.9927 9.02099 21.99H15.7489C15.8812 21.9927 16.0091 21.9428 16.1047 21.8514C16.2003 21.7599 16.2558 21.6343 17.047 21.442C17.0935 21.1511 17.0726 20.8534 16.9859 20.5719C16.8992 20.2903 16.7491 20.0324 16.547 19.818C18.163 19.395 20.406 18.089 21.502 14.472C22.3554 11.3684 22.0939 8.06382 20.763 5.13303Z"
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
    const fetchCustomPrices = async () => {
      if (!profile) return;
      
      if (profile.is_sub_agent && profile.parent_agent_id) {
        try {
          const { data: parentProfile, error } = await supabase
            .from("profiles")
            .select("sub_agent_prices, agent_prices")
            .eq("user_id", profile.parent_agent_id)
            .maybeSingle();
            
          if (error) {
            console.error("[BuyData] Error fetching parent sub-agent prices:", error);
            return;
          }
            
          if (parentProfile) {
            const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, Record<string, string | number>>;
            const agentPrices = (parentProfile.agent_prices || {}) as Record<string, Record<string, string | number>>;
            const hasSubPrices = Object.keys(subPrices).length > 0;
            
            const resolved: Record<string, Record<string, number>> = {};
            const sourceMap = hasSubPrices ? subPrices : agentPrices;
            
            for (const [net, items] of Object.entries(sourceMap)) {
              resolved[net] = {};
              for (const [size, val] of Object.entries(items)) {
                resolved[net][size] = Number(val);
              }
            }
            setCustomPrices(resolved);
          }
        } catch (e) {
          console.error("[BuyData] Failed to resolve parent sub-agent prices:", e);
        }
      }
    };
    
    fetchCustomPrices();
  }, [profile]);

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
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedNetwork, isPhoneValid, resolvedName, resolvingName, phoneDigits]);

  const displayPackages = useMemo(() => {
    const list: { size: string; price: number; validity: string; popular?: boolean; isInstant?: boolean; category?: string; rawData?: any }[] = [];
    const dbNetwork = selectedNetwork;

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

    const addedSizes = new Set(baseList.map(p => p.size.replace(/\s+/g, "").toUpperCase()));

    Object.keys(globalSettings).forEach((key) => {
      const gs = globalSettings[key];
      if (gs && (gs.network === dbNetwork || (dbNetwork === "MTN" && gs.network === "MTN Mash Up"))) {
        const normSize = gs.package_size.replace(/\s+/g, "").toUpperCase();
        if (!addedSizes.has(normSize)) {
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

    const processed = list
      .map((pkg) => {
        const normSize = pkg.size.replace(/\s+/g, "").toUpperCase();
        
        let gs = globalSettings[`${dbNetwork}-${normSize}`];
        if (!gs && dbNetwork === "MTN") {
          gs = globalSettings[`MTN Mash Up-${normSize}`];
        }

        if (gs?.is_unavailable) return null;
        
        let base = gs?.public_price ?? getPublicPrice(pkg.price);
        if (profile) {
          const isApprovedAgent = !!(profile.is_agent && profile.agent_approved);
          const isApprovedSubAgent = !!(profile.is_sub_agent && profile.sub_agent_approved);

          if (isApprovedAgent) {
            base = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : base;
          } else if (isApprovedSubAgent) {
            const custom = customPrices[dbNetwork]?.[normSize];
            if (custom && custom > 0) {
              base = custom;
            } else {
              base = Number(gs?.sub_agent_price) > 0 
                ? Number(gs!.sub_agent_price) 
                : (Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : base);
            }
          }
        }
        const multiplier = priceMultipliers[dbNetwork] || (dbNetwork.includes("MTN") ? priceMultipliers["MTN"] : 1) || 1;
        const price = applyPriceMultiplier(base, multiplier);

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
  }, [basePackages, selectedNetwork, globalSettings, priceMultipliers, korbaMappings, profile, customPrices]);

  const dropdownOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "affordable", label: "Affordable SME Bundles" }
    ];

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
    
    return displayPackages.filter(
      p => p.isInstant && 
           p.category === selectedTypeOrCategory && 
           p.validity !== "MTN Mash Up" && 
           p.category !== "Mash Up Bundles"
    );
  }, [displayPackages, selectedTypeOrCategory]);

  const packages = filteredPackages;

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
      setPromoResult(null); setPromoCode("");
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

  const memoizedGrid = useMemo(() => {
    if (packages.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-amber-500/30 bg-amber-500/5 rounded-3xl backdrop-blur-xl">
          <div className="relative flex items-center justify-center mb-4">
            <span className="absolute inline-flex h-16 w-16 rounded-full bg-amber-500/20 animate-ping" />
            <div className="relative w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/30 shadow-lg">
              <Clock className="w-7 h-7 text-amber-400 animate-spin" />
            </div>
          </div>
          <h3 className="text-lg font-black text-white mb-2 uppercase tracking-wide">{selectedNetwork} Packages Updating</h3>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            All {selectedNetwork} packages are currently being updated. Stock will resume shortly. Thank you for your patience!
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {packages.map((pkg) => {
          const isSelected = selectedPkg?.size === pkg.size;
          const display = formatPackageDisplay(pkg.size);
          const details = getPackageDetails(pkg);
          
          return (
            <button
              key={pkg.size}
              onClick={() => handleCardClick(pkg.size, pkg.price)}
              className={cn(
                "relative rounded-3xl p-4 sm:p-5 flex flex-col justify-between border text-left transition-all duration-300 backdrop-blur-xl overflow-hidden group shadow-xl",
                isSelected
                  ? "bg-slate-900 border-amber-400 shadow-[0_10px_35px_rgba(245,158,11,0.25)] scale-[1.03] ring-2 ring-amber-400/50"
                  : "bg-[#0b0c12]/90 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/90 hover:scale-[1.02]"
              )}
            >
              {/* Dynamic Glow Orb for Selected Card */}
              {isSelected && (
                <div className="absolute -top-12 -right-12 w-28 h-28 bg-amber-500/30 rounded-full blur-2xl pointer-events-none" />
              )}

              {/* Badges */}
              <div className="flex items-center justify-between gap-1 mb-3 relative z-10">
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border",
                  selectedNetwork === "MTN" && "bg-amber-500/20 text-amber-300 border-amber-500/30",
                  selectedNetwork === "Telecel" && "bg-red-500/20 text-red-300 border-red-500/30",
                  selectedNetwork === "AirtelTigo" && "bg-blue-500/20 text-blue-300 border-blue-500/30"
                )}>
                  {selectedNetwork}
                </span>

                {isSelected ? (
                  <span className="w-5 h-5 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-xs shadow-md">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </span>
                ) : pkg.popular ? (
                  <span className="text-[9px] font-black bg-gradient-to-r from-amber-500 to-yellow-400 text-black px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                    HOT
                  </span>
                ) : null}
              </div>

              {/* Package Content */}
              <div className="space-y-1 relative z-10">
                <p className="text-xl sm:text-2xl font-black tracking-tight text-white font-mono group-hover:text-amber-300 transition-colors">
                  {display.main}
                </p>
                
                {display.sub && (
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate">
                    Official: {display.sub}
                  </p>
                )}
                
                {details && (
                  <p className="text-[10px] font-bold text-emerald-400 mt-1 leading-snug uppercase tracking-wide">
                    {details}
                  </p>
                )}

                <div className="pt-3 flex items-baseline justify-between border-t border-slate-800/60 mt-3">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                    {pkg.validity || "No Expiry"}
                  </span>
                  <span className="text-base sm:text-lg font-black text-amber-400 font-mono">
                    GH₵{pkg.price.toFixed(2)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [packages, selectedPkg?.size, handleCardClick, selectedNetwork]);

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-100 selection:bg-amber-500/30 pt-16 md:pt-24 pb-24 font-sans antialiased relative overflow-hidden">
      <SEO 
        title="Buy Cheap Data Bundles Ghana 2026 | #1 Best Data Site ★★★★★ — SwiftData"
        description="Buy cheapest non-expiry MTN, Telecel & AirtelTigo data bundles in Ghana with instant MoMo delivery. 5.0/5 stars rated, no account required. Cheaper than Datamart."
        keywords="mtnupu, mtn upu, mtn up2u, mtnupu sites, mtn upu sites, mtn up2u sites, cheapest data bundle in ghana, buy cheap data in ghana, mtn cheap data bundle code, how to buy cheap mtn data, telecel cheap data bundles, airteltigo cheap data bundles, non expiry data ghana, best data site in ghana, buy MTN data Ghana, buy Telecel data, buy AirtelTigo data, cheap data bundles, non-expiry data, datamart alternative"
        canonical="https://swiftdatagh.com/buy-data"
      />

      {/* Dynamic Ambient Background Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[180px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[160px] pointer-events-none" />
      </div>

      {/* Hero Banner Section */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 mb-8">
        <div className="rounded-3xl bg-[#0b0c12]/90 border border-slate-800 p-6 sm:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 font-mono">Instant MoMo Delivery • No Signup</span>
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
                Buy <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500">Data Bundles</span>
              </h1>
              
              <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
                Select your mobile network, pick a package size &amp; complete payment instantly with Mobile Money or Card.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-900/90 px-3 py-1 rounded-full border border-slate-800">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>256-Bit SSL Encrypted</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-900/90 px-3 py-1 rounded-full border border-slate-800">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Instant Delivery</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-900/90 px-3 py-1 rounded-full border border-slate-800">
                  <Package className="w-3.5 h-3.5 text-blue-400" />
                  <span>Non-Expiry Data</span>
                </div>
              </div>
            </div>

            <div className="shrink-0 w-full md:w-auto">
              <LiveDeliveryBadge />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4">
        {/* Warning Bar */}
        <div className="mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 flex items-center justify-between text-xs font-bold text-amber-300 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Delivery times vary &bull; Double check recipient phone number</span>
          </div>
          <Link to="/order-status" className="px-3 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-extrabold transition-all text-[11px] flex items-center gap-1 shrink-0">
            Track Order <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {holidayMode && (
          <div className="mb-6 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm font-bold text-yellow-300">
            {holidayMessage}
          </div>
        )}

        {/* Network Selector Tabs */}
        <div className="flex gap-2 p-1.5 mb-6 rounded-2xl bg-[#0b0c12]/90 border border-slate-800 backdrop-blur-xl shadow-xl">
          {NETWORKS.filter(n => !(activeGateway === "korba" && n === "MTN Mash Up")).map((n) => {
            const active = selectedNetwork === n;
            return (
              <button
                key={n}
                onClick={() => setSelectedNetwork(n)}
                className={cn(
                  "flex-1 py-3 rounded-xl text-xs sm:text-sm font-black transition-all duration-300 relative overflow-hidden",
                  active
                    ? "text-black shadow-lg scale-[1.02]"
                    : "text-slate-400 hover:text-white hover:bg-slate-900/60"
                )}
                style={active ? NETWORK_GLASS_ACTIVE[n] : undefined}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <span>{n}</span>
                  {networkStatusMap[n.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : (n.toUpperCase().includes("MTN") ? "MTN" : n.toUpperCase())] === "down" && (
                    <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" title="Offline" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        
        {/* Dropdown Selector for Package Type / Category */}
        <div className="mb-6 relative z-50">
          <BundleSelectorDropdown
            options={dropdownOptions}
            value={selectedTypeOrCategory}
            onChange={(val) => {
              setSelectedTypeOrCategory(val);
              setSelectedPkg(null);
            }}
            accentColor={selectedNetwork === "MTN" ? "#F59E0B" : selectedNetwork === "Telecel" ? "#EF4444" : "#3B82F6"}
            isDark={true}
          />
        </div>

        {/* Dedicated Category Header */}
        {selectedTypeOrCategory !== "affordable" && selectedTypeOrCategory !== "mashup" && (
          <div className="mb-6 p-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xs font-black text-white uppercase tracking-wider">
                {selectedNetwork} Instant: {selectedTypeOrCategory}
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Official retail bundles routed instantly via carrier API.
              </p>
            </div>
            <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-wider border border-emerald-500/30">
              Official API
            </div>
          </div>
        )}

        {/* Network Offline Barrier */}
        {networkStatusMap[selectedNetwork.toUpperCase().includes("AIRTEL") ? "AT_PREMIUM" : (selectedNetwork.toUpperCase().includes("MTN") ? "MTN" : selectedNetwork.toUpperCase())] === "down" ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-red-500/30 bg-red-500/10 rounded-3xl backdrop-blur-xl">
            <div className="w-14 h-14 bg-red-500/20 rounded-2xl flex items-center justify-center mb-4 border border-red-500/40">
               <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h3 className="text-lg font-black text-white mb-2 uppercase tracking-wide">{selectedNetwork} Maintenance</h3>
            <p className="text-xs text-slate-300 max-w-md leading-relaxed">
              {selectedNetwork} delivery is undergoing brief maintenance. Please try another network or check back shortly.
            </p>
          </div>
        ) : (
          pkgLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-3xl bg-slate-900/80" />)}
            </div>
          ) : (
            memoizedGrid
          )
        )}

        {/* Reseller Banner */}
        <div className="mt-10 rounded-3xl border border-slate-800 bg-[#0b0c12]/90 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-xl shadow-xl">
          <div>
            <p className="font-extrabold text-sm text-white mb-1">Want wholesale agent rates &amp; your own website store?</p>
            <p className="text-slate-400 text-xs font-medium">Join our reseller program to start your data business today.</p>
          </div>
          <Link
            to="/agent-program"
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-3 text-xs font-black text-black hover:brightness-110 transition-all shadow-lg active:scale-95"
          >
            Become an Agent <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Pro Level Transaction Modal (Portalled to document.body for top z-index placement) */}
      {createPortal(
        <AnimatePresence>
          {selectedPkg && (
            <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center p-4 overflow-y-auto">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { setSelectedPkg(null); setPhone(""); setEmail(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
                className="fixed inset-0 bg-black/95 backdrop-blur-xl"
              />
              
              {/* Modal Card */}
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative w-full max-w-[370px] bg-[#090a0f] border border-amber-500/30 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.95)] z-10"
              >
                {/* Accent Top Bar */}
                <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500" />

                {/* Close Button */}
                <button 
                  onClick={() => { setSelectedPkg(null); setPhone(""); setEmail(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
                  className="absolute top-4 right-4 z-30 w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Modal Header */}
                <div className="p-6 pb-4 text-center space-y-3 relative z-20">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    {selectedNetwork} Network
                  </div>

                  <h3 className="text-3xl font-black text-white font-mono tracking-tight">
                    {selectedPkg.size}
                  </h3>

                  {/* Cultural Centerpiece Icon */}
                  <div className="flex items-center justify-center my-1 h-9 w-9 mx-auto">
                    <AnimatePresence mode="wait">
                      <motion.div 
                        key={adinkraIndex}
                        initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        exit={{ scale: 0.5, opacity: 0, rotate: 45 }}
                        transition={{ duration: 0.4 }}
                        className="flex items-center justify-center"
                      >
                        <svg 
                          width="32" height="32" viewBox="0 0 24 24" 
                          fill="currentColor" 
                          className="text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                        >
                          <path d={adinkraSymbols[adinkraIndex].path} />
                        </svg>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Price Tag */}
                  {isFreePromo ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase tracking-wider shadow-lg">
                      <Gift className="w-3.5 h-3.5" /> Free Reward
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 text-slate-200 text-xs font-bold bg-slate-900 border border-slate-800 rounded-full px-3.5 py-1">
                      {validPromo ? (
                        <>
                          <span className="opacity-40 line-through">GH₵{selectedPkg.price.toFixed(2)}</span> 
                          <span className="text-amber-400 font-black">GH₵{discountedPkgPrice.toFixed(2)}</span>
                        </>
                      ) : (
                        <span className="text-amber-400 font-black">GH₵{selectedPkg.price.toFixed(2)}</span>
                      )}
                      <span className="text-[10px] text-slate-400 font-medium">+GH₵{fee.toFixed(2)} fee</span>
                    </div>
                  )}
                </div>

                {/* Form Fields */}
                <div className="p-6 pt-2 space-y-4 relative z-20">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block font-mono">
                      Recipient Phone Number
                    </label>

                    <div className="relative">
                      <input
                        ref={phoneInputRef}
                        type="tel" 
                        inputMode="numeric"
                        placeholder="0XX XXXXXXX"
                        value={phone} 
                        onChange={(e) => setPhone(e.target.value)}
                        maxLength={12}
                        className="w-full h-13 bg-[#0e0f17] border border-slate-800 rounded-2xl pl-4 pr-11 text-white placeholder:text-slate-600 text-base font-bold tracking-wider font-mono focus:outline-none focus:border-amber-500/50 transition-all shadow-inner"
                      />
                      
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7">
                        {resolvingName ? (
                          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                        ) : resolvedName ? (
                          <div className="bg-emerald-500 rounded-full p-1 shadow-md">
                            <Check className="w-3 h-3 text-black stroke-[3]" />
                          </div>
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-slate-600" />
                        )}
                      </div>
                    </div>

                    {/* Auto Resolved Name Badge */}
                    {resolvedName && (
                      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5 animate-in fade-in duration-200">
                        <div className="shrink-0 w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-xs">
                          {resolvedName.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[8px] font-black uppercase tracking-widest text-emerald-400/80 leading-none mb-0.5">Verified Recipient</p>
                          <p className="text-xs font-black text-emerald-300 uppercase truncate leading-tight tracking-wide">
                            {resolvedName}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Email Optional Field */}
                  {isPhoneValid && !isFreePromo && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block font-mono">
                        Email Address <span className="text-slate-500 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="email" 
                        inputMode="email"
                        placeholder="For receipt..."
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full h-11 bg-[#0e0f17] border border-slate-800 rounded-xl px-3.5 text-white placeholder:text-slate-600 text-xs font-mono focus:outline-none focus:border-amber-500/50 transition-all"
                      />
                    </div>
                  )}

                  {/* Promo Code Drawer */}
                  <div className="pt-1">
                    {!promoOpen && !validPromo ? (
                      <button 
                        onClick={() => { setPromoOpen(true); setTimeout(() => promoInputRef.current?.focus(), 80); }}
                        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-amber-400 transition-colors"
                      >
                        <Tag className="w-3.5 h-3.5 text-amber-400" /> Have a Promo Code?
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        {validPromo ? (
                          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-black bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            <span className="text-[10px] font-mono">{validPromo.is_free ? "FREE CODE ACTIVATED" : `${validPromo.discount_percentage}% DISCOUNT APPLIED`}</span>
                            <button onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="text-slate-400 hover:text-white">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              ref={promoInputRef}
                              type="text" 
                              placeholder="PROMO CODE"
                              value={promoCode} 
                              onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                              className="flex-1 h-9 bg-[#0e0f17] border border-slate-800 rounded-xl px-3 text-white placeholder:text-slate-600 text-xs font-mono font-bold uppercase focus:outline-none focus:border-amber-500/50"
                            />
                            <button 
                              onClick={handleApplyPromo} 
                              disabled={promoValidating || !promoCode.trim()}
                              className="h-9 px-3 rounded-xl text-[10px] font-black bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 transition-all active:scale-95"
                            >
                              {promoValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "APPLY"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Checkout Button */}
                  <div className="pt-2">
                    {isFreePromo ? (
                      <button 
                        onClick={handleClaimFree} 
                        disabled={claiming || !isPhoneValid || !resolvedName}
                        className="w-full h-13 font-black text-sm tracking-wider rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2 uppercase"
                      >
                        {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                        <span>Claim Free Data</span>
                      </button>
                    ) : (
                      <button 
                        onClick={handlePay} 
                        disabled={buying || !resolvedName}
                        className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black font-black uppercase text-xs tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 hover:brightness-110 disabled:opacity-30"
                      >
                        {buying ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Processing...</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4" />
                            <span>Pay GH₵{total.toFixed(2)} &amp; Deliver</span>
                          </div>
                        )}
                      </button>
                    )}

                    <div className="flex items-center justify-center gap-1.5 mt-3">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                        Safe &amp; Encrypted MoMo Payment
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

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
    </div>
  );
};

export default BuyData;
