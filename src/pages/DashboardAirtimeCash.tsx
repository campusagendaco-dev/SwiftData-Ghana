import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { 
  CreditCard, Smartphone, ArrowRightLeft, Loader2, 
  Info, ShieldCheck, AlertCircle, History, Clock,
  ArrowRight, Sparkles, Zap
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
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20 flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 fill-amber-400/20" /> Best Rates in GH
            </span>
            <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 text-[10px] font-bold uppercase tracking-wider border border-sky-500/20">Verified</span>
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight text-white flex items-center gap-3">
            <ArrowRightLeft className="w-8 h-8 text-sky-400" /> Airtime to Cash
          </h1>
          <p className="text-white/40 text-sm max-w-md">
            Convert your excess airtime into wallet funds at premium rates. Fast verification guaranteed.
          </p>
        </div>
        
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Platform Fee</p>
            <p className="text-lg font-black text-white">{FEE_PERCENTAGE}%</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
        
        {/* Conversion Form Card */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-[2.5rem] p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-sky-500/5 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
          
          <form onSubmit={handleSubmit} className="relative z-10 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Left Column */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Network</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {["MTN", "Telecel"].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm({ ...form, network: n })}
                        className={cn(
                          "h-14 rounded-2xl border-2 font-black text-sm transition-all flex items-center justify-center gap-2",
                          form.network === n 
                            ? "bg-sky-500/10 border-sky-500 text-white shadow-lg shadow-sky-500/10" 
                            : "bg-white/[0.02] border-white/10 text-white/30 hover:border-white/20 hover:text-white/60"
                        )}
                      >
                        {n}
                        {form.network === n && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="atc-phone" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Sender Phone</Label>
                  <div className="relative group">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-sky-400 transition-colors" />
                    <Input
                      id="atc-phone"
                      value={form.senderPhone}
                      onChange={(e) => setForm({ ...form, senderPhone: e.target.value })}
                      placeholder="024 XXX XXXX"
                      className="bg-white/[0.03] border-white/10 h-14 pl-12 rounded-2xl text-white font-bold placeholder:text-white/10 focus:border-sky-500/50"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="atc-amount" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Airtime Amount (GHS)</Label>
                  <div className="relative group">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl text-white/20 group-focus-within:text-sky-400 transition-colors">₵</span>
                    <Input
                      id="atc-amount"
                      type="number"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      placeholder="0.00"
                      className="bg-white/[0.03] border-white/10 h-14 pl-10 rounded-2xl text-2xl font-black text-white placeholder:text-white/10 focus:border-sky-500/50"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Cash Value to Wallet</Label>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 h-14 rounded-2xl flex items-center px-6 font-black text-emerald-400 text-2xl tracking-tight">
                    ₵{cashValue.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="atc-ref" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Transaction ID / Reference (Optional)</Label>
              <Input
                id="atc-ref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="Paste the reference code from the transfer SMS here"
                className="bg-white/[0.03] border-white/10 h-14 px-5 rounded-2xl text-white font-bold placeholder:text-white/10 focus:border-sky-500/50"
              />
            </div>

            {/* Steps Info Box */}
            <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.05] space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-sky-400 flex items-center gap-2">
                <Info className="w-4 h-4" /> Instructions
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { step: "01", text: "Transfer airtime to 0540309637" },
                  { step: "02", text: "Fill this form with your details" },
                  { step: "03", text: "Get credited in 15-30 minutes" },
                ].map((s, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Step {s.step}</span>
                    <p className="text-xs text-white/50 leading-snug">{s.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={loading || !form.amount || !form.senderPhone}
              className="w-full h-16 rounded-2xl text-lg font-black bg-gradient-to-r from-sky-500 to-indigo-600 hover:scale-[1.01] transition-transform shadow-xl shadow-sky-500/20"
            >
              {loading ? (
                <><Loader2 className="w-5 h-5 animate-spin mr-3" /> Processing Request...</>
              ) : (
                <><ArrowRightLeft className="w-5 h-5 mr-3" /> Submit Conversion Request</>
              )}
            </Button>
          </form>
        </div>

        {/* Recent History Sidebar */}
        <div className="space-y-6">
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-[2.5rem] p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-white text-base uppercase tracking-widest opacity-40">Recent History</h3>
              <Button variant="ghost" size="sm" onClick={fetchRequests} className="h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white hover:bg-white/5">
                Refresh
              </Button>
            </div>
            
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {fetching ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 bg-white/5 rounded-3xl animate-pulse" />
                ))
              ) : requests.length > 0 ? (
                requests.map((r) => (
                  <div key={r.id} className="p-5 rounded-[2rem] bg-white/[0.02] border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center border",
                        r.status === "approved" ? "bg-emerald-500/10 border-emerald-500/20" : r.status === "rejected" ? "bg-red-500/10 border-red-500/20" : "bg-amber-400/10 border-amber-400/20"
                      )}>
                        {r.status === "approved" ? <ShieldCheck className="w-6 h-6 text-emerald-500" /> : r.status === "rejected" ? <AlertCircle className="w-6 h-6 text-red-500" /> : <Clock className="w-6 h-6 text-amber-400" />}
                      </div>
                      <div>
                        <p className="text-white font-black text-sm">₵{r.amount.toFixed(2)}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mt-1">{r.network} · {new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-emerald-400">+₵{r.cash_value.toFixed(2)}</p>
                      <Badge className={cn(
                        "mt-1.5 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 border-none rounded-full",
                        r.status === "approved" ? "bg-emerald-500 text-white" : r.status === "rejected" ? "bg-red-500 text-white" : "bg-amber-400 text-black"
                      )}>
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-20 text-center bg-white/[0.01] rounded-[3rem] border border-dashed border-white/10">
                  <History className="w-10 h-10 text-white/5 mx-auto mb-4" />
                  <p className="text-white/20 text-xs font-bold uppercase tracking-widest">No history yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/10 rounded-3xl p-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1">Secure Exchange</h3>
              <p className="text-[11px] text-white/40 leading-relaxed">
                All airtime-to-cash conversions are protected by our trade-safe protocol. Verification is performed by human admins to ensure accuracy.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
};

const CheckCircle2 = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
  </svg>
);

const Phone = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

export default DashboardAirtimeCash;
