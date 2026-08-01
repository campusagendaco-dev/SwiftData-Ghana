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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mfaStatus, setMfaStatus] = useState({ enabled: false, challenged: false });
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

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    setProfile(data as Profile | null);
  };

  const checkAdminRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    setIsAdmin(!!(data && data.length > 0));
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
      await checkAdminRole(user.id);
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
              ]).catch((error) => {
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
          ]).catch((error) => {
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

  const signOut = async () => {
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);
    } catch (error) {
      console.error("signOut error:", error);
    } finally {
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
