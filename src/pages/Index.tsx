import { ArrowRight, Shield, Zap, Users, Globe, TrendingUp, Signal, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const networks = [
  { name: "MTN", color: "#FFCC00" },
  { name: "Telecel", color: "#E60000" },
  { name: "AirtelTigo", color: "#2196F3" },
];

const features = [
  { icon: Zap, title: "Instant Delivery", desc: "Data delivered to any number in seconds, 24/7." },
  { icon: Shield, title: "Secure Payments", desc: "Mobile money & bank payments, fully encrypted." },
  { icon: Users, title: "Agent Platform", desc: "Become an agent, set your prices, earn profits." },
  { icon: Globe, title: "All Networks", desc: "MTN, Telecel & AirtelTigo supported." },
  { icon: TrendingUp, title: "Agent Dashboard", desc: "Track sales, manage sub-agents, grow your business." },
];

const Index = () => (
  <div className="min-h-screen">
    {/* Hero */}
    <section className="relative pt-32 pb-20 px-4 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(48_100%_50%/0.06),transparent_60%)]" />
      <div className="container mx-auto text-center relative z-10">
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-6 text-sm text-primary font-medium animate-fade-in">
          <Zap className="w-4 h-4" /> Ghana's #1 Data Reselling Platform
        </div>
        <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          Buy Data for <span className="text-gradient">All Networks</span> <br />in Ghana — Instantly
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          Affordable data bundles for MTN, Telecel & AirtelTigo. Become an agent and earn by reselling with your own branded platform.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: "0.3s" }}>
          <Button size="lg" asChild>
            <Link to="/buy-data">Buy Data Now <ArrowRight className="ml-2 w-4 h-4" /></Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/agent-program">Become an Agent</Link>
          </Button>
        </div>

        {/* Network badges */}
        <div className="flex justify-center gap-4 mt-12 animate-fade-in" style={{ animationDelay: "0.4s" }}>
          {networks.map((n) => (
            <div key={n.name} className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2">
              <Signal className="w-4 h-4" style={{ color: n.color }} />
              <span className="text-sm font-medium text-foreground">{n.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Features */}
    <section className="py-20 px-4">
      <div className="container mx-auto">
        <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-4">Why QuickData GH?</h2>
        <p className="text-center text-muted-foreground mb-12 max-w-lg mx-auto">Everything you need to buy data or start your own data reselling business.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-300 group animate-fade-in"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* CTA */}
    <section className="py-20 px-4">
      <div className="container mx-auto">
        <div className="bg-card border border-border rounded-2xl p-8 md:p-14 text-center glow-yellow">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Ready to Start Selling Data?</h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">Join hundreds of agents earning daily profits by reselling data bundles across Ghana.</p>
          <Button size="lg" asChild>
            <Link to="/agent-program">Start as an Agent <ArrowRight className="ml-2 w-4 h-4" /></Link>
          </Button>
        </div>
      </div>
    </section>

    {/* Floating WhatsApp Button */}
    <a
      href="https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#25D366] hover:bg-[#1da851] text-white font-semibold px-5 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 animate-fade-in"
    >
      <MessageCircle className="w-5 h-5" />
      <span className="hidden sm:inline">Join WhatsApp Channel</span>
      <span className="sm:hidden">WhatsApp</span>
    </a>
  </div>
);

export default Index;
