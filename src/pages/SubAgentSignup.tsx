import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Zap, Users2 } from "lucide-react";

interface ParentAgent {
  user_id: string;
  store_name: string;
  full_name: string;
  sub_agent_activation_markup: number;
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
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, store_name, full_name, sub_agent_activation_markup")
        .eq("slug", slug)
        .eq("is_agent", true)
        .eq("agent_approved", true)
        .eq("onboarding_complete", true)
        .eq("is_sub_agent", false)
        .maybeSingle();

      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setAgent(data as ParentAgent);
      setLoading(false);
    };
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-3xl font-black mb-2">Not Found</h1>
          <p className="text-muted-foreground">This store doesn't exist or isn't accepting sub agents.</p>
        </div>
      </div>
    );
  }

  const activationFee = Math.max(0, Number(agent.sub_agent_activation_markup || 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password || !phone.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // 1. Create auth account
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError || !authData.user) {
      toast({ title: "Sign up failed", description: signUpError?.message || "Please try again.", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const userId = authData.user.id;
    const autoStoreName = storeName.trim() || `${fullName.trim().split(" ")[0]}'s Store`;
    const autoSlug = generateSlug(fullName.trim(), slug || "store");

    // 2. Update profile with sub-agent fields
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        whatsapp_number: phone.trim(),
        store_name: autoStoreName,
        slug: autoSlug,
        is_sub_agent: true,
        parent_agent_id: agent.user_id,
      })
      .eq("user_id", userId);

    if (profileError) {
      console.error("Profile update failed:", profileError);
      // Continue anyway — pending page will show payment form
    }

    toast({ title: "Account created!", description: "Complete your activation below." });
    navigate("/sub-agent/pending");
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-[#162316] px-4 py-3 flex items-center gap-3">
        <img src="/logo.png" alt="SwiftData" className="w-9 h-9" />
        <div>
          <p className="text-white font-bold text-sm leading-tight">{agent.store_name}</p>
          <p className="text-white/50 text-xs">Sub Agent Signup</p>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-amber-400/15 flex items-center justify-center mx-auto mb-4">
              <Users2 className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="font-display text-2xl font-black mb-1">Become a Sub Agent</h1>
            <p className="text-muted-foreground text-sm">
              Join <span className="font-semibold text-foreground">{agent.store_name}</span> and start reselling data instantly.
            </p>
          </div>

          {/* Fee card */}
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-sm">Activation Fee</span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-bold text-foreground border-t border-border pt-1.5 mt-1.5">
                <span>Total</span><span>GH₵ {activationFee.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Sign up form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Kwame Mensah"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Phone / WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0241234567"
                maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Store Name <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Leave blank to auto-generate"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />}
              {submitting ? "Creating account..." : `Create Account & Pay GH₵ ${activationFee.toFixed(2)}`}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-4">
            Already have an account?{" "}
            <a href="/login" className="text-amber-600 hover:underline font-medium">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SubAgentSignup;
