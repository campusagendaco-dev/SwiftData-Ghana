import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session, Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithOAuth: (provider: Provider, redirectPath?: string) => Promise<{ error: any }>;
  requestPasswordReset: (email: string, redirectPath?: string) => Promise<{ error: any }>;
  updatePassword: (password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const envSiteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]" ||
    window.location.hostname.startsWith("192.168.") ||
    window.location.hostname.startsWith("10.") ||
    window.location.hostname.startsWith("172.");

  const appBaseUrl = isLocalDevHost ? window.location.origin : (envSiteUrl || window.location.origin);

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

  useEffect(() => {
    let mounted = true;
    const loadingSafetyTimeout = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 7000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          if (!mounted) return;
          setSession(session);
          setUser(session?.user ?? null);
          if (session?.user) {
            // Fetch profile/roles in background so sign-in UX is not blocked by network latency.
            void Promise.all([
              fetchProfile(session.user.id),
              checkAdminRole(session.user.id),
            ]).catch((error) => {
              console.error("Background auth profile refresh failed:", error);
            });
          } else {
            setProfile(null);
            setIsAdmin(false);
          }
        } finally {
          if (mounted) setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      try {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          void Promise.all([
            fetchProfile(session.user.id),
            checkAdminRole(session.user.id),
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

  const signUp = async (email: string, password: string, fullName: string) => {
    const normalizedEmail = normalizeEmailInput(email);
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: appBaseUrl,
        data: { full_name: fullName },
      },
    });
    return { error };
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

    // Retry once with cleaned password for copy/paste hidden-char issues.
    if (message.includes("invalid login credentials") && fallbackPassword && fallbackPassword !== password) {
      const { error: retryError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: fallbackPassword,
      });
      return { error: retryError };
    }

    return { error };
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
    <AuthContext.Provider value={{ user, session, profile, loading, isAdmin, signUp, signIn, signInWithOAuth, requestPasswordReset, updatePassword, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
