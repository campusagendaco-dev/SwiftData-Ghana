import { Zap } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () =>
  <footer className="border-t border-border bg-card/50 py-12">
    <div className="container mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-2 font-display font-bold text-lg mb-3">
            <Zap className="w-5 h-5 text-primary" />
            <span>QuickData GH</span>
          </div>
          <p className="text-sm text-muted-foreground">Ghana's fastest data reselling platform. Buy data for all networks instantly.</p>
        </div>
        <div>
          <h4 className="font-display font-semibold text-sm mb-3 text-foreground">Quick Links</h4>
          <div className="space-y-2">
            {[{ to: "/buy-data", label: "Buy Data" }, { to: "/agent-program", label: "Agent Program" }, { to: "/dashboard", label: "Dashboard" }].map((l) =>
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
            <p>support@quickdatagh.com</p>
            <p>+233 20 325 6540 </p>
            <p>Accra, Ghana</p>
          </div>
        </div>
      </div>
      <div className="border-t border-border mt-8 pt-6 text-center text-sm text-muted-foreground">
        <p>(c) 2026 QuickData GH. All rights reserved.</p>
        <p className="mt-1">Developed by Bensarfo Tech</p>
      </div>
    </div>
  </footer>;

export default Footer;
