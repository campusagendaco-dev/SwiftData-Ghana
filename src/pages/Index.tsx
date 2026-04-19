import { ArrowRight, MessageCircle, ShieldCheck, Wallet, LineChart, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

const Index = () => {
  const [supportChannelLink, setSupportChannelLink] = useState("https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m");

  useEffect(() => {
    const loadSupportLink = async () => {
      const { data } = await supabase.functions.invoke("system-settings", {
        body: { action: "get" },
      });
      const link = String((data as any)?.support_channel_link || "").trim();
      if (link) setSupportChannelLink(link);
    };
    loadSupportLink();
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,hsl(48_96%_53%/0.1),transparent_55%)]">
      <section className="pt-28 pb-14 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="font-display text-4xl md:text-6xl font-black leading-tight">
            Your Data Business,
            <br />
            One Clean Dashboard.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl mx-auto text-base md:text-lg">
            Sign in to manage wallet purchases, track every transaction, and scale into agent mode with your own public shop.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" asChild>
              <Link to="/login">Sign In / Create Account <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/agent-program">Become an Agent</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="pb-10 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 md:p-5 flex items-start gap-3 mb-6">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5" />
            <p className="text-sm md:text-base text-foreground">
              Agent accounts unlock lower bundle rates and your own public store where customers can pay directly via Paystack.
            </p>
          </div>
        </div>
      </section>

      <section className="pb-12 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <Wallet className="w-5 h-5 text-primary mb-3" />
              <h3 className="font-display text-lg font-bold mb-1">Wallet First Purchases</h3>
              <p className="text-sm text-muted-foreground">Top up with Paystack, then buy bundles directly from your dashboard wallet.</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <LineChart className="w-5 h-5 text-primary mb-3" />
              <h3 className="font-display text-lg font-bold mb-1">Transaction Clarity</h3>
              <p className="text-sm text-muted-foreground">Track paid orders, deposits, and status updates from one transaction center.</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <Store className="w-5 h-5 text-primary mb-3" />
              <h3 className="font-display text-lg font-bold mb-1">Scale With My Shop</h3>
              <p className="text-sm text-muted-foreground">Activate agent access to unlock lower rates and your public Paystack-powered store.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <PhoneOrderTracker
            title="Track Data Delivery by Phone"
            subtitle="Enter your purchase number to check payment and delivery status instantly."
          />
        </div>
      </section>

      {/* Floating WhatsApp Button */}
      <a
        href={supportChannelLink}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#25D366] hover:bg-[#1da851] text-[hsl(0,0%,100%)] font-semibold px-5 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 animate-fade-in"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="hidden sm:inline">Join WhatsApp Channel</span>
        <span className="sm:hidden">WhatsApp</span>
      </a>
    </div>
  );
};

export default Index;
