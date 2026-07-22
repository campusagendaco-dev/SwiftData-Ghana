import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { User, Mail, Phone, Shield, Camera, Lock, Eye, EyeOff, Fingerprint, Smartphone, Trash2, Key, Loader2, Plus, AlertTriangle, Bell } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWebAuthn } from "@/hooks/useWebAuthn";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toast } from "sonner";
import MfaSetupWidget from "@/components/MfaSetupWidget";
import { getFunctionErrorMessage } from "@/lib/function-errors";

const DashboardAccountSettings = () => {
  const { user, profile, refreshProfile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast: uiToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);

  const { isSupported, supportReason, credentials, loadingCredentials, register, deleteCredential } = useWebAuthn();
  const { supported: pushSupported, permissionState, subscribeUser, unsubscribeUser, loading: subLoading } = usePushNotifications();
  const [registering, setRegistering] = useState(false);
  const [deviceName, setDeviceName] = useState("My Device");
  const [savingPin, setSavingPin] = useState(false);
  const [pin, setPin] = useState("");

  const [searchParams] = useSearchParams();
  const forceAdminMfa = searchParams.get("force_admin_mfa") === "true";

  // iOS Detection for Push Notifications
  const [isIosNotStandalone, setIsIosNotStandalone] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !(window as any).MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      if (isIos && !isStandalone) {
        setIsIosNotStandalone(true);
      }
    }
  }, []);

  useEffect(() => {
    if (forceAdminMfa) {
      const timer = setTimeout(() => {
        const el = document.getElementById("mfa-setup-section");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [forceAdminMfa]);

  useEffect(() => {
    setFullName(profile?.full_name || "");
    setPhone(profile?.phone || "");
    setEmail(profile?.email || user?.email || "");
  }, [profile, user?.email]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!fullName.trim()) {
      uiToast({ title: "Full name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
      })
      .eq("user_id", user.id);

    if (error) {
      uiToast({ title: "Could not save account settings", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    await refreshProfile();
    uiToast({ title: "Account settings saved" });
    setSaving(false);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword.length < 6) {
      uiToast({ 
        title: "Password too short", 
        description: "Password must be at least 6 characters long.", 
        variant: "destructive" 
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      uiToast({ 
        title: "Passwords do not match", 
        description: "Please make sure both passwords are the same.", 
        variant: "destructive" 
      });
      return;
    }

    setUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      uiToast({ 
        title: "Could not update password", 
        description: error.message, 
        variant: "destructive" 
      });
    } else {
      uiToast({ 
        title: "Password updated", 
        description: "Your password has been successfully changed." 
      });
      setNewPassword("");
      setConfirmPassword("");
    }
    setUpdatingPassword(false);
  };
  
  const handleDeleteAccount = async () => {
    if (!user) return;
    
    const confirmDelete = window.confirm(
      "Are you absolutely sure you want to delete your account? This action is PERMANENT and cannot be undone. All your data, including order history and wallet balance, will be lost."
    );
    
    if (!confirmDelete) return;
    
    const secondConfirm = window.confirm(
      "Final Confirmation: This is your last chance to cancel. Proceed with deletion?"
    );
    
    if (!secondConfirm) return;

    setDeletingAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account");

      if (error) throw error;
      
      toast.success("Account deleted successfully");
      await supabase.auth.signOut();
      navigate("/");
    } catch (e: any) {
      const errorMsg = await getFunctionErrorMessage(e, "An unexpected error occurred");
      uiToast({ 
        title: "Deletion failed", 
        description: errorMsg, 
        variant: "destructive" 
      });
      setDeletingAccount(false);
    }
  };

  const handleAvatarSelect = async (url: string) => {
    if (!user) return;
    
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("user_id", user.id);

    if (error) throw error;
    
    await refreshProfile();
    toast.success("Avatar updated successfully!");
  };

  return (
    <div className="p-2 sm:p-4 lg:p-6 space-y-6 max-w-4xl mx-auto pb-10">
      {forceAdminMfa && (
        <div className="rounded-2xl bg-rose-500/10 border-2 border-rose-500/30 p-4 sm:p-6 flex items-start gap-4 shadow-lg animate-pulse-subtle backdrop-blur-sm">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
            <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-rose-400 animate-bounce" style={{ animationDuration: '3s' }} />
          </div>
          <div>
            <h2 className="font-black text-rose-400 tracking-wide uppercase text-xs sm:text-sm flex items-center gap-2">
              🔐 Administrator Security Requirement
            </h2>
            <p className="text-xs sm:text-sm text-white/80 font-medium mt-1.5 leading-relaxed">
              Because your account holds global <strong>Administrator powers</strong>, you must lock your session behind <strong>Multi-Factor Authentication (MFA)</strong>. 
            </p>
            <p className="text-[11px] text-white/50 mt-2 italic">
              Please complete the Authenticator App configuration down below to immediately regain access to the Admin Dashboard.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Account Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your personal information and security preferences.</p>
        </div>
        <Button 
          onClick={() => navigate(isAdmin ? '/admin' : '/dashboard/profile')}
          variant="outline" 
          className="rounded-xl font-bold"
        >
          {isAdmin ? 'Back to Dashboard' : 'View Profile'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Avatar & Summary */}
        <div className="space-y-6">
          <Card className="border-none bg-card shadow-sm overflow-hidden">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <div className="relative group cursor-pointer">
                <Avatar className="w-24 h-24 border-4 border-card shadow-lg">
                  <AvatarImage src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`} />
                  <AvatarFallback className="text-4xl bg-primary/10">
                    {profile?.full_name?.charAt(0) || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-1 -right-1">
                  <Button 
                    size="icon" 
                    variant="secondary" 
                    className="h-8 w-8 rounded-full shadow-lg border-2 border-background"
                    onClick={() => setIsAvatarPickerOpen(true)}
                  >
                    <Camera className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <AvatarPicker 
                isOpen={isAvatarPickerOpen}
                onClose={() => setIsAvatarPickerOpen(false)}
                onSelect={handleAvatarSelect}
                currentAvatarUrl={profile?.avatar_url || undefined}
              />

              <div className="mt-4">
                <h3 className="font-bold text-lg">{fullName || "User"}</h3>
                <p className="text-xs text-muted-foreground font-medium">{email}</p>
              </div>
              <div className="w-full mt-6 pt-6 border-t border-white/5 space-y-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Account Status</span>
                  <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider font-black">Active</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Security Level</span>
                  <span className="text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider font-black">Medium</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none bg-primary/5 border border-primary/10">
            <CardContent className="p-4 flex items-start gap-3">
              <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider">Privacy Note</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Your information is encrypted and never shared with third parties. Update your phone to receive order alerts.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Form */}
        <div className="lg:col-span-2">
          <Card className="border-none bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Profile Details</CardTitle>
              <CardDescription>Update your public information used across the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="account-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="account-name" 
                        value={fullName} 
                        onChange={(e) => setFullName(e.target.value)} 
                        className="pl-10 h-12 bg-secondary/50 border-white/5 focus:bg-secondary transition-colors rounded-xl" 
                        required 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account-phone" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="account-phone" 
                        value={phone} 
                        onChange={(e) => setPhone(e.target.value)} 
                        className="pl-10 h-12 bg-secondary/50 border-white/5 focus:bg-secondary transition-colors rounded-xl" 
                        placeholder="024 XXX XXXX"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="account-email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="account-email" 
                        type="email" 
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)} 
                        className="pl-10 h-12 bg-secondary/50 border-white/5 focus:bg-secondary transition-colors rounded-xl" 
                      />
                    </div>
                  </div>
                </div>
                
                <div className="pt-4 flex items-center justify-between border-t border-white/5">
                  <p className="text-[10px] text-muted-foreground italic">Last updated: Just now</p>
                  <Button 
                    type="submit" 
                    disabled={saving}
                    className="h-12 px-8 rounded-xl font-bold shadow-lg shadow-primary/20"
                  >
                    {saving ? "Saving Changes..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-none bg-card shadow-sm mt-8">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Security</CardTitle>
              <CardDescription>Update your password to keep your account secure.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="new-password" 
                        type={showPassword ? "text" : "password"}
                        value={newPassword} 
                        onChange={(e) => setNewPassword(e.target.value)} 
                        className="pl-10 pr-10 h-12 bg-secondary/50 border-white/5 focus:bg-secondary transition-colors rounded-xl" 
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Confirm New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        id="confirm-password" 
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword} 
                        onChange={(e) => setConfirmPassword(e.target.value)} 
                        className="pl-10 h-12 bg-secondary/50 border-white/5 focus:bg-secondary transition-colors rounded-xl" 
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="pt-4 flex items-center justify-between border-t border-white/5">
                  <p className="text-[10px] text-muted-foreground">It's a good idea to use a unique password you don't use elsewhere.</p>
                  <Button 
                    type="submit" 
                    disabled={updatingPassword || !newPassword || !confirmPassword}
                    variant="secondary"
                    className="h-12 px-8 rounded-xl font-bold"
                  >
                    {updatingPassword ? "Updating Password..." : "Update Password"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* ── Biometric / WebAuthn ── */}
          <Card className="border-none bg-card shadow-sm mt-8">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Fingerprint className="w-5 h-5 text-amber-400" />
                Biometric Authentication
              </CardTitle>
              <CardDescription>
                Use your device fingerprint or Face ID to secure sensitive actions like withdrawals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!isSupported && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-600 dark:text-amber-300 flex items-start gap-3">
                  <Shield className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>{supportReason || "Biometric authentication is not available on this browser."}</p>
                </div>
              )}

              {isSupported && (
                <>
                  {/* Registered credentials */}
                  {loadingCredentials ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading devices…
                    </div>
                  ) : credentials.length > 0 ? (
                    <div className="space-y-2">
                      {credentials.map((c) => (
                        <div key={c.id} className="flex items-center justify-between rounded-xl bg-secondary/50 border border-white/5 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Smartphone className="w-4 h-4 text-amber-400 shrink-0" />
                            <div>
                              <p className="text-sm font-bold">{c.device_name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Registered {new Date(c.created_at).toLocaleDateString()}
                                {c.last_used_at && ` · Last used ${new Date(c.last_used_at).toLocaleDateString()}`}
                                {c.backed_up && " · Cloud-backed"}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await deleteCredential(c.credential_id);
                                toast.success("Device removed");
                              } catch (e: any) {
                                toast.error("Could not remove device", { description: e.message });
                              }
                            }}
                            className="text-muted-foreground hover:text-red-400 transition-colors"
                            aria-label="Remove device"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No devices registered yet.</p>
                  )}

                  {/* Register new device */}
                  <div className="space-y-3 pt-2 border-t border-white/5">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                      Device Label (optional)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                        placeholder="e.g. My iPhone 15"
                        className="h-11 bg-secondary/50 border-white/5 rounded-xl"
                        maxLength={40}
                      />
                      <Button
                        type="button"
                        disabled={registering}
                        onClick={async () => {
                          setRegistering(true);
                          try {
                            await register(deviceName.trim() || "My Device");
                            toast.success("Biometric registered!", {
                              description: "You can now use your fingerprint or Face ID to confirm withdrawals.",
                            });
                            setDeviceName("My Device");
                          } catch (e: any) {
                            const msg: string = e?.message ?? "";
                            if (msg.includes("cancelled") || msg.includes("NotAllowedError")) {
                              toast.error("Registration cancelled.");
                            } else {
                              toast.error("Could not register biometric", { description: msg });
                            }
                          } finally {
                            setRegistering(false);
                          }
                        }}
                        className="h-11 px-5 rounded-xl font-bold shrink-0 gap-2"
                      >
                        {registering ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        Add Device
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Multi-Factor Authentication ── */}
          <div id="mfa-setup-section" className="scroll-mt-20">
            <MfaSetupWidget />
          </div>

          {/* ── Push Notifications ── */}
          <Card className="border-none bg-card shadow-sm mt-8">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Bell className="w-5 h-5 text-indigo-400 animate-pulse" />
                Mobile Push Notifications
              </CardTitle>
              <CardDescription>
                Enable lock-screen and taskbar alerts to stay updated in real-time, even when SwiftData is closed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!pushSupported && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-300 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>Your current browser or device does not support background push notifications. On iOS, make sure to "Add to Home Screen" first.</p>
                </div>
              )}

              {pushSupported && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-secondary/50 border border-white/5">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">Status:</p>
                      {permissionState === "granted" ? (
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-2.5 py-0.5 rounded-full">Subscribed</span>
                      ) : permissionState === "denied" ? (
                        <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest bg-rose-500/10 px-2.5 py-0.5 rounded-full">Blocked</span>
                      ) : (
                        <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest bg-amber-500/10 px-2.5 py-0.5 rounded-full">Not Configured</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {permissionState === "granted" 
                        ? "This device is actively listening for lock-screen sales and commission alerts!"
                        : "Tap enable to subscribe this device to encrypted server signals."}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {permissionState === "granted" ? (
                      <Button
                        type="button"
                        onClick={async () => {
                          await unsubscribeUser();
                          toast.success("Device unsubscribed from notifications.");
                        }}
                        disabled={subLoading}
                        variant="destructive"
                        className="h-10 px-5 rounded-xl font-bold text-xs gap-2 shrink-0"
                      >
                        Disable Alerts
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={async () => {
                          const ok = await subscribeUser();
                          if (ok) toast.success("Push notifications activated successfully!");
                        }}
                        disabled={subLoading || permissionState === "denied"}
                        className="h-10 px-6 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/15 gap-2 shrink-0"
                      >
                        {subLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                        {permissionState === "denied" ? "Access Blocked" : "Enable Notifications"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {(!pushSupported || permissionState === "unsupported") && isIosNotStandalone && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-5 h-5 shrink-0" />
                    <h3 className="text-sm font-black uppercase tracking-wider">Enable iOS Push Alerts</h3>
                  </div>
                  <p className="text-xs leading-relaxed">
                    Apple restricts Push Notifications in standard Safari tabs. To receive notifications on your iPhone or iPad, you must first add this app to your Home Screen:
                  </p>
                  <ul className="text-[11px] font-bold space-y-2 mt-2">
                    <li className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">1</span>
                      Tap the <strong>Share</strong> icon at the bottom of Safari.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">2</span>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">3</span>
                      Open the new app from your home screen and return here to enable alerts.
                    </li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Transaction PIN ── */}
          <Card className="border-none bg-card shadow-sm mt-8">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-400" />
                Security Transaction PIN
              </CardTitle>
              <CardDescription>
                Set a 4-digit PIN to authorize withdrawals if biometric is unavailable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                    {profile?.transaction_pin ? "Update 4-Digit PIN" : "Set 4-Digit PIN"}
                  </Label>
                  <div className="relative">
                    <Input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      placeholder="••••"
                      className="h-12 bg-secondary/50 border-white/5 rounded-xl text-center text-xl tracking-[0.5em] font-black"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                </div>
                <Button 
                  onClick={async () => {
                    if (pin.length !== 4) {
                      toast.error("PIN must be exactly 4 digits");
                      return;
                    }
                    setSavingPin(true);
                    try {
                      const { error } = await supabase
                        .from("profiles")
                        .update({ 
                          transaction_pin: pin,
                          last_security_update: new Date().toISOString() 
                        })
                        .eq("user_id", user?.id);
                      
                      if (error) throw error;
                      toast.success("Security PIN Updated!");
                      setPin("");
                      refreshProfile();
                    } catch (e: any) {
                      toast.error("Could not save PIN", { description: e.message });
                    } finally {
                      setSavingPin(false);
                    }
                  }}
                  disabled={savingPin || pin.length !== 4}
                  className="h-12 px-8 rounded-xl font-bold"
                >
                  {savingPin ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save PIN"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Note: For security, changing your PIN will trigger a 24-hour hold on withdrawals.
              </p>
            </CardContent>
          </Card>

          {/* ── Danger Zone ── */}
          <Card className="border border-red-500/20 bg-red-500/5 shadow-sm mt-12 overflow-hidden">
            <CardHeader className="bg-red-500/10 border-b border-red-500/10">
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-red-500">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone
              </CardTitle>
              <CardDescription className="text-red-400/70">
                Permanent actions that cannot be reversed.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-foreground/90">Delete My Account</p>
                  <p className="text-xs text-muted-foreground">
                    Instantly and permanently delete your SwiftData account and all associated data.
                  </p>
                </div>
                <Button 
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount}
                  variant="destructive"
                  className="h-12 px-8 rounded-xl font-bold bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 whitespace-nowrap"
                >
                  {deletingAccount ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deleting...</>
                  ) : (
                    <><Trash2 className="w-4 h-4 mr-2" /> Delete Account</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DashboardAccountSettings;

