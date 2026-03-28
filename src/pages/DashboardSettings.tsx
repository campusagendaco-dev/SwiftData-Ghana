import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateSlug } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Settings } from "lucide-react";

const DashboardSettings = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    store_name: "",
    full_name: "",
    email: "",
    phone: "",
    whatsapp_number: "",
    support_number: "",
    whatsapp_group_link: "",
    momo_number: "",
    momo_network: "",
    momo_account_name: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        store_name: profile.store_name || "",
        full_name: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        whatsapp_number: profile.whatsapp_number || "",
        support_number: profile.support_number || "",
        whatsapp_group_link: profile.whatsapp_group_link || "",
        momo_number: profile.momo_number || "",
        momo_network: profile.momo_network || "",
        momo_account_name: profile.momo_account_name || "",
      });
    }
  }, [profile]);

  const update = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!form.store_name.trim() || !form.full_name.trim() || !form.whatsapp_number.trim() || !form.support_number.trim() || !form.momo_number.trim() || !form.momo_network.trim() || !form.momo_account_name.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setSaving(true);
    const slug = generateSlug(form.store_name);

    const { error } = await supabase
      .from("profiles")
      .update({
        store_name: form.store_name.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        whatsapp_number: form.whatsapp_number.trim(),
        support_number: form.support_number.trim(),
        whatsapp_group_link: form.whatsapp_group_link.trim() || null,
        momo_number: form.momo_number.trim(),
        momo_network: form.momo_network.trim(),
        momo_account_name: form.momo_account_name.trim(),
        slug,
      })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving settings", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "Store settings saved!" });
    }
    setSaving(false);
  };

  const storeUrl = profile?.slug
    ? `${window.location.origin}/store/${profile.slug}`
    : null;

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Store Settings</h1>
        <p className="text-muted-foreground">Update your store details, contact info, and branding.</p>
      </div>

      {storeUrl && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-sm font-medium text-primary">Live at:</span>
          <code className="text-sm text-foreground bg-secondary px-3 py-1 rounded-lg break-all flex-1">{storeUrl}</code>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="settings-name">Full Name *</Label>
              <Input
                id="settings-name"
                value={form.full_name}
                onChange={(e) => update("full_name", e.target.value)}
                placeholder="Kwame Asante"
                className="mt-1 bg-secondary"
                maxLength={100}
                required
              />
            </div>
            <div>
              <Label htmlFor="settings-store">Store Name *</Label>
              <Input
                id="settings-store"
                value={form.store_name}
                onChange={(e) => update("store_name", e.target.value)}
                placeholder="Kwame's Data Hub"
                className="mt-1 bg-secondary"
                maxLength={100}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">Changing this updates your store URL slug.</p>
            </div>
            <div>
              <Label htmlFor="settings-email">Email Address</Label>
              <Input
                id="settings-email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="kwame@example.com"
                className="mt-1 bg-secondary"
                maxLength={255}
              />
            </div>
            <div>
              <Label htmlFor="settings-phone">Phone Number</Label>
              <Input
                id="settings-phone"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="024 XXX XXXX"
                className="mt-1 bg-secondary"
                maxLength={20}
              />
            </div>
            <div>
              <Label htmlFor="settings-whatsapp">WhatsApp Number *</Label>
              <Input
                id="settings-whatsapp"
                value={form.whatsapp_number}
                onChange={(e) => update("whatsapp_number", e.target.value)}
                placeholder="024 XXX XXXX"
                className="mt-1 bg-secondary"
                maxLength={20}
                required
              />
            </div>
            <div>
              <Label htmlFor="settings-support">Support Number *</Label>
              <Input
                id="settings-support"
                value={form.support_number}
                onChange={(e) => update("support_number", e.target.value)}
                placeholder="020 XXX XXXX"
                className="mt-1 bg-secondary"
                maxLength={20}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="settings-group">WhatsApp Group/Channel Link</Label>
            <Input
              id="settings-group"
              value={form.whatsapp_group_link}
              onChange={(e) => update("whatsapp_group_link", e.target.value)}
              placeholder="https://chat.whatsapp.com/..."
              className="mt-1 bg-secondary"
              maxLength={500}
            />
          </div>

          <div className="border-t border-border pt-4 mt-4">
            <h3 className="font-semibold mb-3">Mobile Money (MoMo) Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="settings-momo-name">MoMo Account Name *</Label>
                <Input
                  id="settings-momo-name"
                  value={form.momo_account_name}
                  onChange={(e) => update("momo_account_name", e.target.value)}
                  placeholder="Kwame Asante"
                  className="mt-1 bg-secondary"
                  maxLength={100}
                  required
                />
              </div>
              <div>
                <Label htmlFor="settings-momo-number">MoMo Number *</Label>
                <Input
                  id="settings-momo-number"
                  value={form.momo_number}
                  onChange={(e) => update("momo_number", e.target.value)}
                  placeholder="024 XXX XXXX"
                  className="mt-1 bg-secondary"
                  maxLength={20}
                  required
                />
              </div>
              <div>
                <Label htmlFor="settings-momo-network">MoMo Network *</Label>
                <select
                  id="settings-momo-network"
                  value={form.momo_network}
                  onChange={(e) => update("momo_network", e.target.value)}
                  className="w-full mt-1 bg-secondary border border-input rounded-md px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select network</option>
                  <option value="MTN">MTN</option>
                  <option value="Telecel">Telecel</option>
                  <option value="AirtelTigo">AirtelTigo</option>
                </select>
              </div>
            </div>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default DashboardSettings;
