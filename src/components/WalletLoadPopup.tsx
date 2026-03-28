import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Wallet } from "lucide-react";

const WalletLoadPopup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;

    const checkWallet = async () => {
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();

      const bal = data?.balance ?? 0;
      setBalance(bal);

      // Show popup if wallet is low (< 20 GHC) and hasn't been dismissed this session
      const dismissed = sessionStorage.getItem("wallet_popup_dismissed");
      if (bal < 20 && !dismissed) {
        setOpen(true);
      }
    };

    checkWallet();
  }, [user]);

  const handleDismiss = () => {
    sessionStorage.setItem("wallet_popup_dismissed", "true");
    setOpen(false);
  };

  const handleGoToWallet = () => {
    sessionStorage.setItem("wallet_popup_dismissed", "true");
    setOpen(false);
    navigate("/dashboard/wallet");
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Load Your Wallet
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your wallet balance is <span className="font-bold text-foreground">GH₵{(balance ?? 0).toFixed(2)}</span>.
            <span className="block mt-2">
              Customers cannot purchase data from your store unless your wallet has sufficient funds.
              Please load your wallet with at least <span className="font-bold text-foreground">GH₵20.00</span> to enable purchases.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDismiss}>Later</AlertDialogCancel>
          <AlertDialogAction onClick={handleGoToWallet}>Load Wallet Now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default WalletLoadPopup;
