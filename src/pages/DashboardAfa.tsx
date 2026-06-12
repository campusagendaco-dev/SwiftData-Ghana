import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ShieldCheck, Loader2, CreditCard, Wallet,
  ChevronRight, RotateCcw, CheckCircle2, AlertCircle,
  User, Calendar, Briefcase, Mail, MapPin, Phone,
  Gift, WifiOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/hooks/useConnectivity";
import { CardTilt } from "@/components/ui/CardTilt";
import { playSuccessSound } from "@/lib/sound";

const DashboardAfa = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { isOnline } = useConnectivity();

  // Form states
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [occupation, setOccupation] = useState("");
  const [email, setEmail] = useState("");
  const [ghanaCard, setGhanaCard] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [residence, setResidence] = useState("");
  const [payMethod, setPayMethod] = useState<"wallet" | "paystack">("wallet");

  // Dynamic price & loading states
  const [afaPrice, setAfaPrice] = useState<number>(12.50);
  const [fetchingPrice, setFetchingPrice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  // Fetch AFA price from package settings on mount
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const { data, error } = await supabase
          .from("global_package_settings")
          .select("agent_price, public_price")
          .eq("network", "AFA")
          .eq("package_size", "BUNDLE")
          .maybeSingle();

        if (data && !error) {
          const priceVal = Number(data.agent_price ?? data.public_price ?? 12.50);
          setAfaPrice(priceVal);
        }
      } catch (err) {
        console.error("Error fetching AFA price:", err);
      } finally {
        setFetchingPrice(false);
      }
    };
    fetchPrice();
  }, []);

  const resetForm = () => {
    setFullName("");
    setDateOfBirth("");
    setOccupation("");
    setEmail("");
    setGhanaCard("");
    setPhoneNumber("");
    setResidence("");
  };

  // Helper to format Ghana Card number dynamically: GHA-XXXXXXXXX-X
  const handleGhanaCardChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    
    // Ensure first three characters are forced to 'GHA' if matching start
    if (raw.length > 0 && !raw.startsWith("G")) {
      raw = "GHA" + raw;
    } else if (raw.length > 1 && !raw.startsWith("GH")) {
      raw = "GHA" + raw.slice(1);
    } else if (raw.length > 2 && !raw.startsWith("GHA")) {
      raw = "GHA" + raw.slice(2);
    }

    let formatted = "";
    if (raw.length > 0) {
      formatted += raw.slice(0, 3); // GHA
    }
    if (raw.length > 3) {
      formatted += "-" + raw.slice(3, 12); // GHA-XXXXXXXXX
    }
    if (raw.length > 12) {
      formatted += "-" + raw.slice(12, 13); // GHA-XXXXXXXXX-X
    }
    setGhanaCard(formatted);
  };

  // Validate all fields
  const validate = () => {
    if (!fullName.trim()) {
      toast({ title: "Full Name is required", variant: "destructive" });
      return false;
    }
    if (!dateOfBirth) {
      toast({ title: "Date of Birth is required", variant: "destructive" });
      return false;
    }
    if (!occupation.trim()) {
      toast({ title: "Occupation is required", variant: "destructive" });
      return false;
    }
    
    // Validate Ghana Card regex (GHA-XXXXXXXXX-X where X is digit/letter)
    const ghanaCardRegex = /^GHA-\d{9}-\d$/i;
    if (!ghanaCardRegex.test(ghanaCard)) {
      toast({ 
        title: "Invalid Ghana Card Format", 
        description: "Ghana Card must follow the format GHA-XXXXXXXXX-X (e.g. GHA-123456789-0)", 
        variant: "destructive" 
      });
      return false;
    }

    if (!phoneNumber.trim() || phoneNumber.replace(/\D/g, "").length < 9) {
      toast({ title: "Valid Phone Number is required", variant: "destructive" });
      return false;
    }
    if (!residence.trim()) {
      toast({ title: "Place of Residence is required", variant: "destructive" });
      return false;
    }

    return true;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);

    if (payMethod === "wallet") {
      try {
        const { data, error } = await supabase.functions.invoke("wallet-pay-afa", {
          body: {
            customer_phone: phoneNumber,
            fullName,
            ghanaCard,
            occupation,
            email: email || null,
            residence,
            dateOfBirth,
          },
        });

        if (error || data?.error) {
          toast({ 
            title: "Registration Failed", 
            description: data?.error || "Failed to submit AFA Registration.", 
            variant: "destructive" 
          });
          setLoading(false);
          return;
        }

        playSuccessSound();
        toast({ title: "AFA Order Created!", description: "Fulfillment triggered successfully.", variant: "default" });
        setShowSuccessOverlay(true);
        setTimeout(() => {
          setShowSuccessOverlay(false);
          resetForm();
        }, 5000);
      } catch (err: any) {
        toast({ title: "Request error", description: err.message || "An unexpected error occurred.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
      return;
    }

    // Paystack checkout flow
    try {
      const reference = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: user?.email || "customer@swiftdata.gh",
          amount: afaPrice,
          reference,
          callback_url: `${window.location.origin}/order-status?reference=${reference}&phone=${phoneNumber}&network=AFA&package=BUNDLE`,
          metadata: {
            order_type: "afa",
            network: "AFA",
            package_size: "BUNDLE",
            customer_phone: phoneNumber,
            afa_full_name: fullName,
            afa_ghana_card: ghanaCard,
            afa_occupation: occupation,
            afa_email: email,
            afa_residence: residence,
            afa_date_of_birth: dateOfBirth,
            agent_id: user?.id,
          },
        },
      });

      if (error || !data?.authorization_url) {
        toast({ title: "Payment initialization failed", description: error?.message || "Please try again.", variant: "destructive" });
        setLoading(false);
        return;
      }

      window.location.href = data.authorization_url;
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message || "Could not initialize checkout.", variant: "destructive" });
      setLoading(false);
    }
  };

  const isFormComplete = fullName && dateOfBirth && occupation && ghanaCard && phoneNumber && residence;

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-8 animate-in fade-in duration-500 relative">
      
      {/* Success Animation Overlay */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-50 bg-[#0d140d]/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-card border border-border p-8 rounded-3xl text-center space-y-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 animate-bounce" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-foreground">Registration Submitted!</h2>
              <p className="text-sm text-muted-foreground mt-2">
                AFA registration order for <strong className="text-foreground">{fullName}</strong> has been successfully placed. Your wallet has been debited.
              </p>
            </div>
            <div className="p-4 bg-secondary/50 rounded-2xl border border-border space-y-2 text-left text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Phone:</span><span className="font-bold">{phoneNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ghana Card:</span><span className="font-bold">{ghanaCard}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount:</span><span className="font-bold text-emerald-500">GH₵ {afaPrice.toFixed(2)}</span></div>
            </div>
            <button
              onClick={() => setShowSuccessOverlay(false)}
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-black text-sm hover:opacity-90 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Page header */}
      <div>
        <h1 className="font-black text-3xl tracking-tight text-foreground mb-1">AFA Registration</h1>
        <p className="text-muted-foreground text-sm">Register users on the AFA network and submit credentials securely.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

        {/* Main form card */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-7 shadow-xl">
          
          {/* Step 1 — Personal Info */}
          <div className="space-y-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-1 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black">1</span>
              Personal Details
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-primary" /> Full Name (as on Ghana Card)
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Kwabena Mensah"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-primary" /> Date of Birth
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors text-foreground"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5 text-primary" /> Occupation
                </label>
                <input
                  type="text"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  placeholder="e.g. Trader, Teacher"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-primary" /> Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. customer@example.com"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Step 2 — Ghana Card Number */}
          <div className="space-y-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-1 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black">2</span>
              Ghana Card Number
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Ghana Card Format: GHA-XXXXXXXXX-X</label>
              <div className="relative">
                <input
                  type="text"
                  value={ghanaCard}
                  onChange={handleGhanaCardChange}
                  maxLength={15}
                  placeholder="GHA-123456789-0"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-mono font-bold placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
                {ghanaCard && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    {/^GHA-\d{9}-\d$/i.test(ghanaCard) ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 3 — Phone and Location */}
          <div className="space-y-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-1 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black">3</span>
              AFA Network Number & Residence
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-primary" /> Recipient Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 054XXXXXXX"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> Place of Residence
                </label>
                <input
                  type="text"
                  value={residence}
                  onChange={(e) => setResidence(e.target.value)}
                  placeholder="e.g. East Legon, Accra"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Step 4 — Payment Options */}
          <div className="space-y-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-1 flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black">4</span>
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPayMethod("wallet")}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 h-20 rounded-2xl border font-bold text-sm transition-all",
                  payMethod === "wallet"
                    ? "bg-primary/12 border-primary/40 text-foreground shadow-md shadow-primary/10"
                    : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                <Wallet className="w-5 h-5 text-primary" />
                <span>Wallet</span>
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("paystack")}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 h-20 rounded-2xl border font-bold text-sm transition-all",
                  payMethod === "paystack"
                    ? "bg-primary/12 border-primary/40 text-foreground shadow-md shadow-primary/10"
                    : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                <CreditCard className="w-5 h-5 text-primary" />
                <span>Card / MoMo</span>
              </button>
            </div>
          </div>

          {/* Submit Action */}
          <button
            onClick={handleRegister}
            disabled={loading || !isFormComplete || !isOnline}
            className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-base transition-all hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : !isOnline ? (
              <WifiOff className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
            {loading ? "Registering..." : !isOnline ? "Waiting for Internet..." : `Submit Registration (${fetchingPrice ? "..." : `GH₵ ${afaPrice.toFixed(2)}`})`}
          </button>

        </div>

        {/* Right Info Sidebar Panel */}
        <div className="space-y-5">
          
          {/* Registration Details Summary */}
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-4 shadow-lg">
            <h3 className="font-black text-foreground text-sm uppercase tracking-wider">AFA Registration Summary</h3>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-bold text-foreground text-right truncate max-w-[150px]">{fullName || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">DOB:</span>
                <span className="font-bold text-foreground">{dateOfBirth || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Card:</span>
                <span className={cn("font-bold text-right truncate max-w-[150px]", /^GHA-\d{9}-\d$/i.test(ghanaCard) ? "text-emerald-400 font-mono" : "text-foreground")}>
                  {ghanaCard || "—"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Phone:</span>
                <span className="font-bold text-foreground">{phoneNumber || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Residence:</span>
                <span className="font-bold text-foreground text-right truncate max-w-[150px]">{residence || "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Payment:</span>
                <span className="font-bold text-foreground">{payMethod === "wallet" ? "Wallet" : "Card / MoMo"}</span>
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Wholesale Price</span>
                <span className="font-black text-foreground text-xl">
                  {fetchingPrice ? <Loader2 className="w-4 h-4 animate-spin inline" /> : `GH₵ ${afaPrice.toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>

          {/* Benefits info widget */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 space-y-4"
            style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(99,102,241,0.05) 100%)", border: "1px solid rgba(139,92,246,0.18)" }}
          >
            <h4 className="font-black text-foreground text-sm relative z-10 flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-purple-400" /> AFA Member Perks
            </h4>
            <ul className="space-y-3 relative z-10 text-[11px] text-muted-foreground leading-normal list-disc pl-4">
              <li>Access to cheaper MTN, Telecel, and AirtelTigo bundles</li>
              <li>Non-expiry data packages exclusively for registered members</li>
              <li>Instant delivery with real-time SMS tracking updates</li>
            </ul>
          </div>

          {/* Reset button */}
          <button
            onClick={resetForm}
            className="w-full flex items-center justify-center gap-2 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Registration Form
          </button>

        </div>

      </div>
    </div>
  );
};

export default DashboardAfa;
