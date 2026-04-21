import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type SystemSettings = {
  active_api_source: "primary";
  secondary_price_markup_pct: number;
  auto_api_switch: boolean;
  preferred_provider: "primary";
  backup_provider: "primary";
  holiday_mode_enabled: boolean;
  holiday_message: string;
  disable_ordering: boolean;
  dark_mode_enabled: boolean;
  customer_service_number: string;
  support_channel_link: string;
  table_ready: boolean;
  sub_agent_base_fee: number;
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_from_number: string;
};

const defaultSettings: SystemSettings = {
  active_api_source: "primary",
  secondary_price_markup_pct: 0,
  auto_api_switch: false,
  preferred_provider: "primary",
  backup_provider: "primary",
  holiday_mode_enabled: false,
  holiday_message: "Holiday mode is active. Orders will resume soon.",
  disable_ordering: false,
  dark_mode_enabled: false,
  customer_service_number: "0547636024",
  support_channel_link: "https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m",
  table_ready: true,
  sub_agent_base_fee: 80,
  twilio_account_sid: "",
  twilio_auth_token: "",
  twilio_from_number: "",
};

const toUiSettings = (data: any): SystemSettings => ({
  active_api_source: "primary",
  secondary_price_markup_pct: 0,
  auto_api_switch: false,
  preferred_provider: "primary",
  backup_provider: "primary",
  holiday_mode_enabled: Boolean(data?.holiday_mode_enabled),
  holiday_message: String(data?.holiday_message || defaultSettings.holiday_message),
  disable_ordering: Boolean(data?.disable_ordering),
  dark_mode_enabled: Boolean(data?.dark_mode_enabled),
  customer_service_number: String(data?.customer_service_number || defaultSettings.customer_service_number),
  support_channel_link: String(data?.support_channel_link || defaultSettings.support_channel_link),
  table_ready: Boolean(data?.table_ready ?? true),
  sub_agent_base_fee: Number(data?.sub_agent_base_fee ?? 80) || 80,
  twilio_account_sid: String(data?.twilio_account_sid || ""),
  twilio_auth_token: String(data?.twilio_auth_token || ""),
  twilio_from_number: String(data?.twilio_from_number || ""),
});

const extractMissingColumnFromError = (message: string): string | null => {
  const normalizeColumnName = (raw: string) =>
    String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/["'`]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

  const normalized = String(message || "").replace(/["'`]/g, "");
  const patterns = [
    /column\s+(.+?)\s+does not exist/i,
    /Could not find the\s+(.+?)\s+column/i,
    /column\s+(.+?)\s+of relation\s+system_settings\s+does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return normalizeColumnName(match[1]);
    }
  }

  return null;
};

const AdminSettings = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);

    // Try with new SMS columns first; fall back to base columns if migration hasn't run
    const FULL_SELECT = "auto_api_switch, preferred_provider, backup_provider, holiday_mode_enabled, holiday_message, disable_ordering, dark_mode_enabled, customer_service_number, support_channel_link, sub_agent_base_fee, twilio_account_sid, twilio_auth_token, twilio_from_number";
    const BASE_SELECT = "auto_api_switch, preferred_provider, backup_provider, holiday_mode_enabled, holiday_message, disable_ordering, dark_mode_enabled, customer_service_number, support_channel_link, sub_agent_base_fee";

    let row: any = null;
    const { data: fullData, error: fullError } = await (supabase.from("system_settings") as any)
      .select(FULL_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (fullError) {
      if (fullError.message?.includes("does not exist")) {
        // SMS columns not yet added (migration pending) — load without them
        const { data: baseData, error: baseError } = await supabase
          .from("system_settings")
          .select(BASE_SELECT)
          .eq("id", 1)
          .maybeSingle();
        if (baseError) {
          toast({ title: "Failed to load settings", description: baseError.message, variant: "destructive" });
          setLoading(false);
          return;
        }
        row = baseData;
      } else {
        toast({ title: "Failed to load settings", description: fullError.message, variant: "destructive" });
        setLoading(false);
        return;
      }
    } else {
      row = fullData;
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

    let payload: Record<string, any> = {
      id: 1,
      auto_api_switch: false,
      preferred_provider: "primary",
      backup_provider: "primary",
      active_api_source: "primary",
      secondary_price_markup_pct: 0,
      holiday_mode_enabled: settings.holiday_mode_enabled,
      holiday_message: settings.holiday_message.trim() || defaultSettings.holiday_message,
      disable_ordering: settings.disable_ordering,
      dark_mode_enabled: settings.dark_mode_enabled,
      customer_service_number: settings.customer_service_number.trim() || defaultSettings.customer_service_number,
      support_channel_link: settings.support_channel_link.trim() || defaultSettings.support_channel_link,
      sub_agent_base_fee: settings.sub_agent_base_fee,
      twilio_account_sid: settings.twilio_account_sid.trim(),
      twilio_auth_token: settings.twilio_auth_token.trim(),
      twilio_from_number: settings.twilio_from_number.trim(),
      updated_at: new Date().toISOString(),
    };

    let upsertError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { error } = await (supabase.from("system_settings") as any).upsert(payload);
      if (!error) {
        upsertError = null;
        break;
      }

      const missingColumn = extractMissingColumnFromError(String(error.message || ""));
      if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
        const { [missingColumn]: _drop, ...next } = payload;
        payload = next;
        upsertError = error;
        continue;
      }

      upsertError = error;
      break;
    }

    if (upsertError) {
      toast({
        title: "Failed to save settings",
        description: upsertError.message || "Unknown error",
        variant: "destructive",
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
          <CardTitle className="text-lg">Data Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
            API 1 (Spendless) is locked as the only active provider. API 2 and automatic provider switching are disabled.
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
              placeholder="0547636024"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SMS Configuration (Twilio)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Enter your Twilio credentials to enable SMS notifications. Get these from{" "}
            <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="underline">twilio.com/console</a>.
            The From Number must be a Twilio phone number in E.164 format (e.g. +12015555555).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="twilio-sid">Account SID</Label>
              <Input
                id="twilio-sid"
                value={settings.twilio_account_sid}
                onChange={(e) => setSettings((prev) => ({ ...prev, twilio_account_sid: e.target.value }))}
                className="mt-1 bg-secondary font-mono text-xs"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <Label htmlFor="twilio-from">From Number</Label>
              <Input
                id="twilio-from"
                value={settings.twilio_from_number}
                onChange={(e) => setSettings((prev) => ({ ...prev, twilio_from_number: e.target.value }))}
                className="mt-1 bg-secondary"
                placeholder="+12015555555"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="twilio-token">Auth Token</Label>
            <Input
              id="twilio-token"
              type="password"
              value={settings.twilio_auth_token}
              onChange={(e) => setSettings((prev) => ({ ...prev, twilio_auth_token: e.target.value }))}
              className="mt-1 bg-secondary font-mono text-xs"
              placeholder="Your Twilio Auth Token"
            />
          </div>
          {settings.twilio_account_sid && settings.twilio_auth_token && settings.twilio_from_number && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              Twilio credentials configured — SMS sending is enabled.
            </div>
          )}
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
