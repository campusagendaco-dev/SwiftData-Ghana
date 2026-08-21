import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MessageCircle, Copy, Check, Share2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OrderReceipt {
  id: string;
  network: string;
  package_size: string;
  customer_phone: string;
  customer_name?: string | null;
  amount: number;
  created_at: string;
  status: string;
  store_name?: string;
}

interface WhatsAppReceiptModalProps {
  order: OrderReceipt | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function WhatsAppReceiptModal({ order, isOpen, onClose }: WhatsAppReceiptModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  if (!order) return null;

  const cleanPhone = (order.customer_phone || "").replace(/\D+/g, "");
  const waRecipient = cleanPhone.startsWith("0") ? `233${cleanPhone.slice(1)}` : cleanPhone;
  const storeSignature = order.store_name || "SwiftData Agent Hub";

  const messageText = `*✅ DELIVERY CONFIRMATION RECEIPT*\n\n` +
    `Hello *${order.customer_name || "Valued Customer"}*,\n` +
    `Your data bundle order has been *successfully delivered*! 🎉\n\n` +
    `📦 *Package:* ${order.network} ${order.package_size}\n` +
    `📱 *Recipient:* ${order.customer_phone}\n` +
    `💰 *Amount:* GH₵ ${Number(order.amount).toFixed(2)}\n` +
    `🔖 *Order Reference:* #${order.id.slice(0, 8)}\n` +
    `⏰ *Time:* ${new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\n\n` +
    `Thank you for buying with *${storeSignature}*! 🚀\n` +
    `_Fast, Affordable & Instant 24/7 Delivery._`;

  const waUrl = `https://wa.me/${waRecipient}?text=${encodeURIComponent(messageText)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    toast({ title: "Receipt Copied! 📋", description: "Ready to paste into WhatsApp." });
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-black text-foreground">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" /> WhatsApp Proof of Delivery
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Share an official delivery confirmation receipt directly to your customer.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 rounded-xl bg-secondary/50 border border-border text-xs space-y-2 font-mono whitespace-pre-wrap leading-relaxed text-foreground select-all">
          {messageText}
        </div>

        <DialogFooter className="flex-row sm:justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="rounded-xl text-xs font-bold gap-1.5 h-10 border-border"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy Receipt"}
          </Button>

          <Button
            type="button"
            onClick={() => {
              window.open(waUrl, "_blank");
              onClose();
            }}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs gap-1.5 h-10 shadow-md border-0"
          >
            <MessageCircle className="w-4 h-4 fill-white" /> Send on WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
