import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Key, Copy, RefreshCw, Loader2, ExternalLink,
  Shield, AlertTriangle, CheckCircle, Eye, EyeOff, Zap,
} from "lucide-react";
import { Link } from "react-router-dom";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const DashboardDeveloperAPI = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  // `plaintextKey` holds the key only immediately after generation (one-time display).
  // `apiKeyPrefix` is the first 12 chars stored in the DB — used for masked display.
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [apiKeyPrefix, setApiKeyPrefix] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(true);
  const [rateLimit, setRateLimit] = useState(30);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api";

  useEffect(() => {
    const fetchApiKey = async () => {
      if (!user) return;
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("api_key_prefix, api_access_enabled, api_rate_limit")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setApiKeyPrefix(data.api_key_prefix ?? null);
        setHasKey(!!data.api_key_prefix);
        setAccessEnabled(data.api_access_enabled ?? true);
        setRateLimit(data.api_rate_limit ?? 30);
      }
      setLoading(false);
    };
    fetchApiKey();
  }, [user]);

  const generateApiKey = async () => {
    if (!user) return;
    if (hasKey && !confirmRegen) { setConfirmRegen(true); return; }
    setGenerating(true);
    setConfirmRegen(false);

    const newKey = `swft_live_${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await sha256Hex(newKey);
    const prefix = newKey.slice(0, 12);

    const { error } = await supabase
      .from("profiles")
      .update({ api_key_hash: hash, api_key_prefix: prefix, api_key: null })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Failed to generate API Key", description: error.message, variant: "destructive" });
    } else {
      setPlaintextKey(newKey);
      setApiKeyPrefix(prefix);
      setHasKey(true);
      setRevealed(true);
      toast({ title: "✅ New API Key generated", description: "Copy and store it securely — it will not be shown again." });
    }
    setGenerating(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  // Masked display: show prefix + bullets. Full key only shown right after generation.
  const maskedKey = apiKeyPrefix ? `${apiKeyPrefix}${"•".repeat(24)}` : "";

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-sky-400" /> SwiftData Developers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Integrate SwiftData Ghana directly into your own applications.
          </p>
        </div>
        <Link to="/api-docs">
          <Button variant="outline" className="gap-2 border-sky-500/30 text-sky-400 hover:bg-sky-500/10">
            <ExternalLink className="w-4 h-4" /> View Full Docs
          </Button>
        </Link>
      </div>

      {/* Access status banner */}
      {!loading && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${accessEnabled ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" : "border-red-500/20 bg-red-500/5 text-red-400"}`}>
          {accessEnabled ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {accessEnabled ? "API access is active on your account." : "API access has been disabled by an administrator. Contact support."}
        </div>
      )}

      {/* API Key Card */}
      <Card className="border-sky-500/20 bg-sky-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-sky-500" /> Your Secret API Key
          </CardTitle>
          <CardDescription>
            Used to authenticate every API request. Never expose this in client-side code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : hasKey ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={plaintextKey && revealed ? plaintextKey : maskedKey}
                  readOnly
                  className="font-mono bg-black/20 border-white/10 text-sm"
                />
                {/* Reveal only available immediately after generation */}
                {plaintextKey && (
                  <Button variant="secondary" size="icon" onClick={() => setRevealed(!revealed)} title={revealed ? "Hide" : "Reveal"}>
                    {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                )}
                {plaintextKey && (
                  <Button variant="secondary" size="icon" onClick={() => copyToClipboard(plaintextKey)} title="Copy">
                    <Copy className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {plaintextKey ? (
                <div className="flex items-center gap-2 text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Copy this key now — it will not be shown again after you leave this page.
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  Key is set. Regenerate to get a new one (your current key will be invalidated).
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-white/40">
                <Shield className="w-3.5 h-3.5 shrink-0" />
                Rate limit: <strong className="text-white/60">{rateLimit} requests/min</strong> (controlled by admin)
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No API key yet. Click below to generate one.</p>
          )}

          <div className="pt-3 border-t border-white/5 space-y-2">
            {confirmRegen && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                ⚠️ Regenerating will <strong>invalidate your current key</strong>. All integrations using the old key will break. Click again to confirm.
              </div>
            )}
            <Button
              onClick={generateApiKey}
              disabled={generating || !accessEnabled}
              variant="secondary"
              className={`gap-2 ${confirmRegen ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : ""}`}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {generating ? "Generating..." : confirmRegen ? "⚠️ Confirm Regenerate" : hasKey ? "Regenerate API Key" : "Generate API Key"}
            </Button>
            {confirmRegen && (
              <Button variant="ghost" size="sm" className="text-white/40" onClick={() => setConfirmRegen(false)}>Cancel</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick start + security cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-white/3 border-white/8">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-sky-400" /> Quick Start
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>1. Fund your wallet with sufficient balance.</p>
            <p>2. Copy your API key above.</p>
            <p>3. Call <code className="text-sky-400 bg-white/5 px-1 rounded text-xs">GET /plans</code> to list packages.</p>
            <p>4. POST to <code className="text-sky-400 bg-white/5 px-1 rounded text-xs">/airtime</code> with recipient details.</p>
            <p>5. POST to <code className="text-sky-400 bg-white/5 px-1 rounded text-xs">/payment/bills/validate</code> for bill lookups.</p>
          </CardContent>
        </Card>

        <Card className="bg-white/3 border-white/8">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" /> Security Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>🔑 Store key in environment variables, not source code.</p>
            <p>🔁 All endpoints are RESTful and path-based.</p>
            <p>🚫 Never expose your key in browser/mobile apps.</p>
            <p>🔄 Rotate your key periodically from this page.</p>
          </CardContent>
        </Card>
      </div>

      {/* Base URL reference */}
      <Card className="bg-white/3 border-white/8">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-white/40">Base Endpoint</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs text-emerald-400 bg-black/30 px-3 py-2 rounded-lg flex-1 truncate">
              {BASE_URL}
            </code>
            <Button variant="secondary" size="icon" className="shrink-0" onClick={() => copyToClipboard(BASE_URL)}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-white/30 mt-2">Append <code className="text-sky-400">/balance</code>, <code className="text-sky-400">/plans</code>, or <code className="text-sky-400">/airtime</code> to the URL.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardDeveloperAPI;
