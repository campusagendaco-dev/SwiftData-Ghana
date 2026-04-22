import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, AlertCircle, Phone, MessageSquare, Percent, MessageCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SystemSettings {
  auto_api_switch: boolean;
  preferred_provider: "hubtel" | "paystack" | "flutterwave";
  backup_provider: "hubtel" | "paystack" | "flutterwave";
  holiday_mode_enabled: boolean;
  holiday_message: string;
  disable_ordering: boolean;
  dark_mode_enabled: boolean;
  customer_service_number: string;
  support_channel_link: string;
  sub_agent_base_fee: string;
  txtconnect_api_key: string;
  txtconnect_sender_id: string;
}

const AdminSettings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SystemSettings>({
    auto_api_switch: false,
    preferred_provider: "paystack",
    backup_provider: "hubtel",
    holiday_mode_enabled: false,
    holiday_message: "",
    disable_ordering: false,
    dark_mode_enabled: false,
    customer_service_number: "",
    support_channel_link: "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    sub_agent_base_fee: "5.00",
    txtconnect_api_key: "",
    txtconnect_sender_id: "",
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        toast({ title: "Error loading settings", description: error.message, variant: "destructive" });
      } else if (data) {
        setSettings({
          auto_api_switch: data.auto_api_switch || false,
          preferred_provider: (data.preferred_provider as any) || "paystack",
          backup_provider: (data.backup_provider as any) || "hubtel",
          holiday_mode_enabled: data.holiday_mode_enabled || false,
          holiday_message: data.holiday_message || "",
          disable_ordering: data.disable_ordering || false,
          dark_mode_enabled: data.dark_mode_enabled || false,
          customer_service_number: data.customer_service_number || "",
          support_channel_link: data.support_channel_link || "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
          sub_agent_base_fee: String(data.sub_agent_base_fee || "5.00"),
          txtconnect_api_key: String(data.txtconnect_api_key || ""),
          txtconnect_sender_id: String(data.txtconnect_sender_id || ""),
        });
      }
      setLoading(false);
    };

    fetchSettings();
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    
    // Auto-create row if it doesn't exist to ensure robust setting saving
    const { data: existing } = await supabase.from("system_settings").select("id").eq("id", 1).maybeSingle();
    
    let dbError = null;
    
    if (!existing) {
      const { error } = await supabase.from("system_settings").insert({
        id: 1,
        auto_api_switch: settings.auto_api_switch,
        preferred_provider: settings.preferred_provider,
        backup_provider: settings.backup_provider,
        holiday_mode_enabled: settings.holiday_mode_enabled,
        holiday_message: settings.holiday_message,
        disable_ordering: settings.disable_ordering,
        dark_mode_enabled: settings.dark_mode_enabled,
        customer_service_number: settings.customer_service_number.trim(),
        support_channel_link: settings.support_channel_link.trim(),
        sub_agent_base_fee: parseFloat(settings.sub_agent_base_fee) || 5.0,
        txtconnect_api_key: settings.txtconnect_api_key.trim(),
        txtconnect_sender_id: settings.txtconnect_sender_id.trim(),
      });
      dbError = error;
    } else {
      const { error } = await supabase
        .from("system_settings")
        .update({
          auto_api_switch: settings.auto_api_switch,
          preferred_provider: settings.preferred_provider,
          backup_provider: settings.backup_provider,
          holiday_mode_enabled: settings.holiday_mode_enabled,
          holiday_message: settings.holiday_message,
          disable_ordering: settings.disable_ordering,
          dark_mode_enabled: settings.dark_mode_enabled,
          customer_service_number: settings.customer_service_number.trim(),
          support_channel_link: settings.support_channel_link.trim(),
          sub_agent_base_fee: parseFloat(settings.sub_agent_base_fee) || 5.0,
          txtconnect_api_key: settings.txtconnect_api_key.trim(),
          txtconnect_sender_id: settings.txtconnect_sender_id.trim(),
        })
        .eq("id", 1);
      dbError = error;
    }

    if (dbError) {
      toast({ title: "Failed to save settings", description: dbError.message, variant: "destructive" });
    } else {
      toast({ title: "Settings saved successfully" });
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure global platform behavior.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save All Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Core Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Platform State</CardTitle>
              <CardDescription>Control access and ordering capabilities.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label>Dark Mode Default</Label>
                  <p className="text-xs text-muted-foreground">Enable dark mode as the default theme.</p>
                </div>
                <Switch
                  checked={settings.dark_mode_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, dark_mode_enabled: c })}
                />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label className="text-red-500">Disable All Ordering</Label>
                  <p className="text-xs text-muted-foreground">Stop users from placing any new orders.</p>
                </div>
                <Switch
                  checked={settings.disable_ordering}
                  onCheckedChange={(c) => setSettings({ ...settings, disable_ordering: c })}
                  className="data-[state=checked]:bg-red-500"
                />
              </div>

              {settings.disable_ordering && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Ordering is currently disabled. Users will see a maintenance message at checkout.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact & Support</CardTitle>
              <CardDescription>Update the contact information shown to users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cs-number" className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" /> Customer Service Number
                </Label>
                <Input
                  id="cs-number"
                  placeholder="e.g. 0547636024"
                  value={settings.customer_service_number}
                  onChange={(e) => setSettings({ ...settings, customer_service_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-link" className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-muted-foreground" /> Support Channel Link (WhatsApp)
                </Label>
                <Input
                  id="support-link"
                  placeholder="https://whatsapp.com/channel/..."
                  value={settings.support_channel_link}
                  onChange={(e) => setSettings({ ...settings, support_channel_link: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  The floating WhatsApp button and Footer will link here.
                </p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Percent className="w-5 h-5 text-amber-500" />
                Sub-Agent Commission Base
              </CardTitle>
              <CardDescription>
                Set the default base price for sub-agent packages (what standard agents pay).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>Base Fee (GH₵)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={settings.sub_agent_base_fee}
                  onChange={(e) => setSettings({ ...settings, sub_agent_base_fee: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  When a sub-agent activates a package, this is the amount deducted from the parent agent's wallet. The remaining amount goes to the parent agent as profit.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Messaging & Announcements */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Holiday Mode Announcement
              </CardTitle>
              <CardDescription>Display a prominent banner across the site.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enable Holiday Banner</Label>
                <Switch
                  checked={settings.holiday_mode_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, holiday_mode_enabled: c })}
                />
              </div>

              {settings.holiday_mode_enabled && (
                <div className="space-y-2 pt-2">
                  <Label>Banner Message</Label>
                  <Textarea
                    placeholder="e.g. Happy Holidays! Delivery might be delayed."
                    value={settings.holiday_message}
                    onChange={(e) => setSettings({ ...settings, holiday_message: e.target.value })}
                    className="min-h-[100px]"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">SMS Configuration (TxtConnect)</CardTitle>
              <CardDescription>
                Enter your TxtConnect credentials to enable SMS notifications. Get these from{" "}
                <a href="https://txtconnect.net/" target="_blank" rel="noopener noreferrer" className="underline text-amber-500 hover:text-amber-400">txtconnect.net</a>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="txtconnect-key">API Key</Label>
                  <Input
                    id="txtconnect-key"
                    type="password"
                    value={settings.txtconnect_api_key}
                    onChange={(e) => setSettings((prev) => ({ ...prev, txtconnect_api_key: e.target.value }))}
                    placeholder="Your TxtConnect API Key"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="txtconnect-sender">Sender ID</Label>
                  <Input
                    id="txtconnect-sender"
                    value={settings.txtconnect_sender_id}
                    onChange={(e) => setSettings((prev) => ({ ...prev, txtconnect_sender_id: e.target.value }))}
                    placeholder="Approved Sender ID (e.g. SwiftData)"
                    maxLength={11}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Must be an approved alphanumeric Sender ID (max 11 chars).</p>
                </div>
              </div>

              {settings.txtconnect_api_key && settings.txtconnect_sender_id && (
                <Alert className="bg-green-50 text-green-900 border-green-200 mt-4 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20">
                  <AlertCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-xs font-medium">
                    TxtConnect credentials configured — SMS sending is enabled.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
