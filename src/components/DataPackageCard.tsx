import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";

interface DataPackageCardProps {
  size: string;
  price: string;
  validity: string;
  popular?: boolean;
  isSelected?: boolean;
  phone?: string;
  onPhoneChange?: (val: string) => void;
  isPhoneValid?: boolean;
  fee?: number;
  total?: number;
  onBuy?: () => void;
  onSelect?: () => void;
  buying?: boolean;
}

const DataPackageCard = ({
  size,
  price,
  validity,
  popular,
  isSelected,
  phone = "",
  onPhoneChange,
  isPhoneValid,
  fee,
  total,
  onBuy,
  onSelect,
  buying,
}: DataPackageCardProps) => (
  <div
    className={`relative rounded-xl border transition-all duration-200 ${
      isSelected
        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
        : popular
        ? "border-primary/40 bg-primary/5 glow-yellow"
        : "border-border bg-card hover:border-primary/40"
    }`}
  >
    {popular && (
      <span className="absolute -top-2.5 left-4 bg-primary text-primary-foreground text-xs font-semibold px-3 py-0.5 rounded-full">
        Popular
      </span>
    )}

    {/* Package info — clickable to select */}
    <button
      type="button"
      onClick={onSelect}
      className="w-full p-5 text-left"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-lg text-foreground">{size}</h3>
          <p className="text-sm text-muted-foreground">{validity}</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="font-display font-bold text-xl text-primary">GH₵{price}</p>
          {isSelected ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </div>
    </button>

    {/* Expanded: phone input + buy button */}
    {isSelected && (
      <div className="px-5 pb-5 pt-0 border-t border-border/50">
        <label className="text-sm font-medium text-foreground block mt-4 mb-2">
          Recipient Phone Number
        </label>
        <Input
          placeholder="e.g. 0241234567"
          className="bg-background"
          value={phone}
          onChange={(e) => onPhoneChange?.(e.target.value)}
          maxLength={10}
        />
        {isPhoneValid && fee !== undefined && total !== undefined && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 text-sm space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Package price</span>
              <span>GH₵{price}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Transaction fee</span>
              <span>GH₵{fee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1">
              <span>Total</span>
              <span>GH₵{total.toFixed(2)}</span>
            </div>
          </div>
        )}
        <Button
          className="w-full mt-3"
          disabled={!isPhoneValid || buying}
          onClick={onBuy}
        >
          {buying ? "Processing..." : `Buy ${size} — GH₵${total !== undefined && isPhoneValid ? total.toFixed(2) : price}`}
        </Button>
      </div>
    )}
  </div>
);

export default DataPackageCard;
