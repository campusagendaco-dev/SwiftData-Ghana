import { useEffect, useMemo, useState } from "react";
import { Loader2, Phone, Search, CheckCircle2, Clock3, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RECENT_ORDER_LOOKBACK_DAYS = 7;
const DELIVERED_AFTER_MINUTES = 14;

interface TrackedOrder {
  id: string;
  status: string;
  customer_phone: string | null;
  package_size: string | null;
  created_at: string;
  updated_at?: string | null;
}

function normalizePhoneForQuery(phone: string): string[] {
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return [];

  const variants = new Set<string>();

  if (digits.length === 10 && digits.startsWith("0")) {
    variants.add(digits);
    variants.add(`233${digits.slice(1)}`);
  } else if (digits.length === 12 && digits.startsWith("233")) {
    variants.add(digits);
    variants.add(`0${digits.slice(3)}`);
  } else if (digits.length === 9) {
    variants.add(`0${digits}`);
    variants.add(`233${digits}`);
  } else {
    variants.add(digits);
  }

  return Array.from(variants);
}

type DisplayState = {
  key: "payment_verified" | "pending_delivery" | "delivered" | "payment_processing";
  label: string;
  icon: typeof ShieldCheck;
  className: string;
};

function getDisplayState(order: TrackedOrder): DisplayState {
  const now = Date.now();
  const createdAt = new Date(order.created_at).getTime();
  const updatedAt = new Date(order.updated_at || order.created_at).getTime();
  const deliveryAt = updatedAt + DELIVERED_AFTER_MINUTES * 60 * 1000;
  const pendingFallbackAt = createdAt + DELIVERED_AFTER_MINUTES * 60 * 1000;

  if (order.status === "paid") {
    // Some legacy rows can remain in `paid`; still advance to success after timeout.
    if (now >= pendingFallbackAt) {
      return {
        key: "delivered",
        label: "Order Successful",
        icon: CheckCircle2,
        className: "text-green-600",
      };
    }

    return {
      key: "payment_verified",
      label: "Payment Verified",
      icon: ShieldCheck,
      className: "text-blue-600",
    };
  }

  if (order.status === "fulfilled" || order.status === "fulfillment_failed") {
    if (now < deliveryAt) {
      return {
        key: "pending_delivery",
        label: "Pending Delivery",
        icon: Clock3,
        className: "text-amber-600",
      };
    }

    return {
      key: "delivered",
      label: "Order Successful",
      icon: CheckCircle2,
      className: "text-green-600",
    };
  }

  return {
    key: "payment_processing",
    label: "Processing Payment",
    icon: Clock3,
    className: "text-yellow-600",
  };
}

interface PhoneOrderTrackerProps {
  title?: string;
  subtitle?: string;
  className?: string;
}

const PhoneOrderTracker = ({
  title = "Track Your Order",
  subtitle = "Enter the phone number used for purchase to get real-time delivery updates.",
  className = "",
}: PhoneOrderTrackerProps) => {
  const [phone, setPhone] = useState("");
  const [trackingPhone, setTrackingPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState("");

  const isPhoneValid = useMemo(() => {
    const digits = phone.replace(/\D+/g, "");
    return digits.length === 10 || digits.length === 12 || digits.length === 9;
  }, [phone]);

  const lookupRecentOrder = async (phoneValue: string): Promise<TrackedOrder | null> => {
    const variants = normalizePhoneForQuery(phoneValue);
    if (variants.length === 0) return null;

    const since = new Date();
    since.setDate(since.getDate() - RECENT_ORDER_LOOKBACK_DAYS);

    const { data, error: queryError } = await supabase
      .from("orders")
      .select("id, status, customer_phone, package_size, created_at, updated_at")
      .eq("order_type", "data")
      .in("customer_phone", variants)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (queryError) {
      throw queryError;
    }

    return (data as TrackedOrder | null) ?? null;
  };

  const refreshByOrderId = async (orderId: string): Promise<TrackedOrder | null> => {
    const { data, error: queryError } = await supabase
      .from("orders")
      .select("id, status, customer_phone, package_size, created_at, updated_at")
      .eq("id", orderId)
      .maybeSingle();

    if (queryError) throw queryError;
    return (data as TrackedOrder | null) ?? null;
  };

  const handleTrack = async () => {
    setError("");
    setOrder(null);
    setLoading(true);

    try {
      const found = await lookupRecentOrder(phone);
      if (!found) {
        setError("Phone number not found for recent data orders.");
        setTrackingPhone("");
        return;
      }

      setOrder(found);
      setTrackingPhone(phone.replace(/\D+/g, ""));
    } catch {
      setError("Could not load order status right now. Please try again.");
      setTrackingPhone("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!order?.id || !trackingPhone) return;

    const interval = window.setInterval(async () => {
      try {
        const latest = await refreshByOrderId(order.id);
        if (latest) {
          setOrder(latest);
        }
      } catch {
        // Keep existing state; next poll may recover.
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [order?.id, trackingPhone]);

  const display = order ? getDisplayState(order) : null;

  return (
    <div className={`rounded-2xl border border-primary/25 bg-primary/5 p-5 md:p-6 ${className}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Phone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-xl font-bold">{title}</h3>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Enter phone number (e.g. 0241234567)"
          className="bg-background"
        />
        <Button onClick={handleTrack} disabled={!isPhoneValid || loading} className="sm:min-w-[140px]">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="ml-2">Track</span>
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {order && display && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <display.icon className={`w-5 h-5 ${display.className}`} />
            <p className={`font-semibold ${display.className}`}>{display.label}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Phone: </span>
              <span className="font-medium">{order.customer_phone || "-"}</span>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Bundle: </span>
              <span className="font-medium">{order.package_size || "-"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhoneOrderTracker;
