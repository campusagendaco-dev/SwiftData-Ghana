import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

const Terms = () => {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pt-28 pb-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </Link>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Shield className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Terms of Service</h1>
            <p className="text-muted-foreground text-sm mt-1">Last updated: July 15, 2026</p>
          </div>
        </div>

        <div className="space-y-6 text-zinc-300 text-sm leading-relaxed bg-card/40 backdrop-blur-md border border-border/60 rounded-3xl p-6 sm:p-8">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">1. Agreement to Terms</h2>
            <p>
              By accessing or using SwiftData Ghana (swiftdatagh.shop), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">2. Description of Service</h2>
            <p>
              SwiftData Ghana provides a digital platform for buying cheap, non-expiry mobile data bundles (MTN, Telecel, AirtelTigo) and related services in Ghana.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">3. User Accounts and Security</h2>
            <p>
              To access certain features (such as agent dashboard, billing, API), you may need to register an account. You are responsible for safeguarding your password and account details. You must immediately notify support of any unauthorized use of your account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">4. Payment and Billing</h2>
            <p>
              All purchases on our site are processed securely via Paystack. You agree to provide current, complete, and accurate purchase and account information. We reserve the right to refuse or cancel any order if fraud or an unauthorized transaction is suspected.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">5. Delivery and Refund Policy</h2>
            <p>
              Data bundle delivery is automated and typically completes within seconds. Due to the nature of digital goods, refunds are only issued if a transaction fails to deliver due to our system error and cannot be completed after support review. We do not refund purchases made to incorrect recipient numbers provided by the customer.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">6. Prohibited Activities</h2>
            <p>
              You agree not to exploit the platform for fraud, deceptive activities, API abuse, or phishing. Any unauthorized automated requests, credential stuffing, or attempts to disrupt service security will result in immediate account termination and device blocking.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">7. Contact Information</h2>
            <p>
              If you have any questions or feedback regarding these terms, please contact us at:
              <br />
              <strong>Email:</strong> support@swiftdatagh.shop
              <br />
              <strong>Phone:</strong> 0540309637
              <br />
              <strong>Location:</strong> Accra, Ghana
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Terms;
