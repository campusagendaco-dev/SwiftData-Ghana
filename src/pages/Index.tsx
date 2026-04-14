import { ArrowRight, Shield, Zap, Users, Globe, TrendingUp, Signal, MessageCircle, Sparkles, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const networks = [
  { name: "MTN", color: "#FFCC00" },
  { name: "Telecel", color: "#E60000" },
  { name: "AirtelTigo", color: "#2196F3" },
];

const features = [
  { icon: Zap, title: "Instant Delivery", desc: "Data delivered to any number in seconds, 24/7 availability." },
  { icon: Shield, title: "Secure Payments", desc: "Mobile money & Paystack payments, fully encrypted." },
  { icon: Users, title: "Reseller Platform", desc: "Become a reseller, set your prices, and earn profits." },
  { icon: Globe, title: "All Networks", desc: "MTN, Telecel & AirtelTigo — all in one place." },
  { icon: TrendingUp, title: "Reseller Dashboard", desc: "Track sales, set margins, and grow your business." },
  { icon: Sparkles, title: "Non-Expiry Data", desc: "All bundles come with non-expiry validity." },
];

const stats = [
  { value: "10K+", label: "Customers Served" },
  { value: "99.9%", label: "Uptime" },
  { value: "< 5s", label: "Delivery Time" },
  { value: "24/7", label: "Support" },
];

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
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(48_96%_53%/0.12),transparent_60%)]" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-primary/3 rounded-full blur-3xl animate-float" style={{ animationDelay: "3s" }} />
        <div className="container mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-5 py-2 mb-8 text-sm text-primary font-semibold animate-fade-in">
            <Zap className="w-4 h-4" /> Ghana's #1 Data Reselling Platform
          </div>
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-black leading-[1.1] mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            Buy Data for{" "}
            <span className="text-gradient">All Networks</span>
            <br />
            in Ghana — <span className="text-primary">Instantly</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            Non-expiry data bundles for MTN, Telecel & AirtelTigo. Become a reseller and earn daily profits with your own branded store.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: "0.3s" }}>
            <Button size="lg" className="text-base px-8 py-6 rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow" asChild>
              <Link to="/buy-data">
                <Wifi className="mr-2 w-5 h-5" /> Buy Data Now <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-base px-8 py-6 rounded-xl border-primary/30 hover:bg-primary/5" asChild>
              <Link to="/agent-program">Become a Reseller</Link>
            </Button>
          </div>

          {/* Network badges */}
          <div className="flex justify-center gap-4 mt-14 animate-fade-in" style={{ animationDelay: "0.4s" }}>
            {networks.map((n) => (
              <div key={n.name} className="flex items-center gap-2 glass-card rounded-full px-5 py-2.5 hover:border-primary/30 transition-colors">
                <Signal className="w-4 h-4" style={{ color: n.color }} />
                <span className="text-sm font-semibold text-foreground">{n.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 border-y border-border bg-card/30">
        <div className="container mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-display text-3xl md:text-4xl font-black text-primary mb-1">{s.value}</p>
                <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-4">
            Why <span className="text-gradient">SwiftData</span> Ghana?
          </h2>
          <p className="text-center text-muted-foreground mb-14 max-w-lg mx-auto">
            Everything you need to buy data or start your own data reselling business.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="p-6 rounded-2xl glass-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group animate-fade-in"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all">
                  <f.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-display font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="relative glass-card rounded-3xl p-10 md:p-16 text-center glow-yellow overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(48_96%_53%/0.06),transparent_70%)]" />
            <div className="relative z-10">
              <h2 className="font-display text-3xl md:text-4xl font-black mb-4">
                Ready to Start <span className="text-gradient">Selling Data?</span>
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto text-lg">
                Join resellers earning daily profits by selling data bundles across Ghana.
              </p>
              <Button size="lg" className="text-base px-8 py-6 rounded-xl shadow-lg shadow-primary/20" asChild>
                <Link to="/agent-program">Start as a Reseller <ArrowRight className="ml-2 w-4 h-4" /></Link>
              </Button>
            </div>
          </div>
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
