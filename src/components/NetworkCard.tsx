import { Signal } from "lucide-react";

interface NetworkCardProps {
  name: string;
  color: string;
  selected?: boolean;
  onClick?: () => void;
}

const NetworkCard = ({ name, color, selected, onClick }: NetworkCardProps) => (
  <button
    onClick={onClick}
    className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border transition-all duration-200 ${
      selected
        ? "border-primary bg-primary/10 glow-yellow"
        : "border-border bg-card hover:border-primary/30 hover:bg-secondary"
    }`}
  >
    <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: color + "20", color }}>
      <Signal className="w-7 h-7" />
    </div>
    <span className="font-display font-semibold text-sm">{name}</span>
  </button>
);

export default NetworkCard;
