import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Fingerprint, Lock, ShieldCheck, Loader2, Delete, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VendorSecurityApprovalProps {
  isOpen: boolean;
  amount: number;
  onApprove: () => void;
  onCancel: () => void;
}

export function VendorSecurityApproval({ isOpen, amount, onApprove, onCancel }: VendorSecurityApprovalProps) {
  const [pin, setPin] = useState("");
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (window.PublicKeyCredential) {
      setIsBiometricAvailable(true);
    }
  }, []);

  if (!isOpen) return null;

  const handlePinSubmit = async (digit?: string) => {
    let currentPin = pin;
    if (digit) {
      if (pin.length >= 4) return;
      currentPin = pin + digit;
      setPin(currentPin);
    }

    if (currentPin.length === 4) {
      setLoading(true);
      const storedPin = localStorage.getItem("swift_vendor_pin");
      if (!storedPin) {
        toast.error("Security PIN not setup. Approving by default for now.");
        onApprove();
      } else if (currentPin === storedPin) {
        toast.success("Transaction Approved");
        onApprove();
      } else {
        setPin("");
        toast.error("Invalid Security PIN");
      }
      setLoading(false);
    }
  };

  const handleBiometricAuth = async () => {
    if (!isBiometricAvailable) return;
    
    try {
      setLoading(true);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [],
        }
      });

      if (credential) {
        toast.success("Transaction Approved via Biometrics");
        onApprove();
      }
    } catch (err: any) {
      console.error("Biometric error:", err);
      if (err.name !== "NotAllowedError") {
        toast.error("Biometric authentication failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md overflow-hidden">
      <Card className="w-full max-w-sm border border-amber-500/30 bg-[#0d140d] shadow-[0_32px_64px_-16px_rgba(245,158,11,0.2)] overflow-hidden relative group">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onCancel}
          className="absolute top-3 right-3 text-white/50 hover:text-white z-20"
        >
          <X className="w-5 h-5" />
        </Button>
        <CardContent className="p-8 flex flex-col items-center gap-6 relative z-10">
          <div className="relative">
            <div className="absolute inset-0 rounded-3xl bg-amber-500/20 blur-xl animate-pulse" />
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center relative z-10">
               <ShieldCheck className="w-8 h-8 text-amber-500 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-xl font-black tracking-tight text-white">Security Approval</h2>
            <p className="text-sm text-amber-500/80 font-bold max-w-[220px] mx-auto">
              High value transfer of GHS {amount.toFixed(2)} requires verification.
            </p>
          </div>

          <div className="flex gap-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn("w-3 h-3 rounded-full border-2 transition-all duration-500", pin.length > i ? "bg-amber-500 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]" : "border-white/10 bg-transparent")} />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 w-full mt-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Bio", "0", "Del"].map((val) => {
              if (val === "Bio") {
                return (
                  <Button key={val} variant="ghost" className="h-12 rounded-xl flex items-center justify-center border border-white/5 hover:border-amber-500/30 text-amber-500" disabled={!isBiometricAvailable || loading} onClick={handleBiometricAuth}>
                    <Fingerprint className="w-6 h-6" />
                  </Button>
                );
              }
              if (val === "Del") {
                return (
                  <Button key={val} variant="ghost" className="h-12 rounded-xl text-red-400 hover:bg-red-500/10" onClick={() => setPin(pin.slice(0, -1))}>
                    <Delete className="w-5 h-5" />
                  </Button>
                );
              }
              return (
                <Button key={val} variant="outline" className="h-12 rounded-xl text-lg font-black bg-white/5 border-white/5 text-white hover:bg-amber-500 hover:text-black hover:scale-105 active:scale-95" onClick={() => handlePinSubmit(val)}>
                  {val}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
