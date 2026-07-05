import { useState, useEffect, useCallback } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Key, Copy, RefreshCw, Loader2, ExternalLink,
  Shield, AlertTriangle, CheckCircle, Eye, EyeOff, Zap, Wallet,
  Terminal, History, Bug, Users2, MessageCircle, Share2, Code2,
  PlusCircle, ArrowRightLeft, CreditCard, Globe
} from "lucide-react";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { Switch } from "@/components/ui/switch";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, 
  DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const DashboardDeveloperAPI = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isDark } = useAppTheme();

  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [plaintextSecret, setPlaintextSecret] = useState<string | null>(null);
  const [apiKeyPrefix, setApiKeyPrefix] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [apiBalance, setApiBalance] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(true);
  const [rateLimit, setRateLimit] = useState(30);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [updatingTestMode, setUpdatingTestMode] = useState(false);

  // Webhook and Firewall Whitelisting states
  const [apiWebhookUrl, setApiWebhookUrl] = useState("");
  const [apiIpWhitelist, setApiIpWhitelist] = useState<string[]>([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [savingWhitelist, setSavingWhitelist] = useState(false);

  // API Top-up / Transfer State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [fundingMethod, setFundingMethod] = useState<"paystack" | "transfer">("paystack");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferring, setTransferring] = useState(false);

  const [apiRequestStatus, setApiRequestStatus] = useState<string | null>(null);
  const [requestingAccess, setRequestingAccess] = useState(false);

  const submitApiRequest = async () => {
    if (!user) return;
    setRequestingAccess(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ api_request_status: "pending" })
        .eq("user_id", user.id);

      if (error) throw error;

      toast({
        title: "Access Requested",
        description: "Your request for API access has been submitted to the admin team."
      });
      setApiRequestStatus("pending");
    } catch (err: any) {
      toast({
        title: "Request failed",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setRequestingAccess(false);
    }
  };

  const BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api";

  const fetchApiKey = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    
    const [profileRes, walletRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("api_key_prefix, api_access_enabled, api_rate_limit, api_secret_key_hash, api_test_mode, api_webhook_url, api_ip_whitelist, api_request_status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("wallets")
        .select("balance, api_balance")
        .eq("agent_id", user.id)
        .maybeSingle()
    ]);
    
    if (profileRes.data) {
      setApiKeyPrefix(profileRes.data.api_key_prefix ?? null);
      setHasKey(!!profileRes.data.api_key_prefix);
      setAccessEnabled(profileRes.data.api_access_enabled ?? true);
      setRateLimit(profileRes.data.api_rate_limit ?? 30);
      setTestMode(profileRes.data.api_test_mode ?? false);
      setApiWebhookUrl(profileRes.data.api_webhook_url ?? "");
      const ips = profileRes.data.api_ip_whitelist ?? [];
      setApiIpWhitelist(ips);
      setWhitelistInput(ips.join(", "));
      setApiRequestStatus(profileRes.data.api_request_status ?? null);
    }

    if (walletRes.data) {
      setWalletBalance(walletRes.data.balance ?? 0);
      setApiBalance(walletRes.data.api_balance ?? 0);
    } else {
      setWalletBalance(0);
      setApiBalance(0);
    }
    
    // Fetch recent logs
    const { data: logData } = await supabase
      .from("api_logs")
      .select("log_reference, endpoint, method, error_message, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    
    if (logData) setLogs(logData);
    
    setLoading(false);
  }, [user, toast]);


  useEffect(() => {
    fetchApiKey();
  }, [fetchApiKey]);

  // Handle return from Paystack funding redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    
    if (reference) {
      invokePublicFunctionAsUser("verify-payment", { body: { reference } }).then(async (res) => {
        const status = res.data?.status;
        if (status === "fulfilled") {
          toast({ title: "✅ API Wallet Credited Successfully!" });
        } else {
          toast({ title: "Payment Received", description: "Updating your balance..." });
        }
        
        await fetchApiKey(); // Refresh balance
        
        // Poll for up to 10s if balance hasn't reflected instantly
        let polls = 3;
        const interval = setInterval(async () => {
          await fetchApiKey();
          polls--;
          if (polls <= 0) clearInterval(interval);
        }, 3000);

        window.history.replaceState({}, "", window.location.pathname);
      }).catch(async () => {
        toast({ title: "Could not auto-verify payment", description: "Balance will update momentarily.", variant: "destructive" });
        await fetchApiKey();
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [toast, fetchApiKey]);


  const generateApiKey = async () => {
    if (!user) return;
    if (hasKey && !confirmRegen) { setConfirmRegen(true); return; }
    setGenerating(true);
    setConfirmRegen(false);

    const { data, error } = await supabase.rpc("rotate_api_key");

    if (error) {
      toast({ title: "Failed to generate keys", description: error.message, variant: "destructive" });
    } else if (data && !data.success) {
      toast({ title: "Failed to generate keys", description: data.error, variant: "destructive" });
    } else {
      setPlaintextKey(data.api_key);
      setPlaintextSecret(data.secret); 
      setApiKeyPrefix(data.prefix);
      setHasKey(true);
      setRevealed(true);
      toast({ title: "✅ New API Credentials generated", description: "Copy and store them securely — they will not be shown again." });
    }
    setGenerating(false);
  };

  const toggleTestMode = async (enabled: boolean) => {
    if (!user) return;
    setUpdatingTestMode(true);
    const { error } = await supabase
      .from("profiles")
      .update({ api_test_mode: enabled })
      .eq("user_id", user.id);
    
    if (error) {
      toast({ title: "Failed to update testing mode", description: error.message, variant: "destructive" });
    } else {
      setTestMode(enabled);
      toast({ 
        title: enabled ? "🚀 API Testing Mode Enabled" : "🔒 API Testing Mode Disabled",
        description: enabled 
          ? "You can now test integrations with only Bearer tokens. Charges and fulfillment are simulated."
          : "Production security and real fulfillment are now active."
      });
    }
    setUpdatingTestMode(false);
  };

  const handleSaveWebhook = async () => {
    if (!user) return;
    setSavingWebhook(true);
    
    if (apiWebhookUrl && !apiWebhookUrl.startsWith("https://")) {
      toast({ 
        title: "Secure HTTPS Required", 
        description: "Your callback URL must use the secure HTTPS protocol for webhook payload delivery.", 
        variant: "destructive" 
      });
      setSavingWebhook(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ api_webhook_url: apiWebhookUrl || null })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Failed to save webhook", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ Webhook URL Updated", description: "Real-time purchase events will now deliver to this endpoint." });
    }
    setSavingWebhook(false);
  };

  const handleSaveWhitelist = async () => {
    if (!user) return;
    setSavingWhitelist(true);

    const ipArray = whitelistInput
      .split(",")
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0);

    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/;
    const invalidIps = ipArray.filter(ip => !ipRegex.test(ip));
    
    if (invalidIps.length > 0) {
      toast({ 
        title: "Invalid IP Address", 
        description: `"${invalidIps[0]}" is not a valid IPv4 or IPv6 format.`, 
        variant: "destructive" 
      });
      setSavingWhitelist(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ api_ip_whitelist: ipArray.length > 0 ? ipArray : null })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Failed to save firewall settings", description: error.message, variant: "destructive" });
    } else {
      setApiIpWhitelist(ipArray);
      toast({ title: "✅ IP Firewall Rules Saved", description: "Only whitelisted source IPs will be permitted to access your API keys." });
    }
    setSavingWhitelist(false);
  };

  const handleTransferToApi = async () => {
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (amt > walletBalance) {
      toast({ title: "Insufficient main wallet balance", variant: "destructive" });
      return;
    }

    setTransferring(true);
    try {
      // Attempt direct RPC to perform the atomic DB transfer
      const { data, error } = await supabase.rpc("user_transfer_to_api", {
        p_amount: amt
      });

      if (error || !data) {
        throw new Error(error?.message || "Could not complete transfer. Ensure you've applied the database functions.");
      }

      if (data.success === false) {
        toast({ title: "Transfer Failed", description: data.error, variant: "destructive" });
      } else {
        setWalletBalance(data.main_balance);
        setApiBalance(data.api_balance);
        setIsTransferModalOpen(false);
        setTransferAmount("");
        toast({ title: "🎉 API Wallet Funded!", description: `GH₵${amt.toFixed(2)} has been transferred instantly.` });
      }
    } catch (err: any) {
      toast({ title: "Server Error", description: err.message || "RPC execution failed.", variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  };

  const handlePaystackApiFunding = async () => {
    const amt = parseFloat(transferAmount);
    if (!amt || amt < 10) {
      toast({ title: "Minimum funding amount is GH₵10.00", variant: "destructive" });
      return;
    }

    setTransferring(true);
    try {
      const { data, error } = await invokePublicFunctionAsUser("wallet-topup", {
        body: {
          amount: amt, // No fee added for API direct funding!
          wallet_credit: amt,
          wallet_type: "api", // Critically identifies this as the 0% fee route
          callback_url: `${getAppBaseUrl()}/dashboard/developer-api`,
        },
      });

      if (error || !data?.authorization_url) {
        const description = data?.error || await getFunctionErrorMessage(error, "Could not initialize Paystack payment.");
        toast({ title: "Failed to initialize payment", description, variant: "destructive" });
        return;
      }

      // Redirect to Paystack checkout
      window.location.href = data.authorization_url;
    } catch (err: any) {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    } finally {
      // Wait state remains during redirect
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const maskedKey = apiKeyPrefix ? `${apiKeyPrefix}${"•".repeat(24)}` : "";

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-sky-400" /> Developer Portal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build custom integrations using our secure, production-grade API.
          </p>
        </div>
        <Link to="/api-docs">
          <Button variant="outline" className="gap-2 border-sky-500/30 text-sky-400 hover:bg-sky-500/10">
            <ExternalLink className="w-4 h-4" /> API Documentation
          </Button>
        </Link>
      </div>

      {/* Access status banner */}
      {!loading && (
        <div className="space-y-4">
          <div className={cn(
            "flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-4 rounded-2xl border text-sm font-medium transition-all shadow-sm",
            accessEnabled 
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" 
              : apiRequestStatus === "pending"
                ? "border-amber-500/20 bg-amber-500/5 text-amber-400"
                : "border-red-500/20 bg-red-500/5 text-red-400"
          )}>
            <div className="flex items-center gap-3">
              {accessEnabled ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : apiRequestStatus === "pending" ? (
                <Clock className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              )}
              <div>
                <p className="font-bold text-sm">
                  {accessEnabled 
                    ? "API Access is Active" 
                    : apiRequestStatus === "pending"
                      ? "API Request Pending Approval"
                      : apiRequestStatus === "rejected"
                        ? "API Request Rejected"
                        : "API Access is Disabled"}
                </p>
                <p className="text-xs opacity-75 mt-0.5 font-normal">
                  {accessEnabled 
                    ? "Use your API key credentials to authenticate your automated bundle queries." 
                    : apiRequestStatus === "pending"
                      ? "Our admin team is currently reviewing your account. You will receive an SMS update once approved."
                      : apiRequestStatus === "rejected"
                        ? "Your previous application was rejected. Please review settings or apply again below."
                        : "Submit a request to activate developer capabilities and access live endpoints."}
                </p>
              </div>
            </div>

            {!accessEnabled && apiRequestStatus !== "pending" && (
              <Button
                onClick={submitApiRequest}
                disabled={requestingAccess}
                className="rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-[10px] tracking-widest uppercase h-9 px-4 gap-1.5 shrink-0 self-start md:self-auto border-none"
              >
                {requestingAccess ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                Request API Access
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Wallet Balances Grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={cn("border rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group transition-all", isDark ? "bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border-indigo-500/20" : "bg-indigo-50/50 border-indigo-100")}>
            <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <Wallet className={cn("w-24 h-24", isDark ? "text-white" : "text-indigo-900")} />
            </div>
            <p className="text-[10px] uppercase font-black tracking-widest text-indigo-500 dark:text-indigo-400 mb-2">Main Wallet Balance</p>
            <p className={cn("text-3xl font-black", isDark ? "text-white" : "text-indigo-950")}>GH₵{walletBalance.toFixed(2)}</p>
            <p className={cn("text-[10px] mt-1", isDark ? "text-white/40" : "text-indigo-700/60")}>Used for manual portal purchases</p>
          </div>
          <div className={cn("border rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group transition-all flex flex-col justify-between", isDark ? "bg-gradient-to-br from-sky-500/10 to-teal-500/10 border-sky-500/20" : "bg-sky-50/50 border-sky-100")}>
            <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <Zap className={cn("w-24 h-24", isDark ? "text-white" : "text-sky-900")} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-black tracking-widest text-sky-500 dark:text-sky-400 mb-2 flex items-center gap-2">
                API Wallet Balance 
                <Badge variant="outline" className="h-4 text-[8px] font-black px-1 bg-sky-500/10 text-sky-400 border-sky-400/30">ACTIVE</Badge>
              </p>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className={cn("text-3xl font-black", isDark ? "text-white" : "text-sky-950")}>GH₵{apiBalance.toFixed(2)}</p>
                  <p className={cn("text-[10px] mt-1", isDark ? "text-white/40" : "text-sky-700/60")}>Deducted for automated API-fulfilled orders</p>
                </div>

                {/* Enhanced Top-Up Trigger Modal */}
                <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      size="sm" 
                      className="h-9 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-black text-[10px] tracking-widest uppercase px-4 gap-1.5 shadow-lg shadow-sky-500/20 border-none relative z-10"
                    >
                      <PlusCircle className="w-3.5 h-3.5" /> Fund Wallet
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[420px] rounded-[2rem] bg-card border-border shadow-2xl p-0 overflow-hidden">
                    <DialogHeader className="p-6 bg-gradient-to-br from-sky-500/5 to-teal-500/5 border-b border-border pb-5">
                      <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-500 border border-sky-500/20">
                          <Zap className="w-5 h-5" />
                        </div>
                        <DialogTitle className="font-black text-xl">Fund API Wallet</DialogTitle>
                      </div>
                      <DialogDescription className="text-xs font-medium">
                        Select a funding method to instantly increase your integration balance.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Funding Selector Tabs */}
                    <div className="flex border-b border-border bg-muted/10">
                      <button 
                        onClick={() => setFundingMethod("paystack")}
                        className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all", fundingMethod === "paystack" ? "border-sky-500 text-foreground bg-sky-500/5" : "border-transparent text-muted-foreground hover:text-foreground")}
                      >
                        Direct Payment
                      </button>
                      <button 
                        onClick={() => setFundingMethod("transfer")}
                        className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all", fundingMethod === "transfer" ? "border-sky-500 text-foreground bg-sky-500/5" : "border-transparent text-muted-foreground hover:text-foreground")}
                      >
                        Transfer from Main
                      </button>
                    </div>

                    <div className="p-6 space-y-5">
                      {fundingMethod === "transfer" && (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border text-xs animate-in fade-in slide-in-from-top-1">
                          <span className="text-muted-foreground font-medium">Main Balance Available:</span>
                          <span className="font-black text-foreground">GH₵{walletBalance.toFixed(2)}</span>
                        </div>
                      )}

                      {fundingMethod === "paystack" && (
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 animate-in fade-in slide-in-from-top-1">
                          <Shield className="w-4 h-4 text-emerald-500 shrink-0" />
                          <div>
                            <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">0% Processing Fee</p>
                            <p className="text-[9px] font-medium text-emerald-600/70 dark:text-emerald-400/70">API Direct Funding incurs no gateway platform fees.</p>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Amount (GH₵)</Label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-muted-foreground/60 text-sm">₵</span>
                          <Input 
                            type="number" 
                            placeholder="0.00"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="h-12 pl-10 font-black text-base rounded-xl bg-background border-border focus-visible:ring-sky-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {[20, 50, 100, 200].map(v => (
                          <button 
                            key={v} 
                            onClick={() => setTransferAmount(v.toString())}
                            className="py-2 text-[10px] font-black border border-border rounded-lg bg-muted/30 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all"
                          >
                            ₵{v}
                          </button>
                        ))}
                      </div>
                    </div>

                    <DialogFooter className="p-6 bg-muted/30 border-t border-border">
                      {fundingMethod === "paystack" ? (
                        <Button 
                          onClick={handlePaystackApiFunding} 
                          disabled={transferring || !transferAmount || parseFloat(transferAmount) < 10}
                          className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg border-none gap-2 transition-colors"
                        >
                          {transferring ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Initializing...</>
                          ) : (
                            <><Zap className="w-4 h-4" /> Pay Instantly</>
                          )}
                        </Button>
                      ) : (
                        <Button 
                          onClick={handleTransferToApi} 
                          disabled={transferring || !transferAmount || parseFloat(transferAmount) <= 0}
                          className="w-full h-12 bg-sky-500 hover:bg-sky-400 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg border-none gap-2"
                        >
                          {transferring ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                          ) : (
                            <><ArrowRightLeft className="w-4 h-4" /> Complete Transfer</>
                          )}
                        </Button>
                      )}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Credentials Card */}
      <Card className="border-sky-500/20 bg-sky-500/5 overflow-hidden">
        <CardHeader className="border-b border-sky-500/10 bg-sky-500/5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="w-5 h-5 text-sky-500" /> Authentication Credentials
          </CardTitle>
          <CardDescription>
            Use this key to authenticate your requests. Keep it secure.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading credentials...
            </div>
          ) : hasKey ? (
            <div className="grid gap-6">
              {/* API Key */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-sky-500/70">Public API Key (Bearer Token)</label>
                <div className="flex gap-2">
                  <Input
                    value={plaintextKey && revealed ? plaintextKey : maskedKey}
                    readOnly
                    className="font-mono bg-background border-border text-sm h-10"
                  />
                  {plaintextKey && (
                    <Button variant="secondary" size="icon" className="h-10 w-10" onClick={() => setRevealed(!revealed)}>
                      {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  )}
                  <Button variant="secondary" size="icon" className="h-10 w-10" onClick={() => copyToClipboard(plaintextKey || maskedKey)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>


              <div className="flex flex-wrap items-center gap-6 pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Shield className="w-3.5 h-3.5" /> Rate Limit: <strong className="text-foreground/80">{rateLimit} req/min</strong>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Terminal className="w-3.5 h-3.5" /> Auth: <strong className="text-sky-500 dark:text-sky-400">Bearer Token</strong>
                </div>
                
                <div className="flex items-center gap-3 ml-auto bg-muted/30 px-3 py-1.5 rounded-lg border border-border">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-none">Testing Mode</span>
                    <span className="text-[9px] text-muted-foreground/60 mt-1">Bypass signatures</span>
                  </div>
                  <Switch 
                    checked={testMode} 
                    onCheckedChange={toggleTestMode} 
                    disabled={updatingTestMode}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-sky-500/10 flex items-center justify-center mx-auto">
                <Key className="w-6 h-6 text-sky-500 opacity-50" />
              </div>
              <p className="text-sm text-muted-foreground italic">No API credentials found. Generate them below to get started.</p>
            </div>
          )}

          <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center gap-4">
            <Button
              onClick={generateApiKey}
              disabled={generating || !accessEnabled}
              variant={confirmRegen ? "destructive" : "secondary"}
              className="gap-2 w-full sm:w-auto"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {confirmRegen ? "Confirm Regeneration" : hasKey ? "Rotate Keys" : "Generate API Credentials"}
            </Button>
            {confirmRegen && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmRegen(false)}>Cancel</Button>
            )}
            {hasKey && !confirmRegen && (
              <p className="text-[10px] text-muted-foreground italic max-w-xs">Rotating keys will immediately invalidate your current API Key.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Webhook & IP Whitelist Security Configuration */}
      {!loading && hasKey && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Webhook Config Card */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Globe className="w-4 h-4 text-emerald-400" /> Webhook Configuration
              </CardTitle>
              <CardDescription className="text-xs">
                Receive real-time transaction event callbacks (e.g. <code>order.fulfilled</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Webhook Endpoint URL</label>
                <div className="flex gap-2">
                  <Input 
                    type="url"
                    placeholder="https://yourserver.com/api/webhooks"
                    value={apiWebhookUrl}
                    onChange={(e) => setApiWebhookUrl(e.target.value)}
                    className="font-mono bg-background border-border text-xs h-10 rounded-xl"
                  />
                  <Button 
                    onClick={handleSaveWebhook}
                    disabled={savingWebhook}
                    className="h-10 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl px-4 text-xs font-black uppercase tracking-wider"
                  >
                    {savingWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
                  ⚠️ Must be a secure HTTPS endpoint. Loopback / private VPC addresses are blocked by our SSRF firewall.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* IP Whitelist Firewall Card */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Shield className="w-4 h-4 text-sky-400" /> API Firewall (IP Whitelist)
              </CardTitle>
              <CardDescription className="text-xs">
                Restrict API request authorization to trusted origin server IP addresses.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">Whitelisted IP Addresses</label>
                <div className="flex gap-2">
                  <Input 
                    type="text"
                    placeholder="e.g. 192.0.2.1, 203.0.113.5"
                    value={whitelistInput}
                    onChange={(e) => setWhitelistInput(e.target.value)}
                    className="font-mono bg-background border-border text-xs h-10 rounded-xl"
                  />
                  <Button 
                    onClick={handleSaveWhitelist}
                    disabled={savingWhitelist}
                    className="h-10 bg-sky-500 hover:bg-sky-600 text-white rounded-xl px-4 text-xs font-black uppercase tracking-wider"
                  >
                    {savingWhitelist ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <div className="text-[9px] leading-relaxed space-y-1">
                  <p className="text-red-400/90 dark:text-red-400/90">
                    <strong className="text-red-400 dark:text-red-400 font-bold">🛡️ Fully Optional but Recommended:</strong> Leaving this blank allows access from any IP address. Whitelisting shields your float balance from unauthorized debits in case your API keys are accidentally leaked (e.g., in a public GitHub repository).
                  </p>
                  <p className="mt-1 text-muted-foreground/70">
                    <strong className="text-sky-400">🔍 Finding Your Server IP:</strong> Copy your hosting provider's (e.g., AWS, Heroku, DigitalOcean) outbound server IP, or run <code className="bg-white/5 px-1 rounded text-white/80">curl ifconfig.me</code> or <code className="bg-white/5 px-1 rounded text-white/80">curl icanhazip.com</code> in your backend server terminal to discover it.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* API Logs & Quick Start */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Start */}
        <Card className="lg:col-span-1 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-sky-500 dark:text-sky-400" /> Quick Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-4 text-muted-foreground">
            <div className="space-y-1">
              <p className="font-bold text-foreground/70">1. Required Header</p>
              <ul className="list-disc list-inside space-y-1">
                <li><code>Authorization: Bearer [YOUR_KEY]</code></li>
              </ul>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-foreground/70">2. Sample Request</p>
              <pre className="p-2 bg-muted border border-border rounded overflow-x-auto text-[10px]">
                curl -X GET {BASE_URL}/balance \<br />
                &nbsp;&nbsp;-H "Authorization: Bearer [KEY]"
              </pre>
            </div>
            <Button variant="link" className="p-0 h-auto text-sky-400 text-xs" asChild>
              <Link to="/api-docs">View Integration Guide →</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Recent API Logs */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-amber-500 dark:text-amber-400" /> Recent Errors & Activity
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchApiKey}>
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-10 opacity-30">
                <Bug className="w-8 h-8 mx-auto mb-2" />
                <p className="text-xs">No errors or activity logged yet.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50 border-border">
                      <TableHead className="text-[10px] font-black uppercase tracking-widest px-3">Reference</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest px-3">Endpoint</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest px-3">Status</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest px-3 text-right">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.log_reference} className="border-border text-[11px] hover:bg-muted/50">
                        <TableCell className="font-mono text-amber-600 dark:text-amber-400 px-3">{log.log_reference}</TableCell>
                        <TableCell className="text-foreground/80 px-3 truncate max-w-[120px]">{log.method} {log.endpoint}</TableCell>
                        <TableCell className="px-3">
                          <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5">Error</Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground px-3">
                          {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-4 italic flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> If you receive an Internal Server Error, provide the 8-character reference ID to support for troubleshooting.
            </p>
          </CardContent>
        </Card>
      </div>
      {/* ── Developer Community ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* WhatsApp Dev Group */}
        <Card className="bg-green-500/5 border-green-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-400" /> Developer Community
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Join our WhatsApp group to get help from other developers, share integrations, and get API update announcements.
            </p>
            <div className="space-y-2">
              {[
                { label: "💬 Developer WhatsApp Channel", href: "https://whatsapp.com/channel/0029Vb81tu4HVvTdqauPgU0Z", color: "text-green-400 hover:text-green-300" },
                { label: "📖 API Documentation", href: "/api-docs", color: "text-sky-400 hover:text-sky-300" },
              ].map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex items-center gap-2 text-xs font-bold transition-colors ${item.color}`}
                >
                  {item.label} <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Integration use cases */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Code2 className="w-4 h-4 text-amber-500 dark:text-amber-400" /> What Developers Build
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { emoji: "🤖", title: "WhatsApp Bots", desc: "Auto-sell data via WhatsApp without lifting a finger" },
                { emoji: "🏪", title: "Custom Storefronts", desc: "White-label stores with your own branding and domain" },
                { emoji: "📊", title: "Business Dashboards", desc: "Internal tools for tracking corporate data spend" },
                { emoji: "🔗", title: "POS Integrations", desc: "Connect SwiftData to existing point-of-sale systems" },
              ].map(uc => (
                <div key={uc.title} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border">
                  <span className="text-lg shrink-0">{uc.emoji}</span>
                  <div>
                    <p className="text-xs font-black text-foreground/90">{uc.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{uc.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Share your integration CTA */}
            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Share2 className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <p className="text-xs text-foreground/70 flex-1">Built something cool with the API?</p>
              <a
                href={`https://wa.me/?text=${encodeURIComponent("🚀 I just built an integration with the SwiftData Ghana API! Check out the Developer Portal: https://swiftdatagh.shop/developers")}`}

                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-black text-amber-400 hover:text-amber-300 whitespace-nowrap transition-colors"
              >
                Share it →
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default DashboardDeveloperAPI;
