import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Zap,
  Wallet,
  Settings,
  Sun,
  Moon,
  MessageSquare,
  Activity,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  HelpCircle,
  TrendingUp,
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function CommandPalette({ open, setOpen }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { isDark, toggleDark } = useAppTheme();
  const { toast } = useToast();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const runCommand = React.useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, [setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <div className="relative border-b border-border bg-[#09090b]/80 backdrop-blur-md px-3 flex items-center">
        <Sparkles className="w-4 h-4 text-amber-500 animate-pulse mr-2" />
        <span className="text-[10px] font-black text-amber-400/90 uppercase tracking-widest leading-none mr-2">PRO TERMINAL</span>
      </div>
      <CommandInput 
        placeholder="Type a command or search actions... (e.g. /buy, /theme, /wallet)" 
        className="font-medium text-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none border-none py-4 bg-transparent text-white placeholder:text-white/30"
      />
      <CommandList className="max-h-[350px] overflow-y-auto bg-[#09090b]/90 backdrop-blur-md text-slate-200">
        <CommandEmpty className="py-6 text-center text-xs text-slate-500 font-medium">No actions found.</CommandEmpty>
        
        {/* QUICK DATA FULFILLMENT */}
        <CommandGroup heading="⚡ Data & Airtime Vending">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/buy-data/mtn"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Buy MTN Data Bundle</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">/buy mtn</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/buy-data/telecel"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <Zap className="w-4 h-4 text-red-500 shrink-0" />
            <span>Buy Telecel Data Bundle</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">/buy telecel</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/buy-data/airteltigo"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <Zap className="w-4 h-4 text-blue-500 shrink-0" />
            <span>Buy AirtelTigo Data Bundle</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">/buy airteltigo</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/buy-airtime"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Top Up Mobile Airtime</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">/airtime</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        
        <CommandSeparator className="border-white/5" />

        {/* FINANCIAL OPERATIONS */}
        <CommandGroup heading="💰 Financial Operations">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/wallet"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <Wallet className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Fund Wallet & View Statements</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded">/wallet</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/withdrawals"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Agent Earnings Withdrawals</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">/withdraw</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator className="border-white/5" />

        {/* PRESET SYSTEMS & DIALS */}
        <CommandGroup heading="⚙️ Management & Controls">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/my-store"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <Settings className="w-4 h-4 text-purple-400 shrink-0" />
            <span>Store Settings & Branding</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">/store</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => {
              toggleDark();
              toast({ title: isDark ? "☀️ Light mode activated" : "🌙 Dark mode activated" });
            })}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400 shrink-0" /> : <Moon className="w-4 h-4 text-slate-400 shrink-0" />}
            <span>Toggle Visual Theme</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">/theme</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator className="border-white/5" />

        {/* AI CONCIERGE & SUPPORT */}
        <CommandGroup heading="✨ AI Support">
          <CommandItem
            onSelect={() => runCommand(() => {
              // Programmatically trigger Ama AI concierge panel open
              const amaTrigger = document.querySelector(".fixed.bottom-10.right-10 button, .fixed.bottom-6.right-4 button") as HTMLButtonElement;
              if (amaTrigger) amaTrigger.click();
              toast({ title: "✨ Ama is waking up..." });
            })}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <MessageSquare className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Wake Ama AI Assistant</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">/support</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard/report-issue"))}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/5 transition-all text-xs font-bold text-slate-300"
          >
            <HelpCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Report Outage / Issue</span>
            <CommandShortcut className="text-[9px] font-black uppercase text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">/report</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
