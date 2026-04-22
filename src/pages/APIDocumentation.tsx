import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Check, Terminal, Shield, Zap, Code2, BookOpen, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api";

type Lang = "curl" | "node" | "python" | "php";

const snippets: Record<string, Record<Lang, string>> = {
  balance: {
    curl: `curl -X GET "${BASE_URL}?action=balance" \\\n  -H "x-api-key: sdg_YOUR_SECRET_KEY"`,
    node: `const res = await fetch("${BASE_URL}?action=balance", {\n  headers: { "x-api-key": "sdg_YOUR_SECRET_KEY" }\n});\nconst data = await res.json();\nconsole.log(data.balance); // e.g. 45.50`,
    python: `import requests\nres = requests.get(\n  "${BASE_URL}",\n  params={"action": "balance"},\n  headers={"x-api-key": "sdg_YOUR_SECRET_KEY"}\n)\nprint(res.json())`,
    php: `<?php\n$ch = curl_init("${BASE_URL}?action=balance");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["x-api-key: sdg_YOUR_SECRET_KEY"]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$res = json_decode(curl_exec($ch));\necho $res->balance;`,
  },
  plans: {
    curl: `curl -X GET "${BASE_URL}?action=plans" \\\n  -H "x-api-key: sdg_YOUR_SECRET_KEY"`,
    node: `const res = await fetch("${BASE_URL}?action=plans", {\n  headers: { "x-api-key": "sdg_YOUR_SECRET_KEY" }\n});\nconst { plans } = await res.json();\nconsole.log(plans);`,
    python: `import requests\nres = requests.get(\n  "${BASE_URL}",\n  params={"action": "plans"},\n  headers={"x-api-key": "sdg_YOUR_SECRET_KEY"}\n)\nprint(res.json()["plans"])`,
    php: `<?php\n$ch = curl_init("${BASE_URL}?action=plans");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["x-api-key: sdg_YOUR_SECRET_KEY"]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$data = json_decode(curl_exec($ch));\nprint_r($data->plans);`,
  },
  buy: {
    curl: `curl -X POST "${BASE_URL}?action=buy" \\\n  -H "x-api-key: sdg_YOUR_SECRET_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "network": "MTN",\n    "plan_id": "mtn-1gb-30days",\n    "phone": "054XXXXXXX",\n    "request_id": "unique-idem-key-001"\n  }'`,
    node: `const res = await fetch("${BASE_URL}?action=buy", {\n  method: "POST",\n  headers: {\n    "x-api-key": "sdg_YOUR_SECRET_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    network: "MTN",\n    plan_id: "mtn-1gb-30days",\n    phone: "054XXXXXXX",\n    request_id: "unique-idem-key-001"\n  })\n});\nconst data = await res.json();\nconsole.log(data);`,
    python: `import requests, uuid\nres = requests.post(\n  "${BASE_URL}",\n  params={"action": "buy"},\n  headers={\n    "x-api-key": "sdg_YOUR_SECRET_KEY",\n    "Content-Type": "application/json"\n  },\n  json={\n    "network": "MTN",\n    "plan_id": "mtn-1gb-30days",\n    "phone": "054XXXXXXX",\n    "request_id": str(uuid.uuid4())\n  }\n)\nprint(res.json())`,
    php: `<?php\n$payload = json_encode([\n  "network" => "MTN",\n  "plan_id" => "mtn-1gb-30days",\n  "phone" => "054XXXXXXX",\n  "request_id" => uniqid()\n]);\n$ch = curl_init("${BASE_URL}?action=buy");\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $payload);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "x-api-key: sdg_YOUR_SECRET_KEY",\n  "Content-Type: application/json"\n]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\necho curl_exec($ch);`,
  },
};

const langLabels: Record<Lang, string> = { curl: "cURL", node: "Node.js", python: "Python", php: "PHP" };

function CodeBlock({ code, id }: { code: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-xl bg-[#0a0a10] border border-white/8 overflow-hidden">
      <button onClick={copy} id={`copy-${id}`} className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors z-10">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
      </button>
      <pre className="p-5 text-xs font-mono text-emerald-300/90 leading-relaxed overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

function MultiLangBlock({ snippetKey }: { snippetKey: string }) {
  const [lang, setLang] = useState<Lang>("curl");
  const langs: Lang[] = ["curl", "node", "python", "php"];
  return (
    <div>
      <div className="flex gap-1 mb-2 flex-wrap">
        {langs.map((l) => (
          <button key={l} onClick={() => setLang(l)}
            className={`px-3 py-1 text-xs rounded-lg font-mono font-bold transition-all ${lang === l ? "bg-amber-400 text-black" : "bg-white/5 text-white/40 hover:bg-white/10"}`}>
            {langLabels[l]}
          </button>
        ))}
      </div>
      <CodeBlock code={snippets[snippetKey][lang]} id={`${snippetKey}-${lang}`} />
    </div>
  );
}

function SectionNumber({ n }: { n: string }) {
  return <span className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-mono text-white/30 shrink-0">{n}</span>;
}

const APIDocumentation = () => {
  const { toast } = useToast();
  const copyHeader = () => { navigator.clipboard.writeText("x-api-key: sdg_YOUR_SECRET_KEY"); toast({ title: "Copied!" }); };

  return (
    <div className="min-h-screen bg-[#030305] text-white pb-24 selection:bg-amber-400/30">
      {/* Sticky nav */}
      <div className="border-b border-white/5 bg-[#030305]/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/dashboard/api" className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">● Live</Badge>
            <Badge variant="outline" className="border-amber-500/20 text-amber-400 text-[10px]">v1.0</Badge>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-14 space-y-16">

        {/* Hero */}
        <section className="space-y-4">
          <div className="w-14 h-14 bg-amber-400/10 rounded-2xl flex items-center justify-center mb-6 border border-amber-400/20">
            <Code2 className="w-7 h-7 text-amber-400" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">SwiftData Ghana<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">API Reference</span></h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Programmatically vend data bundles to any Ghanaian network. Our REST API is secured by API keys, idempotency-safe, and designed for production use.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {[{ icon: <Zap className="w-3.5 h-3.5" />, label: "Real-time delivery", color: "text-amber-400" },
              { icon: <Shield className="w-3.5 h-3.5" />, label: "Key-based auth", color: "text-emerald-400" },
              { icon: <Terminal className="w-3.5 h-3.5" />, label: "JSON responses", color: "text-blue-400" },
              { icon: <BookOpen className="w-3.5 h-3.5" />, label: "Idempotency support", color: "text-purple-400" }
            ].map(({ icon, label, color }) => (
              <span key={label} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/5 border border-white/8 ${color}`}>
                {icon} {label}
              </span>
            ))}
          </div>
        </section>

        {/* Base URL */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="01" /> Base URL</h2>
          <CodeBlock id="base-url" code={BASE_URL} />
          <p className="text-white/40 text-sm">All requests append <code className="text-amber-400 bg-white/5 px-1 py-0.5 rounded">?action=</code> as a query parameter to specify the operation.</p>
        </section>

        {/* Auth */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="02" /> Authentication</h2>
          <p className="text-white/50 text-sm">Every request must include your Secret API Key in the <code className="text-amber-400 bg-white/5 px-1 rounded">x-api-key</code> header. Generate your key from the <Link to="/dashboard/api" className="text-amber-400 underline underline-offset-2">Developer Dashboard</Link>.</p>
          <div className="rounded-xl bg-[#0a0a10] border border-white/8 overflow-hidden">
            <div className="px-4 py-2 bg-white/4 border-b border-white/5 flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Required Header</span>
              <button onClick={copyHeader} className="p-1 rounded hover:bg-white/10 transition"><Copy className="w-3.5 h-3.5 text-white/30" /></button>
            </div>
            <pre className="p-4 text-sm font-mono text-amber-300/90">x-api-key: sdg_YOUR_SECRET_KEY</pre>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Keep your key secret</p>
              <p className="text-xs text-white/40 mt-1">Your API key carries full wallet spending rights. Never expose it in client-side browser code or public repositories. Use environment variables on your server.</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm font-semibold text-blue-300 mb-2">Who can use the API?</p>
            <p className="text-xs text-white/40">Only approved <strong className="text-white/60">Agents</strong> and <strong className="text-white/60">Sub-Agents</strong> can make API calls. If your account is not yet approved, requests will return <code className="text-red-400">403 Forbidden</code>.</p>
          </div>
        </section>

        {/* Check Balance */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="03" /> Check Wallet Balance</h2>
          <div className="flex items-center gap-3">
            <Badge className="bg-blue-500/20 text-blue-300 border-none text-xs">GET</Badge>
            <code className="text-white/60 text-sm font-mono">?action=balance</code>
          </div>
          <p className="text-white/50 text-sm">Returns your current wallet balance in GH₵.</p>
          <MultiLangBlock snippetKey="balance" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">Success Response (200)</p>
            <CodeBlock id="balance-res" code={`{\n  "success": true,\n  "balance": 45.50\n}`} />
          </div>
        </section>

        {/* List Plans */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="04" /> List Available Plans</h2>
          <div className="flex items-center gap-3">
            <Badge className="bg-blue-500/20 text-blue-300 border-none text-xs">GET</Badge>
            <code className="text-white/60 text-sm font-mono">?action=plans</code>
          </div>
          <p className="text-white/50 text-sm">Returns all active data packages across all networks. Use the <code className="text-amber-400 bg-white/5 px-1 rounded">plan_id</code> field when placing a buy order.</p>
          <MultiLangBlock snippetKey="plans" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">Success Response (200)</p>
            <CodeBlock id="plans-res" code={`{\n  "success": true,\n  "plans": [\n    {\n      "id": "mtn-1gb-30days",\n      "network": "MTN",\n      "label": "1GB - 30 Days",\n      "price": 5.00,\n      "is_active": true\n    },\n    ...\n  ]\n}`} />
          </div>
        </section>

        {/* Buy Data */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="05" /> Purchase Data Bundle</h2>
          <div className="flex items-center gap-3">
            <Badge className="bg-amber-500/20 text-amber-300 border-none text-xs">POST</Badge>
            <code className="text-white/60 text-sm font-mono">?action=buy</code>
          </div>
          <p className="text-white/50 text-sm">Deducts from your wallet and dispatches a data bundle to the specified phone number. Always supply a unique <code className="text-amber-400 bg-white/5 px-1 rounded">request_id</code> to prevent duplicate orders.</p>

          {/* Request fields table */}
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <div className="px-4 py-2 bg-white/4 border-b border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Request Body Fields</span>
            </div>
            <div className="divide-y divide-white/5">
              {[
                { field: "network", type: "string", req: true, desc: 'Network code. One of: "MTN", "TELECEL", "AT"' },
                { field: "plan_id", type: "string", req: true, desc: "Package ID from the /plans endpoint" },
                { field: "phone", type: "string", req: true, desc: "Recipient phone number (e.g. 054XXXXXXX)" },
                { field: "request_id", type: "string", req: false, desc: "Unique idempotency key — prevents duplicate orders on retry" },
              ].map(({ field, type, req, desc }) => (
                <div key={field} className="grid grid-cols-12 gap-2 px-4 py-3 text-xs">
                  <div className="col-span-3 font-mono text-amber-300">{field}</div>
                  <div className="col-span-2 text-blue-400">{type}</div>
                  <div className="col-span-2">{req ? <span className="text-red-400 font-bold">Required</span> : <span className="text-white/30">Optional</span>}</div>
                  <div className="col-span-5 text-white/40">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <MultiLangBlock snippetKey="buy" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">Success Response (202)</p>
              <CodeBlock id="buy-res-ok" code={`{\n  "success": true,\n  "message": "Order queued",\n  "status": "pending"\n}`} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">Duplicate Response (409)</p>
              <CodeBlock id="buy-res-dup" code={`{\n  "error": "Duplicate request_id",\n  "order_id": "existing-order-uuid"\n}`} />
            </div>
          </div>
        </section>

        {/* Error codes */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="06" /> Error Reference</h2>
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <div className="px-4 py-2 bg-white/4 border-b border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">HTTP Error Codes</span>
            </div>
            <div className="divide-y divide-white/5">
              {[
                { code: "400", color: "text-orange-400", title: "Bad Request", desc: "Missing required fields (plan_id, phone, network) or invalid action." },
                { code: "401", color: "text-red-400", title: "Unauthorized", desc: "Missing or invalid x-api-key header." },
                { code: "402", color: "text-red-400", title: "Payment Required", desc: "Insufficient wallet balance for the selected package." },
                { code: "403", color: "text-red-400", title: "Forbidden", desc: "Account not yet approved as Agent or Sub-Agent." },
                { code: "409", color: "text-yellow-400", title: "Conflict", desc: "Duplicate request_id detected. Returns the existing order_id." },
                { code: "500", color: "text-red-500", title: "Server Error", desc: "Internal error. Retry with exponential backoff." },
              ].map(({ code, color, title, desc }) => (
                <div key={code} className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-start">
                  <div className={`col-span-2 font-mono font-bold ${color}`}>{code}</div>
                  <div className="col-span-3 font-semibold text-white/70">{title}</div>
                  <div className="col-span-7 text-white/40">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security best practices */}
        <section className="space-y-5">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="07" /> Security Best Practices</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { icon: "🔑", title: "Store keys server-side", body: "Never embed your API key in mobile apps or browser JS. Always call from a backend server." },
              { icon: "🔁", title: "Use Idempotency Keys", body: "Generate a unique request_id (UUID) per order to safely retry failed requests without double-charging." },
              { icon: "🔄", title: "Rotate keys regularly", body: "Regenerate your API key periodically from the dashboard. Old keys are immediately invalidated." },
              { icon: "📋", title: "Check balance first", body: "Call the /balance endpoint before bulk orders to avoid 402 errors mid-batch." },
            ].map(({ icon, title, body }) => (
              <div key={title} className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-2">
                <p className="text-lg">{icon} <span className="text-sm font-bold text-white/80 ml-1">{title}</span></p>
                <p className="text-xs text-white/40 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Rate limits */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-3"><SectionNumber n="08" /> Rate Limits</h2>
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <div className="divide-y divide-white/5">
              {[
                { endpoint: "GET ?action=balance", limit: "120 req / min" },
                { endpoint: "GET ?action=plans", limit: "60 req / min" },
                { endpoint: "POST ?action=buy", limit: "30 req / min" },
              ].map(({ endpoint, limit }) => (
                <div key={endpoint} className="flex justify-between items-center px-4 py-3 text-xs">
                  <code className="text-white/60 font-mono">{endpoint}</code>
                  <span className="text-amber-400 font-bold">{limit}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-white/30 text-xs">Exceeding limits returns HTTP 429. Implement exponential backoff before retrying.</p>
        </section>

        {/* Support CTA */}
        <section className="pt-6 border-t border-white/5 flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Terminal className="w-7 h-7 text-blue-400" />
          </div>
          <h3 className="text-xl font-bold">Need integration help?</h3>
          <p className="text-white/40 text-sm max-w-sm">Our technical team is available on WhatsApp to assist with custom implementations, webhook setups, and bulk order automation.</p>
          <a href="https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40" target="_blank" rel="noreferrer">
            <Button className="bg-amber-400 text-black hover:bg-amber-300 font-bold rounded-xl px-8 h-11">Contact Support on WhatsApp</Button>
          </a>
        </section>
      </div>
    </div>
  );
};

export default APIDocumentation;
