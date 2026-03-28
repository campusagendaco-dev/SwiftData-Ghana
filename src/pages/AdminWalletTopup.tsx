import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Wallet, Loader2, CheckCircle, User } from "lucide-react";

interface AgentResult {
  user_id: string;
  full_name: string;
  email: string;
  store_name: string;
  momo_number: string;
  momo_network: string;
  momo_account_name: string;
  topup_reference: string;
}

const AdminWalletTopup = () => {
  const { toast } = useToast();
  const [searchRef, setSearchRef] = useState("");
  const [searching, setSearching] = useState(false);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const handleSearch = async () => {
    const ref = searchRef.trim();
    if (!ref || ref.length !== 6) {
      toast({ title: "Enter a valid 6-digit topup reference", variant: "destructive" });
      return;
    }
    setSearching(true);
    setAgent(null);
    setNotFound(false);

    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, store_name, momo_number, momo_network, momo_account_name, topup_reference")
      .eq("topup_reference", ref)
      .maybeSingle();

    if (error || !data) {
      setNotFound(true);
      setSearching(false);
      return;
    }

    setAgent(data as AgentResult);

    // Fetch wallet balance
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", data.user_id)
      .maybeSingle();

    setWalletBalance(wallet?.balance || 0);
    setSearching(false);
  };

  const handleCredit = async () => {
    if (!agent) return;
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setCrediting(true);

    // Get current balance
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", agent.user_id)
      .maybeSingle();

    if (!wallet) {
      // Create wallet with the credit amount
      const { error } = await supabase.from("wallets").insert({
        agent_id: agent.user_id,
        balance: amount,
      } as any);
      if (error) {
        toast({ title: "Failed to create wallet", description: error.message, variant: "destructive" });
        setCrediting(false);
        return;
      }
    } else {
      const newBalance = parseFloat((wallet.balance + amount).toFixed(2));
      const { error } = await supabase
        .from("wallets")
        .update({ balance: newBalance })
        .eq("agent_id", agent.user_id);
      if (error) {
        toast({ title: "Failed to credit wallet", description: error.message, variant: "destructive" });
        setCrediting(false);
        return;
      }
    }

    // Create a wallet_topup order record
    await supabase.from("orders").insert({
      agent_id: agent.user_id,
      order_type: "wallet_topup",
      amount: amount,
      profit: 0,
      status: "fulfilled",
    });

    toast({ title: `Successfully credited GH₵${amount.toFixed(2)} to ${agent.full_name}'s wallet!` });
    setWalletBalance((prev) => parseFloat((prev + amount).toFixed(2)));
    setCreditAmount("");
    setCrediting(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Manual Wallet Top-Up</h1>
      <p className="text-muted-foreground text-sm">Search an agent by their 6-digit Topup Reference and manually credit their wallet.</p>

      {/* Search */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Search Agent by Reference</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Enter 6-digit reference"
              value={searchRef}
              onChange={(e) => setSearchRef(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="bg-secondary text-lg tracking-[0.3em] font-bold max-w-[200px] text-center"
              maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={searching} className="gap-2">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </Button>
          </div>
          {notFound && (
            <p className="text-destructive text-sm mt-3">No agent found with this reference code.</p>
          )}
        </CardContent>
      </Card>

      {/* Agent Details */}
      {agent && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Agent Found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/50 rounded-xl p-4">
              <div>
                <p className="text-xs text-muted-foreground">Full Name</p>
                <p className="font-semibold text-foreground">{agent.full_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Store Name</p>
                <p className="font-semibold text-foreground">{agent.store_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="font-semibold text-foreground">{agent.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Topup Reference</p>
                <p className="font-bold text-primary tracking-[0.2em]">{agent.topup_reference}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">MoMo Number</p>
                <p className="font-semibold text-foreground">{agent.momo_number}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">MoMo Network</p>
                <p className="font-semibold text-foreground">{agent.momo_network}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
              <Wallet className="w-6 h-6 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Current Wallet Balance</p>
                <p className="font-display text-2xl font-bold text-primary">GH₵{walletBalance.toFixed(2)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-medium">Amount to Credit (GH₵)</Label>
              <div className="flex gap-3">
                <Input
                  type="number" step="0.01" min="0.01"
                  placeholder="Enter amount"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="bg-secondary max-w-[200px]"
                />
                <Button onClick={handleCredit} disabled={crediting} className="gap-2">
                  {crediting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Credit Wallet
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminWalletTopup;
