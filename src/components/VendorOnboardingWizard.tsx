import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ShieldAlert, UploadCloud, CheckCircle2, Loader2, ArrowRight, CreditCard, Wallet, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  initialStatus: string;
  rejectionReason: string | null;
  onComplete: () => void;
  walletBalance: number;
}

export const VendorOnboardingWizard = ({ initialStatus, rejectionReason, onComplete, walletBalance }: Props) => {
  const { user } = useAuth();
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [tin, setTin] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [nationalIdFile, setNationalIdFile] = useState<File | null>(null);
  const [businessCertFile, setBusinessCertFile] = useState<File | null>(null);
  const [nationalIdBackFile, setNationalIdBackFile] = useState<File | null>(null);
  const [vendorRegion, setVendorRegion] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorDigitalAddress, setVendorDigitalAddress] = useState("");
  const [nationalIdExpiry, setNationalIdExpiry] = useState("");
  const [businessCertExpiry, setBusinessCertExpiry] = useState("");
  const [ocrScanning, setOcrScanning] = useState(false);

  const nationalIdInput = useRef<HTMLInputElement>(null);
  const nationalIdBackInput = useRef<HTMLInputElement>(null);
  const businessCertInput = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File, path: string) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${path}_${Math.random()}.${fileExt}`;
    const filePath = `${user?.id}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('kyc-documents')
      .upload(filePath, file);

    if (error) throw error;

    const { data } = supabase.storage
      .from('kyc-documents')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleSubmitKYC = async () => {
    if (!tin || !regNumber || !nationalIdFile || !nationalIdBackFile || !businessCertFile || !nationalIdExpiry || !businessCertExpiry || !vendorRegion || !vendorPhone || !vendorEmail || !vendorDigitalAddress) {
      toast.error("Please fill in all fields, expiry dates, and upload all required documents (including Front & Back ID).");
      return;
    }

    setLoading(true);
    toast.loading("Verifying your location...", { id: "kyc" });

    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser.", { id: "kyc" });
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        toast.loading("Uploading documents...", { id: "kyc" });

    try {
      const idFrontUrl = await uploadFile(nationalIdFile, 'national_id_front');
      const idBackUrl = await uploadFile(nationalIdBackFile, 'national_id_back');
      const certUrl = await uploadFile(businessCertFile, 'business_cert');

      toast.loading("Running AI Document Verification...", { id: "kyc" });
      setOcrScanning(true);

      const { data, error } = await supabase.functions.invoke("theteller-vendor", {
        body: { 
          action: "submit-kyc",
          registration_number: regNumber,
          tin: tin,
          national_id_url: idFrontUrl,
          national_id_back_url: idBackUrl,
          business_cert_url: certUrl,
          national_id_expiry: nationalIdExpiry,
          business_cert_expiry: businessCertExpiry,
          region: vendorRegion,
          vendorPhone: vendorPhone,
          vendorEmail: vendorEmail,
          digitalAddress: vendorDigitalAddress,
          latitude: latitude.toString(),
          longitude: longitude.toString()
        }
      });

      if (error) {
        let msg = error.message;
        try {
          const errBody = await error.context.json();
          msg = errBody.error || errBody.message || error.message;
        } catch (_) {}
        throw new Error(msg);
      }
      if (data && data.success) {
        toast.success("KYC Details Submitted Successfully! Next: Pay Activation Fee.", { id: "kyc" });
        setStatus("payment_pending");
      } else {
        toast.error(data?.error || "Failed to submit KYC details.", { id: "kyc" });
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "An unexpected error occurred.", { id: "kyc" });
    } finally {
      setLoading(false);
      setOcrScanning(false);
    }
      },
      (error) => {
        setLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Location access is mandatory for Swift Vendors. Please allow location access in your browser.", { id: "kyc" });
        } else {
          toast.error("Could not capture your GPS location. Please try again.", { id: "kyc" });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handlePayWallet = async () => {
    setLoading(true);
    toast.loading("Processing payment...", { id: "pay" });
    try {
      const { data, error } = await supabase.functions.invoke("theteller-vendor", {
        body: { action: "activate-with-wallet" }
      });

      if (error) {
        let msg = error.message;
        try {
          const errBody = await error.context.json();
          msg = errBody.error || errBody.message || error.message;
        } catch (_) {}
        throw new Error(msg);
      }
      if (data && data.success) {
        toast.success(data.message, { id: "pay" });
        setStatus(data.status);
        onComplete();
      } else {
        throw new Error(data?.error || "Payment failed");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to process payment", { id: "pay" });
    } finally {
      setLoading(false);
    }
  };

  const handlePayCheckout = async () => {
    setLoading(true);
    toast.loading("Generating payment link...", { id: "pay" });
    try {
      const callbackUrl = `${window.location.origin}/dashboard/swift-vendor`;
      const { data, error } = await supabase.functions.invoke("initialize-payment", {
        body: { 
          email: user?.email || "support@swiftdata.net",
          amount: 700, // Backend will auto-adjust for fee
          reference: crypto.randomUUID(),
          callback_url: callbackUrl,
          metadata: {
            order_type: "vendor_activation",
            agent_id: user?.id,
          }
        }
      });

      if (error) {
        let msg = error.message;
        try {
          const errBody = await error.context.json();
          msg = errBody.error || errBody.message || error.message;
        } catch (_) {}
        throw new Error(msg);
      }
      if (data && data.authorization_url) {
        toast.dismiss("pay");
        window.location.href = data.authorization_url;
      } else {
        throw new Error(data?.error || "Failed to generate checkout");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to initiate payment", { id: "pay" });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6 animate-in fade-in duration-500">
      <Card className="w-full max-w-2xl border-none shadow-2xl shadow-primary/10 bg-card/80 backdrop-blur-xl">
        <CardHeader className="text-center pb-8 border-b border-white/5 bg-primary/5">
          <div className="w-20 h-20 mx-auto bg-primary/20 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
            {status === "pending_approval" ? (
              <CheckCircle2 className="w-10 h-10 text-primary" />
            ) : (
              <ShieldAlert className="w-10 h-10 text-primary" />
            )}
          </div>
          <CardTitle className="text-3xl font-black tracking-tight">Swift Vendor Terminal</CardTitle>
          <CardDescription className="text-base mt-2">
            Institutional-grade POS system. Activation requires KYC verification and a one-time GHS 700.00 licensing fee.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          {status === "rejected" && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
              <p className="font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> Application Rejected</p>
              <p className="text-sm mt-1">{rejectionReason || "Please verify your documents and try again."}</p>
            </div>
          )}

          {(status === "inactive" || status === "rejected") && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">National ID / Ghana Card Number</Label>
                  <Input 
                    placeholder="Enter National ID" 
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Business Reg Number</Label>
                  <Input 
                    placeholder="Enter Business Reg No." 
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Operating Region</Label>
                  <select 
                    className="flex h-12 w-full items-center justify-between rounded-md border-none bg-muted/50 px-3 py-2 text-sm font-bold ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={vendorRegion}
                    onChange={(e) => setVendorRegion(e.target.value)}
                  >
                    <option value="" disabled>Select a Region</option>
                    <option value="Ahafo">Ahafo</option>
                    <option value="Ashanti">Ashanti</option>
                    <option value="Bono">Bono</option>
                    <option value="Bono East">Bono East</option>
                    <option value="Central">Central</option>
                    <option value="Eastern">Eastern</option>
                    <option value="Greater Accra">Greater Accra</option>
                    <option value="North East">North East</option>
                    <option value="Northern">Northern</option>
                    <option value="Oti">Oti</option>
                    <option value="Savannah">Savannah</option>
                    <option value="Upper East">Upper East</option>
                    <option value="Upper West">Upper West</option>
                    <option value="Volta">Volta</option>
                    <option value="Western">Western</option>
                    <option value="Western North">Western North</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Digital Address (GhanaPost GPS)</Label>
                  <Input 
                    placeholder="e.g. GA-123-4567" 
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={vendorDigitalAddress}
                    onChange={(e) => setVendorDigitalAddress(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Vendor Email</Label>
                  <Input 
                    type="email"
                    placeholder="Enter business email" 
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={vendorEmail}
                    onChange={(e) => setVendorEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Vendor Phone Number</Label>
                  <Input 
                    type="tel"
                    placeholder="Enter phone number" 
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={vendorPhone}
                    onChange={(e) => setVendorPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div 
                  className={cn("border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all hover:bg-white/5", nationalIdFile ? "border-primary/50 bg-primary/5" : "border-white/10")}
                  onClick={() => nationalIdInput.current?.click()}
                >
                  <input type="file" ref={nationalIdInput} className="hidden" accept="image/*,.pdf" onChange={(e) => setNationalIdFile(e.target.files?.[0] || null)} />
                  <UploadCloud className={cn("w-8 h-8 mx-auto mb-2", nationalIdFile ? "text-primary" : "text-muted-foreground")} />
                  <p className="font-bold text-sm">{nationalIdFile ? nationalIdFile.name : "Upload National ID"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Front Side Only</p>
                </div>

                <div 
                  className={cn("border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all hover:bg-white/5", nationalIdBackFile ? "border-primary/50 bg-primary/5" : "border-white/10")}
                  onClick={() => nationalIdBackInput.current?.click()}
                >
                  <input type="file" ref={nationalIdBackInput} className="hidden" accept="image/*,.pdf" onChange={(e) => setNationalIdBackFile(e.target.files?.[0] || null)} />
                  <UploadCloud className={cn("w-8 h-8 mx-auto mb-2", nationalIdBackFile ? "text-primary" : "text-muted-foreground")} />
                  <p className="font-bold text-sm">{nationalIdBackFile ? nationalIdBackFile.name : "Upload National ID"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Back Side Only</p>
                </div>
                
                <div 
                  className={cn("border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all hover:bg-white/5", businessCertFile ? "border-primary/50 bg-primary/5" : "border-white/10")}
                  onClick={() => businessCertInput.current?.click()}
                >
                  <input type="file" ref={businessCertInput} className="hidden" accept="image/*,.pdf" onChange={(e) => setBusinessCertFile(e.target.files?.[0] || null)} />
                  <UploadCloud className={cn("w-8 h-8 mx-auto mb-2", businessCertFile ? "text-primary" : "text-muted-foreground")} />
                  <p className="font-bold text-sm">{businessCertFile ? businessCertFile.name : "Upload Business Cert"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Registrar General Certificate</p>
                </div>
              </div>

                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">National ID Expiry Date</Label>
                  <Input 
                    type="date"
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={nationalIdExpiry}
                    onChange={(e) => setNationalIdExpiry(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground">Biz Cert Expiry Date</Label>
                  <Input 
                    type="date"
                    className="h-12 bg-muted/50 border-none font-bold"
                    value={businessCertExpiry}
                    onChange={(e) => setBusinessCertExpiry(e.target.value)}
                  />
                </div>

              <Button 
                className="w-full h-14 rounded-xl text-lg font-black mt-4 relative overflow-hidden" 
                disabled={loading} 
                onClick={handleSubmitKYC}
              >
                {loading && !ocrScanning && <Loader2 className="w-6 h-6 animate-spin mr-2" />}
                {ocrScanning && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <div className="w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-[shimmer_2s_infinite]" />
                    <span className="absolute font-black">AI OCR Scanning...</span>
                  </div>
                )}
                <span className={cn(ocrScanning ? "opacity-0" : "opacity-100", "flex items-center")}>
                  {loading ? "Uploading..." : "Verify Business Details"}
                  {!loading && <ArrowRight className="w-5 h-5 ml-2" />}
                </span>
              </Button>
            </div>
          )}

          {status === "payment_pending" && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-500">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 mb-6">
                <p className="text-emerald-500 font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5" /> KYC Verified Successfully
                </p>
              </div>

              <div className="space-y-2 mb-8">
                <h3 className="text-4xl font-black text-white">GHS 700.00</h3>
                <p className="text-sm text-muted-foreground font-medium">One-time Terminal Activation Fee</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-16 rounded-xl border-2 hover:bg-primary/5 font-bold flex flex-col gap-1 items-center justify-center py-2"
                  disabled={loading}
                  onClick={handlePayWallet}
                >
                  <span className="flex items-center gap-2 text-primary">
                    <Wallet className="w-5 h-5" /> Pay from Wallet
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">Balance: GHS {walletBalance.toFixed(2)}</span>
                </Button>
                
                <Button 
                  className="h-16 rounded-xl font-bold flex gap-2"
                  disabled={loading}
                  onClick={handlePayCheckout}
                >
                  <CreditCard className="w-5 h-5" /> Pay via Mobile Money
                </Button>
              </div>
            </div>
          )}

          {status === "pending_approval" && (
            <div className="text-center py-8 space-y-4 animate-in zoom-in-95 duration-500">
              <div className="relative w-32 h-32 mx-auto">
                <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-ping duration-1000"></div>
                <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldAlert className="w-12 h-12 text-primary" />
                </div>
              </div>
              <h3 className="text-2xl font-black text-white mt-8">Under Final Review</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Your payment and KYC details have been received. An administrator will review and activate your terminal within <strong className="text-white">24 hours</strong>.
              </p>
              <div className="pt-4">
                <Button variant="ghost" onClick={onComplete}>Refresh Status</Button>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
};
