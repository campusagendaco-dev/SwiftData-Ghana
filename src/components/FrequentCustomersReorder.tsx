import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Phone, ArrowRight, User, ShoppingBag, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FrequentCustomer {
  phone: string;
  name: string | null;
  network: string;
  package_size: string;
  count: number;
  last_ordered_at: string;
}

export default function FrequentCustomersReorder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<FrequentCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchFrequentCustomers = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("orders")
          .select("customer_phone, customer_name, network, package_size, created_at, status")
          .eq("agent_id", user.id)
          .in("status", ["fulfilled", "completed", "paid", "processing"])
          .not("customer_phone", "is", null)
          .order("created_at", { ascending: false })
          .limit(100);

        if (error || !data) return;

        // Group by phone number
        const map = new Map<string, FrequentCustomer>();
        for (const o of data) {
          const phone = o.customer_phone?.trim();
          if (!phone || phone.length < 9) continue;

          const existing = map.get(phone);
          if (existing) {
            existing.count += 1;
          } else {
            map.set(phone, {
              phone,
              name: o.customer_name || null,
              network: o.network || "MTN",
              package_size: o.package_size || "Data Bundle",
              count: 1,
              last_ordered_at: o.created_at,
            });
          }
        }

        // Sort by most frequent and recent
        const sorted = Array.from(map.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        setCustomers(sorted);
      } catch (err) {
        console.error("Failed to load frequent customers:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchFrequentCustomers();
  }, [user]);

  if (loading) {
    return null;
  }

  if (customers.length === 0) {
    return null;
  }

  const getNetworkBadge = (network: string) => {
    const net = (network || "").toUpperCase();
    if (net.includes("MTN")) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    if (net.includes("TELECEL") || net.includes("VODA")) return "bg-red-500/15 text-red-400 border-red-500/30";
    if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-black text-foreground">Frequent Customers & Quick Re-Order</h3>
            <p className="text-[11px] text-muted-foreground">1-click repurchase for your most frequent buyers</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {customers.map((c) => (
          <div
            key={c.phone}
            className="p-3 rounded-2xl bg-card border border-border/80 hover:border-amber-500/40 hover:bg-muted/40 transition-all flex items-center justify-between gap-3 group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 font-black text-xs text-amber-400">
                {c.name ? c.name.slice(0, 2).toUpperCase() : c.phone.slice(-2)}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-xs text-foreground truncate flex items-center gap-1.5">
                  <span>{c.name || c.phone}</span>
                  <Badge className={cn("text-[9px] px-1.5 py-0 font-bold border", getNetworkBadge(c.network))}>
                    {c.network}
                  </Badge>
                </p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {c.phone} · <span className="text-foreground/80 font-bold">{c.package_size}</span>
                </p>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => {
                navigate(`/dashboard/buy-data?phone=${encodeURIComponent(c.phone)}&network=${encodeURIComponent(c.network)}&package=${encodeURIComponent(c.package_size)}`);
              }}
              className="h-8 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-slate-950 font-black text-xs shrink-0 border border-amber-500/30 transition-all"
            >
              Re-Order
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
