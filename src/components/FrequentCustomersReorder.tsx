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

  return (
    <section className="rounded-2xl border border-border/70 bg-card dark:border-white/[0.07] dark:bg-white/[0.025] overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground leading-snug">Top customers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Re-order their usual bundle in one tap</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/customers")}
          className="inline-flex items-center rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          All customers
        </button>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3 sm:p-4">
        {customers.map((c) => (
          <li
            key={c.phone}
            className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 hover:bg-muted/40 transition-colors dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
          >
            <span className="h-9 w-9 shrink-0 rounded-full bg-muted text-foreground/80 flex items-center justify-center text-[12px] font-semibold dark:bg-white/[0.06]">
              {c.name ? c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : c.phone.slice(-2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-foreground truncate">{c.name || c.phone}</p>
              <p className="text-[11.5px] text-muted-foreground truncate tabular-nums">
                {c.network} · {c.package_size}
                {c.name ? ` · ${c.phone}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                navigate(`/dashboard/buy-data?phone=${encodeURIComponent(c.phone)}&network=${encodeURIComponent(c.network)}&package=${encodeURIComponent(c.package_size)}`);
              }}
              className="h-8 shrink-0 rounded-lg border border-border px-3 text-[12.5px] font-semibold text-foreground hover:bg-foreground hover:text-background transition-colors dark:border-white/10"
            >
              Re-order
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
