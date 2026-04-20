import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const Footer = () => {
  const [customerServiceNumber, setCustomerServiceNumber] = useState("0547636024");
  const [supportChannelLink, setSupportChannelLink] = useState("https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m");

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
    <footer className="bg-[#162316] text-white pt-12 pb-6">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <img src="/logo.png" alt="SwiftData Ghana" className="w-10 h-10 shrink-0" />
              <div>
                <p className="text-white font-bold text-sm leading-none">SwiftData GH</p>
                <p className="text-amber-400 text-[10px]">Data Reselling Platform</p>
              </div>
            </div>
            <p className="text-sm text-white/70">Ghana's fastest data reselling platform. Buy data for all networks instantly.</p>
          </div>
          <div>
            <h4 className="font-bold text-sm mb-3 text-amber-400">Quick Links</h4>
            <div className="space-y-2">
              {[{ to: "/login", label: "Sign In" }, { to: "/agent-program", label: "Become an Agent" }, { to: "/dashboard", label: "Dashboard" }].map((l) =>
                <Link key={l.to} to={l.to} className="block text-sm text-white/70 hover:text-white transition-colors">{l.label}</Link>
              )}
            </div>
          </div>
          <div>
            <h4 className="font-bold text-sm mb-3 text-amber-400">Networks</h4>
            <div className="space-y-2 text-sm text-white/70">
              <p>MTN Ghana</p>
              <p>Telecel Ghana</p>
              <p>AirtelTigo</p>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-sm mb-3 text-amber-400">Contact</h4>
            <div className="space-y-2 text-sm text-white/70">
              <p>support@swiftdatagh.com</p>
              <p>{customerServiceNumber}</p>
              <a href={supportChannelLink} target="_blank" rel="noopener noreferrer" className="block hover:text-amber-400 transition-colors">
                Join Support Channel
              </a>
              <p>Accra, Ghana</p>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-5 text-center text-sm text-white/50">
          <p>&copy; 2026 SwiftData Ghana. All rights reserved.</p>
          <p className="mt-1">Developed by Scqeel Technologies</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
