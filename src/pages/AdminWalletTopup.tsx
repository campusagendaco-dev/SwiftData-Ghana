import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Wallet, Loader2, CheckCircle, User, ArrowRight, ShieldCheck, Smartphone, Mail, Store, History, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";

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

const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500];

const AdminWalletTopup = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AgentResult[]>([]);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState("");
  const [crediting, setCrediting] = useState(false);

  const handleSearch = async () => {
    const term = searchTerm.trim();
    if (!term) return;
    
    setSearching(true);
    setSearchResults([]);
    
    try {
      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
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
      supabase.from("wallets").select("balance").eq("agent_id", selected.user_id).maybeSingle()
    ]);

    if (profileRes.data) {
      setAgent(profileRes.data as AgentResult);
    }
    setWalletBalance(walletRes.data?.balance || 0);
  };

  const handleCredit = async (overrideAmount?: number) => {
    if (!agent) return;
    const amount = overrideAmount || parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setCrediting(true);
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "manual_topup", user_id: agent.user_id, amount },
    });

    if (error || data?.error) {
      toast({ title: "Failed to credit wallet", description: data?.error || error?.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "manual_wallet_topup", {
          target_agent_id: agent.user_id,
          target_agent_name: agent.full_name,
          amount: amount,
          new_balance: data.new_balance
        });
      }

      toast({ title: `Successfully credited GH₵${amount.toFixed(2)} to ${agent.full_name}'s wallet!` });
      setWalletBalance(data.new_balance);
      setCreditAmount("");
    }
    setCrediting(false);
  };

  return (
    <div className="space-y-8 pb-20 max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="space-y-2 border-b border-white/5 pb-8">
        <div className="flex items-center gap-3 mb-2">
           <div className="w-10 h-10 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-400 border border-amber-400/30">
              <Wallet className="w-5 h-5" />
           </div>
           <h1 className="font-display text-4xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
             Manual Wallet Top-Up
           </h1>
        </div>
        <p className="text-white/50 text-sm leading-relaxed max-w-xl">
          Search for an agent by Name, Email, or Phone to manually credit their wallet.
        </p>
      </div>

      {/* Search Panel */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
        <div className="relative bg-white/[0.02] border border-white/5 rounded-3xl p-6 backdrop-blur-xl">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="w-full space-y-2">
              <Label className="text-[10px] uppercase font-black tracking-widest text-white/40 ml-1">Search Agent</Label>
              <div className="relative">
                <Input
                  placeholder="Enter Name, Email or Phone Number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white/5 border-white/10 h-14 text-lg font-bold text-white placeholder:text-white/20 rounded-2xl focus:border-amber-400/40 focus:ring-0 transition-all pl-12"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
                {searching && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-400/50" />
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
            <div className="mt-4 rounded-2xl bg-[#0a0a1a] border border-white/10 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 shadow-2xl">
              <p className="px-4 py-2 text-[10px] uppercase font-black tracking-widest text-white/30 border-b border-white/5 bg-white/5">Found {searchResults.length} Agents</p>
              <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
                 {searchResults.map((res) => (
                    <button
                      key={res.user_id}
                      onClick={() => selectAgent(res)}
                      className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 group-hover:text-amber-400 transition-colors">
                            <User className="w-5 h-5" />
                         </div>
                         <div>
                            <p className="font-bold text-white">{res.full_name}</p>
                            <p className="text-[10px] text-white/30">{res.email}</p>
                         </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-amber-400 transition-all group-hover:translate-x-1" />
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
             <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 backdrop-blur-md">
                <div className="flex items-center gap-4 mb-6">
                   <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400 border border-blue-500/30">
                      <User className="w-6 h-6" />
                   </div>
                   <div>
                      <h2 className="font-bold text-white text-lg">{agent.full_name}</h2>
                      <p className="text-xs text-white/40 flex items-center gap-1.5"><Store className="w-3 h-3" /> {agent.store_name || "Personal Account"}</p>
                   </div>
                </div>

                <div className="space-y-4">
                   <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 text-white/40">
                         <Smartphone className="w-3.5 h-3.5" />
                         <span className="text-[10px] uppercase font-bold tracking-wider">MoMo Wallet</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-white">{agent.momo_number || agent.phone || "—"}</span>
                   </div>
                   <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-2 text-white/40">
                         <Mail className="w-3.5 h-3.5" />
                         <span className="text-[10px] uppercase font-bold tracking-wider">Email Address</span>
                      </div>
                      <span className="text-xs font-medium text-white truncate max-w-[140px]">{agent.email}</span>
                   </div>
                   {agent.topup_reference && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-amber-400/10 border border-amber-400/20">
                        <div className="flex items-center gap-2 text-amber-400/60">
                          <History className="w-3.5 h-3.5" />
                          <span className="text-[10px] uppercase font-bold tracking-wider">Reference</span>
                        </div>
                        <span className="text-sm font-black text-amber-400 tracking-widest">{agent.topup_reference}</span>
                    </div>
                   )}
                </div>
             </div>

             <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/20 rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group">
                <Wallet className="absolute -right-4 -bottom-4 w-24 h-24 text-blue-500/5 group-hover:scale-110 transition-transform duration-700" />
                <p className="text-[10px] uppercase font-black tracking-widest text-blue-400/60 mb-2">Current Balance</p>
                <p className="text-4xl font-black text-white">GH₵{walletBalance.toFixed(2)}</p>
                <div className="mt-4 flex items-center gap-2 text-[10px] text-white/30 font-medium">
                   <CheckCircle className="w-3 h-3 text-emerald-500" /> Verified Agent Account
                </div>
             </div>
          </div>

          {/* Right: Topup Action */}
          <div className="lg:col-span-3">
             <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 md:p-8 backdrop-blur-xl h-full flex flex-col">
                <h3 className="font-bold text-white mb-6 flex items-center gap-2">
                   <ArrowRight className="w-4 h-4 text-amber-400" />
                   Credit Agent Wallet
                </h3>

                <div className="grid grid-cols-3 gap-2 mb-8">
                   {QUICK_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handleCredit(amt)}
                        disabled={crediting}
                        className="px-4 py-4 rounded-2xl bg-white/5 border border-white/5 text-white/80 hover:bg-amber-400 hover:text-black hover:border-amber-400 font-bold transition-all duration-300 disabled:opacity-50"
                      >
                         ₵{amt}
                      </button>
                   ))}
                </div>

                <div className="mt-auto space-y-4">
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black tracking-widest text-white/40 ml-1">Custom Amount (GH₵)</Label>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                           <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 font-bold">GH₵</span>
                           <Input
                             type="number" step="0.01" min="0.01"
                             placeholder="0.00"
                             value={creditAmount}
                             onChange={(e) => setCreditAmount(e.target.value)}
                             className="bg-white/5 border-white/10 h-14 pl-14 text-lg font-bold text-white rounded-2xl focus:border-amber-400/40"
                           />
                        </div>
                        <Button 
                          onClick={() => handleCredit()} 
                          disabled={crediting || !creditAmount}
                          className="h-14 px-8 rounded-2xl bg-white text-black hover:bg-amber-400 font-black uppercase tracking-widest text-xs gap-2 transition-all duration-300 shadow-xl shadow-white/5"
                        >
                          {crediting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                          {crediting ? "Processing" : "Submit"}
                        </Button>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl bg-amber-400/5 border border-amber-400/10 text-[10px] text-amber-400/60 leading-relaxed italic">
                      Notice: This action is final and will be logged in the system audit records. The agent will receive an automated SMS confirmation.
                   </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWalletTopup;
