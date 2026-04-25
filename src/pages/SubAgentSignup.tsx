import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Users2, TrendingUp, CheckCircle2,
  Store, CircleDollarSign, Eye, EyeOff,
  Sparkles, Mail, Lock, Phone, ShoppingBag,
  X, ArrowLeft, BadgeCheck, Zap
} from "lucide-react";
import StoreNavbar from "@/components/StoreNavbar";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { invokePublicFunction } from "@/lib/public-function-client";

interface ParentAgent {
  user_id: string;
  store_name: string;
  full_name: string;
  sub_agent_activation_markup: number;
  whatsapp_number?: string;
}

function generateSlug(name: string, parentSlug: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 20);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${parentSlug}-${base}-${rand}`;
}

const SubAgentSignup = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [agent, setAgent] = useState<ParentAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("user_id, store_name, full_name, sub_agent_activation_markup, whatsapp_number")
          .eq("slug", slug)
          .eq("agent_approved", true)
          .maybeSingle();

        if (error || !data) { setNotFound(true); setLoading(false); return; }
        setAgent(data as unknown as ParentAgent);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password || !phone.trim()) {
      toast({ title: "All fields are required", variant: "destructive" }); return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" }); return;
    }
    setSubmitting(true);

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError || !authData.user) {
      toast({ title: "Sign up failed", description: signUpError?.message || "Please try again.", variant: "destructive" });
      setSubmitting(false); return;
    }

    const userId = authData.user.id;
    const autoStoreName = storeName.trim() || `${fullName.trim().split(" ")[0]}'s Store`;
    const autoSlug = generateSlug(fullName.trim(), slug || "store");

    await supabase.from("profiles").update({
      full_name: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      whatsapp_number: phone.trim(),
      store_name: autoStoreName,
      slug: autoSlug,
      is_sub_agent: true,
      parent_agent_id: agent!.user_id,
    } as any).eq("user_id", userId);

    toast({ title: "Account created!", description: "Initializing activation payment..." });
    
    // Initialize payment immediately
    const totalFee = Math.max(0, Number(agent!.sub_agent_activation_markup || 0));
    const orderId = crypto.randomUUID();
    const agentProfitShare = Math.max(0, parseFloat((totalFee - 80).toFixed(2)));
    const swiftDataShare = parseFloat((totalFee - agentProfitShare).toFixed(2));

    if (totalFee > 0) {
      const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
        body: {
          email: email.trim(),
          amount: totalFee,
          reference: orderId,
          callback_url: `${getAppBaseUrl()}/sub-agent/pending?reference=${orderId}`,
          metadata: {
            order_id: orderId,
            order_type: "sub_agent_activation",
            sub_agent_id: userId,
            agent_id: agent!.user_id,
            parent_agent_id: agent!.user_id,
            activation_fee: totalFee,
            paystack_fee: 0,
            agent_profit: agentProfitShare,
            swiftdata_share: swiftDataShare,
          },
        },
      });

      if (paymentError || !paymentData?.authorization_url) {
        toast({ 
          title: "Payment initialization failed", 
          description: "Your account was created, but we couldn't start the payment. Please go to the pending page to pay.", 
          variant: "destructive" 
        });
        navigate("/sub-agent/pending");
      } else {
        window.location.href = paymentData.authorization_url;
      }
    } else {
      // If fee is 0, just go to pending/dashboard
      navigate("/sub-agent/pending");
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030305]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-400/20 border-t-amber-400 rounded-full animate-spin" />
          <p className="text-white/40 text-sm font-bold tracking-widest uppercase">Initializing Portal...</p>
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030305] px-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-[2.5rem] bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6">
            <X className="w-10 h-10 text-white/20" />
          </div>
          <h1 className="text-2xl font-black text-white mb-2">Unavailable</h1>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">This store is not accepting new sub-agents at the moment.</p>
          <Link to="/" className="inline-flex items-center gap-2 text-amber-400 font-bold hover:text-amber-300 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Return to Home
          </Link>
        </div>
      </div>
    );
  }

  const activationFee = Math.max(0, Number(agent.sub_agent_activation_markup || 0));

  return (
    <div className="min-h-screen flex flex-col bg-[#030305] text-white selection:bg-amber-400/30">
      
      {/* ── Mesh Background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-amber-400/5 rounded-full blur-[140px]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.02]" 
          style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "40px 40px" }} 
        />
      </div>

      <StoreNavbar
        storeName={agent.store_name}
        agentSlug={slug}
        whatsappNumber={agent.whatsapp_number}
        backMode
        backLabel={`Back to ${agent.store_name}`}
        backHref={`/store/${slug}`}
        stepLabel="Sub-Agent Signup"
      />

      <div className="relative z-10 flex-1 flex items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-[440px] space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">

          {/* Hero */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 backdrop-blur-md mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-400/80 text-[10px] font-black uppercase tracking-widest">Reseller Program</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight leading-none">Become a <br /> Sub-Agent</h1>
            <p className="text-white/40 text-sm leading-relaxed">
              Launch your own store under <strong className="text-white/70">{agent.store_name}</strong> and earn instant profit.
            </p>
          </div>

          {/* Benefit Cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Store, label: "Own Store", color: "text-amber-400" },
              { icon: CircleDollarSign, label: "Daily Profit", color: "text-emerald-400" },
              { icon: TrendingUp, label: "Growth", color: "text-sky-400" },
            ].map((b) => (
              <div key={b.label} className="rounded-2xl p-4 text-center border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl shadow-2xl transition-transform hover:scale-105">
                <b.icon className={`w-6 h-6 mx-auto mb-2 ${b.color}`} />
                <p className="text-white/60 text-[10px] font-black uppercase tracking-wider">{b.label}</p>
              </div>
            ))}
          </div>

          {/* Fee Ticket */}
          <div className="relative rounded-[2rem] overflow-hidden p-6 border-2 border-amber-400/20 bg-amber-400/[0.03] backdrop-blur-2xl shadow-3xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="relative flex items-center justify-between gap-6">
              <div className="space-y-1">
                <p className="text-amber-400 text-xs font-black uppercase tracking-widest">Activation Fee</p>
                <p className="text-white/40 text-[11px] leading-snug">One-time payment for <br /> lifetime portal access.</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-black text-white tracking-tighter">₵{activationFee.toFixed(2)}</p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400/60 text-[9px] font-black uppercase">Instant</span>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="rounded-[2.5rem] border border-white/10 bg-[#08080A]/60 backdrop-blur-3xl p-8 sm:p-10 shadow-3xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-4">
                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-1">Full Name</label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-amber-400 transition-colors">
                      <Users2 className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Kwame Mensah"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-1">Email Address</label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-amber-400 transition-colors">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-1">Secure Password</label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-amber-400 transition-colors">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPwd ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-12 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 transition-all"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors"
                    >
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-1">Phone / WhatsApp</label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-amber-400 transition-colors">
                      <Phone className="w-4 h-4" />
                    </div>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="024XXXXXXX"
                      maxLength={10}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Store Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-1">Store Name (Optional)</label>
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-amber-400 transition-colors">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      placeholder="Leave blank to auto-generate"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 transition-all"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full relative flex items-center justify-center gap-2 rounded-2xl py-4 font-black text-black text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed group overflow-hidden shadow-2xl shadow-amber-400/20 mt-4"
                style={{ background: "#f59e0b" }}
              >
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 pointer-events-none" />
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating Account...</>
                  : <><CheckCircle2 className="w-4 h-4" /> Signup & Pay Activation</>}
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-white/5 text-center">
              <p className="text-xs text-white/30">
                Already have an account?{" "}
                <Link to="/login" className="text-amber-400 hover:text-amber-300 font-black transition-colors ml-1">Sign in here</Link>
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-white/10 text-[10px] font-black uppercase tracking-[0.3em] py-4">
            <Zap className="w-3 h-3 text-amber-400" />
            SwiftData Ghana Ecosystem
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubAgentSignup;
