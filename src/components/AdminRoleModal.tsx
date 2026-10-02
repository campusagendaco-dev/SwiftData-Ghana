import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/utils/auditLogger";
import {
  ShieldCheck, ShieldAlert, Check, X, Loader2,
  LayoutDashboard, ShoppingCart, Users, Package, CreditCard,
  Megaphone, LifeBuoy, Settings, Key, Lock, CheckSquare, Square
} from "lucide-react";

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  icon: any;
  paths: string[];
}

export const ADMIN_PERMISSIONS: PermissionDef[] = [
  {
    key: "orders",
    label: "Orders & Fulfillments",
    description: "View, retry, refund, check live status, and manage all orders (Data, Airtime, Utility, MashUp, Beneficiary, Checker, API).",
    icon: ShoppingCart,
    paths: [
      "/admin/orders",
      "/admin/refunded-orders",
      "/admin/beneficiary-orders",
      "/admin/submitted-numbers",
      "/submit-numbers",
      "/admin/airtime-orders",
      "/admin/mashup-orders",
      "/admin/utility-orders",
      "/admin/standard-orders",
      "/admin/checker-orders",
      "/admin/api-orders",
    ],
  },
  {
    key: "agents",
    label: "Agents & Sub-Agents Management",
    description: "Manage agents, sub-agents, agent approvals, performance, and Swift Vendor features.",
    icon: ShieldCheck,
    paths: ["/admin/agents", "/admin/sub-agents", "/admin/agent-performance", "/admin/swift-vendor"],
  },
  {
    key: "packages",
    label: "Packages & Pricing Control",
    description: "Set package prices, Korba Hub packages, promo codes, and discount tiers.",
    icon: Package,
    paths: ["/admin/packages", "/admin/korba", "/admin/korba/packages", "/admin/promotions"],
  },
  {
    key: "finance",
    label: "Financials, Top-Ups & P&L",
    description: "Wallet top-ups, withdrawal payouts, credit limits, reconciliation, profit reports, and P&L.",
    icon: CreditCard,
    paths: [
      "/admin/wallet-topup",
      "/admin/withdrawals",
      "/admin/reconciliation",
      "/admin/profits",
      "/admin/pnl",
      "/admin/credit-management",
    ],
  },
  {
    key: "communications",
    label: "Communications & Broadcasts",
    description: "Send SMS broadcasts, mNotify voice calls, promo banners, and edit SMS notification templates.",
    icon: Megaphone,
    paths: ["/admin/broadcast", "/admin/voice-sms", "/admin/banners", "/admin/sms-templates"],
  },
  {
    key: "support",
    label: "Support Tickets & Engagement",
    description: "Resolve support tickets, send push notifications, and manage user engagement tools.",
    icon: LifeBuoy,
    paths: ["/admin/tickets", "/admin/notifications", "/admin/engagement"],
  },
  {
    key: "users",
    label: "User Accounts & Role Management",
    description: "View user profiles, suspend/unsuspend accounts, manage API users, and assign sub-admin roles.",
    icon: Users,
    paths: ["/admin/users", "/admin/api-users"],
  },
  {
    key: "system",
    label: "System Settings, Security & AI",
    description: "Access system configuration, security logs, Sentinel AI, feature flags, health status, and audit logs.",
    icon: Settings,
    paths: [
      "/admin/security",
      "/admin/system-health",
      "/admin/sentinel",
      "/admin/ai-strategy",
      "/admin/api-network",
      "/admin/system-logs",
      "/admin/feature-flags",
      "/admin/audit-logs",
      "/admin/settings",
    ],
  },
];

interface AdminRoleModalProps {
  user: {
    user_id?: string;
    id?: string;
    full_name: string;
    email: string;
    admin_permissions?: string[] | null;
    is_admin?: boolean;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export default function AdminRoleModal({ user, isOpen, onClose, onUpdated }: AdminRoleModalProps) {
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const targetUserId = user?.user_id || user?.id;

  useEffect(() => {
    if (!targetUserId || !isOpen) return;
    setLoading(true);

    async function loadUserRole() {
      try {
        // Check user_roles table
        const { data: roles, error: rolesErr } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", targetUserId!)
          .eq("role", "admin");

        if (rolesErr) console.warn("[AdminRoleModal] Error loading roles:", rolesErr);

        const hasAdminRole = Boolean(roles && roles.length > 0);
        setIsAdmin(hasAdminRole);

        // Fetch profile permissions from markups JSONB field
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("markups")
          .eq("user_id", targetUserId!)
          .maybeSingle();

        if (profErr) console.warn("[AdminRoleModal] Error loading profile markups:", profErr);

        const rawMarkups = prof?.markups;
        let markupsObj: Record<string, any> = {};
        if (typeof rawMarkups === "string") {
          try { markupsObj = JSON.parse(rawMarkups); } catch (e) { markupsObj = {}; }
        } else if (rawMarkups && typeof rawMarkups === "object") {
          markupsObj = rawMarkups as Record<string, any>;
        }

        const perms = Array.isArray(markupsObj.admin_permissions) ? markupsObj.admin_permissions : [];
        setSelectedPermissions(perms);
      } catch (err) {
        console.error("Failed to load user role permissions:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUserRole();
  }, [targetUserId, isOpen]);

  if (!user || !targetUserId) return null;

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSelectAll = () => {
    setSelectedPermissions(ADMIN_PERMISSIONS.map((p) => p.key));
  };

  const handleClearAll = () => {
    setSelectedPermissions([]);
  };

  const handleSave = async () => {
    if (!targetUserId) {
      toast({ title: "Invalid User", description: "Target user ID is missing.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (isAdmin) {
        // Ensure row exists in user_roles
        const { data: existing } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", targetUserId)
          .eq("role", "admin")
          .maybeSingle();

        if (!existing) {
          const { error: insErr } = await supabase.from("user_roles").insert({
            user_id: targetUserId,
            role: "admin",
          });
          if (insErr) throw insErr;
        }

        const isSubAdmin = selectedPermissions.length < ADMIN_PERMISSIONS.length;
        
        // 1. Invoke Edge Function with Service Role to bypass RLS restrictions on profiles table
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        
        const { data: edgeRes, error: edgeErr } = await supabase.functions.invoke("admin-user-actions", {
          body: {
            action: "update_sub_admin_permissions",
            target_user_id: targetUserId,
            permissions: selectedPermissions,
            is_sub_admin: isSubAdmin,
          },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (edgeErr || edgeRes?.error) {
          console.warn("[AdminRoleModal] Edge function update failed, falling back to client update:", edgeErr || edgeRes?.error);
          
          const { data: prof } = await supabase
            .from("profiles")
            .select("markups")
            .eq("user_id", targetUserId)
            .maybeSingle();

          const rawCurrent = prof?.markups;
          let currentMarkups: Record<string, any> = {};
          if (typeof rawCurrent === "string") {
            try { currentMarkups = JSON.parse(rawCurrent); } catch (e) { currentMarkups = {}; }
          } else if (rawCurrent && typeof rawCurrent === "object") {
            currentMarkups = rawCurrent as Record<string, any>;
          }

          const { error: updErr } = await supabase
            .from("profiles")
            .update({
              markups: {
                ...currentMarkups,
                admin_permissions: selectedPermissions,
                is_sub_admin: isSubAdmin,
              },
            })
            .eq("user_id", targetUserId);

          if (updErr) throw updErr;
        }

        await logAudit({
          action: "UPDATE_ADMIN_ROLE_PERMISSIONS",
          targetId: targetUserId,
          details: {
            assigned_admin: true,
            permissions: selectedPermissions,
            target_user: user.email,
          },
        });

        toast({
          title: "Admin Role & Permissions Saved! 🛡️",
          description: `Updated admin permissions for ${user.full_name || user.email}.`,
        });
      } else {
        // Remove admin role
        const { error: delErr } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", targetUserId)
          .eq("role", "admin");

        if (delErr) throw delErr;

        const { data: prof } = await supabase
          .from("profiles")
          .select("markups")
          .eq("user_id", targetUserId)
          .maybeSingle();

        const currentMarkups = (prof?.markups as Record<string, any>) || {};
        delete currentMarkups.admin_permissions;
        delete currentMarkups.is_sub_admin;

        const { error: clearErr } = await supabase
          .from("profiles")
          .update({
            markups: currentMarkups,
          })
          .eq("user_id", targetUserId);

        if (clearErr) throw clearErr;

        await logAudit({
          action: "REVOKE_ADMIN_ROLE",
          targetId: targetUserId,
          details: {
            assigned_admin: false,
            target_user: user.email,
          },
        });

        toast({
          title: "Admin Role Revoked",
          description: `Removed admin access from ${user.full_name || user.email}.`,
        });
      }

      onUpdated?.();
      onClose();
    } catch (err: any) {
      console.error("Save role error:", err);
      toast({
        title: "Failed to Save Admin Role",
        description: err.message || "An error occurred while saving role.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl rounded-3xl bg-card border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="flex items-center justify-between text-lg font-black text-foreground">
            <span className="flex items-center gap-2.5">
              <ShieldCheck className="w-6 h-6 text-amber-400" /> Manage Admin Role & Granular Permissions
            </span>
            <Badge variant="outline" className={`text-xs font-bold ${isAdmin ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-slate-700 text-slate-400 bg-slate-800/40"}`}>
              {isAdmin ? "ADMIN ACCESS" : "STANDARD USER"}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Assign admin access to <strong className="text-foreground">{user.full_name || user.email}</strong> and specify exactly which feature modules they are authorized to access.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-400" />
            <p className="text-xs text-muted-foreground font-semibold">Loading permissions...</p>
          </div>
        ) : (
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            {/* Admin Toggle */}
            <div className="p-4 rounded-2xl bg-secondary/40 border border-border flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-sm font-extrabold text-foreground flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-400" /> Grant Administrator Access
                </span>
                <p className="text-xs text-muted-foreground">
                  Enabling this grants administrative access to the Admin Dashboard.
                </p>
              </div>
              <Switch
                checked={isAdmin}
                onCheckedChange={setIsAdmin}
                className="data-[state=checked]:bg-amber-500"
              />
            </div>

            {isAdmin && (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Feature Access Permissions</h4>
                    <p className="text-[11px] text-muted-foreground">
                      Leave all unchecked to give FULL ACCESS, or check specific modules for restricted sub-admin access.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-[11px] font-bold text-amber-400 hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-[11px] font-bold text-muted-foreground hover:text-foreground"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ADMIN_PERMISSIONS.map((perm) => {
                    const isChecked = selectedPermissions.includes(perm.key);
                    const IconComp = perm.icon;
                    return (
                      <div
                        key={perm.key}
                        onClick={() => togglePermission(perm.key)}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isChecked
                            ? "bg-amber-500/10 border-amber-500/40 shadow-sm"
                            : "bg-secondary/20 border-border/70 hover:bg-secondary/40"
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => togglePermission(perm.key)}
                          className="mt-0.5 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                        />
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                            <IconComp className={`w-3.5 h-3.5 shrink-0 ${isChecked ? "text-amber-400" : "text-muted-foreground"}`} />
                            <span className="truncate">{perm.label}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                            {perm.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t border-border/50 bg-secondary/20 flex-row sm:justify-between items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-mono">
            {isAdmin ? (selectedPermissions.length === 0 ? "Full Super-Admin Access" : `${selectedPermissions.length} of ${ADMIN_PERMISSIONS.length} Modules Permitted`) : "No Admin Privileges"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="rounded-xl text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || loading}
              onClick={handleSave}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs gap-1.5 shadow-md border-0"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {saving ? "Saving Roles..." : "Save Admin Role & Permissions"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
