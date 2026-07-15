import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pt-28 pb-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </Link>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Lock className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
            <p className="text-muted-foreground text-sm mt-1">Last updated: July 15, 2026</p>
          </div>
        </div>

        <div className="space-y-6 text-zinc-300 text-sm leading-relaxed bg-card/40 backdrop-blur-md border border-border/60 rounded-3xl p-6 sm:p-8">
          <p>
            At SwiftData Ghana, accessible from swiftdatagh.shop, one of our main priorities is the privacy of our visitors. This Privacy Policy document contains types of information that is collected and recorded by SwiftData Ghana and how we use it.
          </p>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">1. Information We Collect</h2>
            <p>
              We collect information necessary to fulfill your orders and manage your user account:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Personal Info:</strong> Full name, email address, and phone number when registering.</li>
              <li><strong>Transaction Info:</strong> Recipient phone numbers, network type, payment details (processed securely via Paystack tokenization; we do not store raw card details or momo PINs).</li>
              <li><strong>Device Info:</strong> IP address, browser type, and unique device IDs to prevent fraudulent purchases and blocks.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">2. How We Use Your Information</h2>
            <p>
              We use the collected information to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Process and deliver mobile data bundle orders.</li>
              <li>Send transaction confirmation emails, support updates, and verification links.</li>
              <li>Detect, prevent, and mitigate fraud or security breaches.</li>
              <li>Improve site usability, design, and system performance.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">3. Information Sharing and Disclosure</h2>
            <p>
              We do not sell, rent, or trade your personal data to third parties. We share information only with trusted service partners to fulfill transactions:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Telecom Networks:</strong> Sharing recipient numbers to fulfill the data bundle delivery.</li>
              <li><strong>Payment Gateway:</strong> Secure tokenized transactions via Paystack.</li>
              <li><strong>SMS Gateways:</strong> Sending transaction updates and verification OTP alerts via TxtConnect.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">4. Data Security</h2>
            <p>
              We implement industry-standard cryptographic protocols (SSL/TLS) and Supabase security roles to protect all customer and agent account data. However, no internet transmission is 100% secure, and users are responsible for keeping their passwords safe.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">5. Data Protection Rights (GDPR & Ghana Data Protection Act)</h2>
            <p>
              You have the right to request access, correction, or deletion of your personal data stored on our servers. To make a request, please contact our support team.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">6. Contact Us</h2>
            <p>
              If you have additional questions or require more information about our Privacy Policy, do not hesitate to contact us at support@swiftdatagh.shop.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Privacy;
