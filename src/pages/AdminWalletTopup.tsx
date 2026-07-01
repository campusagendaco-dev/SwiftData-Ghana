import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Search, Wallet, Loader2, CheckCircle, User, ArrowRight, 
  ShieldCheck, Smartphone, Mail, Store, History, ChevronRight,
  ArrowUpRight, RefreshCw, Filter, AlertCircle, PlayCircle, Eye,
  Check, X, FileText
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";

interface AgentResult {
  user_id: string;
  full_name: string;
  email: string;
  store_name: string;
  momo_number: string;
  momo_network: string;
  momo_account_name: string;
  topup_reference: string;
  phone?: string;
}

interface DepositRecord {
  id: string;
  source: "auto_wallet" | "auto_store" | "manual_store";
  created_at: string;
  amount: number;
  status: string;
  sender: string;
  recipient: string;
  agent_email?: string;
  reference?: string;
  failure_reason?: string | null;
}

const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500];

const AdminWalletTopup = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  
  // Tab State
  const [activeTab, setActiveTab] = useState("manual");

  // Manual Topup State
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AgentResult[]>([]);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [apiBalance, setApiBalance] = useState<number>(0);
  const [walletType, setWalletType] = useState<"main" | "api">("main");
  const [creditAmount, setCreditAmount] = useState("");
  const [crediting, setCrediting] = useState(false);

  // Incoming Deposits State
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [depositsTypeFilter, setDepositsTypeFilter] = useState<"all" | "auto_wallet" | "auto_store" | "manual_store">("all");
  const [depositsStatusFilter, setDepositsStatusFilter] = useState<"all" | "pending" | "fulfilled" | "failed">("all");
  const [depositsSearch, setDepositsSearch] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleSearch = async () => {
    const term = searchTerm.trim();
    if (!term) return;
    
    setSearching(true);
    setSearchResults([]);
    
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "find_user", search: term },
      });

      if (error || data?.error) throw new Error(data?.error || error?.message);
      
      // Filter for agents only
      const agents = (data.users || []).filter((u: any) => u.is_agent || u.agent_approved);
      setSearchResults(agents);
      
      if (agents.length === 0) {
        toast({ title: "No agents found", description: `Could not find any agent matching "${term}"`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const selectAgent = async (selected: AgentResult) => {
    setAgent(selected);
    setSearchResults([]);
    setSearchTerm("");
    
    // Fetch full profile and wallet details
    const [profileRes, walletRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", selected.user_id).single(),
      supabase.from("wallets").select("balance, api_balance").eq("agent_id", selected.user_id).maybeSingle()
    ]);

    if (profileRes.data) {
      setAgent(profileRes.data as AgentResult);
    }
    setWalletBalance(walletRes.data?.balance || 0);
    setApiBalance(walletRes.data?.api_balance || 0);
  };

  const handleCredit = async (overrideAmount?: number) => {
    if (!agent) return;
    const amount = overrideAmount || parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setCrediting(true);
    const action = walletType === "api" ? "manual_api_topup" : "manual_topup";
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action, user_id: agent.user_id, amount },
    });

    if (error || data?.error) {
      toast({ title: `Failed to credit ${walletType === "api" ? "API " : ""}wallet`, description: data?.error || error?.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, walletType === "api" ? "manual_api_wallet_topup" : "manual_wallet_topup", {
          target_agent_id: agent.user_id,
          target_agent_name: agent.full_name,
          amount: amount,
          new_balance: data.new_balance
        });
      }

      toast({ title: `Successfully credited GH₵${amount.toFixed(2)} to ${agent.full_name}'s ${walletType === "api" ? "API" : "Main"} wallet!` });
      if (walletType === "api") {
        setApiBalance(data.new_balance);
      } else {
        setWalletBalance(data.new_balance);
      }
      setCreditAmount("");
    }
    setCrediting(false);
  };

  // Fetch Deposits from DB (orders table + store_deposits table)
  const fetchDeposits = async () => {
    setLoadingDeposits(true);
    try {
      // 1. Fetch from orders table (auto wallet topups and store topups)
      const { data: orderData, error: orderErr } = await supabase
        .from("orders")
        .select(`
          id,
          created_at,
          order_type,
          amount,
          status,
          customer_phone,
          customer_name,
          failure_reason,
          agent_id
        `)
        .in("order_type", ["wallet_topup", "store_wallet_topup"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (orderErr) throw orderErr;

      // Fetch profiles for these agent_ids separately since there is no public foreign key constraint in the schema cache
      const agentIds = [...new Set((orderData || []).map((o: any) => o.agent_id).filter(Boolean))];
      const profilesMap: Record<string, { full_name: string; email: string }> = {};
      if (agentIds.length > 0) {
        const { data: profilesData, error: profilesErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", agentIds);
        
        if (!profilesErr && profilesData) {
          profilesData.forEach((p: any) => {
            profilesMap[p.user_id] = {
              full_name: p.full_name,
              email: p.email
            };
          });
        }
      }

      // 2. Fetch from store_deposits table (manual storefront deposits)
      const { data: storeData, error: storeErr } = await supabase
        .from("store_deposits")
        .select(`
          id,
          created_at,
          amount,
          status,
          sender_number,
          transaction_reference,
          agent_id,
          customer_id,
          customer_profile:profiles!store_deposits_customer_id_fkey (
            full_name,
            email,
            phone
          ),
          agent_profile:profiles!store_deposits_agent_id_fkey (
            full_name,
            email
          )
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (storeErr) throw storeErr;

      // 3. Map orders data
      const mappedOrders: DepositRecord[] = (orderData || []).map((o: any) => {
        const profile = profilesMap[o.agent_id];
        return {
          id: o.id,
          source: o.order_type === "wallet_topup" ? "auto_wallet" : "auto_store",
          created_at: o.created_at,
          amount: Number(o.amount),
          status: o.status,
          sender: o.customer_name || o.customer_phone || "System / Direct",
          recipient: profile?.full_name || "Unknown Agent",
          agent_email: profile?.email,
          reference: o.id,
          failure_reason: o.failure_reason
        };
      });

      // 4. Map store_deposits data
      const mappedStore: DepositRecord[] = (storeData || []).map((d: any) => ({
        id: d.id,
        source: "manual_store",
        created_at: d.created_at,
        amount: Number(d.amount),
        status: d.status,
        sender: d.customer_profile?.full_name || d.sender_number || "Unknown Customer",
        recipient: d.agent_profile?.full_name || "Unknown Agent",
        agent_email: d.agent_profile?.email,
        reference: d.transaction_reference || "N/A",
        failure_reason: null
      }));

      // 5. Combine and sort by date descending
      const combined = [...mappedOrders, ...mappedStore].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setDeposits(combined);
    } catch (err: any) {
      console.error("Error fetching deposits:", err);
      toast({
        title: "Failed to load deposits",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoadingDeposits(false);
    }
  };

  // Verify / retry payment using edge function (for automated deposits)
  const handleVerifyPayment = async (orderId: string) => {
    setProcessingId(orderId);
    try {
      const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
        body: { reference: orderId },
      });
      if (error) {
        toast({ title: "Verification failed", description: error.message, variant: "destructive" });
      } else if (data?.status === "fulfilled") {
        toast({ title: "Deposit verified & credited successfully!" });
        await fetchDeposits();
      } else {
        toast({
          title: "Verification completed",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: data?.status === "fulfilled" ? "default" : "destructive",
        });
        await fetchDeposits();
      }
    } catch (e: any) {
      toast({ title: "Verification error", description: e.message, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === "records") {
      fetchDeposits();
    }
  }, [activeTab]);

  // Client-side filtering
  const filteredDeposits = deposits.filter(d => {
    const term = depositsSearch.trim().toLowerCase();
    const matchesSearch = !term || 
      d.sender.toLowerCase().includes(term) ||
      d.recipient.toLowerCase().includes(term) ||
      (d.agent_email && d.agent_email.toLowerCase().includes(term)) ||
      (d.reference && d.reference.toLowerCase().includes(term)) ||
      d.id.toLowerCase().includes(term);

    let matchesType = true;
    if (depositsTypeFilter !== "all") {
      matchesType = d.source === depositsTypeFilter;
    }

    let matchesStatus = true;
    if (depositsStatusFilter !== "all") {
      if (depositsStatusFilter === "pending") {
        matchesStatus = d.status === "pending" || d.status === "paid" || d.status === "processing";
      } else if (depositsStatusFilter === "fulfilled") {
        matchesStatus = d.status === "fulfilled" || d.status === "approved";
      } else if (depositsStatusFilter === "failed") {
        matchesStatus = d.status === "failed" || d.status === "declined" || d.status === "fulfillment_failed";
      }
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fulfilled":
      case "approved":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border">Success</Badge>;
      case "pending":
      case "paid":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 border">Pending</Badge>;
      case "processing":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border animate-pulse">Processing</Badge>;
      case "failed":
      case "declined":
      case "fulfillment_failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border">Failed</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground border-border border">{status}</Badge>;
    }
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "auto_wallet":
        return <Badge className="bg-purple-500/15 text-purple-400 border border-purple-500/20">Agent Auto</Badge>;
      case "auto_store":
        return <Badge className="bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">Store Auto</Badge>;
      case "manual_store":
        return <Badge className="bg-orange-500/15 text-orange-400 border border-orange-500/20">Store Manual</Badge>;
      default:
        return <Badge variant="outline">{source}</Badge>;
    }
  };

  return (
    <div className="space-y-8 pb-20 max-w-6xl mx-auto">
      {/* Header Section */}
      <div className="space-y-2 border-b border-border pb-8">
        <div className="flex items-center gap-3 mb-2">
           <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Wallet className="w-5 h-5" />
           </div>
           <h1 className="font-display text-4xl font-black tracking-tight text-foreground">
             Wallet Top-Ups & Deposits
           </h1>
        </div>
        <p className="text-muted-foreground font-medium text-sm leading-relaxed max-w-xl">
          Credit agent wallets manually or view recent incoming deposit requests and their payment statuses.
        </p>
      </div>

      <Tabs defaultValue="manual" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-secondary/60 backdrop-blur-md p-1.5 rounded-2xl h-14 w-full max-w-md border border-border/60">
          <TabsTrigger value="manual" className="rounded-xl h-full font-black uppercase tracking-wider text-xs flex-1 transition-all">
            Manual Credit
          </TabsTrigger>
          <TabsTrigger value="records" className="rounded-xl h-full font-black uppercase tracking-wider text-xs flex-1 transition-all">
            Incoming Deposits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-6">
          {/* Search Panel */}
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000 dark:opacity-25"></div>
            <div className="relative bg-card border border-border shadow-lg rounded-3xl p-6 backdrop-blur-xl">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="w-full space-y-2">
                  <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Search Agent</Label>
                  <div className="relative">
                    <Input
                      placeholder="Enter Name, Email or Phone Number..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-background border-border h-14 text-lg font-black text-foreground placeholder:text-muted-foreground/40 rounded-2xl focus:border-amber-500/40 focus:ring-0 transition-all pl-12 shadow-sm"
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/50" />
                    {searching && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-5 h-5 animate-spin text-amber-500/50" />
                      </div>
                    )}
                  </div>
                </div>
                <Button 
                  onClick={handleSearch} 
                  disabled={searching || !searchTerm.trim()}
                  className="h-14 px-8 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black uppercase tracking-widest text-xs gap-3 shrink-0 disabled:opacity-30 transition-all duration-300 shadow-xl shadow-amber-400/10"
                >
                  Find Agent
                </Button>
              </div>

              {/* Search Results Dropdown */}
              {searchResults.length > 0 && (
                <div className="mt-4 rounded-2xl bg-card border border-border overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 shadow-2xl ring-1 ring-black/5">
                  <p className="px-4 py-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground border-b border-border bg-muted/50">Found {searchResults.length} Agents</p>
                  <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
                     {searchResults.map((res) => (
                        <button
                          key={res.user_id}
                          onClick={() => selectAgent(res)}
                          className="w-full flex items-center justify-between p-4 hover:bg-muted transition-colors text-left group"
                        >
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                                <User className="w-5 h-5" />
                             </div>
                             <div>
                                <p className="font-black text-foreground">{res.full_name}</p>
                                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{res.email}</p>
                             </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-500 transition-all group-hover:translate-x-1" />
                        </button>
                     ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent Details & Topup Action */}
          {agent && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Left: Agent Info */}
              <div className="lg:col-span-2 space-y-4">
                 <div className="bg-card border border-border shadow-lg rounded-3xl p-6 backdrop-blur-md">
                    <div className="flex items-center gap-4 mb-6">
                       <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-sm">
                          <User className="w-6 h-6" />
                       </div>
                       <div>
                          <h2 className="font-black text-foreground text-lg tracking-tight">{agent.full_name}</h2>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium"><Store className="w-3 h-3" /> {agent.store_name || "Personal Account"}</p>
                       </div>
                    </div>

                     <div className="space-y-3">
                       <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border shadow-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                             <Smartphone className="w-3.5 h-3.5" />
                             <span className="text-[10px] uppercase font-black tracking-wider">MoMo Wallet</span>
                          </div>
                          <span className="text-xs font-mono font-black text-foreground">{agent.momo_number || agent.phone || "—"}</span>
                       </div>
                       <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border shadow-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                             <Mail className="w-3.5 h-3.5" />
                             <span className="text-[10px] uppercase font-black tracking-wider">Email Address</span>
                          </div>
                          <span className="text-xs font-bold text-foreground truncate max-w-[140px]">{agent.email}</span>
                       </div>
                       {agent.topup_reference && (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/5 dark:bg-amber-400/10 border border-amber-500/20 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400/60">
                              <History className="w-3.5 h-3.5" />
                              <span className="text-[10px] uppercase font-black tracking-wider">Reference</span>
                            </div>
                            <span className="text-sm font-black text-amber-600 dark:text-amber-400 tracking-widest">{agent.topup_reference}</span>
                        </div>
                       )}
                    </div>
                 </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-blue-500/5 to-indigo-500/5 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-500/20 shadow-md rounded-3xl p-5 backdrop-blur-md relative overflow-hidden group">
                       <p className="text-[10px] uppercase font-black tracking-widest text-blue-600 dark:text-blue-400/60 mb-2">Main Balance</p>
                       <p className="text-2xl font-black text-foreground tracking-tight">GH₵{walletBalance.toFixed(2)}</p>
                    </div>
                    <div className="bg-gradient-to-br from-sky-500/5 to-teal-500/5 dark:from-sky-500/10 dark:to-teal-500/10 border border-sky-500/20 shadow-md rounded-3xl p-5 backdrop-blur-md relative overflow-hidden group">
                       <p className="text-[10px] uppercase font-black tracking-widest text-sky-600 dark:text-sky-400/60 mb-2">API Balance</p>
                       <p className="text-2xl font-black text-foreground tracking-tight">GH₵{apiBalance.toFixed(2)}</p>
                    </div>
                  </div>
              </div>

              {/* Right: Topup Action */}
              <div className="lg:col-span-3">
                 <div className="bg-card border border-border shadow-xl rounded-3xl p-6 md:p-8 backdrop-blur-xl h-full flex flex-col">
                    <h3 className="font-black text-xl text-foreground mb-6 flex items-center gap-2 tracking-tight">
                       <ArrowRight className="w-5 h-5 text-amber-500" />
                       Credit Agent Wallet
                    </h3>

                     <div className="flex gap-2 p-1.5 bg-muted rounded-2xl border border-border mb-6">
                       <button
                         type="button"
                         onClick={() => setWalletType("main")}
                         className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${walletType === "main" ? "bg-amber-50 text-black shadow-lg" : "text-muted-foreground hover:text-foreground hover:bg-background/50"}`}
                       >
                         Main Wallet
                       </button>
                       <button
                         type="button"
                         onClick={() => setWalletType("api")}
                         className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${walletType === "api" ? "bg-sky-500 text-white shadow-lg" : "text-muted-foreground hover:text-foreground hover:bg-background/50"}`}
                       >
                         API Wallet
                       </button>
                     </div>

                    <div className="grid grid-cols-3 gap-3 mb-8">
                       {QUICK_AMOUNTS.map((amt) => (
                          <button
                            key={amt}
                            onClick={() => handleCredit(amt)}
                            disabled={crediting}
                            className="px-4 py-4 rounded-2xl bg-background border border-border text-foreground hover:bg-amber-500 hover:text-black hover:border-amber-500 font-black shadow-sm transition-all duration-200 disabled:opacity-50"
                          >
                             ₵{amt}
                          </button>
                       ))}
                    </div>

                    <div className="mt-auto space-y-4">
                       <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black tracking-widest text-muted-foreground ml-1">Custom Amount (GH₵)</Label>
                          <div className="flex gap-3">
                            <div className="relative flex-1">
                               <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-black">GH₵</span>
                               <Input
                                 type="number" step="0.01" min="0.01"
                                 placeholder="0.00"
                                 value={creditAmount}
                                 onChange={(e) => setCreditAmount(e.target.value)}
                                 className="bg-background border-border h-14 pl-14 text-lg font-black text-foreground rounded-2xl focus:border-amber-500/40 shadow-sm"
                               />
                            </div>
                            <Button 
                              onClick={() => handleCredit()} 
                              disabled={crediting || !creditAmount}
                              className="h-14 px-8 rounded-2xl bg-foreground text-background hover:bg-amber-500 hover:text-black font-black uppercase tracking-widest text-xs gap-2 transition-all duration-300 shadow-xl"
                            >
                              {crediting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                              {crediting ? "Processing" : "Submit"}
                            </Button>
                          </div>
                       </div>
                       <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-400/5 border border-amber-200 dark:border-amber-400/10 text-[10px] text-amber-700 dark:text-amber-400/60 leading-relaxed font-medium italic">
                          Notice: This action is final and will be logged in the system audit records. The agent will receive an automated SMS confirmation.
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="records" className="space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-card border-border shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10">
                <FileText className="w-16 h-16 text-purple-500" />
              </div>
              <CardContent className="p-5">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Total Deposits (Shown)</p>
                <p className="text-3xl font-black text-foreground">{filteredDeposits.length}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Volume: GH₵{filteredDeposits.reduce((acc, d) => acc + (d.status === "fulfilled" || d.status === "approved" ? d.amount : 0), 0).toFixed(2)} credited
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10">
                <Loader2 className="w-16 h-16 text-amber-500 animate-spin" />
              </div>
              <CardContent className="p-5">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Pending Auto Deposits</p>
                <p className="text-3xl font-black text-amber-500">
                  {deposits.filter(d => d.source !== "manual_store" && (d.status === "pending" || d.status === "paid" || d.status === "processing")).length}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Awaiting verification</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10">
                <Store className="w-16 h-16 text-orange-500" />
              </div>
              <CardContent className="p-5">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Pending Manual Deposits</p>
                <p className="text-3xl font-black text-orange-500">
                  {deposits.filter(d => d.source === "manual_store" && d.status === "pending").length}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Requires agent approval</p>
              </CardContent>
            </Card>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap gap-4 items-center bg-card border border-border p-4 rounded-2xl shadow-sm">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by agent, customer, ref..."
                value={depositsSearch}
                onChange={(e) => setDepositsSearch(e.target.value)}
                className="pl-10 bg-background border-border"
              />
            </div>

            <div className="flex gap-3">
              <select
                value={depositsTypeFilter}
                onChange={(e) => setDepositsTypeFilter(e.target.value as any)}
                className="text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground outline-none cursor-pointer h-10"
              >
                <option value="all">All Deposit Types</option>
                <option value="auto_wallet">Agent Auto Deposit</option>
                <option value="auto_store">Store Auto Deposit</option>
                <option value="manual_store">Store Manual Deposit</option>
              </select>

              <select
                value={depositsStatusFilter}
                onChange={(e) => setDepositsStatusFilter(e.target.value as any)}
                className="text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground outline-none cursor-pointer h-10"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending/Active</option>
                <option value="fulfilled">Success/Approved</option>
                <option value="failed">Failed/Declined</option>
              </select>

              <Button
                variant="outline"
                size="icon"
                onClick={fetchDeposits}
                disabled={loadingDeposits}
                className="h-10 w-10 border-border"
              >
                <RefreshCw className={`w-4 h-4 ${loadingDeposits ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Records Table / List */}
          {loadingDeposits && filteredDeposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              <p className="text-sm text-muted-foreground">Loading deposit records...</p>
            </div>
          ) : filteredDeposits.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-2xl bg-card">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-muted-foreground/60" />
              <p className="text-sm font-semibold text-foreground">No deposit records found.</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Desktop Table */}
              <div className="hidden md:block rounded-2xl border border-border overflow-hidden bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sender / Customer</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recipient / Agent</th>
                        <th className="text-right px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Amount</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reference / Transaction ID</th>
                        <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Status</th>
                        <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredDeposits.map((d) => (
                        <tr key={d.id} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(d.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}
                          </td>
                          <td className="px-4 py-3.5">
                            {getSourceBadge(d.source)}
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-xs font-bold text-foreground truncate max-w-[140px]">{d.sender}</p>
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-xs font-bold text-foreground truncate max-w-[140px]">{d.recipient}</p>
                            {d.agent_email && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{d.agent_email}</p>}
                          </td>
                          <td className="px-4 py-3.5 text-right font-black text-foreground whitespace-nowrap">
                            GH₵{d.amount.toFixed(2)}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-mono text-muted-foreground/80 max-w-[150px] truncate" title={d.reference || d.id}>
                            {d.reference || d.id}
                          </td>
                          <td className="px-4 py-3.5 text-center whitespace-nowrap">
                            {getStatusBadge(d.status)}
                          </td>
                          <td className="px-4 py-3.5 text-center whitespace-nowrap">
                            {d.source !== "manual_store" && (d.status === "pending" || d.status === "paid" || d.status === "failed" || d.status === "fulfillment_failed") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs gap-1 border-white/10 hover:border-amber-500/30"
                                onClick={() => handleVerifyPayment(d.id)}
                                disabled={processingId === d.id}
                              >
                                {processingId === d.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                                ) : (
                                  <PlayCircle className="w-3 h-3" />
                                )}
                                Verify Payment
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground/45">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card List */}
              <div className="md:hidden space-y-4">
                {filteredDeposits.map((d) => (
                  <div key={d.id} className="rounded-2xl border border-border p-4 bg-card space-y-3 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(d.created_at).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                        {getSourceBadge(d.source)}
                      </div>
                      <div className="text-right">
                        <p className="font-black text-foreground">GH₵{d.amount.toFixed(2)}</p>
                        {getStatusBadge(d.status)}
                      </div>
                    </div>

                    <div className="border-t border-border/60 pt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">From</p>
                        <p className="font-semibold text-foreground/80 truncate">{d.sender}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">To / Agent</p>
                        <p className="font-semibold text-foreground/80 truncate">{d.recipient}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Reference / Order ID</p>
                        <p className="font-mono text-muted-foreground truncate" title={d.reference || d.id}>{d.reference || d.id}</p>
                      </div>
                    </div>

                    {d.source !== "manual_store" && (d.status === "pending" || d.status === "paid" || d.status === "failed" || d.status === "fulfillment_failed") && (
                      <div className="border-t border-border/60 pt-3">
                        <Button
                          size="sm"
                          className="w-full bg-secondary/80 hover:bg-secondary border border-border text-foreground h-9 gap-1.5"
                          onClick={() => handleVerifyPayment(d.id)}
                          disabled={processingId === d.id}
                        >
                          {processingId === d.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                          ) : (
                            <PlayCircle className="w-3.5 h-3.5 text-amber-500" />
                          )}
                          Verify Payment Status
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminWalletTopup;
