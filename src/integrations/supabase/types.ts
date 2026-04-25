export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      airtime_to_cash_requests: {
        Row: {
          admin_note: string | null
          amount: number
          cash_value: number
          created_at: string
          id: string
          network: string
          reference_code: string | null
          sender_phone: string
          status: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          cash_value: number
          created_at?: string
          id?: string
          network: string
          reference_code?: string | null
          sender_phone: string
          status?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          cash_value?: number
          created_at?: string
          id?: string
          network?: string
          reference_code?: string | null
          sender_phone?: string
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string | null
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      global_package_settings: {
        Row: {
          agent_price: number | null
          api_price: number | null
          id: string
          is_unavailable: boolean
          network: string
          package_size: string
          public_price: number | null
          updated_at: string
        }
        Insert: {
          agent_price?: number | null
          api_price?: number | null
          id?: string
          is_unavailable?: boolean
          network: string
          package_size: string
          public_price?: number | null
          updated_at?: string
        }
        Update: {
          agent_price?: number | null
          api_price?: number | null
          id?: string
          is_unavailable?: boolean
          network?: string
          package_size?: string
          public_price?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_settings: {
        Row: {
          id: number
          is_enabled: boolean
          message: string
          updated_at: string
        }
        Insert: {
          id?: number
          is_enabled?: boolean
          message?: string
          updated_at?: string
        }
        Update: {
          id?: number
          is_enabled?: boolean
          message?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_dismissals: {
        Row: {
          created_at: string
          id: string
          notification_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_dismissals_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          message: string
          target_type: string
          target_user_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          target_type?: string
          target_user_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          target_type?: string
          target_user_id?: string | null
          title?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          afa_date_of_birth: string | null
          afa_email: string | null
          afa_full_name: string | null
          afa_ghana_card: string | null
          afa_occupation: string | null
          afa_residence: string | null
          agent_id: string
          amount: number
          created_at: string
          customer_phone: string | null
          discount_amount: number | null
          failure_reason: string | null
          id: string
          last_retry_at: string | null
          network: string | null
          order_type: string
          package_size: string | null
          parent_agent_id: string | null
          parent_profit: number
          parent_profit_credited: boolean | null
          profit: number
          profit_credited: boolean | null
          promo_code_id: string | null
          retry_count: number | null
          sms_reminder_sent: boolean | null
          status: string
          updated_at: string
          utility_account_name: string | null
          utility_account_number: string | null
          utility_provider: string | null
          utility_type: string | null
        }
        Insert: {
          afa_date_of_birth?: string | null
          afa_email?: string | null
          afa_full_name?: string | null
          afa_ghana_card?: string | null
          afa_occupation?: string | null
          afa_residence?: string | null
          agent_id?: string
          amount?: number
          created_at?: string
          customer_phone?: string | null
          discount_amount?: number | null
          failure_reason?: string | null
          id?: string
          last_retry_at?: string | null
          network?: string | null
          order_type?: string
          package_size?: string | null
          parent_agent_id?: string | null
          parent_profit?: number
          parent_profit_credited?: boolean | null
          profit?: number
          profit_credited?: boolean | null
          promo_code_id?: string | null
          retry_count?: number | null
          sms_reminder_sent?: boolean | null
          status?: string
          updated_at?: string
          utility_account_name?: string | null
          utility_account_number?: string | null
          utility_provider?: string | null
          utility_type?: string | null
        }
        Update: {
          afa_date_of_birth?: string | null
          afa_email?: string | null
          afa_full_name?: string | null
          afa_ghana_card?: string | null
          afa_occupation?: string | null
          afa_residence?: string | null
          agent_id?: string
          amount?: number
          created_at?: string
          customer_phone?: string | null
          discount_amount?: number | null
          failure_reason?: string | null
          id?: string
          last_retry_at?: string | null
          network?: string | null
          order_type?: string
          package_size?: string | null
          parent_agent_id?: string | null
          parent_profit?: number
          parent_profit_credited?: boolean | null
          profit?: number
          profit_credited?: boolean | null
          promo_code_id?: string | null
          retry_count?: number | null
          sms_reminder_sent?: boolean | null
          status?: string
          updated_at?: string
          utility_account_name?: string | null
          utility_account_number?: string | null
          utility_provider?: string | null
          utility_type?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agent_approved: boolean
          agent_prices: Json
          api_access_enabled: boolean | null
          api_allowed_actions: string[] | null
          api_custom_prices: Json | null
          api_ip_whitelist: string[] | null
          api_key: string | null
          api_last_used_at: string | null
          api_rate_limit: number | null
          api_requests_reset_at: string | null
          api_requests_today: number | null
          api_requests_total: number | null
          api_webhook_url: string | null
          created_at: string
          disabled_packages: Json
          email: string
          full_name: string
          id: string
          is_agent: boolean
          is_sub_agent: boolean
          markups: Json
          momo_account_name: string
          momo_network: string
          momo_number: string
          onboarding_complete: boolean
          parent_agent_id: string | null
          phone: string
          referral_code: string | null
          referred_by: string | null
          slug: string | null
          store_banner_url: string | null
          store_logo_url: string | null
          store_name: string
          store_primary_color: string | null
          sub_agent_activation_markup: number
          sub_agent_approved: boolean
          sub_agent_prices: Json
          support_number: string
          topup_reference: string | null
          updated_at: string
          user_id: string
          whatsapp_group_link: string | null
          whatsapp_number: string
        }
        Insert: {
          agent_approved?: boolean
          agent_prices?: Json
          api_access_enabled?: boolean | null
          api_allowed_actions?: string[] | null
          api_custom_prices?: Json | null
          api_ip_whitelist?: string[] | null
          api_key?: string | null
          api_last_used_at?: string | null
          api_rate_limit?: number | null
          api_requests_reset_at?: string | null
          api_requests_today?: number | null
          api_requests_total?: number | null
          api_webhook_url?: string | null
          created_at?: string
          disabled_packages?: Json
          email?: string
          full_name?: string
          id?: string
          is_agent?: boolean
          is_sub_agent?: boolean
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          parent_agent_id?: string | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          slug?: string | null
          store_banner_url?: string | null
          store_logo_url?: string | null
          store_name?: string
          store_primary_color?: string | null
          sub_agent_activation_markup?: number
          sub_agent_approved?: boolean
          sub_agent_prices?: Json
          support_number?: string
          topup_reference?: string | null
          updated_at?: string
          user_id: string
          whatsapp_group_link?: string | null
          whatsapp_number?: string
        }
        Update: {
          agent_approved?: boolean
          agent_prices?: Json
          api_access_enabled?: boolean | null
          api_allowed_actions?: string[] | null
          api_custom_prices?: Json | null
          api_ip_whitelist?: string[] | null
          api_key?: string | null
          api_last_used_at?: string | null
          api_rate_limit?: number | null
          api_requests_reset_at?: string | null
          api_requests_today?: number | null
          api_requests_total?: number | null
          api_webhook_url?: string | null
          created_at?: string
          disabled_packages?: Json
          email?: string
          full_name?: string
          id?: string
          is_agent?: boolean
          is_sub_agent?: boolean
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          parent_agent_id?: string | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          slug?: string | null
          store_banner_url?: string | null
          store_logo_url?: string | null
          store_name?: string
          store_primary_color?: string | null
          sub_agent_activation_markup?: number
          sub_agent_approved?: boolean
          sub_agent_prices?: Json
          support_number?: string
          topup_reference?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_group_link?: string | null
          whatsapp_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      promo_claims: {
        Row: {
          claimed_by_phone: string
          created_at: string | null
          id: string
          order_id: string | null
          promo_code_id: string
        }
        Insert: {
          claimed_by_phone: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          promo_code_id: string
        }
        Update: {
          claimed_by_phone?: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          promo_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_claims_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string | null
          current_uses: number
          discount_percentage: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number
        }
        Insert: {
          code: string
          created_at?: string | null
          current_uses?: number
          discount_percentage: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
        }
        Update: {
          code?: string
          created_at?: string | null
          current_uses?: number
          discount_percentage?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          credit_amount: number
          credited: boolean
          credited_at: string | null
          id: string
          referee_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          credit_amount?: number
          credited?: boolean
          credited_at?: string | null
          id?: string
          referee_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          credit_amount?: number
          credited?: boolean
          credited_at?: string | null
          id?: string
          referee_id?: string
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      saved_customers: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          name: string
          network: string
          phone: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          name: string
          network: string
          phone: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          name?: string
          network?: string
          phone?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          last_message: string | null
          last_message_at: string
          unread_count_admin: number | null
          unread_count_user: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_message?: string | null
          last_message_at?: string
          unread_count_admin?: number | null
          unread_count_user?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_message?: string | null
          last_message_at?: string
          unread_count_admin?: number | null
          unread_count_user?: number | null
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_read: boolean | null
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_response: string | null
          created_at: string | null
          description: string
          id: string
          status: string
          subject: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_response?: string | null
          created_at?: string | null
          description: string
          id?: string
          status?: string
          subject: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_response?: string | null
          created_at?: string | null
          description?: string
          id?: string
          status?: string
          subject?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          at_markup_percentage: number | null
          auto_api_switch: boolean
          auto_pending_sms_enabled: boolean | null
          auto_pending_sms_message: string | null
          backup_provider: string
          customer_service_number: string
          dark_mode_enabled: boolean
          disable_ordering: boolean
          free_data_claims_count: number | null
          free_data_enabled: boolean | null
          free_data_max_claims: number | null
          free_data_network: string | null
          free_data_package_size: string | null
          holiday_message: string
          holiday_mode_enabled: boolean
          hubtel_client_id: string | null
          hubtel_client_secret: string | null
          id: number
          manual_credit_sms_message: string | null
          mtn_markup_percentage: number | null
          order_failed_sms_message: string | null
          payment_success_sms_message: string | null
          paystack_secret_key: string | null
          preferred_provider: string
          store_visitor_popup_enabled: boolean
          sub_agent_base_fee: number
          support_channel_link: string
          telecel_markup_percentage: number | null
          twilio_account_sid: string
          twilio_auth_token: string
          twilio_from_number: string
          txtconnect_api_key: string | null
          txtconnect_sender_id: string | null
          updated_at: string
          updated_by: string | null
          wallet_topup_sms_message: string | null
          withdrawal_completed_sms_message: string | null
          withdrawal_request_sms_message: string | null
        }
        Insert: {
          at_markup_percentage?: number | null
          auto_api_switch?: boolean
          auto_pending_sms_enabled?: boolean | null
          auto_pending_sms_message?: string | null
          backup_provider?: string
          customer_service_number?: string
          dark_mode_enabled?: boolean
          disable_ordering?: boolean
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string
          holiday_mode_enabled?: boolean
          hubtel_client_id?: string | null
          hubtel_client_secret?: string | null
          id?: number
          manual_credit_sms_message?: string | null
          mtn_markup_percentage?: number | null
          order_failed_sms_message?: string | null
          payment_success_sms_message?: string | null
          paystack_secret_key?: string | null
          preferred_provider?: string
          store_visitor_popup_enabled?: boolean
          sub_agent_base_fee?: number
          support_channel_link?: string
          telecel_markup_percentage?: number | null
          twilio_account_sid?: string
          twilio_auth_token?: string
          twilio_from_number?: string
          txtconnect_api_key?: string | null
          txtconnect_sender_id?: string | null
          updated_at?: string
          updated_by?: string | null
          wallet_topup_sms_message?: string | null
          withdrawal_completed_sms_message?: string | null
          withdrawal_request_sms_message?: string | null
        }
        Update: {
          at_markup_percentage?: number | null
          auto_api_switch?: boolean
          auto_pending_sms_enabled?: boolean | null
          auto_pending_sms_message?: string | null
          backup_provider?: string
          customer_service_number?: string
          dark_mode_enabled?: boolean
          disable_ordering?: boolean
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string
          holiday_mode_enabled?: boolean
          hubtel_client_id?: string | null
          hubtel_client_secret?: string | null
          id?: number
          manual_credit_sms_message?: string | null
          mtn_markup_percentage?: number | null
          order_failed_sms_message?: string | null
          payment_success_sms_message?: string | null
          paystack_secret_key?: string | null
          preferred_provider?: string
          store_visitor_popup_enabled?: boolean
          sub_agent_base_fee?: number
          support_channel_link?: string
          telecel_markup_percentage?: number | null
          twilio_account_sid?: string
          twilio_auth_token?: string
          twilio_from_number?: string
          txtconnect_api_key?: string | null
          txtconnect_sender_id?: string | null
          updated_at?: string
          updated_by?: string | null
          wallet_topup_sms_message?: string | null
          withdrawal_completed_sms_message?: string | null
          withdrawal_request_sms_message?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          agent_id: string
          balance: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          agent_id: string
          amount: number
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          amount: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          amount?: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      user_sales_stats: {
        Row: {
          total_commissions_paid: number | null
          total_fulfilled_orders: number | null
          total_own_profit: number | null
          total_sales_volume: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_promo_code: {
        Args: { p_code: string; p_order_id?: string; p_phone: string }
        Returns: {
          discount_percentage: number
          is_free: boolean
          promo_id: string
        }[]
      }
      credit_order_profits: { Args: { p_order_id: string }; Returns: Json }
      credit_wallet: {
        Args: { p_agent_id: string; p_amount: number }
        Returns: Json
      }
      debit_wallet: {
        Args: { p_agent_id: string; p_amount: number }
        Returns: Json
      }
      get_agent_leaderboard: {
        Args: never
        Returns: {
          agent_name: string
          day_orders: number
          is_current_user: boolean
          rank_position: number
          week_orders: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_api_usage: { Args: { p_user_id: string }; Returns: undefined }
      request_withdrawal: {
        Args: { p_agent_id: string; p_amount: number }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
