import { Shield, Zap } from "lucide-react";
import AfaOrderForm from "@/components/AfaOrderForm";

const AFA_BASE_PRICE = "12.50";

const AfaBundles = () => (
  <div className="min-h-screen pt-24 pb-16 px-4">
    <div className="container mx-auto max-w-2xl">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-4 text-sm text-primary font-medium">
          <Shield className="w-4 h-4" /> AFA Bundle
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">AFA Bundle Registration</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Register for the Agent For Agents (AFA) bundle. Fill in all required details below to place your order.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-lg font-semibold">AFA Bundle</h2>
            <p className="text-sm text-muted-foreground">One-time registration package</p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-bold text-primary">GH₵ {AFA_BASE_PRICE}</p>
          </div>
        </div>
        <AfaOrderForm price={AFA_BASE_PRICE} />
      </div>
    </div>
  </div>
);

export default AfaBundles;
