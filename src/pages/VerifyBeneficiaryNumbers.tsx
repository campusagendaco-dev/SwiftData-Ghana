import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck, ArrowLeft, Send, Sparkles, PhoneCall, Zap, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import SEO from "@/components/SEO";
import { useAppTheme } from "@/contexts/ThemeContext";
import BeneficiaryWhitelistChecker from "@/components/BeneficiaryWhitelistChecker";
import { cn } from "@/lib/utils";

export default function VerifyBeneficiaryNumbers() {
  const { isDark } = useAppTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <SEO
        title="MTN Beneficiary Whitelist Checker | Verify Phone Numbers"
        description="Instantly verify if your MTN number is approved on the carrier beneficiary whitelist before purchasing Affordable SME data bundles."
        canonical="https://swiftdata.com.gh/verify-numbers"
      />

      <div className="max-w-4xl mx-auto px-4 pt-6 sm:pt-10 space-y-6">
        {/* Navigation & Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/buy-data"
            className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Buy Data
          </Link>

          <Link
            to="/submit-numbers"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-500 hover:underline"
          >
            <Send className="w-3.5 h-3.5" /> Submit for Approval Portal
          </Link>
        </div>

        {/* Page Header */}
        <div className="space-y-2 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-amber-500" />
              MTN Beneficiary Whitelist Checker
            </h1>
            <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px] font-bold">
              Carrier SME Gateway
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
            Precheck MTN / Yello recipients before purchasing Affordable SME Data bundles. Check single numbers or audit bulk lists (up to 1,000 numbers).
            Completely free, wallet-safe, and zero debits.
          </p>
        </div>

        {/* Informational Guidance Alert */}
        <div className={cn("p-4 rounded-2xl border backdrop-blur-xl space-y-2", isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-900")}>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Important: Verified Numbers feature is strictly for Affordable MTN SME</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs pt-1">
            <div className="p-2.5 rounded-xl bg-background/50 border border-white/5 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Affordable MTN SME
              </p>
              <p className="text-[11px] opacity-80">Requires carrier beneficiary whitelisting. Whitelisted numbers receive bundles in 1-5 minutes.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-background/50 border border-white/5 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-foreground">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> MTN Mash Up & Retail
              </p>
              <p className="text-[11px] opacity-80">MTN Mash Up combos and retail packages deliver directly and NEVER require whitelisting.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-background/50 border border-white/5 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-foreground">
                <Zap className="w-3.5 h-3.5 text-blue-400" /> Telecel & AirtelTigo
              </p>
              <p className="text-[11px] opacity-80">Telecel and AT deliver directly without requiring carrier beneficiary whitelisting.</p>
            </div>
          </div>
        </div>

        {/* Standalone Checker Component */}
        <BeneficiaryWhitelistChecker
          onTransferToSubmit={(numbers) => {
            navigate(`/submit-numbers?tab=submit&numbers=${encodeURIComponent(numbers.join(","))}`);
          }}
        />
      </div>
    </div>
  );
}
