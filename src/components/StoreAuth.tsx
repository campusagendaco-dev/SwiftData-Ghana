import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { X, ArrowRight, Eye, EyeOff, Loader2, Store, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StoreAuthProps {
  isOpen: boolean;
  onClose: () => void;
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  agentId: string; // The store owner's user_id
}

const StoreAuth = ({
  isOpen,
  onClose,
  storeName,
  logoUrl,
  primaryColor = "#f59e0b",
  agentId,
}: StoreAuthProps) => {
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signUp, signIn } = useAuth();
  const { toast } = useToast();

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        if (!fullName.trim()) {
          toast({ title: "Please enter your full name", variant: "destructive" });
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          toast({ title: "Passwords do not match", variant: "destructive" });
          setLoading(false);
          return;
        }

        const { error } = await signUp(email, password, fullName);
        if (error) {
          toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
        } else {
          // Force sign in immediately
          const { error: signInError } = await signIn(email, password);
          if (!signInError) {
            // Update newly created profile with this parent agent ID for scoping!
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await supabase
                .from("profiles")
                .update({ parent_agent_id: agentId })
                .eq("user_id", user.id);
            }
            toast({ title: "Welcome!", description: `Account created successfully on ${storeName}!` });
            resetForm();
            onClose();
            // Refresh to update state
            window.location.reload();
          }
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
        } else {
          toast({ title: "Success!", description: `Welcome back to ${storeName}!` });
          resetForm();
          onClose();
          // Refresh to update state and show customer page with logged-in credentials
          window.location.reload();
        }
      }
    } catch (err: any) {
      toast({ title: "Auth Error", description: err.message || "An unexpected error occurred", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[250] flex items-start sm:items-center justify-center sm:p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-[8px]"
          onClick={onClose}
        />

        {/* Modal panel */}
        <motion.div
          initial={{ opacity: 0, y: "-100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "-100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 350 }}
          className="relative w-full sm:max-w-md overflow-y-auto max-h-[100vh] sm:max-h-[95vh] rounded-b-3xl sm:rounded-3xl shadow-2xl border backdrop-blur-md z-10"
          style={{ 
            background: "#08080c", 
            borderColor: `${primaryColor}33`,
            boxShadow: `0 10px 40px -10px ${primaryColor}15`
          }}
        >
          {/* Header decoration */}
          <div className="absolute top-0 inset-x-0 h-1" style={{ background: `linear-gradient(90deg, transparent, ${primaryColor}, transparent)` }} />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-6 sm:p-8">
            {/* Logo area */}
            <div className="flex flex-col items-center justify-center text-center mb-6">
              <div 
                className="w-12 h-12 rounded-2xl overflow-hidden bg-white flex items-center justify-center shadow-lg mb-3"
                style={{ border: `1.5px solid ${primaryColor}` }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={storeName} className="w-full h-full object-contain" />
                ) : (
                  <Store className="w-6 h-6" style={{ color: primaryColor }} />
                )}
              </div>
              <h2 className="text-white text-xl font-black tracking-tight">{storeName}</h2>
              <p className="text-white/40 text-xs mt-1 font-semibold uppercase tracking-wider">
                {isSignUp ? "Create a Customer Account" : "Access Customer Dashboard"}
              </p>
            </div>

            {/* Tab selector */}
            <div className="flex p-1 bg-white/5 rounded-2xl mb-6 border border-white/5 relative">
              <button
                type="button"
                onClick={() => { setIsSignUp(false); resetForm(); }}
                className={`flex-1 relative z-10 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-colors duration-300 ${
                  !isSignUp ? "text-black" : "text-white/50 hover:text-white"
                }`}
                style={{ color: !isSignUp ? "#000000" : undefined }}
              >
                Sign In
                {!isSignUp && (
                  <motion.div
                    layoutId="activeStoreTab"
                    className="absolute inset-0 rounded-xl shadow-md z-[-1]"
                    style={{ backgroundColor: primaryColor }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => { setIsSignUp(true); resetForm(); }}
                className={`flex-1 relative z-10 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-colors duration-300 ${
                  isSignUp ? "text-black" : "text-white/50 hover:text-white"
                }`}
                style={{ color: isSignUp ? "#000000" : undefined }}
              >
                Register
                {isSignUp && (
                  <motion.div
                    layoutId="activeStoreTab"
                    className="absolute inset-0 rounded-xl shadow-md z-[-1]"
                    style={{ backgroundColor: primaryColor }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
              </button>
            </div>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={isSignUp ? "signup" : "signin"}
                  initial={{ opacity: 0, x: isSignUp ? 15 : -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: isSignUp ? -15 : 15 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  {isSignUp && (
                    <div>
                      <Label htmlFor="storeFullName" className="text-white/60 text-xs font-bold">Full Name</Label>
                      <Input
                        id="storeFullName"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe"
                        className="mt-1 bg-white/5 h-11 border-white/5 text-white placeholder:text-white/20 focus-visible:border-white/10 rounded-xl transition-all"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="storeEmail" className="text-white/60 text-xs font-bold">Email Address</Label>
                    <Input
                      id="storeEmail"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="mt-1 bg-white/5 h-11 border-white/5 text-white placeholder:text-white/20 focus-visible:border-white/10 rounded-xl transition-all"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="storePassword" className="text-white/60 text-xs font-bold">Password</Label>
                    <div className="relative mt-1">
                      <Input
                        id="storePassword"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="bg-white/5 pr-10 h-11 border-white/5 text-white placeholder:text-white/20 focus-visible:border-white/10 rounded-xl transition-all"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {isSignUp && (
                    <div>
                      <Label htmlFor="storeConfirmPassword" className="text-white/60 text-xs font-bold">Confirm Password</Label>
                      <Input
                        id="storeConfirmPassword"
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="mt-1 bg-white/5 h-11 border-white/5 text-white placeholder:text-white/20 focus-visible:border-white/10 rounded-xl transition-all"
                        required
                        minLength={6}
                      />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              <div className="pt-2">
                <Button 
                  type="submit" 
                  className="w-full h-12 text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] border-0" 
                  disabled={loading}
                  style={{ 
                    backgroundColor: primaryColor,
                    color: "#000000",
                    boxShadow: `0 12px 24px -6px ${primaryColor}44`
                  }}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>{isSignUp ? "Create Account" : "Access Site"}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-white/20 text-[10px] uppercase font-bold tracking-widest pt-4 border-t border-white/5">
              <Lock className="w-3 h-3" />
              <span>100% Encrypted & Secure Portal</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default StoreAuth;
