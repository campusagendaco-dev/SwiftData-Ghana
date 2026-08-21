import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Wallet, Plus, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LowBalanceAlertProps {
  balance: number;
}

export default function LowBalanceAlertDrawer({ balance }: LowBalanceAlertProps) {
  const navigate = useNavigate();
  if (balance >= 25) return null;

  const presets = [50, 100, 200, 500];

  return (
    <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border border-amber-500/30 backdrop-blur-xl shadow-md space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0 mt-0.5">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-foreground flex items-center gap-2">
              <span>Low Wallet Balance Alert</span>
              <span className="font-mono text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded text-[10px]">
                GH₵ {balance.toFixed(2)}
              </span>
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Your float is running low. Top up now to prevent customer orders from failing.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-1.5">
          {presets.map((amt) => (
            <Button
              key={amt}
              size="sm"
              onClick={() => navigate(`/dashboard/wallet?amount=${amt}`)}
              className="h-8 px-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-slate-950 font-bold text-xs border border-amber-500/30 transition-all"
            >
              +GH₵{amt}
            </Button>
          ))}
          <Button
            size="sm"
            onClick={() => navigate("/dashboard/wallet")}
            className="h-8 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-all shadow-sm"
          >
            Top Up Float
          </Button>
        </div>
      </div>
    </div>
  );
}
