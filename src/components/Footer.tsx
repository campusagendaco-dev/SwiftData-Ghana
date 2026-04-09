import { Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const Footer = () => {
  const [customerServiceNumber, setCustomerServiceNumber] = useState("+233560042269");
  const [supportChannelLink, setSupportChannelLink] = useState("https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m");

  useEffect(() => {
    const loadSupportSettings = async () => {
      const { data } = await supabase.functions.invoke("system-settings", {
        body: { action: "get" },
      });
      const number = String((data as any)?.customer_service_number || "").trim();
      const link = String((data as any)?.support_channel_link || "").trim();
      if (number) setCustomerServiceNumber(number);
      if (link) setSupportChannelLink(link);
    };
    loadSupportSettings();
  }, []);

  return (
    <footer className="border-t border-border bg-card/50 py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 font-display font-bold text-lg mb-3">
              <Zap className="w-5 h-5 text-primary" />
              <span className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground leading-none">Data</span>
              <span className="text-primary">Hive</span>
              <span className="text-muted-foreground text-sm">GH</span>
            </div>
            <p className="text-sm text-muted-foreground">Ghana's fastest data reselling platform. Buy data for all networks instantly.</p>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-3 text-foreground">Quick Links</h4>
            <div className="space-y-2">
              {[{ to: "/buy-data", label: "Buy Data" }, { to: "/agent-program", label: "Reseller Program" }, { to: "/dashboard", label: "Dashboard" }].map((l) =>
                <Link key={l.to} to={l.to} className="block text-sm text-muted-foreground hover:text-primary transition-colors">{l.label}</Link>
              )}
            </div>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-3 text-foreground">Networks</h4>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>MTN Ghana</p><p>Telecel Ghana</p><p>AirtelTigo</p>
            </div>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-3 text-foreground">Contact</h4>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>support@datahiveghana.com</p>
              <p>{customerServiceNumber}</p>
              <a href={supportChannelLink} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                Join Support Channel
              </a>
              <p>Accra, Ghana</p>
            </div>
          </div>
        </div>
        <div className="border-t border-border mt-8 pt-6 text-center text-sm text-muted-foreground">
          <p>&copy; 2026 DataHive Ghana. All rights reserved.</p>
          <p className="mt-1">Developed by Scqeel Technologies</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
