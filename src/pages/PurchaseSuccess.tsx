import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Home, ReceiptText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ConfettiPiece = {
  id: number;
  left: number;
  size: number;
  delay: number;
  duration: number;
  rotation: number;
  color: string;
};

const CONFETTI_COLORS = [
  "#ffd43b",
  "#ff9f1c",
  "#22c55e",
  "#0ea5e9",
  "#f97316",
  "#e11d48",
];

const formatPhone = (value: string) => {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("233")) return `0${digits.slice(3)}`;
  return value;
};

const PurchaseSuccess = () => {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const customerPhone = formatPhone(searchParams.get("phone") || "");
  const source = searchParams.get("source") || "";

  const confetti = useMemo<ConfettiPiece[]>(
    () =>
      Array.from({ length: 72 }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        size: 8 + Math.random() * 8,
        delay: Math.random() * 0.9,
        duration: 2.2 + Math.random() * 1.9,
        rotation: Math.random() * 360,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      })),
    [],
  );

  return (
    <div className="purchase-success-page min-h-screen px-4 py-20 md:py-24">
      <div className="purchase-success-confetti" aria-hidden="true">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="purchase-success-confetti-piece"
            style={{
              left: `${piece.left}%`,
              width: `${piece.size}px`,
              height: `${piece.size * 0.45}px`,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              transform: `rotate(${piece.rotation}deg)`,
              backgroundColor: piece.color,
            }}
          />
        ))}
      </div>

      <div className="mx-auto max-w-2xl">
        <Card className="purchase-success-card overflow-hidden border-primary/30 bg-card/95 backdrop-blur shadow-2xl">
          <CardContent className="p-8 md:p-10">
            <div className="purchase-success-badge mx-auto mb-6 h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>

            <h1 className="font-display text-3xl md:text-4xl font-black text-center">Payment Successful</h1>
            <p className="mt-3 text-sm md:text-base text-muted-foreground text-center max-w-xl mx-auto">
              Your data purchase has been completed successfully. We have processed your order and sent it for instant delivery.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Network</p>
                <p className="font-semibold mt-1">{network || "Data Purchase"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Package</p>
                <p className="font-semibold mt-1">{packageSize || "Bundle"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
                <p className="font-semibold mt-1">{customerPhone || "Provided at checkout"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Reference</p>
                <p className="font-semibold mt-1 break-all">{reference || "Generated automatically"}</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
              <p className="font-semibold text-primary">Next step</p>
              <p className="text-muted-foreground mt-1">
                {source === "wallet"
                  ? "Your wallet has already been charged. You can continue buying bundles right away."
                  : "You can track this order at any time from the order status page."}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link to="/order-status">
                  <ReceiptText className="h-4 w-4 mr-2" />
                  Track Another Order
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/dashboard/wallet">
                  <Wallet className="h-4 w-4 mr-2" />
                  Go to Wallet
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/">
                  <Home className="h-4 w-4 mr-2" />
                  Back Home
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PurchaseSuccess;
