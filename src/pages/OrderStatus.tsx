import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { invokePublicFunction } from "@/lib/public-function-client";

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const phone = searchParams.get("phone") || "";
  const [checkingStatus, setCheckingStatus] = useState(Boolean(reference));
  const [statusMessage, setStatusMessage] = useState("Checking payment confirmation...");

  useEffect(() => {
    if (!reference) {
      setCheckingStatus(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;

    const checkStatus = async () => {
      attempts += 1;
      const { data } = await invokePublicFunction("verify-payment", {
        body: { reference },
      });

      if (cancelled) return;

      if (data?.status === "fulfilled") {
        const successParams = new URLSearchParams({
          reference,
          network,
          package: packageSize,
          phone,
          source: "checkout",
        });
        navigate(`/purchase-success?${successParams.toString()}`, { replace: true });
        return;
      }

      if (data?.status === "paid") {
        setStatusMessage("Payment confirmed. Waiting for delivery completion...");
      } else if (data?.status === "pending") {
        setStatusMessage("Payment is processing. This can take a moment...");
      } else if (data?.status === "fulfillment_failed") {
        setStatusMessage("Payment succeeded but delivery failed. Try tracking by phone below.");
      }

      if (attempts >= maxAttempts) {
        setCheckingStatus(false);
      }
    };

    void checkStatus();
    const interval = window.setInterval(() => {
      void checkStatus();
    }, 4500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setCheckingStatus(false);
    };
  }, [reference, network, packageSize, phone, navigate]);

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-2xl">
        <div className="text-center mb-8">
          <Package className="w-10 h-10 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl font-bold mb-2">Order Status Tracker</h1>
          <p className="text-muted-foreground text-sm">Track data orders with the phone number used for purchase.</p>
        </div>

        {reference && checkingStatus && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>{statusMessage}</span>
          </div>
        )}

        <PhoneOrderTracker
          title="Track by Phone Number"
          subtitle="Get live updates: Payment Verified, Pending Delivery, then Data Delivered."
        />
      </div>
    </div>
  );
};

export default OrderStatus;
