import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Copy, Check, Terminal, Shield, Zap, Code2, BookOpen,
  AlertCircle, ChevronRight, Globe, Key, List, ShoppingCart, AlertTriangle,
  Activity, Lock, RotateCcw, ExternalLink, Menu, X, CreditCard, Search
} from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api";

type Lang = "curl" | "node" | "python" | "php";
const LANGS: Lang[] = ["curl", "node", "python", "php"];
const LANG_LABELS: Record<Lang, string> = { curl: "cURL", node: "Node.js", python: "Python", php: "PHP" };

// ─── Code Snippets ────────────────────────────────────────────────────────────
const makeSnippets = (key: string): Record<string, Record<Lang, string>> => {
  const K = key || "swft_live_xxxxxxxxxxxxxxxxxxxx";
  return {
    balance: {
      curl: `curl -X GET "${BASE_URL}/balance" \\\n  -H "X-API-Key: ${K}"`,
      node: `const res = await fetch("${BASE_URL}/balance", {\n  headers: { "X-API-Key": "${K}" },\n});\nconst { balance } = await res.json();\nconsole.log("Balance:", balance); // 50.00`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/balance",\n    headers={"X-API-Key": "${K}"},\n)\nprint(res.json())`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/balance");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["X-API-Key: ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$res = json_decode(curl_exec($ch));\necho $res->balance;`,
    },
    plans: {
      curl: `curl -X GET "${BASE_URL}/plans" \\\n  -H "X-API-Key: ${K}"`,
      node: `const res = await fetch("${BASE_URL}/plans", {\n  headers: { "X-API-Key": "${K}" },\n});\nconst { plans } = await res.json();\nplans.forEach(p => console.log(p.network, p.package_size, "GH₵" + p.api_price));`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/plans",\n    headers={"X-API-Key": "${K}"},\n)\nfor plan in res.json()["plans"]:\n    print(plan["network"], plan["package_size"], plan["api_price"])`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/plans");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["X-API-Key: ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\nforeach ($data->plans as $plan) {\n    echo $plan->network . " " . $plan->package_size . " → GH₵" . $plan->api_price . "\\n";\n}`,
    },
    airtime: {
      curl: `curl -X POST "${BASE_URL}/airtime" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "network": "MTN",\n    "amount": 5.00,\n    "phone": "0241234567",\n    "request_id": "unique_id_123"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/airtime", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    network: "MTN",           // MTN | TELECEL | AT | GLO\n    amount: 5.00,             // GHS amount\n    phone: "0241234567",\n    request_id: "unique_id_123",\n  }),\n});\n\nconst data = await res.json();\nconsole.log(data.status); // "fulfilled"`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/airtime",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n    },\n    json={\n        "network": "MTN",        # MTN | TELECEL | AT | GLO\n        "amount": 5.00,\n        "phone": "0241234567",\n        "request_id": "unique_id_123",\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "network"    => "MTN",\n    "amount"     => 5.00,\n    "phone"      => "0241234567",\n    "request_id" => "unique_id_123",\n]);\n$ch = curl_init("${BASE_URL}/airtime");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    data: {
      curl: `curl -X POST "${BASE_URL}/airtime" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "network": "MTN",\n    "plan_id": "5GB",\n    "phone": "0241234567",\n    "request_id": "unique_id_123"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/airtime", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    network: "MTN",           // MTN | TELECEL | AT | GLO\n    plan_id: "5GB",           // package size from /plans\n    phone: "0241234567",\n    request_id: "unique_id_123",\n  }),\n});\n\nconst data = await res.json();\nconsole.log(data.status); // "fulfilled"`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/airtime",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n    },\n    json={\n        "network": "MTN",        # MTN | TELECEL | AT | GLO\n        "plan_id": "5GB",        # package size from /plans\n        "phone": "0241234567",\n        "request_id": "unique_id_123",\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "network"    => "MTN",\n    "plan_id"    => "5GB",\n    "phone"      => "0241234567",\n    "request_id" => "unique_id_123",\n]);\n$ch = curl_init("${BASE_URL}/airtime");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    validate: {
      curl: `curl -X POST "${BASE_URL}/payment/bills/validate" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "customerNumber": "8226349986",\n    "billType": "DSTV"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/bills/validate", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    customerNumber: "8226349986",\n    billType: "DSTV"\n  }),\n});\n\nconst data = await res.json();\nconsole.log(data.customerName); // "JOHN DOE"`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/bills/validate",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n    },\n    json={\n        "customerNumber": "8226349986",\n        "billType": "DSTV"\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "customerNumber" => "8226349986",\n    "billType"       => "DSTV",\n]);\n$ch = curl_init("${BASE_URL}/payment/bills/validate");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    ecg: {
      curl: `curl -X POST "${BASE_URL}/ecg" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "customerNumber": "8226349986",\n    "billType": "DSTV",\n    "amount": 41.00,\n    "senderName": "JOHN DOE"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/ecg", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    customerNumber: "8226349986",\n    billType: "DSTV",\n    amount: 41.00,\n    senderName: "JOHN DOE"\n  }),\n});\n\nconst data = await res.json();\nconsole.log(data.transaction_id); // "SWFT_BILL_..."`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/ecg",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n    },\n    json={\n        "customerNumber": "8226349986",\n        "billType": "DSTV",\n        "amount": 41.00,\n        "senderName": "JOHN DOE"\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "customerNumber" => "8226349986",\n    "billType"       => "DSTV",\n    "amount"         => 41.00,\n    "senderName"     => "JOHN DOE",\n]);\n$ch = curl_init("${BASE_URL}/ecg");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    }
  };
};

// ─── Responses ────────────────────────────────────────────────────────────────
const RESPONSES: Record<string, string> = {
  balance: `{\n  "success": true,\n  "balance": 50.00,\n  "currency": "GHS"\n}`,
  account: `{\n  "success": true,\n  "name": "Your Name",\n  "balance": 50.00,\n  "apiKey": "swft_live_...",\n  "active": true\n}`,
  plans: `{\n  "success": true,\n  "plans": [\n    {\n      "network": "MTN",\n      "package_size": "5GB",\n      "api_price": 22.00,\n      "is_unavailable": false\n    },\n    {\n      "network": "TELECEL",\n      "package_size": "6GB",\n      "api_price": 20.00,\n      "is_unavailable": false\n    }\n  ]\n}`,
  buy_ok: `{\n  "success": true,\n  "order_id": "a3f2b1c0-...",\n  "status": "fulfilled",\n  "balance": 45.00\n}`,
  validate_ok: `{\n  "success": true,\n  "customerName": "JOHN DOE",\n  "validatedAmount": 41.00\n}`,
  bill_ok: `{\n  "success": true,\n  "transaction_id": "SWFT_BILL_1234567890",\n  "cost": 41.00,\n  "balance": 9.00\n}`,
  error_401: `{\n  "success": false,\n  "error": "Invalid API key"\n}`,
  error_402: `{\n  "success": false,\n  "error": "Insufficient balance"\n}`,
};

// ─── Reusable components ──────────────────────────────────────────────────────
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`p-1.5 rounded-lg bg-white/5 hover:bg-white/15 transition-colors ${className}`}
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
    </button>
  );
}

function CodeBlock({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  return (
    <div className={`relative rounded-xl bg-[#080810] border border-white/8 overflow-hidden ${className}`}>
      {label && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      {!label && <CopyButton text={code} className="absolute top-3 right-3 z-10" />}
      <pre className="p-5 text-xs font-mono text-emerald-300/85 leading-relaxed overflow-x-auto whitespace-pre pr-12">{code}</pre>
    </div>
  );
}

function ResponseBlock({ code, label, variant = "success" }: { code: string; label?: string; variant?: "success" | "error" }) {
  const color = variant === "error" ? "text-red-300/85" : "text-sky-300/85";
  return (
    <div className="relative rounded-xl bg-[#080810] border border-white/8 overflow-hidden">
      {label && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      {!label && <CopyButton text={code} className="absolute top-3 right-3 z-10" />}
      <pre className={`p-5 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre pr-12 ${color}`}>{code}</pre>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold font-mono ${method === "GET" ? "bg-sky-500/15 text-sky-300 border border-sky-500/20" : "bg-amber-500/15 text-amber-300 border border-amber-500/20"}`}>
      {method}
    </span>
  );
}

function ParamRow({ name, type, required, desc }: { name: string; type: string; required: boolean; desc: string }) {
  return (
    <div className="flex flex-col md:grid md:grid-cols-12 md:gap-3 px-4 py-4 md:py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors gap-2">
      <div className="md:col-span-3 flex items-center justify-between md:block">
        <span className="font-mono text-amber-300 font-bold md:font-semibold">{name}</span>
        <div className="md:hidden">
          {required
            ? <span className="text-red-400 font-black text-[9px] uppercase tracking-widest bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">Required</span>
            : <span className="text-white/25 text-[9px] uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded border border-white/10">Optional</span>}
        </div>
      </div>
      <div className="md:col-span-2 text-sky-400 font-mono flex items-center gap-2 md:block">
        <span className="md:hidden text-white/20 font-sans text-[9px] uppercase">Type:</span>
        {type}
      </div>
      <div className="hidden md:col-span-2 md:block">
        {required
          ? <span className="text-red-400 font-bold text-[10px] uppercase tracking-wide">Required</span>
          : <span className="text-white/25 text-[10px] uppercase tracking-wide">Optional</span>}
      </div>
      <div className="md:col-span-5 text-white/50 md:text-white/45 leading-relaxed">{desc}</div>
    </div>
  );
}

function SectionAnchor({ id }: { id: string }) {
  return <span id={id} className="block -mt-20 pt-20 invisible absolute" />;
}

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "overview",        label: "Overview",           icon: BookOpen },
  { id: "authentication",  label: "Authentication",      icon: Key },
  { id: "balance",         label: "Check Balance",       icon: Activity },
  { id: "plans",           label: "List Plans",          icon: List },
  { id: "buy",             label: "Airtime & Data",      icon: ShoppingCart },
  { id: "bills-validate",  label: "Validate Bills",      icon: Search },
  { id: "bills-pay",       label: "Pay Bills",           icon: CreditCard },
  { id: "errors",          label: "Error Reference",     icon: AlertTriangle },
  { id: "best-practices",  label: "Best Practices",      icon: Shield },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
const APIDocumentation = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [activeLang, setActiveLang] = useState<Lang>("curl");
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Use the key provided by the user if available, otherwise use profile key
  const userApiKey = profile?.api_key || null;
  const snippets = makeSnippets(userApiKey);

  useEffect(() => {
    const onScroll = () => {
      const offsets = NAV_ITEMS.map(({ id }) => {
        const el = document.getElementById(id);
        return { id, top: el ? el.getBoundingClientRect().top : Infinity };
      });
      const active = offsets.filter(({ top }) => top <= 120).slice(-1)[0];
      if (active) setActiveSection(active.id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileNavOpen(false);
  };

  const Sidebar = () => (
    <nav className="space-y-0.5">
      <div className="flex items-center gap-2 px-3 py-3 mb-3 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-sky-400/15 border border-sky-400/25 flex items-center justify-center">
          <Code2 className="w-3.5 h-3.5 text-sky-400" />
        </div>
        <div>
          <p className="text-xs font-black text-white tracking-tight leading-none">SwiftData API</p>
          <p className="text-[9px] text-white/30 uppercase tracking-widest mt-0.5">v2.0 REST</p>
        </div>
      </div>
      <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-white/20">Reference</p>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => scrollTo(id)}
          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            activeSection === id
              ? "bg-sky-400/10 text-sky-300 border border-sky-400/20"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          }`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {label}
          {activeSection === id && <ChevronRight className="w-3 h-3 ml-auto text-sky-400/60" />}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#030305] text-white selection:bg-sky-400/25">

      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#030305]/95 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNavOpen(!mobileNavOpen)} className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <Link to="/dashboard/api" className="flex items-center gap-2 text-white/40 hover:text-white/80 transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </div>

          <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/8">
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => setActiveLang(l)}
                className={`px-3 py-1 text-xs rounded-lg font-mono font-bold transition-all ${
                  activeLang === l ? "bg-sky-400 text-black shadow-sm" : "text-white/35 hover:text-white/70"
                }`}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-sky-500/20 text-sky-400 text-[10px]">v2.0 REST</Badge>
          </div>
        </div>
      </div>

      <div className="flex max-w-[1400px] mx-auto pt-14">
        <aside className="hidden lg:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4 border-r border-white/5">
          <Sidebar />
        </aside>

        {/* Mobile Sidebar Overlay */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
            <div className="absolute top-0 left-0 bottom-0 w-72 bg-[#08080a] border-r border-white/10 p-4 shadow-2xl animate-in slide-in-from-left duration-300">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-400/20 flex items-center justify-center">
                    <Code2 className="w-4 h-4 text-sky-400" />
                  </div>
                  <span className="font-black tracking-tight">API Docs</span>
                </div>
                <button onClick={() => setMobileNavOpen(false)} className="p-2 rounded-xl bg-white/5 border border-white/10">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Sidebar />
            </div>
          </div>
        )}

        <main ref={scrollRef} className="flex-1 min-w-0 px-4 md:px-8 lg:px-12 xl:px-16 py-8 md:py-12 pb-32 space-y-20 md:space-y-24">

          {/* ── Overview ─────────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="overview" />
            <div className="flex items-start justify-between gap-4 mb-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-400/10 border border-sky-400/20 rounded-full text-xs font-bold text-sky-400 mb-4">
                  <Zap className="w-3 h-3" /> SwiftData Developers · REST API
                </div>
                <h1 className="text-4xl lg:text-5xl font-black tracking-tight leading-none mb-4">
                  SwiftData Ghana<br />
                  <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-sky-500 bg-clip-text text-transparent">
                    API Reference
                  </span>
                </h1>
                <p className="text-white/50 text-lg max-w-2xl leading-relaxed">
                  Integrate airtime, data, and bill payments into your applications.
                  Our API is RESTful, secure, and built for scale.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 overflow-hidden bg-white/[0.02]">
              <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Base URL</span>
                <CopyButton text={BASE_URL} />
              </div>
              <div className="px-5 py-4 flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <code className="text-sm font-mono text-emerald-300 break-all">{BASE_URL}</code>
              </div>
            </div>
          </section>

          {/* ── Authentication ───────────────────────────────────────── */}
          <section>
            <SectionAnchor id="authentication" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <Key className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Authentication</h2>
            </div>
            <p className="text-white/45 text-sm mb-6 md:ml-11 max-w-xl">
              Include your Developer API Key in the <code className="text-sky-400 bg-white/5 px-1.5 py-0.5 rounded-md font-mono">X-API-Key</code> header on every request.
            </p>

            <div className="grid lg:grid-cols-2 gap-6 md:ml-11">
              <div className="space-y-4">
                <CodeBlock code={`X-API-Key: ${userApiKey}`} label="Required Header" />
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 flex gap-3">
                  <Shield className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-sky-300 mb-1">Production Security</p>
                    <p className="text-[11px] text-white/40 leading-relaxed">Never expose your API key in client-side code. Always proxy requests through your backend server.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Check Balance ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="balance" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Check Wallet Balance</h2>
            </div>
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/balance</code>
            </div>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <div>
                <CodeBlock code={snippets.balance[activeLang]} label="Request" />
              </div>
              <div>
                <ResponseBlock code={RESPONSES.balance} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── List Plans ─────────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="plans" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <List className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">List Data Plans</h2>
            </div>
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/plans</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">Returns all available data packages with prices. Use the <code className="text-amber-400 bg-white/5 px-1.5 py-0.5 rounded-md">package_size</code> from this response when placing a data order.</p>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.plans[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.plans} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── Airtime & Data ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="buy" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Purchase Airtime & Data</h2>
            </div>
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/airtime</code>
            </div>

            {/* Key distinction callout */}
            <div className="ml-11 mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3">
              <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-300 mb-1.5">Same endpoint — two modes</p>
                <ul className="text-[11px] text-white/50 space-y-1 leading-relaxed">
                  <li><span className="text-amber-400 font-mono font-bold">Airtime</span> — send <code className="text-sky-400 bg-white/5 px-1 rounded">amount</code> (GHS). Do <em>not</em> include <code className="bg-white/5 px-1 rounded">package_size</code>.</li>
                  <li><span className="text-emerald-400 font-mono font-bold">Data bundle</span> — send <code className="text-sky-400 bg-white/5 px-1 rounded">package_size</code> (e.g. "5GB" from <code className="bg-white/5 px-1 rounded">/plans</code>). Do <em>not</em> include <code className="bg-white/5 px-1 rounded">amount</code>.</li>
                  <li><span className="text-sky-400 font-mono font-bold">AirtelTigo</span> — We support all **AT iShare** and **BigData** bundles via the standard data endpoint.</li>
                </ul>
              </div>
            </div>

            <div className="ml-11 space-y-8">
              {/* Parameters table */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="networkCode" type="string" required desc="MTN · TELECEL · AT · GLO" />
                <ParamRow name="customerNumber" type="string" required desc="Recipient phone number (e.g. 0241234567)" />
                <ParamRow name="amount" type="number" required={false} desc="GHS amount — required for airtime. Omit for data." />
                <ParamRow name="package_size" type="string" required={false} desc="Bundle size from /plans (e.g. 5GB) — required for data. Omit for airtime." />
                <ParamRow name="request_id" type="string" required={false} desc="Idempotency key. Resend the same ID to avoid duplicate charges." />
              </div>

              {/* Airtime example */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-3">Airtime Purchase</p>
                <div className="grid lg:grid-cols-2 gap-6">
                  <CodeBlock code={snippets.airtime[activeLang]} label="Request" />
                  <ResponseBlock code={RESPONSES.buy_ok} label="Response · 200 OK" />
                </div>
              </div>

              {/* Data example */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-3">Data Bundle Purchase</p>
                <div className="grid lg:grid-cols-2 gap-6">
                  <CodeBlock code={snippets.data[activeLang]} label="Request" />
                  <ResponseBlock code={RESPONSES.buy_ok} label="Response · 200 OK" />
                </div>
              </div>

              {/* Network codes quick ref */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">networkCode Reference</span>
                </div>
                {[
                  { code: "MTN", name: "MTN Ghana", note: "YELLOW, YELLO" },
                  { code: "TELECEL", name: "Telecel", note: "VODAFONE, VOD" },
                  { code: "AT", name: "AirtelTigo", note: "iShare, BigData" },
                  { code: "GLO", name: "Glo Ghana", note: "" },
                ].map(({ code, name, note }) => (
                  <div key={code} className="flex flex-col md:grid md:grid-cols-12 md:gap-2 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] gap-1">
                    <div className="md:col-span-3 font-mono font-black text-amber-300">{code}</div>
                    <div className="md:col-span-5 font-semibold text-white/70">{name}</div>
                    <div className="md:col-span-4 text-white/30 text-[10px] md:text-xs italic">{note}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Bill Validation ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="bills-validate" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <Search className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Validate Utility Bill</h2>
            </div>
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/bills/validate</code>
            </div>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="customerNumber" type="string" required desc="Smartcard, Account or Meter number" />
                <ParamRow name="billType" type="string" required desc="DSTV | GOTV | STARTIMES | ECG" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.validate[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.validate_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Pay Bill ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="bills-pay" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Pay Utility Bill</h2>
            </div>
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/ecg</code>
            </div>
            <p className="text-white/45 text-sm mb-6 ml-11 max-w-xl italic">Note: Use /ecg for electricity and /dstv, /gotv, /startimes for TV subscriptions.</p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="customerNumber" type="string" required desc="Account/Meter number" />
                <ParamRow name="billType" type="string" required desc="e.g. DSTV" />
                <ParamRow name="amount" type="number" required desc="Amount to pay in GHS" />
                <ParamRow name="senderName" type="string" required desc="Customer name from validation lookup" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.ecg[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.bill_ok} label="Response · 201 Created" />
              </div>
            </div>
          </section>

          {/* ── Error Reference ──────────────────────────────────────── */}
          <section>
            <SectionAnchor id="errors" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-white/40" />
              </div>
              <h2 className="text-2xl font-black">Error Reference</h2>
            </div>
            <div className="ml-11 grid lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="grid grid-cols-12 px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <div className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-white/20">Code</div>
                  <div className="col-span-10 text-[9px] font-bold uppercase tracking-widest text-white/20">Description</div>
                </div>
                {[
                  { code: "400", title: "Bad Request", desc: "Missing parameters" },
                  { code: "401", title: "Unauthorized", desc: "Invalid X-API-Key" },
                  { code: "402", title: "Low Balance", desc: "Wallet balance too low" },
                  { code: "403", title: "Forbidden", desc: "Key disabled" },
                  { code: "404", title: "Not Found", desc: "Invalid endpoint" },
                ].map(({ code, title, desc }) => (
                  <div key={code} className="flex items-center gap-4 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <div className="font-mono font-black text-sky-400 w-8">{code}</div>
                    <div className="font-bold text-white/80 w-24 shrink-0">{title}</div>
                    <div className="text-white/35 truncate">{desc}</div>
                  </div>
                ))}
              </div>
              <ResponseBlock code={RESPONSES.error_402} variant="error" label="Example Error" />
            </div>
          </section>

        </main>
      </div>
    </div>
  );
};

export default APIDocumentation;
