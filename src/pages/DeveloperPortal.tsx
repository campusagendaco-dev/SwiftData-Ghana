import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Code2, Key, Zap, Shield, ArrowRight, Terminal, Puzzle } from "lucide-react";

const DeveloperPortal = () => {
  return (
    <div className="min-h-screen bg-[#030305] text-white selection:bg-amber-400/30">
      {/* Hero Section */}
      <div className="relative pt-20 pb-32 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-amber-500/10 blur-[120px] pointer-events-none" />
        
        <div className="max-w-6xl mx-auto px-6 relative z-10 text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-bold uppercase tracking-widest mb-4">
            <Terminal className="w-3 h-3" /> Developer Hub
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-tight">
            Vending Data <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600">Built for Developers.</span>
          </h1>
          <p className="text-xl text-white/60 max-w-2xl mx-auto">
            Integrate Ghana's fastest data vending engine into your website, mobile app, or USSD platform with just a few lines of code.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-8">
            <Link to="/api-docs">
              <Button size="lg" className="bg-amber-400 text-black hover:bg-amber-300 font-bold h-14 px-8 text-lg rounded-2xl gap-2">
                View API Docs <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Link to="/dashboard/api">
              <Button size="lg" variant="outline" className="border-white/10 hover:bg-white/5 h-14 px-8 text-lg rounded-2xl gap-2">
                <Key className="w-5 h-5 text-amber-400" /> Get API Key
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Card className="bg-white/5 border-white/10 hover:border-amber-400/30 transition-all group">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-amber-400/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Zap className="w-6 h-6 text-amber-400" />
              </div>
              <CardTitle>Lightning Fast</CardTitle>
              <CardDescription className="text-white/40">Real-time delivery with 99.9% uptime for all networks in Ghana.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-white/5 border-white/10 hover:border-amber-400/30 transition-all group">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-blue-400/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Code2 className="w-6 h-6 text-blue-400" />
              </div>
              <CardTitle>Simple REST API</CardTitle>
              <CardDescription className="text-white/40">Clean endpoints, JSON responses, and detailed documentation.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-white/5 border-white/10 hover:border-amber-400/30 transition-all group">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-emerald-400/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Shield className="w-6 h-6 text-emerald-400" />
              </div>
              <CardTitle>Secure & Robust</CardTitle>
              <CardDescription className="text-white/40">Header-based auth, idempotency keys, and IP whitelisting.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Code Snippet Preview */}
      <div className="max-w-6xl mx-auto px-6 py-20 bg-amber-400/[0.02] border-y border-white/5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <h2 className="text-4xl font-bold tracking-tight">Integrate in minutes, not days.</h2>
            <p className="text-white/60 text-lg">
              Our API is designed by developers, for developers. Whether you use Node.js, Python, or PHP, our endpoints are easy to consume and highly reliable.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="bg-amber-400/20 p-1.5 rounded-lg mt-1"><Puzzle className="w-4 h-4 text-amber-400" /></div>
                <div>
                  <p className="font-bold">No hidden fees</p>
                  <p className="text-sm text-white/40">Only pay for the data packages you purchase.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="relative group">
            <div className="absolute inset-0 bg-amber-400/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative bg-[#0d0d12] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
              <div className="flex items-center gap-1.5 px-4 py-3 bg-white/5 border-b border-white/10">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-white/30">Node.js Integration</span>
              </div>
              <pre className="p-6 text-xs md:text-sm font-mono text-emerald-400/90 leading-relaxed overflow-x-auto">
{`const response = await fetch('https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api/buy', {
  method: 'POST',
  headers: {
    'x-api-key': 'sdg_live_XXXXXXXXXX',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    network: 'MTN',
    plan_id: 'mtn-1gb-30days',
    phone: '054XXXXXXX'
  })
});`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="max-w-6xl mx-auto px-6 py-32 text-center space-y-8">
        <h2 className="text-4xl font-bold tracking-tight">Ready to build the future of data?</h2>
        <p className="text-white/60 max-w-xl mx-auto">
          Join 50+ developers who are already using our infrastructure to power their businesses.
        </p>
        <div className="flex justify-center gap-4">
           <Link to="/dashboard/api">
              <Button size="lg" className="bg-white text-black hover:bg-white/90 font-bold rounded-2xl px-8 h-14">
                Get Started Now
              </Button>
           </Link>
        </div>
      </div>
    </div>
  );
};

export default DeveloperPortal;
