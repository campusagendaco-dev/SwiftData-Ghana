export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = any;

declare module "@/hooks/useAuth" {
  interface Profile {
    last_check_in?: string | null;
    check_in_streak?: number;
    last_spin_at?: string | null;
    store_slug?: string | null;
    registered_user_prices?: Record<string, Record<string, string>>;
    api_custom_prices?: Record<string, Record<string, number>>;
    created_at?: string;
    paystack_saved_authorizations?: any[];
  }
}
