import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Code, Terminal, Key, ShieldCheck, Zap, 
  Copy, Check, Book, Globe, Cpu, Lock, 
  ChevronRight, AlertCircle, FileCode, Play
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const AgentDevAPIDocs = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("Code snippet copied");
    setTimeout(() => setCopied(null), 2000);
  };

  const codeSnippets = {
    auth: `curl -X GET "https://api.swiftdata.gh/v1/balance" \\
  -H "Authorization: Bearer sk_agent_xxxx"`,
    data: `curl -X POST "https://api.swiftdata.gh/v1/purchase" \\
  -H "Authorization: Bearer sk_agent_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "network": "MTN",
    "phone": "0240000000",
    "package": "1GB",
    "reference": "dev_order_001"
  }'`
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white p-6 md:p-12 lg:p-20 font-sans">
      <div className="max-w-5xl mx-auto space-y-16">
        
        {/* Header */}
        <div className="space-y-6">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1 rounded-full font-black text-xs uppercase tracking-widest">
            Agent Developer Network • v1.0
          </Badge>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none italic uppercase">
            Agent API <br />
            <span className="text-primary">Documentation</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl font-medium leading-relaxed">
            Integrate high-speed data and airtime fulfillment into your applications using agent-issued tactical keys.
          </p>
        </div>

        {/* Getting Started */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
           <div className="space-y-6">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Key className="w-6 h-6 text-primary" />
                 </div>
                 <h2 className="text-2xl font-black uppercase italic">Authentication</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                All requests must include your agent-issued API key in the <code className="text-primary font-bold">Authorization</code> header as a Bearer token.
              </p>
              <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-4">
                 <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Header Example</span>
                    <Button variant="ghost" size="icon" onClick={() => copyCode(codeSnippets.auth, "auth")}>
                       {copied === "auth" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </Button>
                 </div>
                 <pre className="text-xs font-mono text-primary/80 overflow-x-auto">
                    {codeSnippets.auth}
                 </pre>
              </div>
           </div>
           <Card className="bg-white/[0.02] border-white/5 border rounded-3xl p-8 space-y-6">
              <div className="flex items-center gap-3">
                 <ShieldCheck className="w-6 h-6 text-emerald-400" />
                 <h3 className="font-black uppercase tracking-tight">Sentinel Guarding</h3>
              </div>
              <p className="text-sm text-muted-foreground italic">
                "Every transaction is monitored by the Sentinel AI engine. Keys are subject to daily spending limits set by your providing agent."
              </p>
              <ul className="space-y-3">
                 {["Daily GHS Cap Enforcement", "Real-time Fraud Scanning", "Automatic Throttling"].map(item => (
                    <li key={item} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                       <Zap className="w-3 h-3 text-primary" />
                       {item}
                    </li>
                 ))}
              </ul>
           </Card>
        </div>

        <hr className="border-white/5" />

        {/* Endpoints */}
        <div className="space-y-10">
           <div className="flex items-center gap-4">
              <Terminal className="w-8 h-8 text-indigo-400" />
              <h2 className="text-3xl font-black uppercase italic">Core Endpoints</h2>
           </div>

           <div className="space-y-12">
              {/* Purchase Data */}
              <div className="space-y-6">
                 <div className="flex items-center gap-3">
                    <Badge className="bg-emerald-500 text-black font-black px-3">POST</Badge>
                    <h3 className="text-xl font-black tracking-tight uppercase">/v1/purchase</h3>
                 </div>
                 <p className="text-muted-foreground">Execute a tactical data or airtime purchase for a specific network and phone number.</p>
                 
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                       <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Request Parameters</h4>
                       <table className="w-full text-left text-sm">
                          <tbody className="divide-y divide-white/5">
                             {[
                                { name: "network", type: "string", desc: "MTN, Telecel, or AirtelTigo" },
                                { name: "phone", type: "string", desc: "10-digit recipient number" },
                                { name: "package", type: "string", desc: "Bundle size (e.g. 1GB, 500MB)" },
                                { name: "reference", type: "string", desc: "Your unique order ID" }
                             ].map(p => (
                                <tr key={p.name}>
                                   <td className="py-3 font-mono font-bold text-primary">{p.name}</td>
                                   <td className="py-3 text-muted-foreground">{p.desc}</td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                    </div>
                    <div className="p-6 rounded-3xl bg-black/40 border border-white/5 space-y-4">
                       <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Payload Example</span>
                          <Button variant="ghost" size="icon" onClick={() => copyCode(codeSnippets.data, "data")}>
                             {copied === "data" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </Button>
                       </div>
                       <pre className="text-xs font-mono text-emerald-400/80 overflow-x-auto">
                          {codeSnippets.data}
                       </pre>
                    </div>
                 </div>
              </div>

              {/* Error Codes */}
              <div className="p-8 rounded-[40px] bg-red-500/5 border border-red-500/10 space-y-6">
                 <div className="flex items-center gap-3">
                    <AlertCircle className="w-6 h-6 text-red-500" />
                    <h3 className="font-black uppercase italic text-xl">Error Intelligence</h3>
                 </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                     {[
                        { code: "400", msg: "MTN Beneficiary Error", desc: "Phone number is not whitelisted by MTN as a beneficiary." },
                        { code: "402", msg: "Insufficient Agent Float", desc: "Providing agent balance is too low." },
                        { code: "429", msg: "Daily Limit Reached", desc: "You have exceeded your GHS spend cap." },
                        { code: "403", msg: "Sentinel Lock", desc: "AI has suspended this key for security." }
                     ].map(e => (
                        <div key={e.code} className="space-y-1">
                           <p className="font-black text-red-500 text-lg">Error {e.code}</p>
                           <p className="font-bold text-sm uppercase tracking-tight">{e.msg}</p>
                           <p className="text-xs text-muted-foreground italic">{e.desc}</p>
                        </div>
                     ))}
                  </div>
              </div>
           </div>
        </div>

        {/* Footer */}
        <div className="pt-20 border-t border-white/5 text-center space-y-4 pb-20">
           <Cpu className="w-10 h-10 text-muted-foreground/20 mx-auto" />
           <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest">
              Powered by SwiftData Sentinel AI • Institutional Access
           </p>
        </div>
      </div>
    </div>
  );
};

export default AgentDevAPIDocs;
