import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { Shield } from "lucide-react";

interface AfaOrderFormProps {
  price: string;
  agentId?: string;
  profit?: number;
  onOrderSaved?: () => void;
}

export interface AfaFormData {
  fullName: string;
  ghanaCardNumber: string;
  occupation: string;
  email: string;
  placeOfResidence: string;
  dateOfBirth: string;
}

const PAYSTACK_FEE_RATE = 0.0195;
const PAYSTACK_FEE_CAP = 100;

const calculateFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

const AfaOrderForm = ({ price, agentId, profit = 0, onOrderSaved }: AfaOrderFormProps) => {
  const { toast } = useToast();
  const [form, setForm] = useState<AfaFormData>({
    fullName: "",
    ghanaCardNumber: "",
    occupation: "",
    email: "",
    placeOfResidence: "",
    dateOfBirth: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof AfaFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missing = Object.entries(form).find(([, v]) => !v.trim());
    if (missing) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }

    if (!/^GHA-\d{9}-\d$/i.test(form.ghanaCardNumber.trim())) {
      toast({ title: "Enter a valid Ghana Card number (e.g. GHA-123456789-0)", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    const amount = parseFloat(price);
    const fee = calculateFee(amount);
    const total = parseFloat((amount + fee).toFixed(2));
    const orderId = crypto.randomUUID();
    const resolvedAgentId = agentId || "00000000-0000-0000-0000-000000000000";

    // Initialize Paystack payment
    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: form.email.trim(),
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?reference=${orderId}`,
        metadata: {
          order_id: orderId,
          order_type: "afa",
          afa_full_name: form.fullName.trim(),
          afa_ghana_card: form.ghanaCardNumber.trim(),
          afa_occupation: form.occupation.trim(),
          afa_email: form.email.trim(),
          afa_residence: form.placeOfResidence.trim(),
          afa_date_of_birth: form.dateOfBirth,
          agent_id: resolvedAgentId,
          profit,
          fee,
        },
      },
    });

    if (paymentError || !paymentData?.authorization_url) {
      const description = paymentData?.error || await getFunctionErrorMessage(paymentError, "Could not initialize payment.");
      toast({ title: "Payment failed", description, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    onOrderSaved?.();
    window.location.href = paymentData.authorization_url;
  };

  const amount = parseFloat(price);
  const fee = calculateFee(amount);
  const total = (amount + fee).toFixed(2);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="afa-name">Full Name *</Label>
          <Input id="afa-name" placeholder="Kofi Mensah" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} className="mt-1 bg-card" maxLength={100} />
        </div>
        <div>
          <Label htmlFor="afa-card">Ghana Card Number *</Label>
          <Input id="afa-card" placeholder="GHA-123456789-0" value={form.ghanaCardNumber} onChange={(e) => update("ghanaCardNumber", e.target.value)} className="mt-1 bg-card" maxLength={16} />
        </div>
        <div>
          <Label htmlFor="afa-occupation">Occupation *</Label>
          <Input id="afa-occupation" placeholder="e.g. Trader" value={form.occupation} onChange={(e) => update("occupation", e.target.value)} className="mt-1 bg-card" maxLength={100} />
        </div>
        <div>
          <Label htmlFor="afa-email">Email *</Label>
          <Input id="afa-email" type="email" placeholder="kofi@email.com" value={form.email} onChange={(e) => update("email", e.target.value)} className="mt-1 bg-card" maxLength={255} />
        </div>
        <div>
          <Label htmlFor="afa-residence">Place of Residence *</Label>
          <Input id="afa-residence" placeholder="e.g. Accra, East Legon" value={form.placeOfResidence} onChange={(e) => update("placeOfResidence", e.target.value)} className="mt-1 bg-card" maxLength={200} />
        </div>
        <div>
          <Label htmlFor="afa-dob">Date of Birth *</Label>
          <Input id="afa-dob" type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} className="mt-1 bg-card" />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-sm text-muted-foreground space-y-0.5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span>All fields are required</span>
          </div>
          <p className="text-xs">Fee: GH₵ {fee.toFixed(2)} · Total: GH₵ {total}</p>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Processing..." : `Pay GH₵ ${total}`}
        </Button>
      </div>
    </form>
  );
};

export default AfaOrderForm;
