import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, Gift, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { oddsPercent, packageSizeGb } from "@/lib/mysteryBox";
import { MysteryBoxPreview, previewSamplePrize } from "@/components/MysteryBoxPreview";

type Campaign = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  orders_per_box: number;
  boxes_per_day: number;
  reward_text: string;
  min_order_amount: number;
  bullets: string[];
};

type Prize = {
  id: string;
  campaign_id: string;
  label: string;
  network: string;
  package_size: string;
  is_mashup: boolean;
  weight: number;
  stock_total: number | null;
  stock_remaining: number | null;
  is_active: boolean;
};

type OpenRow = {
  id: string;
  user_id: string;
  prize_label: string;
  recipient_phone: string;
  order_id: string;
  box_number: number;
  created_at: string;
};

type Pkg = { network: string; package_size: string };

const DEFAULT_BULLETS = [
  "Complete 5 successful orders today to unlock your box.",
  "Open it to win 5GB or more.",
  "New box every day: progress resets at midnight.",
];

/** Prizes should be at least this big (owner's rule: "5GB or more"). */
const MIN_PRIZE_GB = 5;
const isUnderMinimum = (packageSize: string) => {
  const gb = packageSizeGb(packageSize);
  return gb !== null && gb < MIN_PRIZE_GB;
};

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const blankCampaign = (): Omit<Campaign, "id"> => {
  const start = new Date();
  const end = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  return {
    title: "Mystery Box",
    description: "",
    image_url: null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    is_active: false,
    orders_per_box: 5,
    boxes_per_day: 1,
    reward_text: "5GB or more",
    min_order_amount: 0,
    bullets: [...DEFAULT_BULLETS],
  };
};

const isMashupNetwork = (network: string) => /mash/i.test(network);

export default function AdminMysteryBox() {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Campaign, "id">>(blankCampaign());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [opens, setOpens] = useState<(OpenRow & { status?: string; name?: string })[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [newPrize, setNewPrize] = useState({ label: "", network: "", package_size: "", weight: "1", stock: "" });
  // The campaign whose prizes and opens should be on screen; slower loads for another one are dropped.
  const shownCampaignRef = useRef<string | null>(null);

  // Show a newly chosen (not yet uploaded) image in the preview; release it when it changes.
  useEffect(() => {
    if (!imageFile) {
      setPreviewImage(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewImage(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const loadCampaigns = useCallback(async () => {
    const { data, error } = await supabase.from("mystery_box_campaigns").select("*").order("created_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load Mystery Box campaigns. Has the migration been applied?");
      setCampaigns([]);
    } else {
      setCampaigns((data || []).map((c: any) => ({ ...c, bullets: Array.isArray(c.bullets) ? c.bullets : [] })));
    }
    setLoading(false);
  }, []);

  const loadPrizesAndOpens = useCallback(async (campaignId: string) => {
    const [{ data: prizeRows }, { data: openRows }] = await Promise.all([
      supabase.from("mystery_box_prizes").select("*").eq("campaign_id", campaignId).order("created_at"),
      supabase
        .from("mystery_box_opens")
        .select("id, user_id, prize_label, recipient_phone, order_id, box_number, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (shownCampaignRef.current !== campaignId) return;
    setPrizes((prizeRows as Prize[]) || []);
    const rows = (openRows as OpenRow[]) || [];
    if (rows.length === 0) {
      setOpens([]);
      return;
    }
    const [{ data: orderRows }, { data: profileRows }] = await Promise.all([
      supabase.from("orders").select("id, status").in("id", rows.map((r) => r.order_id)),
      supabase.from("profiles").select("user_id, full_name").in("user_id", [...new Set(rows.map((r) => r.user_id))]),
    ]);
    if (shownCampaignRef.current !== campaignId) return;
    const statusById = new Map((orderRows || []).map((o: any) => [o.id, o.status]));
    const nameById = new Map((profileRows || []).map((p: any) => [p.user_id, p.full_name]));
    setOpens(rows.map((r) => ({ ...r, status: statusById.get(r.order_id), name: nameById.get(r.user_id) })));
  }, []);

  useEffect(() => {
    loadCampaigns();
    supabase
      .from("global_package_settings")
      .select("network, package_size, is_unavailable")
      .then(({ data }) => setPackages(((data || []) as any[]).filter((p) => p.is_unavailable !== true)));
  }, [loadCampaigns]);

  useEffect(() => {
    shownCampaignRef.current = selectedId;
    setPrizes([]);
    setOpens([]);
    if (selectedId) loadPrizesAndOpens(selectedId);
  }, [selectedId, loadPrizesAndOpens]);

  const networks = useMemo(() => [...new Set(packages.map((p) => p.network))].sort(), [packages]);
  const packagesForNetwork = useMemo(
    () => packages.filter((p) => p.network === newPrize.network).map((p) => p.package_size),
    [packages, newPrize.network],
  );
  const odds = useMemo(() => oddsPercent(prizes), [prizes]);

  const selectCampaign = (c: Campaign | null) => {
    setSelectedId(c?.id ?? null);
    setImageFile(null);
    if (c) {
      const { id: _id, ...rest } = c;
      const bullets = [...rest.bullets, "", "", ""].slice(0, 3);
      setForm({ ...rest, bullets });
    } else {
      setForm(blankCampaign());
    }
  };

  const saveCampaign = async () => {
    const start = new Date(form.starts_at);
    const end = new Date(form.ends_at);
    if (!form.title.trim()) return toast.error("Give the campaign a title.");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return toast.error("The end date must be after the start date.");
    }
    if (!Number.isInteger(form.orders_per_box) || form.orders_per_box < 1) return toast.error("Orders needed per day must be 1 or more.");
    if (!Number.isInteger(form.boxes_per_day) || form.boxes_per_day < 1) {
      return toast.error("Boxes per customer per day must be 1 or more.");
    }
    if (!form.reward_text.trim()) return toast.error("Add the reward wording, e.g. 5GB or more.");
    if (!(form.min_order_amount >= 0)) return toast.error("Minimum order amount can't be negative.");

    setSaving(true);
    try {
      let imageUrl = form.image_url;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop();
        const path = `mystery-box/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("promo-banners").upload(path, imageFile);
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("promo-banners").getPublicUrl(path).data.publicUrl;
      }
      const payload = {
        ...form,
        title: form.title.trim(),
        reward_text: form.reward_text.trim(),
        image_url: imageUrl,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        bullets: form.bullets.map((b) => b.trim()).filter(Boolean),
      };
      const { data, error } = selectedId
        ? await supabase.from("mystery_box_campaigns").update(payload).eq("id", selectedId).select().single()
        : await supabase.from("mystery_box_campaigns").insert(payload).select().single();
      if (error) throw error;
      toast.success(selectedId ? "Campaign saved" : "Campaign created — now add some prizes");
      await loadCampaigns();
      selectCampaign({ ...(data as Campaign), bullets: Array.isArray(data.bullets) ? data.bullets : [] });
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save the campaign.");
    } finally {
      setSaving(false);
    }
  };

  const addPrize = async () => {
    if (!selectedId) return;
    const weight = Number(newPrize.weight);
    const stock = newPrize.stock.trim() === "" ? null : Number(newPrize.stock);
    if (!newPrize.label.trim() || !newPrize.network || !newPrize.package_size) {
      return toast.error("Pick a label, network and package for the prize.");
    }
    if (!Number.isInteger(weight) || weight < 1) return toast.error("Weight must be a whole number of 1 or more.");
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return toast.error("Stock must be a whole number, or blank for unlimited.");
    const { error } = await supabase.from("mystery_box_prizes").insert({
      campaign_id: selectedId,
      label: newPrize.label.trim(),
      network: newPrize.network,
      package_size: newPrize.package_size,
      is_mashup: isMashupNetwork(newPrize.network),
      weight,
      stock_total: stock,
      stock_remaining: stock,
    });
    if (error) return toast.error(error.message);
    if (isUnderMinimum(newPrize.package_size)) {
      toast.warning(`${newPrize.package_size} is under ${MIN_PRIZE_GB}GB — customers are promised "${form.reward_text}".`);
    }
    setNewPrize({ label: "", network: newPrize.network, package_size: "", weight: "1", stock: "" });
    loadPrizesAndOpens(selectedId);
  };

  const updatePrize = async (id: string, patch: Partial<Prize>) => {
    const { error } = await supabase.from("mystery_box_prizes").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    if (selectedId) loadPrizesAndOpens(selectedId);
  };

  const removePrize = async (id: string) => {
    const { error } = await supabase.from("mystery_box_prizes").delete().eq("id", id);
    if (error) toast.error(error.message);
    if (selectedId) loadPrizesAndOpens(selectedId);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-sm text-muted-foreground">Loading Mystery Box campaigns...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Gift className="h-6 w-6 text-amber-500" /> Mystery Box
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customers earn a box by completing a number of delivered data orders in one day (resets at midnight Ghana time),
          then open it for a random prize from the pool. Only the newest active campaign is shown to customers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Campaign list */}
        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Campaigns</CardTitle>
            <Button size="sm" variant="outline" onClick={() => selectCampaign(null)}>
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {campaigns.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
            {campaigns.map((c) => {
              const now = Date.now();
              const live = c.is_active && new Date(c.starts_at).getTime() <= now && new Date(c.ends_at).getTime() > now;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCampaign(c)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${selectedId === c.id ? "border-primary bg-muted" : "border-border"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{c.title}</span>
                    {live ? <Badge className="bg-emerald-600 text-white">Live</Badge> : <Badge variant="secondary">{c.is_active ? "Scheduled/ended" : "Off"}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(c.starts_at).toLocaleDateString()} – {new Date(c.ends_at).toLocaleDateString()} · {c.orders_per_box} orders/day · {c.boxes_per_day} box{c.boxes_per_day === 1 ? "" : "es"}/day
                  </p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Campaign form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{selectedId ? "Edit campaign" : "New campaign"}</CardTitle>
            <CardDescription>Only delivered data orders placed today (inside the campaign dates) count. Free and prize orders never count.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mb-title">Title</Label>
                <Input id="mb-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mb-desc">Internal note (optional)</Label>
                <Textarea id="mb-desc" rows={2} value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-start">Starts</Label>
                <Input id="mb-start" type="datetime-local" value={toLocalInput(form.starts_at)} onChange={(e) => setForm({ ...form, starts_at: new Date(e.target.value).toISOString() })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-end">Ends</Label>
                <Input id="mb-end" type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => setForm({ ...form, ends_at: new Date(e.target.value).toISOString() })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-per">Orders needed per day</Label>
                <Input id="mb-per" type="number" min={1} value={form.orders_per_box} onChange={(e) => setForm({ ...form, orders_per_box: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-max">Boxes per customer per day</Label>
                <Input id="mb-max" type="number" min={1} value={form.boxes_per_day} onChange={(e) => setForm({ ...form, boxes_per_day: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-reward">Reward wording</Label>
                <Input id="mb-reward" placeholder="5GB or more" value={form.reward_text} onChange={(e) => setForm({ ...form, reward_text: e.target.value })} />
                <p className="text-xs text-muted-foreground">Shown as "Complete 4 more orders today to earn …"</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-min">Minimum order amount (GH₵)</Label>
                <Input id="mb-min" type="number" min={0} step="0.01" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-image">Box image (optional)</Label>
                <label htmlFor="mb-image" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-muted">
                  <Upload className="h-4 w-4" /> {imageFile ? imageFile.name : form.image_url ? "Replace image" : "Upload image"}
                </label>
                <input id="mb-image" type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Popup bullet points</Label>
              {form.bullets.map((b, i) => (
                <Input
                  key={i}
                  aria-label={`Bullet ${i + 1}`}
                  value={b}
                  onChange={(e) => setForm({ ...form, bullets: form.bullets.map((x, j) => (j === i ? e.target.value : x)) })}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /> Active
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                  <Eye className="mr-1 h-4 w-4" /> Preview
                </Button>
                <Button onClick={saveCampaign} disabled={saving}>
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  {selectedId ? "Save campaign" : "Create campaign"}
                </Button>
              </div>
            </div>
            <MysteryBoxPreview
              open={previewOpen}
              onOpenChange={setPreviewOpen}
              campaign={{ ...form, image_url: previewImage ?? form.image_url }}
              samplePrize={previewSamplePrize(prizes)}
            />
          </CardContent>
        </Card>
      </div>

      {selectedId && (
        <>
          {/* Prize pool */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prize pool</CardTitle>
              <CardDescription>
                Each open picks one active prize with stock left, weighted by its weight. Blank stock means unlimited.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {prizes.length === 0 && <p className="text-sm text-muted-foreground">No prizes yet — customers can't open boxes until you add one.</p>}
              {prizes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Prize</th>
                        <th className="py-2 pr-3">Bundle</th>
                        <th className="py-2 pr-3">Weight</th>
                        <th className="py-2 pr-3">Odds</th>
                        <th className="py-2 pr-3">Stock left</th>
                        <th className="py-2 pr-3">Active</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {prizes.map((p, i) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="py-2 pr-3 font-medium text-foreground">{p.label}</td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {p.network} {p.package_size} {p.is_mashup && <Badge variant="secondary">Mashup</Badge>}{" "}
                            {isUnderMinimum(p.package_size) && <Badge variant="destructive">Under {MIN_PRIZE_GB}GB</Badge>}
                          </td>
                          <td className="py-2 pr-3">
                            <Input
                              type="number"
                              min={1}
                              key={`${p.id}-w-${p.weight}`}
                              defaultValue={p.weight}
                              className="h-8 w-20"
                              onBlur={(e) => {
                                const w = Number(e.target.value);
                                if (Number.isInteger(w) && w >= 1 && w !== p.weight) updatePrize(p.id, { weight: w });
                              }}
                            />
                          </td>
                          <td className="py-2 pr-3 text-foreground">{odds[i]}%</td>
                          <td className="py-2 pr-3">
                            <Input
                              type="number"
                              min={0}
                              placeholder="∞"
                              key={`${p.id}-s-${p.stock_remaining}`}
                              defaultValue={p.stock_remaining ?? ""}
                              className="h-8 w-20"
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const s = raw === "" ? null : Number(raw);
                                if (s !== null && (!Number.isInteger(s) || s < 0)) return;
                                if (s !== p.stock_remaining) updatePrize(p.id, { stock_remaining: s, stock_total: s === null ? null : Math.max(s, p.stock_total ?? 0) });
                              }}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <Switch checked={p.is_active} onCheckedChange={(v) => updatePrize(p.id, { is_active: v })} />
                          </td>
                          <td className="py-2 text-right">
                            <Button size="icon" variant="ghost" aria-label={`Remove ${p.label}`} onClick={() => removePrize(p.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-6">
                <Input className="sm:col-span-2" placeholder="Label, e.g. 1GB MTN Data" value={newPrize.label} onChange={(e) => setNewPrize({ ...newPrize, label: e.target.value })} />
                <select
                  aria-label="Network"
                  className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  value={newPrize.network}
                  onChange={(e) => setNewPrize({ ...newPrize, network: e.target.value, package_size: "" })}
                >
                  <option value="">Network</option>
                  {networks.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <select
                  aria-label="Package"
                  className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  value={newPrize.package_size}
                  onChange={(e) => setNewPrize({ ...newPrize, package_size: e.target.value })}
                  disabled={!newPrize.network}
                >
                  <option value="">Package</option>
                  {packagesForNetwork.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <Input type="number" min={1} placeholder="Weight" aria-label="Weight" value={newPrize.weight} onChange={(e) => setNewPrize({ ...newPrize, weight: e.target.value })} />
                <div className="flex gap-2">
                  <Input type="number" min={0} placeholder="Stock ∞" aria-label="Stock" value={newPrize.stock} onChange={(e) => setNewPrize({ ...newPrize, stock: e.target.value })} />
                  <Button onClick={addPrize} aria-label="Add prize">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Opens */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent openings</CardTitle>
              <CardDescription>Newest 50. Failed deliveries can be retried from Orders (type "Mystery Box").</CardDescription>
            </CardHeader>
            <CardContent>
              {opens.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has opened a box yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">When</th>
                        <th className="py-2 pr-3">Customer</th>
                        <th className="py-2 pr-3">Sent to</th>
                        <th className="py-2 pr-3">Box</th>
                        <th className="py-2 pr-3">Prize</th>
                        <th className="py-2">Delivery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opens.map((o) => (
                        <tr key={o.id} className="border-t border-border">
                          <td className="py-2 pr-3 text-muted-foreground">{new Date(o.created_at).toLocaleString()}</td>
                          <td className="py-2 pr-3 text-foreground">{o.name || o.user_id.slice(0, 8)}</td>
                          <td className="py-2 pr-3 text-foreground">{o.recipient_phone}</td>
                          <td className="py-2 pr-3 text-foreground">#{o.box_number}</td>
                          <td className="py-2 pr-3 text-foreground">{o.prize_label}</td>
                          <td className="py-2">
                            <Badge variant={o.status === "fulfilled" ? "default" : o.status === "fulfillment_failed" ? "destructive" : "secondary"}>
                              {o.status || "unknown"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
