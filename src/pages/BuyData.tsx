import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import NetworkCard from "@/components/NetworkCard";
import { basePackages, networks, getPublicPrice } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction } from "@/lib/public-function-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PAYSTACK_FEE_RATE = 0.0195;
const PAYSTACK_FEE_CAP = 100;

const calculateFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  public_price: number | null;
  is_unavailable: boolean;
}

interface SystemSettingsSnapshot {
  holiday_mode_enabled: boolean;
  holiday_message: string;
  disable_ordering: boolean;
}

const BuyData = () => {
  const { toast } = useToast();
  const [selected, setSelected] = useState("MTN");
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [buyingPkg, setBuyingPkg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ network: string; size: string; price: number } | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [systemSettings, setSystemSettings] = useState<SystemSettingsSnapshot>({
    holiday_mode_enabled: false,
    holiday_message: "Holiday mode is active. Orders will resume soon.",
    disable_ordering: false,
  });
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase
        .from("global_package_settings")
        .select("network, package_size, public_price, is_unavailable");
      const map: Record<string, GlobalPkgSetting> = {};
      (data || []).forEach((r: any) => { map[`${r.network}-${r.package_size}`] = r; });
      setGlobalSettings(map);

      const { data: systemData } = await supabase.functions.invoke("system-settings", {
        body: { action: "get" },
      });
      if (systemData) {
        setSystemSettings({
          holiday_mode_enabled: Boolean(systemData.holiday_mode_enabled),
          holiday_message: String(systemData.holiday_message || "Holiday mode is active. Orders will resume soon."),
          disable_ordering: Boolean(systemData.disable_ordering),
        });
      }

      const pricingContext = await fetchApiPricingContext();
      setPriceMultiplier(pricingContext.multiplier);
    };
    fetchSettings();
  }, []);

  const isPhoneValid = phone.replace(/\s/g, "").length === 10;

  const handleSelectPackage = (network: string, size: string) => {
    const key = `${network}-${size}`;
    if (selectedPkg === key) {
      setSelectedPkg(null);
      setPhone("");
    } else {
      setSelectedPkg(key);
      setPhone("");
    }
  };

  const getTotal = (price: number) => {
    const fee = calculateFee(price);
    return { fee, total: parseFloat((price + fee).toFixed(2)) };
  };

  const handleBuyClick = (network: string, size: string, publicPrice: number) => {
    if (systemSettings.disable_ordering) {
      toast({
        title: "Ordering is currently disabled",
        description: systemSettings.holiday_message || "Please try again later.",
        variant: "destructive",
      });
      return;
    }
    setPhone("");
    setPendingOrder({ network, size, price: publicPrice });
    setConfirmOpen(true);
  };

  const handleConfirmBuy = async () => {
    if (!pendingOrder) return;
    setConfirmOpen(false);

    const { network, size, price } = pendingOrder;
    const key = `${network}-${size}`;
    setBuyingPkg(key);

    const orderId = crypto.randomUUID();

    // Order is created server-side by initialize-payment

    const { total, fee } = getTotal(price);
    const callbackParams = new URLSearchParams({
      reference: orderId,
      network,
      package: size,
      phone: phone.replace(/\s/g, ""),
    });

    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
      body: {
        email: `${phone.replace(/\s/g, "")}@customer.swiftdata.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
        metadata: {
          order_id: orderId,
          order_type: "data",
          network,
          package_size: size,
          customer_phone: phone.replace(/\s/g, ""),
          fee,
        },
      },
    });

    if (paymentError || !paymentData?.authorization_url) {
      const description = paymentData?.error || await getFunctionErrorMessage(paymentError, "Could not initialize payment.");
      toast({ title: "Payment failed", description, variant: "destructive" });
      setBuyingPkg(null);
      return;
    }

    window.location.href = paymentData.authorization_url;
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-3xl">
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">Buy Data</h1>
        <p className="text-muted-foreground mb-8">Select a network and choose your data package.</p>

        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="text-sm text-foreground mb-3">
            Agents get cheaper bundle rates and their own store. Create an account to access your dashboard,
            then activate agent access when ready.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link to="/login" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Sign In / Create Account
            </Link>
            <Link to="/agent-program" className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent">
              Become an Agent
            </Link>
          </div>
        </div>

        {systemSettings.holiday_mode_enabled && (
          <div className="mb-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-800">
            {systemSettings.holiday_message}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-8">
          {networks.map((n) => (
            <NetworkCard
              key={n.name}
              name={n.name}
              color={n.color}
              selected={selected === n.name}
              onClick={() => { setSelected(n.name); setPhone(""); }}
            />
          ))}
        </div>

        <h2 className="font-display text-xl font-semibold mb-4">{selected} Data Packages</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {basePackages[selected]?.map((pkg) => {
            const key = `${selected}-${pkg.size}`;
            const gs = globalSettings[key];
            const isUnavailable = gs?.is_unavailable || false;
            if (isUnavailable) return null;
            const basePublicPrice = gs?.public_price ?? getPublicPrice(pkg.price);
            const publicPrice = applyPriceMultiplier(basePublicPrice, priceMultiplier);
            return (
              <div key={pkg.size} className={`${getNetworkCardColors(selected).card} rounded-xl p-3 flex flex-col gap-2`}>
                <div className="flex justify-between items-start">
                  <span className={`${getNetworkCardColors(selected).label} text-xs font-semibold`}>{selected}</span>
                  <span className={`${getNetworkCardColors(selected).price} text-xs`}>Price</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className={`${getNetworkCardColors(selected).size} text-2xl font-black`}>{pkg.size}</span>
                  <span className={`${getNetworkCardColors(selected).size} font-bold text-sm`}>GH&#8373; {publicPrice.toFixed(2)}</span>
                </div>
                <button
                  onClick={() => handleBuyClick(selected, pkg.size, publicPrice)}
                  disabled={buyingPkg === key}
                  className={`w-full ${getNetworkCardColors(selected).btn} disabled:opacity-50 text-sm font-semibold py-1.5 rounded-lg transition-colors`}
                >
                  {buyingPkg === key ? "Processing..." : "Buy"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setPhone(""); setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter Recipient Number</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOrder && `${pendingOrder.network} — ${pendingOrder.size} · GH₵ ${pendingOrder.price.toFixed(2)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 px-1">
            <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
            <input
              type="tel"
              placeholder="e.g. 0241234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-transparent text-foreground"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPhone("")}>Cancel</AlertDialogCancel>
            <button
              onClick={() => { if (isPhoneValid) handleConfirmBuy(); }}
              disabled={!isPhoneValid}
              className="inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Confirm &amp; Pay
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BuyData;
