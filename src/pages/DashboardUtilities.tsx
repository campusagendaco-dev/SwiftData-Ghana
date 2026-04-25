import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Zap, Droplets, Tv, Search, Loader2, 
  CreditCard, Wallet, ShieldCheck, Info 
} from "lucide-react";
import { cn } from "@/lib/utils";

type UtilityType = "electricity" | "water" | "tv";

const DashboardUtilities = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<UtilityType>("electricity");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);

  const [form, setForm] = useState({
    provider: "",
    accountNumber: "",
    amount: "",
  });

  const handleVerify = async () => {
    if (!form.accountNumber || !form.provider) {
      toast({ title: "Enter account number and provider", variant: "destructive" });
      return;
    }
    setVerifying(true);
    // Mocking account verification
    setTimeout(() => {
      setAccountName("JOHN DOE ENT.");
      setVerifying(false);
      toast({ title: "Account Verified!" });
    }, 1500);
  };

  const [payMethod, setPayMethod] = useState<"wallet" | "paystack">("paystack");

  const handlePay = async () => {
    if (!accountName || !form.amount) {
      toast({ title: "Please verify account and enter amount", variant: "destructive" });
      return;
    }
    setLoading(true);

    const reference = crypto.randomUUID();
    const amount = Number(form.amount);

    if (payMethod === "wallet") {
      const { data, error } = await supabase.functions.invoke("wallet-pay-utility", {
        body: {
          utility_type: activeTab,
          utility_provider: form.provider,
          utility_account_number: form.accountNumber,
          utility_account_name: accountName,
          amount: amount,
        }
      });

      if (error || data?.error) {
        toast({ title: "Payment failed", description: data?.error || "Insufficient balance or server error", variant: "destructive" });
        setLoading(false);
        return;
      }

      toast({ title: "Payment Successful!", description: "Your bill has been paid from your wallet." });
      setLoading(false);
      setForm({ provider: "", accountNumber: "", amount: "" });
      setAccountName(null);
      return;
    }

    const { data, error } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: user?.email || "customer@swiftdata.gh",
        amount: amount,
        reference: reference,
        callback_url: `${window.location.origin}/dashboard/utilities?ref=${reference}`,
        metadata: {
          order_type: "utility",
          utility_type: activeTab,
          utility_provider: form.provider,
          utility_account_number: form.accountNumber,
          utility_account_name: accountName,
          agent_id: user?.id,
        }
      }
    });

    if (error || !data?.authorization_url) {
      toast({ title: "Payment initialization failed", description: error?.message || "Please try again.", variant: "destructive" });
      setLoading(false);
      return;
    }

    window.location.href = data.authorization_url;
  };

  const tabs = [
    { id: "electricity" as UtilityType, label: "Electricity", icon: Zap, color: "text-amber-400" },
    { id: "water" as UtilityType, label: "Water", icon: Droplets, color: "text-blue-400" },
    { id: "tv" as UtilityType, label: "TV Subscription", icon: Tv, color: "text-purple-400" },
  ];

  const providers = {
    electricity: ["ECG Prepaid", "ECG Postpaid", "NEDCO"],
    water: ["Ghana Water Company"],
    tv: ["DSTV", "GOTV", "StarTimes"],
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Zap className="w-8 h-8 text-primary" />
            Utility Bills
          </h1>
          <p className="text-white/40 text-sm mt-1">Pay for your electricity, water, and TV instantly.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-white/5 border border-white/10 rounded-2xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setForm({ provider: "", accountNumber: "", amount: "" });
              setAccountName(null);
            }}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
              activeTab === tab.id 
                ? "bg-white/10 text-white shadow-lg" 
                : "text-white/40 hover:text-white/60"
            )}
          >
            <tab.icon className={cn("w-4 h-4", activeTab === tab.id ? tab.color : "text-current")} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 backdrop-blur-xl space-y-6">
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-black uppercase tracking-widest text-white/40 mb-2 block">Select Provider</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {providers[activeTab].map((p) => (
                  <button
                    key={p}
                    onClick={() => setForm({ ...form, provider: p })}
                    className={cn(
                      "px-4 py-3 rounded-xl border text-left text-sm font-bold transition-all",
                      form.provider === p 
                        ? "bg-primary/20 border-primary text-white" 
                        : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-no" className="text-xs font-black uppercase tracking-widest text-white/40">
                {activeTab === "electricity" ? "Meter Number" : activeTab === "tv" ? "Smartcard / IUC Number" : "Customer Number"}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="account-no"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  placeholder="e.g. 04123456789"
                  className="bg-white/5 border-white/10 h-12 rounded-xl flex-1"
                />
                <Button 
                  onClick={handleVerify} 
                  disabled={verifying || !form.accountNumber || !form.provider}
                  variant="secondary"
                  className="h-12 px-6 rounded-xl font-bold"
                >
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                </Button>
              </div>
            </div>

            {accountName && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between animate-in zoom-in-95">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/60">Customer Name</p>
                  <p className="text-white font-black">{accountName}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="amount" className="text-xs font-black uppercase tracking-widest text-white/40">Amount (GHS)</Label>
              <Input
                id="amount"
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className="bg-white/5 border-white/10 h-12 rounded-xl text-lg font-black"
              />
            </div>

            <div className="pt-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Select Payment Method</p>
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setPayMethod("wallet")}
                  className={cn(
                    "h-16 rounded-2xl border-white/10 flex flex-col gap-1 items-center justify-center transition-all",
                    payMethod === "wallet" ? "bg-primary/20 border-primary text-white" : "hover:bg-white/5"
                  )}
                >
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="text-xs font-black">Wallet</span>
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setPayMethod("paystack")}
                  className={cn(
                    "h-16 rounded-2xl border-white/10 flex flex-col gap-1 items-center justify-center transition-all",
                    payMethod === "paystack" ? "bg-primary/20 border-primary text-white" : "hover:bg-white/5"
                  )}
                >
                  <CreditCard className="w-4 h-4 text-primary" />
                  <span className="text-xs font-black">Card / MoMo</span>
                </Button>
              </div>
            </div>

            <Button 
              onClick={handlePay} 
              disabled={loading || !accountName || !form.amount}
              className="w-full h-14 rounded-2xl text-base font-black shadow-xl shadow-primary/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
              Pay Bill Now
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gradient-to-br from-primary/10 to-blue-500/10 border border-white/10 rounded-[2.5rem] p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Zap className="w-24 h-24" />
            </div>
            <div className="relative z-10">
              <h3 className="text-xl font-bold text-white mb-3">Why pay with SwiftData?</h3>
              <ul className="space-y-4">
                {[
                  { icon: Zap, text: "Instant Meter Tokens delivered via SMS" },
                  { icon: ShieldCheck, text: "Official receipt generated for every payment" },
                  { icon: Info, text: "Lowest service fees in Ghana" },
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-white/60">
                    <f.icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8">
            <h3 className="text-lg font-bold text-white mb-4">Recent Payments</h3>
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-white/20" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">ECG Prepaid</p>
                      <p className="text-[10px] text-white/40">Meter: 04128...88</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-white">₵50.00</p>
                    <p className="text-[10px] text-emerald-400 font-bold">Successful</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardUtilities;
