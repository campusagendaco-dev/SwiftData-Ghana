import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, CheckCircle, Clock, Loader2, Package } from "lucide-react";

interface OrderInfo {
  id: string;
  status: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  created_at: string;
}

const OrderStatus = () => {
  const [searchParams] = useSearchParams();
  const [orderId, setOrderId] = useState(searchParams.get("reference") || "");
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const lookupOrder = useCallback(async (id?: string) => {
    const ref = id || orderId.trim();
    if (!ref) return;
    setLoading(true);
    setNotFound(false);
    setOrder(null);

    const { data, error } = await supabase
      .from("orders")
      .select("id, status, network, package_size, customer_phone, amount, created_at")
      .eq("id", ref)
      .maybeSingle();

    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setOrder(data);
    setLoading(false);

    // If pending or paid, trigger verification
    if (data.status === "pending" || data.status === "paid") {
      setVerifying(true);
      try {
        const { data: result } = await supabase.functions.invoke("verify-payment", {
          body: { reference: ref },
        });
        if (result?.status) {
          // verify-payment always returns "fulfilled" to user after payment verified
          setOrder(prev => prev ? { ...prev, status: result.status } : prev);
        }
      } catch {
        await pollOrderStatus(ref);
      }
      setVerifying(false);
    }
  }, [orderId]);

  const pollOrderStatus = async (ref: string) => {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const { data } = await supabase
        .from("orders")
        .select("id, status, network, package_size, customer_phone, amount, created_at")
        .eq("id", ref)
        .maybeSingle();
      if (data && (data.status === "fulfilled" || data.status === "fulfillment_failed")) {
        setOrder(data);
        return;
      }
      if (data) setOrder(data);
    }
  };

  useEffect(() => {
    const ref = searchParams.get("reference");
    if (ref) {
      setOrderId(ref);
      lookupOrder(ref);
    }
  }, [lookupOrder, searchParams]);

  // Map internal status to user-facing display
  const getDisplayStatus = () => {
    if (!order) return null;
    const s = order.status;
    if (s === "fulfilled") {
      return { label: "Delivered", icon: CheckCircle, color: "text-green-500", desc: "Your data bundle has been delivered successfully!" };
    }
    if (s === "fulfillment_failed") {
      return { label: "Delivery Failed", icon: Clock, color: "text-red-500", desc: "Payment was received, but delivery failed. Please contact support with your reference." };
    }
    if (s === "pending" || s === "paid") {
      return { label: "Processing", icon: Loader2, color: "text-yellow-500", desc: "Payment confirmed. Your bundle is being delivered now." };
    }
    return { label: "Processing", icon: Loader2, color: "text-blue-500", desc: "Your order is being processed..." };
  };

  const display = getDisplayStatus();
  const isProcessing = verifying || order?.status === "pending" || order?.status === "paid";

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-lg">
        <div className="text-center mb-8">
          <Package className="w-10 h-10 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl font-bold mb-2">Order Status</h1>
          <p className="text-muted-foreground text-sm">Track your data bundle delivery</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <Label htmlFor="orderId" className="text-sm font-medium">Order Reference</Label>
          <div className="flex gap-2 mt-2">
            <Input id="orderId" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Paste your order reference" className="bg-secondary" />
            <Button onClick={() => lookupOrder()} disabled={loading || verifying || !orderId.trim()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>

          {notFound && (
            <div className="mt-6 text-center py-6">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
              <p className="font-medium text-foreground">Order not found</p>
              <p className="text-sm text-muted-foreground mt-1">Check your reference and try again.</p>
            </div>
          )}

          {order && display && (
            <div className="mt-6 space-y-4">
              <div className="text-center py-4">
                <display.icon className={`w-12 h-12 mx-auto mb-3 ${display.color} ${isProcessing ? "animate-spin" : ""}`} />
                <p className={`font-display font-bold text-lg ${display.color}`}>{display.label}</p>
                <p className="text-sm text-muted-foreground mt-1">{display.desc}</p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                {order.network && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span className="font-medium text-foreground">{order.network}</span></div>
                )}
                {order.package_size && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium text-foreground">{order.package_size}</span></div>
                )}
                {order.customer_phone && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Recipient</span><span className="font-medium text-foreground">{order.customer_phone}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-medium text-foreground">GH₵{order.amount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="font-medium text-foreground">{new Date(order.created_at).toLocaleString()}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderStatus;
