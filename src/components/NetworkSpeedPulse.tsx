import React from "react";
import { Zap, Activity, Clock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function NetworkSpeedPulse() {
  const networks = [
    { name: "MTN SME", status: "Instant Delivery", time: "~15s", color: "text-amber-400", dot: "bg-emerald-400", border: "border-amber-500/20" },
    { name: "Telecel", status: "Instant Delivery", time: "~10s", color: "text-red-400", dot: "bg-emerald-400", border: "border-red-500/20" },
    { name: "AT / AirtelTigo", status: "Instant Delivery", time: "~8s", color: "text-blue-400", dot: "bg-emerald-400", border: "border-blue-500/20" },
    { name: "MTN Mashup", status: "Active Queue", time: "15–30m", color: "text-amber-400", dot: "bg-amber-400", border: "border-amber-500/20" },
  ];

  return (
    <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          </div>
          <span className="text-xs font-black text-foreground uppercase tracking-wider">Live Carrier Delivery Speed</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground font-semibold">99.8% Online</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {networks.map((n) => (
          <div key={n.name} className="p-2.5 rounded-xl bg-secondary/40 border border-border/60 flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${n.dot} animate-ping`} />
                <span className="font-bold text-xs text-foreground truncate">{n.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{n.status}</p>
            </div>
            <Badge className="text-[9px] font-mono font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              {n.time}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
