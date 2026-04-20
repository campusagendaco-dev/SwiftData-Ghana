import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Loader2 } from "lucide-react";
import { basePackages, getPublicPrice } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";

const networkRouteMap: Record<NetworkName, string> = {
  MTN: "mtn",
  Telecel: "telecel",
  AirtelTigo: "airteltigo",
};

interface DashboardBuyDataNetworkProps {
  network: NetworkName;
}

interface GlobalPackageSetting {
  network: string;
  package_size: string;
  public_price: number | null;
  agent_price: number | null;
  is_unavailable: boolean;
}

const normalizePackageSize = (size: string) => size.replace(/\s+/g, "").toUpperCase();

const getAssignedSubAgentPrice = (
  profile: any,
  network: string,
  size: string,
): number | null => {
  if (!profile?.is_sub_agent) return null;
  const assigned = profile?.agent_prices as Record<string, Record<string, string | number>> | undefined;
  if (!assigned || typeof assigned !== "object") return null;

  const networkCandidates = [
    network,
    network.replace(/\s+/g, ""),
    network === "AT iShare" ? "AirtelTigo" : network,
  ];
  const sizeCandidates = [size, size.replace(/\s+/g, ""), size.toUpperCase()];

  for (const n of networkCandidates) {
    const byNetwork = assigned[n];
    if (!byNetwork) continue;
    for (const s of sizeCandidates) {
      const value = Number(byNetwork[s]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
};

const DashboardBuyDataNetwork = ({ network }: DashboardBuyDataNetworkProps) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalPackageSetting[]>([]);
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  useEffect(() => {
    const loadPricing = async () => {
      const [settingsRes, pricingContext] = await Promise.all([
        supabase.from("global_package_settings").select("network, package_size, public_price, agent_price, is_unavailable"),
        fetchApiPricingContext(),
      ]);
      setGlobalSettings((settingsRes.data || []) as GlobalPackageSetting[]);
      setPriceMultiplier(pricingContext.multiplier);
    };

    void loadPricing();
  }, []);

  const packages = useMemo(() => {
    return (basePackages[network] || [])
      .map((item) => {
        const setting = globalSettings.find(
          (s) => s.network === network && normalizePackageSize(s.package_size) === normalizePackageSize(item.size),
        );

        const assignedPrice = getAssignedSubAgentPrice(profile, network, item.size);
        const basePublic = Number(setting?.public_price);
        const baseAgent = Number(setting?.agent_price);

        const resolvedBasePrice = (() => {
          if (assignedPrice && assignedPrice > 0) return assignedPrice;
          if (isPaidAgent) {
            if (Number.isFinite(baseAgent) && baseAgent > 0) return baseAgent;
            return item.price;
          }
          if (Number.isFinite(basePublic) && basePublic > 0) return basePublic;
          return getPublicPrice(item.price);
        })();

        return {
          ...item,
          isUnavailable: Boolean(setting?.is_unavailable),
          price: applyPriceMultiplier(resolvedBasePrice, priceMultiplier),
        };
      })
      .filter((item) => !item.isUnavailable);
  }, [globalSettings, isPaidAgent, network, priceMultiplier, profile]);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();
      setWalletBalance(Number(data?.balance || 0));
    };
    void load();
  }, [user]);

  const selectedPackage = packages.find((item) => item.size === selectedSize);
  const cardColors = getNetworkCardColors(network);

  const refreshBalance = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", user.id)
      .maybeSingle();
    setWalletBalance(Number(data?.balance || 0));
  };

  const handleBuy = async () => {
    if (!selectedPackage || !phone.trim()) {
      toast({ title: "Select package and phone", variant: "destructive" });
      return;
    }

    const normalizedPhone = phone.replace(/\D+/g, "");
    if (!(normalizedPhone.length === 10 || normalizedPhone.length === 12 || normalizedPhone.length === 9)) {
      toast({ title: "Invalid phone number", description: "Use a valid Ghana number.", variant: "destructive" });
      return;
    }

    setBuying(true);
    const { data, error } = await invokePublicFunctionAsUser("wallet-buy-data", {
      body: {
        network,
        package_size: selectedPackage.size,
        customer_phone: phone,
        amount: selectedPackage.price,
      },
    });

    if (error || data?.error) {
      const description = data?.error || await getFunctionErrorMessage(error, "Could not complete purchase.");
      toast({ title: "Purchase failed", description, variant: "destructive" });
      setBuying(false);
      return;
    }

    toast({
      title: "Order placed",
      description: data?.status === "fulfilled" ? "Data delivered successfully." : "Your order is being processed.",
    });

    if (data?.status === "fulfilled") {
      const successParams = new URLSearchParams({
        source: "wallet",
        network,
        package: selectedPackage.size,
        phone,
      });
      if (typeof data?.order_id === "string" && data.order_id) {
        successParams.set("reference", data.order_id);
      }
      navigate(`/purchase-success?${successParams.toString()}`);
    }

    setPhone("");
    setSelectedSize("");
    await refreshBalance();
    setBuying(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Buy {network} Data</h1>
          <p className="text-sm text-muted-foreground">All purchases are deducted from your wallet balance.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/dashboard/wallet")}>Load Wallet</Button>
      </div>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="pt-6 space-y-3">
          {!isPaidAgent ? (
            <>
              <p className="text-sm">
                Agents get cheaper bundle prices. Activate your agent access for GHS 80 to unlock agent rates and your store tools.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/agent-program")}>Become an Agent</Button>
                <Button variant="outline" onClick={() => navigate("/dashboard/my-store")}>My Shop</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">You are currently buying with agent prices. Manage your store and pricing from My Shop.</p>
              <Button variant="outline" onClick={() => navigate("/dashboard/my-store")}>Go to My Shop</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" /> Wallet Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-display text-3xl font-bold">GH₵ {(walletBalance || 0).toFixed(2)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buy Bundle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Package Size</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
              {packages.map((item) => (
                <button
                  key={item.size}
                  type="button"
                  onClick={() => setSelectedSize(item.size)}
                  className={`${cardColors.card} rounded-xl p-3 flex flex-col gap-2 border transition-colors ${selectedSize === item.size ? "ring-2 ring-primary/40" : ""}`}
                >
                  <div className="flex justify-between items-start">
                    <span className={`${cardColors.label} text-xs font-semibold`}>{network}</span>
                    <span className={`${cardColors.price} text-xs`}>Price</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className={`${cardColors.size} text-2xl font-black`}>{item.size}</span>
                    <span className={`${cardColors.size} font-bold text-sm`}>GH₵ {item.price.toFixed(2)}</span>
                  </div>
                  <span className={`w-full ${cardColors.btn} text-sm font-semibold py-1.5 rounded-lg text-center`}>
                    {selectedSize === item.size ? "Selected" : "Select"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="customer-phone">Customer Phone</Label>
            <Input
              id="customer-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1"
              placeholder="0241234567"
            />
          </div>

          <Button onClick={handleBuy} disabled={buying || !selectedPackage}>
            {buying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Buying...</> : "Buy from Wallet"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        {(["MTN", "Telecel", "AirtelTigo"] as NetworkName[]).map((name) => (
          <Button
            key={name}
            variant={name === network ? "default" : "outline"}
            onClick={() => navigate(`/dashboard/buy-data/${networkRouteMap[name]}`)}
          >
            {name}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default DashboardBuyDataNetwork;
