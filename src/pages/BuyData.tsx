import { useState, useEffect } from "react";
import NetworkCard from "@/components/NetworkCard";
import DataPackageCard from "@/components/DataPackageCard";
import { basePackages, networks, getPublicPrice } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
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

    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: `${phone.replace(/\s/g, "")}@customer.datahive.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?reference=${orderId}`,
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
        {systemSettings.holiday_mode_enabled && (
          <div className="mb-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-200">
            {systemSettings.holiday_message}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {networks.map((n) => (
            <NetworkCard
              key={n.name}
              name={n.name}
              color={n.color}
              selected={selected === n.name}
              onClick={() => { setSelected(n.name); setSelectedPkg(null); setPhone(""); }}
            />
          ))}
        </div>

        <h2 className="font-display text-xl font-semibold mb-4">{selected} Data Packages</h2>
        <div className="space-y-4">
          {basePackages[selected]?.map((pkg) => {
            const key = `${selected}-${pkg.size}`;
            const gs = globalSettings[key];
            const isUnavailable = gs?.is_unavailable || false;
            if (isUnavailable) return null;

            const publicPrice = gs?.public_price ?? getPublicPrice(pkg.price);
            const { fee, total } = getTotal(publicPrice);
            return (
              <DataPackageCard
                key={pkg.size}
                size={pkg.size}
                price={publicPrice.toFixed(2)}
                validity={pkg.validity}
                popular={pkg.popular}
                isSelected={selectedPkg === key}
                phone={selectedPkg === key ? phone : ""}
                onPhoneChange={(val) => setPhone(val)}
                isPhoneValid={isPhoneValid}
                fee={selectedPkg === key ? fee : undefined}
                total={selectedPkg === key ? total : undefined}
                buying={buyingPkg === key}
                onSelect={() => handleSelectPackage(selected, pkg.size)}
                onBuy={() => handleBuyClick(selected, pkg.size, publicPrice)}
              />
            );
          })}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Recipient Number</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to purchase data for:
              <span className="block text-foreground font-bold text-lg mt-2">{phone}</span>
              <span className="block mt-2">Please make sure this is the correct number before proceeding.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBuy}>Buy Now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BuyData;
