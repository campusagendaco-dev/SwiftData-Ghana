import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MessageCircle, Copy, Check, Send, Loader2, FileText, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export interface OrderReceipt {
  id: string;
  network: string;
  package_size: string;
  customer_phone: string;
  customer_name?: string | null;
  amount: number;
  created_at: string;
  status: string;
  store_name?: string;
  agent_id?: string;
}

interface WhatsAppReceiptModalProps {
  order: OrderReceipt | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function WhatsAppReceiptModal({ order, isOpen, onClose }: WhatsAppReceiptModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [sendingSms, setSendingSms] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [customText, setCustomText] = React.useState("");

  const cleanPhone = (order?.customer_phone || "").replace(/\D+/g, "");
  const waRecipient = cleanPhone.startsWith("0") ? `233${cleanPhone.slice(1)}` : cleanPhone;
  const storeSignature = order?.store_name || "SwiftData Hub";

  const defaultReceiptText = React.useMemo(() => {
    if (!order) return "";
    return `*✅ DELIVERY CONFIRMATION RECEIPT*\n\n` +
      `Hello *${order.customer_name || "Valued Customer"}*,\n` +
      `Your data bundle order has been *successfully delivered*! 🎉\n\n` +
      `📦 *Package:* ${order.network} ${order.package_size}\n` +
      `📱 *Recipient:* ${order.customer_phone}\n` +
      `💰 *Amount:* GH₵ ${Number(order.amount || 0).toFixed(2)}\n` +
      `🔖 *Order Reference:* #${(order.id || "").slice(0, 8)}\n` +
      `⏰ *Time:* ${order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}\n\n` +
      `Thank you for buying with *${storeSignature}*! 🚀\n` +
      `_Fast, Affordable & Instant 24/7 Delivery._`;
  }, [order, storeSignature]);

  React.useEffect(() => {
    setCustomText(defaultReceiptText);
    setIsEditing(false);
  }, [order?.id, defaultReceiptText]);

  if (!order) return null;

  const activeText = customText || defaultReceiptText;
  const waUrl = `https://wa.me/${waRecipient}?text=${encodeURIComponent(activeText)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeText);
    setCopied(true);
    toast({ title: "Receipt Copied! 📋", description: "Receipt copied to clipboard." });
    setTimeout(() => setCopied(false), 2500);
  };

  const handleResendSms = async () => {
    if (!order.customer_phone) {
      toast({ title: "No Phone Number", description: "This order does not have a recipient phone number.", variant: "destructive" });
      return;
    }
    setSendingSms(true);
    try {
      // Clean SMS plain text version for SMS gateway with clear order status
      const statusLabel = order.status === "fulfilled" ? "FULFILLED & DELIVERED 🎉" :
                          order.status === "processing" ? "PROCESSING ⏳" :
                          order.status === "pending" ? "PENDING ⏳" :
                          order.status === "fulfillment_failed" || order.status === "failed" ? "FAILED ❌" :
                          order.status.toUpperCase();

      const cleanSmsText = `SwiftData Alert: Order #${order.id.slice(0, 8).toUpperCase()} for ${order.customer_phone} (${order.network} ${order.package_size}, GHS ${Number(order.amount).toFixed(2)}) Status: [${statusLabel}]. Thank you for choosing SwiftData!`;
      
      const { data, error } = await supabase.functions.invoke("send-order-sms", {
        body: {
          phone: order.customer_phone,
          action: "custom",
          custom_message: cleanSmsText,
          order_id: order.id,
          amount: order.amount,
          package_size: order.package_size,
          network: order.network,
          agent_id: order.agent_id,
          status: order.status,
        },
      });

      if (error) throw error;

      toast({
        title: "SMS Resent Successfully! 📱",
        description: `Receipt SMS sent directly to ${order.customer_phone}.`,
      });
    } catch (err: any) {
      console.error("Resend SMS error:", err);
      toast({
        title: "Failed to Send SMS",
        description: err.message || "An error occurred while sending SMS.",
        variant: "destructive",
      });
    } finally {
      setSendingSms(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-2xl bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-base font-black text-foreground">
            <span className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" /> Order Receipt & SMS
            </span>
            <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10 uppercase">
              {order.status}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Copy receipt details, share via WhatsApp, or resend SMS directly to the recipient.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-muted-foreground">Receipt Content</span>
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="text-[11px] font-semibold text-amber-400 hover:underline"
            >
              {isEditing ? "Done Editing" : "Edit Text"}
            </button>
          </div>

          {isEditing ? (
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={8}
              className="w-full p-3 rounded-xl bg-secondary/70 border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
            />
          ) : (
            <div className="p-4 rounded-xl bg-secondary/50 border border-border text-xs space-y-2 font-mono whitespace-pre-wrap leading-relaxed text-foreground select-all max-h-[220px] overflow-y-auto">
              {activeText}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="w-full sm:w-auto rounded-xl text-xs font-bold gap-1.5 h-10 border-border"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy Receipt"}
          </Button>

          <Button
            type="button"
            disabled={sendingSms}
            onClick={handleResendSms}
            className="w-full sm:w-auto rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs gap-1.5 h-10 shadow-md border-0"
          >
            {sendingSms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
            {sendingSms ? "Sending SMS..." : "Resend SMS"}
          </Button>

          <Button
            type="button"
            onClick={() => {
              window.open(waUrl, "_blank");
              onClose();
            }}
            className="w-full sm:w-auto rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs gap-1.5 h-10 shadow-md border-0"
          >
            <MessageCircle className="w-4 h-4 fill-white" /> WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
