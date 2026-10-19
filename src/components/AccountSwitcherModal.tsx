import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth, SavedAccount } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Check,
  Plus,
  Trash2,
  LogOut,
  ShieldCheck,
  Store,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export const AccountSwitcherModal = () => {
  const {
    user,
    profile,
    isAdmin,
    savedAccounts,
    switchAccount,
    addAccount,
    removeSavedAccount,
    signOutAll,
    signOut,
    isAccountSwitcherOpen,
    setIsAccountSwitcherOpen,
  } = useAuth();

  const { isDark } = useAppTheme();

  // Add account form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  // Switching & Re-authentication states
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [expiredAccount, setExpiredAccount] = useState<SavedAccount | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [showReauthPassword, setShowReauthPassword] = useState(false);
  const [isReauthing, setIsReauthing] = useState(false);

  // Sign out all confirmation
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  // Filter accounts: current vs other saved accounts
  const currentUserId = user?.id;
  const otherAccounts = savedAccounts.filter((acc) => acc.userId !== currentUserId);

  const handleSwitch = async (targetAccount: SavedAccount) => {
    if (targetAccount.userId === currentUserId) {
      setIsAccountSwitcherOpen(false);
      return;
    }

    // If account has no valid session or was previously expired, open inline reconnect directly
    if (!targetAccount.session?.access_token || !targetAccount.session?.refresh_token) {
      setExpiredAccount(targetAccount);
      setReauthPassword("");
      toast.info(`Session expired for ${targetAccount.email}. Please enter your password.`);
      return;
    }

    setSwitchingId(targetAccount.userId);
    setExpiredAccount(null);

    try {
      const res = await switchAccount(targetAccount.userId);
      if (res.success) {
        toast.success(`Switched to ${targetAccount.fullName || targetAccount.email}`);
        setIsAccountSwitcherOpen(false);
      } else {
        if (res.expiredEmail) {
          setExpiredAccount(targetAccount);
          setReauthPassword("");
          toast.error("Session expired for this account. Please enter your password to reconnect.");
        } else {
          toast.error(res.error || "Failed to switch account.");
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to switch account.");
    } finally {
      setSwitchingId(null);
    }
  };

  const handleAddAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword.trim()) {
      toast.error("Please enter email and password.");
      return;
    }

    setIsAdding(true);
    try {
      const res = await addAccount(newEmail.trim(), newPassword);
      if (res.success) {
        toast.success("Account connected and switched successfully!");
        setNewEmail("");
        setNewPassword("");
        setShowAddForm(false);
        setIsAccountSwitcherOpen(false);
      } else {
        toast.error(res.error || "Could not log into this account. Please verify credentials.");
      }
    } catch (err: any) {
      toast.error(err?.message || "An unexpected error occurred.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expiredAccount || !reauthPassword.trim()) return;

    setIsReauthing(true);
    try {
      const res = await addAccount(expiredAccount.email, reauthPassword);
      if (res.success) {
        toast.success(`Reconnected to ${expiredAccount.email} successfully!`);
        setExpiredAccount(null);
        setReauthPassword("");
        setIsAccountSwitcherOpen(false);
      } else {
        toast.error(res.error || "Invalid password. Could not reconnect.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to reconnect account.");
    } finally {
      setIsReauthing(false);
    }
  };

  const handleRemove = (e: React.MouseEvent, targetAccount: SavedAccount) => {
    e.stopPropagation();
    removeSavedAccount(targetAccount.userId);
    if (expiredAccount?.userId === targetAccount.userId) {
      setExpiredAccount(null);
    }
    toast.info(`Removed ${targetAccount.email} from saved accounts on this device.`);
  };

  const handleSignOutCurrent = async () => {
    setIsAccountSwitcherOpen(false);
    await signOut();
    toast.info("Signed out of current account.");
  };

  const handleSignOutAll = async () => {
    setIsAccountSwitcherOpen(false);
    setConfirmSignOutAll(false);
    await signOutAll();
    toast.info("Signed out of all accounts on this device.");
  };

  return (
    <Dialog open={isAccountSwitcherOpen} onOpenChange={setIsAccountSwitcherOpen}>
      <DialogContent
        className={cn(
          "max-w-md w-[95vw] sm:w-full rounded-2xl sm:rounded-3xl p-5 sm:p-6 overflow-hidden border shadow-2xl transition-all duration-300",
          isDark
            ? "bg-[#0b091a]/95 border-white/10 text-white backdrop-blur-2xl shadow-black/80"
            : "bg-white/95 border-gray-200 text-gray-900 backdrop-blur-2xl shadow-xl"
        )}
      >
        <DialogHeader className="space-y-2 text-left">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-md",
                isDark
                  ? "bg-amber-400/10 border-amber-400/20 text-amber-400"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-600"
              )}
            >
              <Users className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2">
                Switch Account
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                    isDark
                      ? "bg-white/5 border-white/10 text-amber-400"
                      : "bg-gray-100 border-gray-200 text-gray-700"
                  )}
                >
                  {savedAccounts.length} {savedAccounts.length === 1 ? "Saved" : "Saved"}
                </Badge>
              </DialogTitle>
              <DialogDescription className={cn("text-xs", isDark ? "text-white/50" : "text-gray-500")}>
                Seamless 1-click switching between accounts on this device.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Active Account Card ── */}
        <div className="mt-1 space-y-3">
          <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase opacity-60 px-1">
            <span>Currently Active</span>
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Active Now
            </span>
          </div>

          <div
            className={cn(
              "relative p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 overflow-hidden",
              isDark
                ? "bg-gradient-to-r from-emerald-500/10 via-white/[0.04] to-transparent border-emerald-500/30"
                : "bg-gradient-to-r from-emerald-50 via-white to-transparent border-emerald-300"
            )}
          >
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative">
                <Avatar className="w-11 h-11 border-2 border-emerald-500/40 p-0.5">
                  <AvatarImage
                    src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`}
                  />
                  <AvatarFallback className="bg-emerald-500/10 text-xs font-bold text-emerald-500">
                    {profile?.full_name?.charAt(0) || user?.email?.charAt(0) || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0b091a] flex items-center justify-center">
                  <Check className="w-2 h-2 text-white stroke-[3]" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black truncate">
                    {profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User"}
                  </p>
                  {isAdmin && (
                    <Badge className="h-4 text-[9px] bg-red-500 text-white font-black px-1.5 border-none">
                      ADMIN
                    </Badge>
                  )}
                  {profile?.is_agent && (
                    <Badge className="h-4 text-[9px] bg-amber-400 text-black font-black px-1.5 border-none">
                      AGENT
                    </Badge>
                  )}
                </div>
                <p className={cn("text-xs truncate font-mono", isDark ? "text-white/60" : "text-gray-500")}>
                  {user?.email || "No email available"}
                </p>
                {profile?.store_name && (
                  <p className="text-[11px] text-amber-400/90 font-medium flex items-center gap-1 mt-0.5 truncate">
                    <Store className="w-3 h-3 shrink-0" />
                    {profile.store_name}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Saved Other Accounts List ── */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          <p className="text-[11px] font-bold tracking-wider uppercase opacity-60 px-1">
            Other Saved Accounts ({otherAccounts.length})
          </p>

          {otherAccounts.length === 0 ? (
            <div
              className={cn(
                "p-4 rounded-2xl border text-center space-y-1.5",
                isDark ? "bg-white/[0.02] border-white/5" : "bg-gray-50 border-gray-200"
              )}
            >
              <Users className="w-6 h-6 mx-auto opacity-30" />
              <p className="text-xs font-bold opacity-80">No other saved accounts on this device</p>
              <p className={cn("text-[11px]", isDark ? "text-white/40" : "text-gray-500")}>
                Add your agent, admin, or personal accounts below to switch instantly without passwords.
              </p>
            </div>
          ) : (
            otherAccounts.map((account) => {
              const isSwitchingThis = switchingId === account.userId;
              const isSessionMissing = !account.session?.access_token || !account.session?.refresh_token;
              const isThisExpired = expiredAccount?.userId === account.userId || isSessionMissing;
              const isFormOpen = expiredAccount?.userId === account.userId;

              return (
                <div
                  key={account.userId}
                  onClick={() => {
                    if (isSwitchingThis) return;
                    if (isThisExpired) {
                      if (!isFormOpen) {
                        setExpiredAccount(account);
                        setReauthPassword("");
                      }
                      return;
                    }
                    handleSwitch(account);
                  }}
                  className={cn(
                    "group flex flex-col p-3 rounded-2xl border transition-all duration-200 cursor-pointer relative",
                    isThisExpired
                      ? isDark
                        ? "bg-amber-400/10 border-amber-400/40 shadow-lg shadow-amber-400/5"
                        : "bg-amber-50 border-amber-300 shadow-md"
                      : isDark
                      ? "bg-white/[0.03] hover:bg-white/[0.08] border-white/5 hover:border-amber-400/40"
                      : "bg-gray-50/80 hover:bg-gray-100 border-gray-200 hover:border-amber-400/50"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Avatar className="w-9 h-9 border border-white/10 shrink-0">
                        <AvatarImage
                          src={account.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${account.userId}`}
                        />
                        <AvatarFallback className="bg-white/10 text-xs font-bold">
                          {account.fullName?.charAt(0) || account.email.charAt(0) || "U"}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold truncate group-hover:text-amber-400 transition-colors">
                            {account.fullName || account.email.split("@")[0]}
                          </p>
                          {account.isAdmin && (
                            <Badge className="h-3.5 text-[8px] bg-red-500 text-white font-black px-1 border-none">
                              ADMIN
                            </Badge>
                          )}
                          {account.isAgent && (
                            <Badge className="h-3.5 text-[8px] bg-amber-400 text-black font-black px-1 border-none">
                              AGENT
                            </Badge>
                          )}
                          {isThisExpired && (
                            <Badge className="h-3.5 text-[8px] bg-amber-500/20 text-amber-400 border border-amber-400/30 font-bold px-1">
                              EXPIRED
                            </Badge>
                          )}
                        </div>
                        <p className={cn("text-[11px] truncate font-mono", isDark ? "text-white/50" : "text-gray-500")}>
                          {account.email}
                        </p>
                        {account.storeName && (
                          <p className="text-[10px] text-amber-400/80 font-medium truncate flex items-center gap-1">
                            <Store className="w-2.5 h-2.5" />
                            {account.storeName}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pl-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isThisExpired) {
                            if (!isFormOpen) {
                              setExpiredAccount(account);
                              setReauthPassword("");
                            }
                          } else {
                            handleSwitch(account);
                          }
                        }}
                        disabled={isSwitchingThis}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1",
                          isThisExpired
                            ? "bg-amber-400 text-black hover:bg-amber-300"
                            : isDark
                            ? "bg-amber-400/20 text-amber-300 hover:bg-amber-400 hover:text-black"
                            : "bg-amber-500/15 text-amber-700 hover:bg-amber-500 hover:text-white"
                        )}
                      >
                        {isSwitchingThis ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Switching...</span>
                          </>
                        ) : isThisExpired ? (
                          <span>Reconnect</span>
                        ) : (
                          <span>Switch</span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleRemove(e, account)}
                        title="Remove from saved accounts"
                        aria-label="Remove account"
                        className={cn(
                          "p-1.5 rounded-xl transition-all opacity-40 hover:opacity-100 hover:text-red-400",
                          isDark ? "hover:bg-red-500/10" : "hover:bg-red-50"
                        )}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Re-auth Form when session expired */}
                  {isFormOpen && (
                    <div
                      className={cn(
                        "mt-3 pt-3 border-t space-y-2.5 w-full cursor-default",
                        isDark ? "border-amber-400/20" : "border-amber-300"
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-xs">
                          <p className="font-bold text-amber-400">Session Expired</p>
                          <p className={cn("text-[11px]", isDark ? "text-white/70" : "text-gray-600")}>
                            Enter password for <strong>{account.email}</strong> to reconnect and switch:
                          </p>
                        </div>
                      </div>

                      <div className="relative">
                        <Lock className="w-3.5 h-3.5 absolute left-3 top-3 opacity-40" />
                        <input
                          type={showReauthPassword ? "text" : "password"}
                          placeholder="Password"
                          value={reauthPassword}
                          onChange={(e) => setReauthPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleReauthSubmit(e);
                            }
                          }}
                          autoFocus
                          required
                          className={cn(
                            "w-full pl-9 pr-10 py-2 rounded-xl text-xs font-medium outline-none border transition-all",
                            isDark
                              ? "bg-black/30 border-white/10 text-white placeholder-white/30 focus:border-amber-400"
                              : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-amber-500"
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => setShowReauthPassword(!showReauthPassword)}
                          className="absolute right-3 top-2.5 opacity-60 hover:opacity-100"
                        >
                          {showReauthPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setExpiredAccount(null)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold opacity-70 hover:opacity-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleReauthSubmit}
                          disabled={isReauthing || !reauthPassword.trim()}
                          className="px-4 py-1.5 rounded-xl text-xs font-black bg-amber-400 text-black hover:bg-amber-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isReauthing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                          Reconnect & Switch
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Add Another Account Toggle & Form ── */}
        <div className="border-t border-dashed pt-3 border-white/10 space-y-2">
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-2xl text-xs font-bold transition-all border",
              isDark
                ? "bg-white/[0.02] hover:bg-white/[0.06] border-white/10 text-white"
                : "bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-800"
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-lg flex items-center justify-center",
                  isDark ? "bg-amber-400/20 text-amber-400" : "bg-amber-500/20 text-amber-700"
                )}
              >
                <Plus className="w-3.5 h-3.5" />
              </div>
              <span>Add Another Account</span>
            </div>
            {showAddForm ? <ChevronUp className="w-4 h-4 opacity-50" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
          </button>

          <AnimatePresence>
            {showAddForm && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleAddAccountSubmit}
                className={cn(
                  "p-3.5 rounded-2xl border space-y-3 overflow-hidden",
                  isDark ? "bg-black/20 border-white/10" : "bg-gray-50 border-gray-200"
                )}
              >
                <p className={cn("text-[11px]", isDark ? "text-white/60" : "text-gray-500")}>
                  Sign in with another account. It will be saved securely to this device for instant switching.
                </p>

                <div className="space-y-2">
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 absolute left-3 top-3 opacity-40" />
                    <input
                      type="email"
                      placeholder="Account Email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      className={cn(
                        "w-full pl-9 pr-3 py-2 rounded-xl text-xs font-medium outline-none border transition-all",
                        isDark
                          ? "bg-black/30 border-white/10 text-white placeholder-white/30 focus:border-amber-400"
                          : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-amber-500"
                      )}
                    />
                  </div>

                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-3 top-3 opacity-40" />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className={cn(
                        "w-full pl-9 pr-10 py-2 rounded-xl text-xs font-medium outline-none border transition-all",
                        isDark
                          ? "bg-black/30 border-white/10 text-white placeholder-white/30 focus:border-amber-400"
                          : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-amber-500"
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 opacity-60 hover:opacity-100"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isAdding}
                  className="w-full py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-amber-400 to-amber-500 text-black hover:opacity-95 transition-opacity flex items-center justify-center gap-1.5 shadow-lg shadow-amber-400/20 disabled:opacity-50"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Signing In & Saving...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Sign In & Save Account</span>
                    </>
                  )}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* ── Footer Actions ── */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs font-bold">
          {confirmSignOutAll ? (
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-[11px]">Confirm sign out all?</span>
              <button
                type="button"
                onClick={handleSignOutAll}
                className="px-2 py-1 rounded-lg bg-red-500 text-white text-[11px] font-black hover:bg-red-600"
              >
                Yes, Sign Out All
              </button>
              <button
                type="button"
                onClick={() => setConfirmSignOutAll(false)}
                className="px-2 py-1 rounded-lg opacity-60 hover:opacity-100 text-[11px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmSignOutAll(true)}
              className="text-red-400/70 hover:text-red-400 text-[11px] flex items-center gap-1 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out of all accounts
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsAccountSwitcherOpen(false)}
            className={cn(
              "px-4 py-1.5 rounded-xl font-bold transition-all",
              isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-800"
            )}
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
