import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RefreshCw, MessageSquare, Edit2, Save, X, Info } from "lucide-react";
import { format } from "date-fns";

interface SmsTemplate {
  id: string;
  key: string;
  label: string;
  body: string;
  is_active: boolean;
  updated_at: string;
}

const VARIABLES: Record<string, string[]> = {
  payment_success:    ["{amount}", "{package}", "{phone}", "{network}", "{est_delivery}"],
  order_fulfilled:    ["{network}", "{package}", "{phone}", "{est_delivery}"],
  order_failed:       ["{package}", "{phone}", "{amount}"],
  order_refunded:     ["{amount}"],
  low_balance:        [],
  withdrawal_approved:["{amount}", "{momo_number}", "{momo_network}"],
  error_spike_alert:  ["{count}"],
};

export default function AdminSmsTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("sms_templates").select("*").not("key", "is", null).order("label");
    if (!error) setTemplates((data as SmsTemplate[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const startEdit = (t: SmsTemplate) => {
    setEditingId(t.id);
    setEditBody(t.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const handleSave = async (t: SmsTemplate) => {
    if (!editBody.trim()) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("sms_templates")
      .update({ body: editBody.trim(), updated_at: new Date().toISOString() })
      .eq("id", t.id);

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      setTemplates((prev) => prev.map((x) => x.id === t.id ? { ...x, body: editBody.trim(), updated_at: new Date().toISOString() } : x));
      toast({ title: "Template saved" });
      cancelEdit();
      // Log change
      await (supabase as any).from("system_logs").insert({
        level: "info", source: "admin", event: "sms_template.updated",
        message: `SMS template "${t.label}" updated`,
        data: { key: t.key, new_body: editBody.trim() },
      });
    }
    setSaving(false);
  };

  const handleToggle = async (t: SmsTemplate) => {
    const { error } = await (supabase as any)
      .from("sms_templates").update({ is_active: !t.is_active }).eq("id", t.id);
    if (!error) setTemplates((prev) => prev.map((x) => x.id === t.id ? { ...x, is_active: !t.is_active } : x));
  };

  const charCount = (body: string) => body.length;
  const smsCount = (body: string) => Math.ceil(body.length / 160);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">SMS Templates</h1>
          <p className="text-white/40 text-sm mt-1">Edit message templates without deploying code</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={fetchTemplates}
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Variable legend */}
      <Card className="bg-primary/5 border-primary/20 p-4">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-primary text-sm font-bold">Template Variables</p>
            <p className="text-white/40 text-xs mt-1">
              Use placeholders like <code className="bg-white/10 px-1 rounded text-white/60">{"{amount}"}</code> — they are replaced with real values when the SMS is sent. Available variables are shown on each template.
            </p>
          </div>
        </div>
      </Card>

      {/* Templates */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-white/20 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((t) => {
            const isEditing = editingId === t.id;
            const vars = VARIABLES[t.key] || [];

            return (
              <Card key={t.id} className={cn(
                "border p-5 space-y-3 transition-all",
                !t.is_active ? "opacity-50 border-white/5 bg-white/[0.01]" : "border-white/10 bg-white/[0.03]",
                isEditing && "border-primary/30 bg-primary/[0.03]"
              )}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className={cn("w-4 h-4 shrink-0", isEditing ? "text-primary" : "text-white/30")} />
                    <div>
                      <p className="text-white font-black text-sm">{t.label}</p>
                      <p className="text-white/30 text-[10px] font-mono">{t.key}</p>
                    </div>
                    <Badge className={cn("text-[9px] h-4 px-1.5 border font-black uppercase",
                      t.is_active ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-white/5 text-white/20 border-white/10")}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => handleToggle(t)} title={t.is_active ? "Disable" : "Enable"}
                      className="text-white/20 hover:text-white/60 transition-colors text-xs font-bold">
                      {t.is_active ? "Disable" : "Enable"}
                    </button>
                    {!isEditing && (
                      <button type="button" onClick={() => startEdit(t)}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Variables */}
                {vars.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {vars.map((v) => (
                      <button type="button" key={v} onClick={() => isEditing && setEditBody((b) => b + v)}
                        title={isEditing ? `Insert ${v}` : undefined}
                        className={cn("text-[10px] px-2 py-0.5 rounded-md border font-mono",
                          isEditing ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 cursor-pointer" : "bg-white/5 text-white/30 border-white/10 cursor-default")}>
                        {v}
                      </button>
                    ))}
                    {isEditing && <p className="text-white/20 text-[10px] self-center">← click to insert</p>}
                  </div>
                )}

                {/* Body / Editor */}
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={4}
                      className="w-full bg-black/30 border border-primary/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50 resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <p className={cn("text-[11px]", charCount(editBody) > 320 ? "text-red-400" : "text-white/30")}>
                        {charCount(editBody)} chars · {smsCount(editBody)} SMS segment{smsCount(editBody) > 1 ? "s" : ""}
                      </p>
                      <div className="flex gap-2">
                        <button type="button" onClick={cancelEdit}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white/40 hover:bg-white/5 text-xs font-bold transition-colors">
                          <X className="w-3 h-3" /> Cancel
                        </button>
                        <button type="button" onClick={() => handleSave(t)} disabled={saving}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-xs font-bold transition-colors disabled:opacity-50">
                          <Save className="w-3 h-3" /> {saving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-black/20 rounded-lg px-3 py-2.5">
                    <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{t.body}</p>
                    <p className="text-white/20 text-[10px] mt-2">
                      {charCount(t.body)} chars · Updated {format(new Date(t.updated_at), "MMM dd, yyyy")}
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
