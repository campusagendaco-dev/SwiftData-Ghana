import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type OrderStatus = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed";

const STEPS = [
  { key: "received", label: "Payment Received" },
  { key: "processing", label: "Processing Order" },
  { key: "delivered", label: "Data Delivered" },
] as const;

function statusToStepIndex(status: OrderStatus): number {
  if (status === "fulfilled") return 2;
  if (status === "processing" || status === "paid") return 1;
  return 0;
}

interface OrderStatusBannerProps {
  orderId: string;
  network: string;
  packageSize: string;
  customerPhone: string;
  initialStatus?: string;
  onDismiss: () => void;
}

const OrderStatusBanner = ({
  orderId,
  network,
  packageSize,
  customerPhone,
  initialStatus = "paid",
  onDismiss,
}: OrderStatusBannerProps) => {
  const [status, setStatus] = useState<OrderStatus>(initialStatus as OrderStatus);

  useEffect(() => {
    const channel = supabase
      .channel(`order-banner-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload: any) => {
          if (payload.new?.status) setStatus(payload.new.status as OrderStatus);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  const isFailed = status === "fulfillment_failed";
  const currentStep = statusToStepIndex(status);

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="font-semibold text-sm">Order Status</p>
          <p className="text-xs text-muted-foreground">
            {network} {packageSize} &rarr; {customerPhone}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isFailed ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Delivery failed. Please contact support with order ID: <span className="font-mono">{orderId.slice(0, 8)}</span></span>
        </div>
      ) : (
        <div className="flex items-center">
          {STEPS.map((step, i) => {
            const done = currentStep > i;
            const active = currentStep === i;
            return (
              <div key={step.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  {done ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : active ? (
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30" />
                  )}
                  <p
                    className={`text-[10px] text-center leading-tight max-w-[64px] ${
                      done ? "text-green-600 font-medium" : active ? "text-primary font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mb-4 mx-1 ${done ? "bg-green-500" : "bg-muted-foreground/20"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {status === "fulfilled" && (
        <p className="text-xs text-green-600 font-medium mt-3 text-center">
          Data bundle sent successfully!
        </p>
      )}
    </div>
  );
};

export default OrderStatusBanner;
