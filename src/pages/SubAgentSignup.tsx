import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Users2, TrendingUp, CheckCircle2,
  Store, CircleDollarSign, Eye, EyeOff,
} from "lucide-react";
import StoreNavbar from "@/components/StoreNavbar";

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
      const { data } = await supabase
        .from("profiles")
        .select("user_id, store_name, full_name, sub_agent_activation_markup, whatsapp_number")
        .eq("slug", slug)
        .eq("is_agent", true)
        .eq("agent_approved", true)
        .eq("is_sub_agent" as any, false)
        .maybeSingle();

      if (!data) { setNotFound(true); setLoading(false); return; }
      setAgent(data as unknown as ParentAgent);
      setLoading(false);
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

    toast({ title: "Account created!", description: "Complete your activation below." });
    navigate("/sub-agent/pending");
    setSubmitting(false);
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0d0d18" }}>
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading store...
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0d0d18" }}>
        <div className="text-center text-white">
          <h1 className="font-display text-2xl font-black mb-2">Not Found</h1>
          <p className="text-white/40 text-sm mb-4">This store isn't accepting sub-agents right now.</p>
          <Link to="/" className="text-amber-400 text-sm hover:underline">← Back to SwiftData</Link>
        </div>
      </div>
    );
  }

  const activationFee = Math.max(0, Number(agent.sub_agent_activation_markup || 0));

  const inputCls = "w-full rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm border border-white/12 focus:outline-none focus:border-amber-400/60 transition-colors";
  const inputStyle = { background: "rgba(255,255,255,0.05)" };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0d0d18" }}>

      <StoreNavbar
        storeName={agent.store_name}
        agentSlug={slug}
        whatsappNumber={agent.whatsapp_number}
        backMode
        backLabel={`Back to ${agent.store_name}`}
        backHref={`/store/${slug}`}
        stepLabel="Sub-Agent Signup"
      />

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-md">

          {/* Hero */}
          <div className="text-center mb-8">
            <div className="relative inline-flex mb-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }}>
                <Users2 className="w-8 h-8 text-amber-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                <TrendingUp className="w-3 h-3 text-black" />
              </span>
            </div>
            <h1 className="font-display text-2xl font-black text-white mb-1">Become a Sub-Agent</h1>
            <p className="text-white/45 text-sm">
              Join <span className="text-amber-400 font-semibold">{agent.store_name}</span> and start reselling data bundles instantly.
            </p>
          </div>

          {/* Benefits */}
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { icon: Store, label: "Own Store", color: "#f59e0b" },
              { icon: CircleDollarSign, label: "Earn Profit", color: "#22c55e" },
              { icon: TrendingUp, label: "Full Dashboard", color: "#3b82f6" },
            ].map((b) => (
              <div key={b.label} className="rounded-xl p-3 text-center border border-white/8" style={{ background: "rgba(255,255,255,0.03)" }}>
                <b.icon className="w-5 h-5 mx-auto mb-1.5" style={{ color: b.color }} />
                <p className="text-white/60 text-[11px] font-semibold">{b.label}</p>
              </div>
            ))}
          </div>

          {/* Activation fee card */}
          <div className="rounded-2xl border border-amber-400/25 p-4 mb-6" style={{ background: "rgba(245,158,11,0.06)" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-amber-300 font-bold text-sm">One-time Activation Fee</p>
                <p className="text-white/40 text-xs mt-0.5">Paid via Paystack after signup — lifetime access</p>
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-black text-2xl">GH₵ {activationFee.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-amber-400/15">
              {["Instant approval", "Your own store link", "Set your prices"].map((f) => (
                <div key={f} className="flex items-center gap-1 text-[10px] text-white/50">
                  <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> {f}
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1.5 uppercase tracking-wide">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Kwame Mensah"
                className={inputCls}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1.5 uppercase tracking-wide">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className={inputCls}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1.5 uppercase tracking-wide">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className={`${inputCls} pr-11`}
                  style={inputStyle}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1.5 uppercase tracking-wide">Phone / WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0241234567"
                maxLength={10}
                className={inputCls}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1.5 uppercase tracking-wide">
                Store Name <span className="text-white/25 font-normal normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Leave blank to auto-generate"
                className={inputCls}
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-black text-black text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 mt-2"
              style={{ background: "#f59e0b" }}
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</>
                : <><Users2 className="w-4 h-4" /> Create Account &amp; Pay GH₵ {activationFee.toFixed(2)}</>}
            </button>
          </form>

          <p className="text-center text-xs text-white/30 mt-5">
            Already have an account?{" "}
            <Link to="/login" className="text-amber-400 hover:text-amber-300 font-semibold transition-colors">Sign in</Link>
          </p>

          <div className="flex items-center justify-center gap-1.5 mt-6 text-white/20 text-[11px]">
            <span>Powered by SwiftData Ghana</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubAgentSignup;
