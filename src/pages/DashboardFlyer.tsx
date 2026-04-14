import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Download, Sparkles, Loader2, Eye } from "lucide-react";
import html2canvas from "html2canvas";

interface AgentPrices { [network: string]: { [size: string]: string } }
interface DisabledPackages { [network: string]: string[] }

const DashboardFlyer = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [flyerData, setFlyerData] = useState<any>(null);
  const [agentPrices, setAgentPrices] = useState<AgentPrices>({});
  const [disabledPackages, setDisabledPackages] = useState<DisabledPackages>({});

  useEffect(() => {
    if (profile) {
      setAgentPrices((profile.agent_prices as AgentPrices) || {});
      setDisabledPackages((profile.disabled_packages as DisabledPackages) || {});
    }
  }, [profile]);

  const getAgentPrice = (network: string, size: string): number => {
    const price = agentPrices[network]?.[size];
    if (price && !isNaN(Number(price))) return Number(price);
    const basePkg = basePackages[network]?.find(p => p.size === size);
    return basePkg ? basePkg.price : 0;
  };

  const isPackageEnabled = (network: string, size: string): boolean => {
    return !disabledPackages[network]?.includes(size);
  };

  const buildFlyerHtml = (flyerInfo: any): string => {
    const { storeName, storeUrl, packages, networks: nets, contact } = flyerInfo;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Poppins',sans-serif;background:#111;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.flyer{width:100%;max-width:900px;background:#1a1a1a;border-radius:24px;overflow:hidden;border:2px solid #EAB308}
.header{background:linear-gradient(135deg,#EAB308 0%,#CA8A04 100%);padding:32px 24px;text-align:center}
.header h1{font-size:36px;font-weight:900;color:#000;letter-spacing:-0.5px}
.header p{color:#000;opacity:0.7;font-size:14px;margin-top:4px;font-weight:600}
.badge-row{display:flex;justify-content:center;gap:12px;margin-top:16px;flex-wrap:wrap}
.badge{background:rgba(0,0,0,0.2);color:#000;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px}
.content{padding:24px}
.network-section{margin-bottom:24px}
.network-title{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.network-dot{width:14px;height:14px;border-radius:50%}
.network-name{font-size:20px;font-weight:700;color:#fff}
.packages-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.pkg-card{background:#222;border:1px solid #333;border-radius:12px;padding:12px;text-align:center;transition:border-color 0.2s}
.pkg-card:hover{border-color:#EAB308}
.pkg-size{font-size:16px;font-weight:700;color:#fff}
.pkg-price{font-size:18px;font-weight:900;color:#EAB308;margin-top:4px}
.pkg-validity{font-size:10px;color:#888;margin-top:2px}
.pkg-popular{background:#EAB308;color:#000;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;display:inline-block;margin-top:4px}
.footer{background:#111;padding:24px;text-align:center;border-top:1px solid #333}
.cta-btn{display:inline-block;background:#EAB308;color:#000;padding:14px 40px;border-radius:30px;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 4px 20px rgba(234,179,8,0.3)}
.contact-text{color:#888;font-size:13px;margin-top:12px}
.powered{color:#555;font-size:11px;margin-top:16px}
</style>
</head>
<body>
<div class="flyer">
  <div class="header">
    <h1>${storeName}</h1>
    <p>Your Trusted Data Plug 🇬🇭</p>
    <div class="badge-row">
      <span class="badge">⚡ Instant Delivery</span>
      <span class="badge">💰 Best Prices</span>
      <span class="badge">🔒 Secure</span>
    </div>
  </div>
  <div class="content">
    ${nets.map((net: any) => {
      const netPkgs = packages[net.name];
      if (!netPkgs || netPkgs.length === 0) return '';
      return `<div class="network-section">
        <div class="network-title">
          <div class="network-dot" style="background:${net.color}"></div>
          <span class="network-name">${net.name}</span>
        </div>
        <div class="packages-grid">
          ${netPkgs.map((pkg: any) => `
            <div class="pkg-card">
              <div class="pkg-size">${pkg.size}</div>
              <div class="pkg-price">GH₵${pkg.price.toFixed(2)}</div>
              <div class="pkg-validity">${pkg.validity || 'Non-expiry'}</div>
              ${pkg.popular ? '<div class="pkg-popular">🔥 HOT</div>' : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>
  <div class="footer">
    <a href="${storeUrl}" class="cta-btn">🛒 Order Now</a>
    ${contact ? `<p class="contact-text">${contact}</p>` : ''}
    <p class="powered">Powered by SwiftData Ghana</p>
  </div>
</div>
</body>
</html>`;
  };

  const generateFlyer = async () => {
    if (!profile?.store_name) {
      toast({ title: "Store name required", description: "Please set up your store name in settings first.", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      const pkgsByNetwork: Record<string, any[]> = {};
      for (const network of networks) {
        const networkPackages = basePackages[network.name] || [];
        const enabled = networkPackages
          .filter(pkg => isPackageEnabled(network.name, pkg.size))
          .map(pkg => ({
            network: network.name, size: pkg.size,
            price: getAgentPrice(network.name, pkg.size),
            validity: pkg.validity, popular: pkg.popular,
          }));
        if (enabled.length > 0) pkgsByNetwork[network.name] = enabled;
      }

      const flyerInfo = {
        storeName: profile.store_name,
        storeUrl: profile.slug ? `https://swiftdatagh.com/store/${profile.slug}` : 'https://swiftdatagh.com',
        packages: pkgsByNetwork,
        networks,
        contact: profile.momo_number ? `Contact: ${profile.momo_number}` : '',
      };

      let data;
      try {
        const result = await supabase.functions.invoke('generate-flyer', { body: flyerInfo });
        if (result.error) throw new Error(result.error.message || 'Function failed');
        data = result.data;
      } catch {
        data = { html: buildFlyerHtml(flyerInfo), generatedLocally: true };
      }

      if (!data) throw new Error('No data returned');
      if (data.error) throw new Error(data.error);

      setFlyerData(data);
      toast({ title: "Flyer generated!", description: "Your promotional flyer is ready to share." });
    } catch (error) {
      toast({ title: "Generation failed", description: error instanceof Error ? error.message : 'Unknown error', variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const downloadFlyer = async () => {
    if (!flyerData?.html) return;
    try {
      const container = document.createElement('div');
      container.innerHTML = flyerData.html;
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '-9999px';
      container.style.width = '900px';
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { width: 900, height: container.scrollHeight, scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#111' });
      document.body.removeChild(container);

      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${profile?.store_name || 'store'}-flyer.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          toast({ title: "Downloaded!", description: "Flyer saved as PNG." });
        }
      }, 'image/png', 0.95);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const openFlyer = () => {
    if (!flyerData?.html) return;
    const newWindow = window.open('', '_blank');
    if (newWindow) { newWindow.document.write(flyerData.html); newWindow.document.close(); }
  };

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-black">Flyer Generator</h1>
          <p className="text-muted-foreground text-sm">Create shareable promotional flyers for your store</p>
        </div>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Your Store Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Store Info</h3>
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Name:</span> <span className="font-semibold">{profile?.store_name || 'Not set'}</span></p>
                <p><span className="text-muted-foreground">URL:</span> <span className="font-semibold">{profile?.slug ? `swiftdatagh.com/store/${profile.slug}` : 'Not set'}</span></p>
                <p><span className="text-muted-foreground">Contact:</span> <span className="font-semibold">{profile?.momo_number || 'Not set'}</span></p>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Networks</h3>
              <div className="space-y-2">
                {networks.map(network => {
                  const enabledCount = basePackages[network.name]?.filter(pkg => isPackageEnabled(network.name, pkg.size)).length || 0;
                  return (
                    <div key={network.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: network.color }} />
                      <span className="text-sm font-medium">{network.name}</span>
                      <Badge variant="secondary" className="text-xs">{enabledCount} pkgs</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <Button onClick={generateFlyer} disabled={generating || !profile?.store_name} className="gap-2 w-full sm:w-auto">
              {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate Flyer</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {flyerData && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="font-black">Your Flyer Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <div className="border border-border rounded-xl overflow-hidden w-full max-w-lg bg-[#111]">
                <iframe srcDoc={flyerData.html} className="w-full h-[500px] border-0" title="Generated flyer" />
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={openFlyer} variant="outline" className="gap-2">
                <Eye className="w-4 h-4" /> View Full Size
              </Button>
              <Button onClick={downloadFlyer} className="gap-2">
                <Download className="w-4 h-4" /> Download PNG
              </Button>
              <Button onClick={generateFlyer} variant="ghost" disabled={generating}>
                Regenerate
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DashboardFlyer;
