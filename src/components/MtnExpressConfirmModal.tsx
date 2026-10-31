import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Phone, ShieldAlert, X } from "lucide-react";

interface MtnExpressConfirmModalProps {
  open: boolean;
  recipientPhone: string;
  packageSize?: string;
  amount?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const MtnExpressConfirmModal: React.FC<MtnExpressConfirmModalProps> = ({
  open,
  recipientPhone,
  packageSize,
  amount,
  onConfirm,
  onCancel,
}) => {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100001] flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md rounded-3xl border border-amber-500/30 bg-[#111116] text-white p-6 shadow-2xl space-y-4 z-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight text-white">
                MTN Express Order Notice
              </h3>
              <p className="text-xs text-amber-400/90 font-semibold">
                Delivery &amp; End-of-Day Refund Policy
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation notice"
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Recipient Summary */}
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Phone className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-white/50">
                Verify Recipient Carefully
              </p>
              <p className="text-base font-black tracking-wide text-amber-300 font-mono">
                {recipientPhone}
              </p>
            </div>
          </div>
          {(packageSize || amount !== undefined) && (
            <div className="text-right">
              {packageSize && (
                <p className="text-xs font-black text-white">{packageSize}</p>
              )}
              {amount !== undefined && amount > 0 && (
                <p className="text-xs font-bold text-emerald-400">
                  GH₵ {amount.toFixed(2)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Required Notice Body */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 space-y-2.5 text-xs text-white/80 leading-relaxed">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-white">No Pre-Verification Check:</strong>{" "}
              MTN Express orders are sent without a number-verification check.{" "}
              <strong className="text-amber-300">
                Submission does not guarantee delivery.
              </strong>
            </p>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-white">End-of-Day Refunds:</strong> Failed
              orders are reviewed and their charges are refunded to the
              originating wallet at the end of the day (a confirmed rejection
              may be refunded earlier). A reseller must pass any refund on to
              its own customer.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-white">Avoid Duplicate Orders:</strong>{" "}
              Please check the recipient number carefully and{" "}
              <strong className="text-amber-300">
                avoid reordering while an order is processing.
              </strong>
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-2xl font-bold text-xs bg-white/10 hover:bg-white/15 text-white/70 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-[1.8] h-11 rounded-2xl font-black text-xs text-black bg-amber-400 hover:bg-amber-300 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98]"
          >
            <CheckCircle2 className="w-4 h-4" />I Understand &amp; Confirm Order
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

