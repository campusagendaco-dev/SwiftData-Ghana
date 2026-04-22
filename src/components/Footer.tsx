import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Mail, Phone, ArrowRight, ShieldCheck, Zap } from "lucide-react";

const Footer = () => {
  const [customerServiceNumber, setCustomerServiceNumber] = useState("0547636024");
  const [supportChannelLink, setSupportChannelLink] = useState("https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40");

  useEffect(() => {
    const loadSupportSettings = async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("customer_service_number, support_channel_link")
        .eq("id", 1)
        .maybeSingle();
      const number = String(data?.customer_service_number || "").trim();
      const link = String(data?.support_channel_link || "").trim();
      if (number) setCustomerServiceNumber(number);
      if (link) setSupportChannelLink(link);
    };
    loadSupportSettings();
  }, []);

  return (
    <footer className="relative bg-[#0a0a0f] text-white pt-20 pb-8 overflow-hidden border-t border-white/5">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-amber-500/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />
      
      <div className="container relative z-10 mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 mb-16">
          
          {/* Brand Column */}
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-white/5 p-2 rounded-xl border border-white/10 shadow-xl backdrop-blur-sm">
                <img src="/logo.png" alt="SwiftData Ghana" className="w-10 h-10 shrink-0" />
              </div>
              <div>
                <p className="text-white font-black text-xl tracking-tight leading-none">SwiftData <span className="text-amber-400">GH</span></p>
                <p className="text-white/50 text-xs font-medium uppercase tracking-widest mt-1">Premium Data Platform</p>
              </div>
            </div>
            <p className="text-sm text-white/60 leading-relaxed mb-6">
              Ghana's fastest and most reliable data reselling platform. Experience instant delivery, unexpiring bundles, and secure transactions across all major networks.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-white/40">
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-green-400" /> Paystack Secured</span>
              <span className="flex items-center gap-1.5"><Zap className="w-4 h-4 text-amber-400" /> Instant Delivery</span>
            </div>
          </div>
          
          {/* Quick Links */}
          <div className="md:col-span-2 md:col-start-6">
            <h4 className="font-bold text-sm mb-6 text-white uppercase tracking-wider">Quick Links</h4>
            <div className="space-y-4">
              {[{ to: "/login", label: "Sign In" }, { to: "/agent-program", label: "Become an Agent" }, { to: "/dashboard", label: "Dashboard" }].map((l) =>
                <Link key={l.to} to={l.to} className="group flex items-center gap-2 text-sm text-white/60 hover:text-amber-400 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20 group-hover:bg-amber-400 transition-colors" />
                  {l.label}
                </Link>
              )}
            </div>
          </div>
          
          {/* Networks */}
          <div className="md:col-span-2">
            <h4 className="font-bold text-sm mb-6 text-white uppercase tracking-wider">Networks</h4>
            <div className="space-y-4 text-sm text-white/60">
              <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" /> MTN Ghana</p>
              <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" /> Telecel Ghana</p>
              <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500" /> AirtelTigo</p>
            </div>
          </div>
          
          {/* Contact */}
          <div className="md:col-span-3">
            <h4 className="font-bold text-sm mb-6 text-white uppercase tracking-wider">Contact Us</h4>
            <div className="space-y-4 text-sm text-white/60">
              <a href="mailto:support@swiftdatagh.com" className="flex items-center gap-3 hover:text-white transition-colors">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                support@swiftdatagh.com
              </a>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <Phone className="w-4 h-4" />
                </div>
                {customerServiceNumber}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                Accra, Ghana
              </div>
            </div>

            <a 
              href={supportChannelLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="mt-6 flex items-center justify-between p-1 pl-4 rounded-full bg-gradient-to-r from-[#25D366]/20 to-[#128C7E]/20 border border-[#25D366]/30 hover:border-[#25D366]/60 transition-colors group"
            >
              <div className="flex flex-col py-1">
                <span className="text-xs text-[#25D366] font-bold uppercase tracking-wide">Join 50K+ followers</span>
                <span className="text-[10px] text-white/60">On our WhatsApp Channel</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg">
                <ArrowRight className="w-4 h-4 text-white" />
              </div>
            </a>
          </div>
        </div>
        
        {/* Bottom Bar */}
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/40">
          <p>&copy; {new Date().getFullYear()} SwiftData Ghana. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          </div>
          <p className="flex items-center gap-1">
            Developed by <span className="font-semibold text-white/60 hover:text-white transition-colors cursor-pointer">Scqeel Technologies</span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
