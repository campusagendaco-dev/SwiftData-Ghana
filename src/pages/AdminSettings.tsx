import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type SystemSettings = {
  active_api_source: "primary" | "secondary";
  secondary_price_markup_pct: number;
  auto_api_switch: boolean;
  preferred_provider: "primary" | "secondary";
  backup_provider: "primary" | "secondary";
  holiday_mode_enabled: boolean;
  holiday_message: string;
  disable_ordering: boolean;
  dark_mode_enabled: boolean;
  customer_service_number: string;
  support_channel_link: string;
  table_ready: boolean;
  sub_agent_base_fee: number;
};

const defaultSettings: SystemSettings = {
  active_api_source: "primary",
  secondary_price_markup_pct: 8.11,
  auto_api_switch: false,
  preferred_provider: "primary",
  backup_provider: "secondary",
  holiday_mode_enabled: false,
  holiday_message: "Holiday mode is active. Orders will resume soon.",
  disable_ordering: false,
  dark_mode_enabled: false,
  customer_service_number: "+233203256540",
  support_channel_link: "https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m",
  table_ready: true,
  sub_agent_base_fee: 80,
};

const toUiSettings = (data: any): SystemSettings => ({
  active_api_source:
    data?.active_api_source === "secondary" || data?.preferred_provider === "secondary" ? "secondary" : "primary",
  secondary_price_markup_pct: Number(data?.secondary_price_markup_pct ?? 8.11) || 8.11,
  auto_api_switch: Boolean(data?.auto_api_switch),
  preferred_provider: data?.preferred_provider === "secondary" ? "secondary" : "primary",
  backup_provider: data?.backup_provider === "primary" ? "primary" : "secondary",
  holiday_mode_enabled: Boolean(data?.holiday_mode_enabled),
  holiday_message: String(data?.holiday_message || defaultSettings.holiday_message),
  disable_ordering: Boolean(data?.disable_ordering),
  dark_mode_enabled: Boolean(data?.dark_mode_enabled),
  customer_service_number: String(data?.customer_service_number || defaultSettings.customer_service_number),
  support_channel_link: String(data?.support_channel_link || defaultSettings.support_channel_link),
  table_ready: Boolean(data?.table_ready ?? true),
  sub_agent_base_fee: Number(data?.sub_agent_base_fee ?? 80) || 80,
});

const AdminSettings = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("system-settings", {
      body: { action: "get" },
    });

    if (!error && !data?.error) {
      setSettings(toUiSettings(data));
      setLoading(false);
      return;
    }

    // Fallback: direct table read if Edge Function is unreachable.
    const { data: row, error: rowError } = await supabase
      .from("system_settings")
      .select("auto_api_switch, preferred_provider, backup_provider, holiday_mode_enabled, holiday_message, disable_ordering, dark_mode_enabled, customer_service_number, support_channel_link, sub_agent_base_fee")
      .eq("id", 1)
      .maybeSingle();

    if (rowError) {
      toast({
        title: "Failed to load settings",
        description: data?.error || error?.message || rowError.message || "Unknown error",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setSettings(toUiSettings(row));
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    if (!settings.table_ready) {
      toast({
        title: "System settings table missing",
        description: "Run latest Supabase migration and retry.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast({ title: "Not authenticated", description: "Please sign in again.", variant: "destructive" });
      setSaving(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke("system-settings", {
      body: {
        action: "set",
        active_api_source: settings.active_api_source,
        secondary_price_markup_pct: settings.secondary_price_markup_pct,
        auto_api_switch: settings.auto_api_switch,
        preferred_provider: settings.preferred_provider,
        backup_provider: settings.backup_provider,
        holiday_mode_enabled: settings.holiday_mode_enabled,
        holiday_message: settings.holiday_message.trim() || defaultSettings.holiday_message,
        disable_ordering: settings.disable_ordering,
        dark_mode_enabled: settings.dark_mode_enabled,
        customer_service_number: settings.customer_service_number.trim() || defaultSettings.customer_service_number,
        support_channel_link: settings.support_channel_link.trim() || defaultSettings.support_channel_link,
        sub_agent_base_fee: settings.sub_agent_base_fee,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (error || data?.error) {
      // Fallback: direct table upsert if Edge Function is unreachable.
      const { error: upsertError } = await supabase.from("system_settings").upsert({
        id: 1,
        auto_api_switch: settings.auto_api_switch,
        preferred_provider: settings.active_api_source,
        backup_provider: settings.backup_provider,
        holiday_mode_enabled: settings.holiday_mode_enabled,
        holiday_message: settings.holiday_message.trim() || defaultSettings.holiday_message,
        disable_ordering: settings.disable_ordering,
        dark_mode_enabled: settings.dark_mode_enabled,
        customer_service_number: settings.customer_service_number.trim() || defaultSettings.customer_service_number,
        support_channel_link: settings.support_channel_link.trim() || defaultSettings.support_channel_link,
        sub_agent_base_fee: settings.sub_agent_base_fee,
        updated_at: new Date().toISOString(),
      });

      if (upsertError) {
        toast({
          title: "Failed to save settings",
          description: data?.error || error?.message || upsertError.message || "Unknown error",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      toast({
        title: "Settings saved with fallback",
        description: "Edge Function unreachable, saved directly to database.",
      });
      setSaving(false);
      return;
    }

    toast({ title: "System settings saved" });
    setSaving(false);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading system settings...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Admin Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API Source & Automation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Active data API source</Label>
              <Select
                value={settings.active_api_source}
                onValueChange={(value: "primary" | "secondary") =>
                  setSettings((prev) => ({ ...prev, active_api_source: value, preferred_provider: value }))
                }
              >
                <SelectTrigger className="mt-1 bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">API 1 (Primary)</SelectItem>
                  <SelectItem value="secondary">API 2 (Secondary)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                When API 2 is active, storefront data prices are auto-adjusted by the secondary markup.
              </p>
            </div>

            <div>
              <Label htmlFor="secondary-markup">API 2 markup (%)</Label>
              <Input
                id="secondary-markup"
                type="number"
                min={0}
                step={0.01}
                value={settings.secondary_price_markup_pct}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    secondary_price_markup_pct: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 bg-secondary"
              />
              <p className="text-xs text-muted-foreground mt-1">Default: 8.11%</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Auto API switch</Label>
              <p className="text-xs text-muted-foreground">
                Retry fulfillment with backup provider when the preferred provider fails.
              </p>
            </div>
            <Switch
              checked={settings.auto_api_switch}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, auto_api_switch: checked }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Preferred provider</Label>
              <Select
                value={settings.preferred_provider}
                onValueChange={(value: "primary" | "secondary") =>
                  setSettings((prev) => ({ ...prev, preferred_provider: value }))
                }
              >
                <SelectTrigger className="mt-1 bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="secondary">Secondary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Backup provider</Label>
              <Select
                value={settings.backup_provider}
                onValueChange={(value: "primary" | "secondary") =>
                  setSettings((prev) => ({ ...prev, backup_provider: value }))
                }
              >
                <SelectTrigger className="mt-1 bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="secondary">Secondary</SelectItem>
                  <SelectItem value="primary">Primary</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Holiday & Ordering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Holiday mode</Label>
              <p className="text-xs text-muted-foreground">Show seasonal operation mode and optional order restrictions.</p>
            </div>
            <Switch
              checked={settings.holiday_mode_enabled}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, holiday_mode_enabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Disable ordering</Label>
              <p className="text-xs text-muted-foreground">Blocks new payment initialization and wallet data buys.</p>
            </div>
            <Switch
              checked={settings.disable_ordering}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, disable_ordering: checked }))}
            />
          </div>

          <div>
            <Label htmlFor="holiday-message">Holiday message</Label>
            <Textarea
              id="holiday-message"
              value={settings.holiday_message}
              onChange={(e) => setSettings((prev) => ({ ...prev, holiday_message: e.target.value }))}
              className="mt-1 bg-secondary min-h-[90px]"
              placeholder="Holiday mode message..."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    holiday_mode_enabled: true,
                    holiday_message: "Merry Christmas! Our team is in holiday mode. Orders may process a bit slower.",
                  }))
                }
              >
                Merry Christmas Preset
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    holiday_mode_enabled: true,
                    holiday_message: "Happy Easter! We are currently in holiday mode. Thanks for your patience.",
                  }))
                }
              >
                Happy Easter Preset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Support Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="customer-service-number">Customer Service Number</Label>
            <Input
              id="customer-service-number"
              value={settings.customer_service_number}
              onChange={(e) => setSettings((prev) => ({ ...prev, customer_service_number: e.target.value }))}
              className="mt-1 bg-secondary"
              placeholder="+233..."
            />
          </div>
          <div>
            <Label htmlFor="support-channel-link">Support Channel Link</Label>
            <Input
              id="support-channel-link"
              value={settings.support_channel_link}
              onChange={(e) => setSettings((prev) => ({ ...prev, support_channel_link: e.target.value }))}
              className="mt-1 bg-secondary"
              placeholder="https://whatsapp.com/channel/..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Dark mode (global)</Label>
              <p className="text-xs text-muted-foreground">Applies a dark theme across the app for all users.</p>
            </div>
            <Switch
              checked={settings.dark_mode_enabled}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, dark_mode_enabled: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sub Agent Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <Label htmlFor="sub-agent-base-fee">Sub Agent Activation Base Fee (GH₵)</Label>
            <p className="text-xs text-muted-foreground mb-2">Platform base fee agents pay to activate a sub agent. Agents can add their own markup on top.</p>
            <Input
              id="sub-agent-base-fee"
              type="number"
              min={0}
              step={0.01}
              value={settings.sub_agent_base_fee}
              onChange={(e) => setSettings((prev) => ({ ...prev, sub_agent_base_fee: Math.max(0, Number(e.target.value)) }))}
              className="mt-1 bg-secondary max-w-[180px]"
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={saveSettings} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
};

export default AdminSettings;
