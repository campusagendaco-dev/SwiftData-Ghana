import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session, Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDeviceId, getBrowserFingerprint } from "@/utils/device";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  support_number: string;
  store_name: string;
  whatsapp_group_link: string | null;
  slug: string | null;
  momo_number: string;
  momo_network: string;
  momo_account_name: string;
  markups: Record<string, string>;
  agent_prices: Record<string, Record<string, string>>;
  disabled_packages: Record<string, string[]>;
  is_agent: boolean;
  onboarding_complete: boolean;
  agent_approved: boolean;
  topup_reference: string | null;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
  sub_agent_activation_markup: number;
  sub_agent_prices: Record<string, Record<string, string>>;
  referral_code: string | null;
  referred_by: string | null;
  api_key: string | null;
  api_key_prefix: string | null;
  api_key_hash: string | null;
  is_suspended?: boolean;
  credit_enabled?: boolean;
  credit_limit?: number;
  avatar_url?: string | null;
  transaction_pin?: string | null;
  api_access_enabled?: boolean;
  is_super_admin?: boolean;
  is_sub_admin?: boolean;
  store_primary_color?: string | null;
  store_logo_url?: string | null;
  store_banner_url?: string | null;
  store_description?: string | null;
  custom_domain?: string | null;
  last_security_update?: string | null;
  wallet_balance?: number;
  loyalty_points?: number;
  sms_sender_id?: string | null;
  sms_sender_status?: string | null;
}

export interface SavedAccount {
  userId: string;
  email: string;
  fullName?: string;
  phone?: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isAdmin?: boolean;
  storeName?: string;
  session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
  };
  lastActiveAt: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    referralCodeOrMetadata?: string | {
      referralCode?: string;
      phone?: string;
      storeName?: string;
      slug?: string;
      isSubAgent?: boolean;
      parentAgentId?: string;
      isAgent?: boolean;
    }
  ) => Promise<{ data: any; error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithOAuth: (provider: Provider, redirectPath?: string) => Promise<{ error: any }>;
  requestPasswordReset: (email: string, redirectPath?: string) => Promise<{ error: any }>;
  updatePassword: (password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isMfaEnabled: boolean;
  isMfaChallenged: boolean;
  refreshMfaStatus: () => Promise<void>;
  savedAccounts: SavedAccount[];
  switchAccount: (userId: string) => Promise<{ success: boolean; error?: string; expiredEmail?: string }>;
  addAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  removeSavedAccount: (userId: string) => void;
  signOutAll: () => Promise<void>;
  isAccountSwitcherOpen: boolean;
  setIsAccountSwitcherOpen: (open: boolean) => void;
  openAccountSwitcher: () => void;
}

const GLOBAL_AUTH_CONTEXT_KEY = "__SWIFT_AUTH_CONTEXT_SINGLETON__";

const AuthContext: React.Context<AuthContextType | undefined> =
  (globalThis as any)[GLOBAL_AUTH_CONTEXT_KEY] ||
  ((globalThis as any)[GLOBAL_AUTH_CONTEXT_KEY] = createContext<AuthContextType | undefined>(undefined));

const SAVED_ACCOUNTS_STORAGE_KEY = "swift_multi_saved_accounts_v1";

const getSavedAccountsFromStorage = (): SavedAccount[] => {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (err) {
    console.warn("[Auth] Failed to load saved accounts from storage:", err);
    return [];
  }
};

const persistSavedAccountsToStorage = (accounts: SavedAccount[]) => {
  try {
    localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch (err) {
    console.warn("[Auth] Failed to save accounts to storage:", err);
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mfaStatus, setMfaStatus] = useState({ enabled: false, challenged: false });
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => getSavedAccountsFromStorage());
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);

  const openAccountSwitcher = () => setIsAccountSwitcherOpen(true);

  const envSiteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  // Explicitly enforce main production domain for redirects as requested by user
  const appBaseUrl = envSiteUrl || "https://swiftdatagh.shop";

  const normalizeEmailInput = (value: string) =>
    value
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .toLowerCase();

  const cleanPasswordInput = (value: string) =>
    value
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();

  const upsertSavedAccount = (
    currentSession: Session | null,
    userProfile?: Profile | null,
    isAdminUser?: boolean
  ) => {
    if (!currentSession?.user || !currentSession.access_token || !currentSession.refresh_token) {
      return;
    }

    const currentUserId = currentSession.user.id;
    const email = currentSession.user.email || userProfile?.email || "";
    const fullName =
      userProfile?.full_name ||
      (currentSession.user.user_metadata as any)?.full_name ||
      email.split("@")[0] ||
      "User";
    const phone =
      userProfile?.phone || (currentSession.user.user_metadata as any)?.phone || "";
    const avatarUrl = userProfile?.avatar_url || null;
    const isAgent = userProfile?.is_agent || false;
    const isAdminAccount = typeof isAdminUser === "boolean" ? isAdminUser : isAdmin;
    const storeName = userProfile?.store_name || "";

    setSavedAccounts((prev) => {
      const existingIdx = prev.findIndex((acc) => acc.userId === currentUserId);
      const updatedAccount: SavedAccount = {
        userId: currentUserId,
        email,
        fullName,
        phone,
        avatarUrl,
        isAgent,
        isAdmin: isAdminAccount,
        storeName,
        session: {
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token,
          expires_at: currentSession.expires_at,
        },
        lastActiveAt: new Date().toISOString(),
      };

      let next: SavedAccount[];
      if (existingIdx >= 0) {
        next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          ...updatedAccount,
          fullName: updatedAccount.fullName || next[existingIdx].fullName,
          phone: updatedAccount.phone || next[existingIdx].phone,
          avatarUrl: updatedAccount.avatarUrl || next[existingIdx].avatarUrl,
          storeName: updatedAccount.storeName || next[existingIdx].storeName,
        };
      } else {
        next = [updatedAccount, ...prev];
      }
      persistSavedAccountsToStorage(next);
      return next;
    });
  };

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    const prof = (data as Profile | null) || null;
    setProfile(prof);
    return prof;
  };

  const checkAdminRole = async (userId: string): Promise<boolean> => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    const adminRole = !!(data && data.length > 0);
    setIsAdmin(adminRole);
    return adminRole;
  };

  const refreshProfile = async () => {
    if (user) {
      const [profData, adminData] = await Promise.all([
        fetchProfile(user.id),
        checkAdminRole(user.id),
      ]);
      if (session) {
        upsertSavedAccount(session, profData, adminData);
      }
    }
  };

  const refreshMfaStatus = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      
      const { data: factorsData } = await supabase.auth.mfa.listFactors().catch(() => ({ data: null }));
      const hasTotpFactor = (factorsData?.totp || []).some((f: any) => f.status === "verified");

      const enabled = data.nextLevel === "aal2" && hasTotpFactor;
      const challenged = data.currentLevel === "aal1" && enabled;
      
      setMfaStatus({ enabled, challenged });
    } catch (e) {
      console.error("[MFA] Fetch assurance levels error:", e);
    }
  };

  useEffect(() => {
    let mounted = true;
    const loadingSafetyTimeout = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 7000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        try {
          if (!mounted) return;
          setSession(session);
          setUser(session?.user ?? null);
          if (session?.user) {
            const userId = session.user.id;
            const token = session.access_token;
            
            // Defer profile loading and functions out of Gotrue state machine lock scope
            setTimeout(() => {
              if (!mounted) return;
              void Promise.all([
                fetchProfile(userId),
                checkAdminRole(userId),
                refreshMfaStatus(),
              ]).then(([profData, adminData]) => {
                if (mounted && session) {
                  upsertSavedAccount(session, profData, adminData);
                }
              }).catch((error) => {
                console.error("Background auth profile refresh failed:", error);
              });

              // Log IP and update device_id and browser_fingerprint on every fresh sign-in (not on token refreshes)
              if (event === "SIGNED_IN") {
                const localDeviceId = getOrCreateDeviceId();
                const fingerprint = getBrowserFingerprint();
                void supabase
                  .from("profiles")
                  .update({ 
                    device_id: localDeviceId,
                    browser_fingerprint: fingerprint
                  })
                  .eq("user_id", userId);

                void supabase.functions.invoke("log-user-activity", {
                  headers: { Authorization: `Bearer ${token}` },
                });
              }
            }, 0);
          } else {
            setProfile(null);
            setIsAdmin(false);
            setMfaStatus({ enabled: false, challenged: false });
          }
        } finally {
          if (mounted) setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data, error }) => {
      try {
        if (!mounted) return;
        
        if (error) {
          console.warn("Initial Supabase session fetch encountered an error:", error.message);
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch (signOutErr) {
            console.error("Local signout failed during session error handling:", signOutErr);
          }
          setSession(null);
          setUser(null);
          setProfile(null);
          setIsAdmin(false);
          return;
        }

        const session = data?.session ?? null;
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          void Promise.all([
            fetchProfile(session.user.id),
            checkAdminRole(session.user.id),
            refreshMfaStatus(),
          ]).then(([profData, adminData]) => {
            if (mounted && session) {
              upsertSavedAccount(session, profData, adminData);
            }
          }).catch((error) => {
            console.error("Initial auth profile refresh failed:", error);
          });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      window.clearTimeout(loadingSafetyTimeout);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    referralCodeOrMetadata?: string | {
      referralCode?: string;
      phone?: string;
      storeName?: string;
      slug?: string;
      isSubAgent?: boolean;
      parentAgentId?: string;
      isAgent?: boolean;
    }
  ) => {
    const normalizedEmail = normalizeEmailInput(email);
    
    let referralCode: string | undefined;
    let phone: string | undefined;
    let storeName: string | undefined;
    let slug: string | undefined;
    let isSubAgent = false;
    let parentAgentId: string | undefined;
    let isAgent = false;

    if (typeof referralCodeOrMetadata === "string") {
      referralCode = referralCodeOrMetadata;
    } else if (referralCodeOrMetadata && typeof referralCodeOrMetadata === "object") {
      referralCode = referralCodeOrMetadata.referralCode;
      phone = referralCodeOrMetadata.phone;
      storeName = referralCodeOrMetadata.storeName;
      slug = referralCodeOrMetadata.slug;
      isSubAgent = referralCodeOrMetadata.isSubAgent || false;
      parentAgentId = referralCodeOrMetadata.parentAgentId;
      isAgent = referralCodeOrMetadata.isAgent || false;
    }

    const role = isAgent ? "agent" : "user";

    const deviceId = getOrCreateDeviceId();
    const fingerprint = getBrowserFingerprint();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${appBaseUrl}/auth/callback?role=${role}`,
        data: { 
          full_name: fullName,
          referral_code: referralCode || null,
          phone: phone || "",
          store_name: storeName || "",
          slug: slug || null,
          is_sub_agent: isSubAgent,
          parent_agent_id: parentAgentId || null,
          is_agent: isAgent,
          device_id: deviceId,
          browser_fingerprint: fingerprint
        },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = normalizeEmailInput(email);
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (!error) return { error: null };

    const message = String(error.message || "").toLowerCase();
    const fallbackPassword = cleanPasswordInput(password);

    let finalError = error;

    // Retry once with cleaned password for copy/paste hidden-char issues.
    if (message.includes("invalid login credentials") && fallbackPassword && fallbackPassword !== password) {
      const { error: retryError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: fallbackPassword,
      });
      finalError = retryError;
    }

    if (finalError) {
      // Call failed-login-tracker edge function (non-blocking)
      supabase.functions.invoke("failed-login-tracker", {
        body: { email: normalizedEmail }
      }).catch(err => console.warn("Failed to log failed login attempt:", err));
    }

    return { error: finalError };
  };

  const signInWithOAuth = async (provider: Provider, redirectPath = "/auth/callback") => {
    const normalizedPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${appBaseUrl}${normalizedPath}`,
      },
    });
    return { error };
  };

  const requestPasswordReset = async (email: string, redirectPath = "/reset-password") => {
    const normalizedEmail = normalizeEmailInput(email);
    const normalizedPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${appBaseUrl}${normalizedPath}`,
    });
    return { error };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  };

  const switchAccount = async (
    targetUserId: string
  ): Promise<{ success: boolean; error?: string; expiredEmail?: string }> => {
    try {
      const targetAccount = savedAccounts.find((acc) => acc.userId === targetUserId);
      if (!targetAccount) {
        return { success: false, error: "Account not found in your saved accounts list." };
      }

      if (session?.user?.id === targetUserId) {
        setIsAccountSwitcherOpen(false);
        return { success: true };
      }

      // Check if target account has valid session tokens
      if (!targetAccount.session?.access_token || !targetAccount.session?.refresh_token) {
        return {
          success: false,
          error: "Session expired. Please enter your password to reconnect.",
          expiredEmail: targetAccount.email,
        };
      }

      // Preserve current session before switching
      const activeSessionBackup = session;
      if (session?.user && session.access_token && session.refresh_token) {
        upsertSavedAccount(session, profile, isAdmin);
      }

      setLoading(true);

      // Check if access_token is expired (JWT access tokens expire after 1 hour)
      const nowSec = Math.floor(Date.now() / 1000);
      let isAccessTokenExpired = true;
      if (typeof targetAccount.session.expires_at === "number") {
        isAccessTokenExpired = targetAccount.session.expires_at <= nowSec;
      } else if (targetAccount.session.access_token) {
        try {
          const parts = targetAccount.session.access_token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            if (typeof payload.exp === "number") {
              isAccessTokenExpired = payload.exp <= nowSec;
            }
          }
        } catch {
          isAccessTokenExpired = true;
        }
      }

      let authResult: { data: { session: Session | null; user: User | null }; error: any } = {
        data: { session: null, user: null },
        error: null,
      };

      if (isAccessTokenExpired && targetAccount.session.refresh_token) {
        // If access token is expired, call refreshSession directly with the refresh_token.
        // This avoids calling /auth/v1/user with an expired access token (which triggers HTTP 403 Forbidden in console).
        authResult = await supabase.auth.refreshSession({
          refresh_token: targetAccount.session.refresh_token,
        });
      } else {
        // Access token is still valid within its expiration window, use setSession
        authResult = await supabase.auth.setSession({
          access_token: targetAccount.session.access_token,
          refresh_token: targetAccount.session.refresh_token,
        });

        // If setSession failed, try refreshing with the refresh token as fallback
        if (authResult.error && targetAccount.session.refresh_token) {
          authResult = await supabase.auth.refreshSession({
            refresh_token: targetAccount.session.refresh_token,
          });
        }
      }

      const { data, error } = authResult;

      if (error || !data.session) {
        // Clear dead session from saved account so it doesn't repeatedly retry invalid tokens
        setSavedAccounts((prev) => {
          const next = prev.map((acc) =>
            acc.userId === targetUserId ? { ...acc, session: undefined } : acc
          );
          persistSavedAccountsToStorage(next);
          return next;
        });

        // Restore active session backup so the active user is not logged out!
        if (activeSessionBackup?.access_token && activeSessionBackup?.refresh_token) {
          await supabase.auth.setSession({
            access_token: activeSessionBackup.access_token,
            refresh_token: activeSessionBackup.refresh_token,
          }).catch(() => {});
        }
        const errorMsg = error?.message || "Session expired. Please re-authenticate.";
        console.warn("[Auth] Failed to switch session:", errorMsg);
        return {
          success: false,
          error: errorMsg,
          expiredEmail: targetAccount.email,
        };
      }

      // Update last active
      setSavedAccounts((prev) => {
        const next = prev.map((acc) =>
          acc.userId === targetUserId
            ? {
                ...acc,
                lastActiveAt: new Date().toISOString(),
                session: {
                  access_token: data.session!.access_token,
                  refresh_token: data.session!.refresh_token,
                  expires_at: data.session!.expires_at,
                },
              }
            : acc
        );
        persistSavedAccountsToStorage(next);
        return next;
      });

      setSession(data.session);
      setUser(data.session.user);

      let newProf: Profile | null = null;
      let newAdmin = false;
      try {
        const [profData, adminData] = await Promise.all([
          fetchProfile(data.session.user.id),
          checkAdminRole(data.session.user.id),
          refreshMfaStatus(),
        ]);
        newProf = profData;
        newAdmin = adminData;
      } catch (err) {
        console.error("Profile refresh after switch failed:", err);
      }

      if (newProf) {
        upsertSavedAccount(data.session, newProf, newAdmin);
      }

      setIsAccountSwitcherOpen(false);
      return { success: true };
    } catch (err: any) {
      console.error("[Auth] switchAccount exception:", err);
      return { success: false, error: err?.message || "Failed to switch account" };
    } finally {
      setLoading(false);
    }
  };

  const addAccount = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    const normalizedEmail = normalizeEmailInput(email);
    const cleanedPassword = cleanPasswordInput(password);
    const previousSession = session;

    // Preserve active session first
    if (session?.user && session.access_token && session.refresh_token) {
      upsertSavedAccount(session, profile, isAdmin);
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: cleanedPassword,
      });

      if (error || !data.session) {
        // Restore previous session if login failed
        if (previousSession?.access_token && previousSession?.refresh_token) {
          await supabase.auth.setSession({
            access_token: previousSession.access_token,
            refresh_token: previousSession.refresh_token,
          }).catch(console.error);
        }
        return { success: false, error: error?.message || "Invalid credentials." };
      }

      const newSession = data.session;
      const newUserId = newSession.user.id;

      const [{ data: newProfile }, { data: adminRoles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", newUserId).single(),
        supabase.from("user_roles").select("role").eq("user_id", newUserId).eq("role", "admin"),
      ]);

      const isNewAdmin = !!(adminRoles && adminRoles.length > 0);

      const newSavedAccount: SavedAccount = {
        userId: newUserId,
        email: normalizedEmail,
        fullName:
          (newProfile as any)?.full_name ||
          (newSession.user.user_metadata as any)?.full_name ||
          normalizedEmail.split("@")[0],
        phone: (newProfile as any)?.phone || (newSession.user.user_metadata as any)?.phone || "",
        avatarUrl: (newProfile as any)?.avatar_url || null,
        isAgent: (newProfile as any)?.is_agent || false,
        isAdmin: isNewAdmin,
        storeName: (newProfile as any)?.store_name || "",
        session: {
          access_token: newSession.access_token,
          refresh_token: newSession.refresh_token,
          expires_at: newSession.expires_at,
        },
        lastActiveAt: new Date().toISOString(),
      };

      setSavedAccounts((prev) => {
        const filtered = prev.filter((acc) => acc.userId !== newUserId);
        const next = [newSavedAccount, ...filtered];
        persistSavedAccountsToStorage(next);
        return next;
      });

      setSession(newSession);
      setUser(newSession.user);
      setProfile(newProfile as Profile | null);
      setIsAdmin(isNewAdmin);
      await refreshMfaStatus();

      setIsAccountSwitcherOpen(false);
      return { success: true };
    } catch (err: any) {
      console.error("[Auth] addAccount exception:", err);
      if (previousSession?.access_token && previousSession?.refresh_token) {
        await supabase.auth.setSession({
          access_token: previousSession.access_token,
          refresh_token: previousSession.refresh_token,
        }).catch(console.error);
      }
      return { success: false, error: err?.message || "Failed to add account" };
    } finally {
      setLoading(false);
    }
  };

  const removeSavedAccount = (targetUserId: string) => {
    const updated = savedAccounts.filter((acc) => acc.userId !== targetUserId);
    setSavedAccounts(updated);
    persistSavedAccountsToStorage(updated);

    if (session?.user?.id === targetUserId) {
      if (updated.length > 0) {
        const sorted = [...updated].sort(
          (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        );
        void switchAccount(sorted[0].userId);
      } else {
        void signOut();
      }
    }
  };

  const signOutAll = async () => {
    try {
      localStorage.removeItem(SAVED_ACCOUNTS_STORAGE_KEY);
      setSavedAccounts([]);
      await signOut();
      setIsAccountSwitcherOpen(false);
    } catch (err) {
      console.error("[Auth] signOutAll error:", err);
    }
  };

  const signOut = async () => {
    const currentUserId = user?.id;
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);
    } catch (error) {
      console.error("signOut error:", error);
    } finally {
      if (currentUserId) {
        setSavedAccounts((prev) => {
          const next = prev.filter((acc) => acc.userId !== currentUserId);
          persistSavedAccountsToStorage(next);
          return next;
        });
      }
      setSession(null);
      setUser(null);
      setProfile(null);
      setIsAdmin(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isAdmin,
        signUp,
        signIn,
        signInWithOAuth,
        requestPasswordReset,
        updatePassword,
        signOut,
        refreshProfile,
        isMfaEnabled: mfaStatus.enabled,
        isMfaChallenged: mfaStatus.challenged,
        refreshMfaStatus,
        savedAccounts,
        switchAccount,
        addAccount,
        removeSavedAccount,
        signOutAll,
        isAccountSwitcherOpen,
        setIsAccountSwitcherOpen,
        openAccountSwitcher,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const defaultAuthFallback: AuthContextType = {
  user: null,
  session: null,
  profile: null,
  loading: true,
  isAdmin: false,
  signUp: async () => ({ data: null, error: null }),
  signIn: async () => ({ error: null }),
  signInWithOAuth: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
  isMfaEnabled: false,
  isMfaChallenged: false,
  refreshMfaStatus: async () => {},
  savedAccounts: [],
  switchAccount: async () => ({ success: false, error: "Auth initializing..." }),
  addAccount: async () => ({ success: false, error: "Auth initializing..." }),
  removeSavedAccount: () => {},
  signOutAll: async () => {},
  isAccountSwitcherOpen: false,
  setIsAccountSwitcherOpen: () => {},
  openAccountSwitcher: () => {},
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    return defaultAuthFallback;
  }
  return context;
};
