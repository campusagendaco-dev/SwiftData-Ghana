import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { 
  CreditCard, Smartphone, ArrowRightLeft, Loader2, 
  Info, ShieldCheck, AlertCircle, History, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const DashboardAirtimeCash = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);

  const [form, setForm] = useState({
    network: "MTN",
    amount: "",
    senderPhone: "",
    reference: "",
  });

  const FEE_PERCENTAGE = 20; // 20% platform fee
  const airtimeAmount = Number(form.amount) || 0;
  const cashValue = airtimeAmount * (1 - FEE_PERCENTAGE / 100);

  useEffect(() => {
    if (user) fetchRequests();
  }, [user]);

  const fetchRequests = async () => {
    setFetching(true);
    const { data } = await supabase
      .from("airtime_to_cash_requests")
      .select("*")
      .order("created_at", { ascending: false });
    setRequests(data || []);
    setFetching(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.amount || !form.senderPhone) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from("airtime_to_cash_requests")
      .insert([
        {
          user_id: user.id,
          network: form.network,
          amount: airtimeAmount,
          cash_value: cashValue,
          sender_phone: form.senderPhone,
          reference_code: form.reference,
          status: "pending",
        }
      ]);

    if (error) {
      toast({ title: "Error submitting request", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Request submitted!", description: "An admin will verify and credit your wallet shortly." });
      setForm({ network: "MTN", amount: "", senderPhone: "", reference: "" });
      fetchRequests();
    }
    setLoading(false);
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <CreditCard className="w-8 h-8 text-primary" />
            Airtime to Cash
          </h1>
          <p className="text-white/40 text-sm mt-1">Convert your excess airtime into wallet funds at the best rates.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Conversion Form */}
        <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 backdrop-blur-xl space-y-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Smartphone className="w-32 h-32" />
          </div>
          
          <div className="relative z-10 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <ArrowRightLeft className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">New Conversion</h2>
                <p className="text-white/40 text-xs">Send airtime and get cash in your wallet.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-white/40">Select Network</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {["MTN", "Telecel"].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm({ ...form, network: n })}
                        className={cn(
                          "px-4 py-3 rounded-xl border text-sm font-bold transition-all",
                          form.network === n 
                            ? "bg-primary/20 border-primary text-white" 
                            : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="atc-phone" className="text-xs font-black uppercase tracking-widest text-white/40">Sender Phone</Label>
                  <Input
                    id="atc-phone"
                    value={form.senderPhone}
                    onChange={(e) => setForm({ ...form, senderPhone: e.target.value })}
                    placeholder="024XXXXXXX"
                    className="bg-white/5 border-white/10 h-12 rounded-xl"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="atc-amount" className="text-xs font-black uppercase tracking-widest text-white/40">Airtime Amount (GHS)</Label>
                  <Input
                    id="atc-amount"
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    className="bg-white/5 border-white/10 h-12 rounded-xl text-lg font-black"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-white/40">You will receive</Label>
                  <div className="bg-primary/10 border border-primary/20 h-12 rounded-xl flex items-center px-4 font-black text-primary text-lg">
                    ₵{cashValue.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="atc-ref" className="text-xs font-black uppercase tracking-widest text-white/40">Transaction ID / Reference (Optional)</Label>
                <Input
                  id="atc-ref"
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="Paste transaction ID from SMS"
                  className="bg-white/5 border-white/10 h-12 rounded-xl"
                />
              </div>

              <div className="p-4 rounded-2xl bg-amber-400/5 border border-amber-400/20 space-y-3">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-100/60 leading-relaxed">
                    <p className="font-bold text-amber-400 mb-1">How to convert:</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Transfer the airtime to our number: <span className="text-white font-black">0540309637</span></li>
                      <li>Fill this form with your details.</li>
                      <li>Our team will verify the transfer and credit your wallet within 15-30 minutes.</li>
                    </ol>
                  </div>
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={loading || !form.amount || !form.senderPhone}
                className="w-full h-14 rounded-2xl text-base font-black shadow-xl shadow-primary/20 mt-4"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ArrowRightLeft className="w-5 h-5 mr-2" />}
                Submit Conversion Request
              </Button>
            </form>
          </div>
        </div>

        {/* History / Info */}
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Recent Requests
              </h3>
              <Button variant="ghost" size="sm" onClick={fetchRequests} className="text-white/40 hover:text-white">
                Refresh
              </Button>
            </div>
            
            <div className="space-y-4">
              {fetching ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />
                ))
              ) : requests.length > 0 ? (
                requests.map((r) => (
                  <div key={r.id} className="p-5 rounded-[2rem] bg-white/[0.02] border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center",
                        r.status === "approved" ? "bg-emerald-500/10" : r.status === "rejected" ? "bg-red-500/10" : "bg-amber-400/10"
                      )}>
                        {r.status === "approved" ? <ShieldCheck className="w-6 h-6 text-emerald-500" /> : r.status === "rejected" ? <AlertCircle className="w-6 h-6 text-red-500" /> : <Clock className="w-6 h-6 text-amber-400" />}
                      </div>
                      <div>
                        <p className="text-white font-bold text-sm">₵{r.amount.toFixed(2)} Airtime</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mt-0.5">{r.network} · {new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-white">₵{r.cash_value.toFixed(2)} Cash</p>
                      <Badge className={cn(
                        "mt-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 border-none",
                        r.status === "approved" ? "bg-emerald-500 text-white" : r.status === "rejected" ? "bg-red-500 text-white" : "bg-amber-400 text-black"
                      )}>
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-20 text-center bg-white/[0.02] rounded-[3rem] border border-dashed border-white/10">
                  <CreditCard className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/40 text-sm">No conversion requests yet.</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-[2.5rem] p-8">
            <h3 className="text-lg font-bold text-white mb-2">Safe & Reliable</h3>
            <p className="text-white/40 text-sm leading-relaxed">
              Join thousands of Ghanaians who trust us with their airtime conversion. Our system is fast, secure, and fully automated for approvals once the transfer is confirmed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardAirtimeCash;
