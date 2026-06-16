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
        swift_beneficiaries: {
          Row: {
            id: string
            user_id: string
            name: string
            account_number: string
            network_or_bank: string
            type: string
            created_at: string
            last_used_at: string | null
            usage_count: number | null
          }
          Insert: {
            id?: string
            user_id: string
            name: string
            account_number: string
            network_or_bank: string
            type: string
            created_at?: string
            last_used_at?: string | null
            usage_count?: number | null
          }
          Update: {
            id?: string
            user_id?: string
            name?: string
            account_number?: string
            network_or_bank?: string
            type?: string
            created_at?: string
            last_used_at?: string | null
            usage_count?: number | null
          }
          Relationships: [
            {
              foreignKeyName: "swift_beneficiaries_user_id_fkey"
              columns: ["user_id"]
              isOneToOne: false
              referencedRelation: "profiles"
              referencedColumns: ["user_id"]
            }
          ]
        }

      admin_action_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
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
      api_logs: {
        Row: {
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          log_reference: string | null
          method: string
          request_payload: Json | null
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          log_reference?: string | null
          method: string
          request_payload?: Json | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          log_reference?: string | null
          method?: string
          request_payload?: Json | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      api_rate_limit_counters: {
        Row: {
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
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
            referencedRelation: "agent_stores"
            referencedColumns: ["user_id"]
          },
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
          cost_price: number | null
          id: string
          is_unavailable: boolean
          network: string
          package_size: string
          public_price: number | null
          sub_agent_price: number | null
          updated_at: string
        }
        Insert: {
          agent_price?: number | null
          api_price?: number | null
          cost_price?: number | null
          id?: string
          is_unavailable?: boolean
          network: string
          package_size: string
          public_price?: number | null
          sub_agent_price?: number | null
          updated_at?: string
        }
        Update: {
          agent_price?: number | null
          api_price?: number | null
          cost_price?: number | null
          id?: string
          is_unavailable?: boolean
          network?: string
          package_size?: string
          public_price?: number | null
          sub_agent_price?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          id: string
          key: string
          response_body: Json
          status_code: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          response_body: Json
          status_code?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          response_body?: Json
          status_code?: number
          user_id?: string
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
      menu_banners: {
        Row: {
          created_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          priority: number | null
          target_url: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          priority?: number | null
          target_url?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          priority?: number | null
          target_url?: string | null
          updated_at?: string | null
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
          cost_price: number | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          discount_amount: number | null
          failure_reason: string | null
          id: string
          last_retry_at: string | null
          metadata: Json | null
          network: string | null
          order_type: string
          package_size: string | null
          parent_agent_id: string | null
          parent_profit: number
          parent_profit_credited: boolean | null
          paystack_fee: number | null
          paystack_verified_amount: number | null
          profit: number
          profit_credited: boolean | null
          promo_code_id: string | null
          provider_id: string | null
          provider_order_id: string | null
          provider_response: Json | null
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
          cost_price?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          failure_reason?: string | null
          id?: string
          last_retry_at?: string | null
          metadata?: Json | null
          network?: string | null
          order_type?: string
          package_size?: string | null
          parent_agent_id?: string | null
          parent_profit?: number
          parent_profit_credited?: boolean | null
          paystack_fee?: number | null
          paystack_verified_amount?: number | null
          profit?: number
          profit_credited?: boolean | null
          promo_code_id?: string | null
          provider_id?: string | null
          provider_order_id?: string | null
          provider_response?: Json | null
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
          cost_price?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          failure_reason?: string | null
          id?: string
          last_retry_at?: string | null
          metadata?: Json | null
          network?: string | null
          order_type?: string
          package_size?: string | null
          parent_agent_id?: string | null
          parent_profit?: number
          parent_profit_credited?: boolean | null
          paystack_fee?: number | null
          paystack_verified_amount?: number | null
          profit?: number
          profit_credited?: boolean | null
          promo_code_id?: string | null
          provider_id?: string | null
          provider_order_id?: string | null
          provider_response?: Json | null
          retry_count?: number | null
          sms_reminder_sent?: boolean | null
          status?: string
          updated_at?: string
          utility_account_name?: string | null
          utility_account_number?: string | null
          utility_provider?: string | null
          utility_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_notes: string | null
          agent_approved: boolean
          agent_prices: Json
          api_access_enabled: boolean | null
          api_allowed_actions: string[] | null
          api_custom_prices: Json | null
          api_ip_whitelist: string[] | null
          api_key: string | null
          api_key_hash: string | null
          api_key_prefix: string | null
          api_last_used_at: string | null
          api_rate_limit: number | null
          api_requests_reset_at: string | null
          api_requests_today: number | null
          api_requests_total: number | null
          api_secret_key_hash: string | null
          api_test_mode: boolean | null
          api_webhook_url: string | null
          avatar_url: string | null
          biometric_enabled: boolean | null
          check_in_streak: number | null
          created_at: string
          disabled_packages: Json
          email: string
          first_purchase_bonus_claimed: boolean | null
          full_name: string
          id: string
          is_agent: boolean
          is_sub_agent: boolean
          is_suspended: boolean
          last_check_in: string | null
          last_ip: string | null
          last_location: string | null
          last_security_update: string | null
          last_seen_at: string | null
          last_spin_at: string | null
          login_count: number
          markups: Json
          momo_account_name: string
          momo_network: string
          momo_number: string
          onboarding_complete: boolean
          parent_agent_id: string | null
          paystack_customer_code: string | null
          paystack_saved_authorizations: Json | null
          phone: string
          referral_code: string | null
          referred_by: string | null
          slug: string | null
          sms_opt_out: boolean
          store_banner_url: string | null
          store_logo_url: string | null
          store_name: string
          store_primary_color: string | null
          sub_agent_activation_markup: number
          sub_agent_approved: boolean
          sub_agent_prices: Json
          support_number: string
          topup_reference: string | null
          transaction_pin: string | null
          updated_at: string
          user_id: string
          wa_bot_api_key: string | null
          wa_bot_enabled: boolean | null
          wa_bot_greeting: string | null
          whatsapp_group_link: string | null
          whatsapp_number: string
          vendor_preferences: Json | null
        }
        Insert: {
          admin_notes?: string | null
          agent_approved?: boolean
          agent_prices?: Json
          api_access_enabled?: boolean | null
          api_allowed_actions?: string[] | null
          api_custom_prices?: Json | null
          api_ip_whitelist?: string[] | null
          api_key?: string | null
          api_key_hash?: string | null
          api_key_prefix?: string | null
          api_last_used_at?: string | null
          api_rate_limit?: number | null
          api_requests_reset_at?: string | null
          api_requests_today?: number | null
          api_requests_total?: number | null
          api_secret_key_hash?: string | null
          api_test_mode?: boolean | null
          api_webhook_url?: string | null
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          check_in_streak?: number | null
          created_at?: string
          disabled_packages?: Json
          email?: string
          first_purchase_bonus_claimed?: boolean | null
          full_name?: string
          id?: string
          is_agent?: boolean
          is_sub_agent?: boolean
          is_suspended?: boolean
          last_check_in?: string | null
          last_ip?: string | null
          last_location?: string | null
          last_security_update?: string | null
          last_seen_at?: string | null
          last_spin_at?: string | null
          login_count?: number
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          parent_agent_id?: string | null
          paystack_customer_code?: string | null
          paystack_saved_authorizations?: Json | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          slug?: string | null
          sms_opt_out?: boolean
          store_banner_url?: string | null
          store_logo_url?: string | null
          store_name?: string
          store_primary_color?: string | null
          sub_agent_activation_markup?: number
          sub_agent_approved?: boolean
          sub_agent_prices?: Json
          support_number?: string
          topup_reference?: string | null
          transaction_pin?: string | null
          updated_at?: string
          user_id: string
          wa_bot_api_key?: string | null
          wa_bot_enabled?: boolean | null
          wa_bot_greeting?: string | null
          whatsapp_group_link?: string | null
          whatsapp_number?: string
          vendor_preferences?: Json | null
        }
        Update: {
          admin_notes?: string | null
          agent_approved?: boolean
          agent_prices?: Json
          api_access_enabled?: boolean | null
          api_allowed_actions?: string[] | null
          api_custom_prices?: Json | null
          api_ip_whitelist?: string[] | null
          api_key?: string | null
          api_key_hash?: string | null
          api_key_prefix?: string | null
          api_last_used_at?: string | null
          api_rate_limit?: number | null
          api_requests_reset_at?: string | null
          api_requests_today?: number | null
          api_requests_total?: number | null
          api_secret_key_hash?: string | null
          api_test_mode?: boolean | null
          api_webhook_url?: string | null
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          check_in_streak?: number | null
          created_at?: string
          disabled_packages?: Json
          email?: string
          first_purchase_bonus_claimed?: boolean | null
          full_name?: string
          id?: string
          is_agent?: boolean
          is_sub_agent?: boolean
          is_suspended?: boolean
          last_check_in?: string | null
          last_ip?: string | null
          last_location?: string | null
          last_security_update?: string | null
          last_seen_at?: string | null
          last_spin_at?: string | null
          login_count?: number
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          parent_agent_id?: string | null
          paystack_customer_code?: string | null
          paystack_saved_authorizations?: Json | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          slug?: string | null
          sms_opt_out?: boolean
          store_banner_url?: string | null
          store_logo_url?: string | null
          store_name?: string
          store_primary_color?: string | null
          sub_agent_activation_markup?: number
          sub_agent_approved?: boolean
          sub_agent_prices?: Json
          support_number?: string
          topup_reference?: string | null
          transaction_pin?: string | null
          updated_at?: string
          user_id?: string
          wa_bot_api_key?: string | null
          wa_bot_enabled?: boolean | null
          wa_bot_greeting?: string | null
          whatsapp_group_link?: string | null
          whatsapp_number?: string
          vendor_preferences?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "agent_stores"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      promo_banners: {
        Row: {
          background_color: string | null
          banner_type: string | null
          content: string | null
          created_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          priority: number | null
          target_url: string | null
          text_color: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          background_color?: string | null
          banner_type?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          priority?: number | null
          target_url?: string | null
          text_color?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          background_color?: string | null
          banner_type?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          priority?: number | null
          target_url?: string | null
          text_color?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      provider_errors: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          order_id: string | null
          provider_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_errors_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_errors_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_packages: {
        Row: {
          capacity_gb: number
          cost_price: number
          created_at: string | null
          external_id: string | null
          id: string
          is_active: boolean | null
          network: string
          package_name: string
          provider_id: string | null
          raw_data: Json | null
          updated_at: string | null
        }
        Insert: {
          capacity_gb: number
          cost_price: number
          created_at?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          network: string
          package_name: string
          provider_id?: string | null
          raw_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          capacity_gb?: number
          cost_price?: number
          created_at?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          network?: string
          package_name?: string
          provider_id?: string | null
          raw_data?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_packages_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          api_key: string | null
          api_secret: string | null
          balance: number | null
          base_url: string | null
          created_at: string | null
          handler_type: string | null
          id: string
          is_active: boolean | null
          last_balance_check: string | null
          last_synced_at: string | null
          name: string
          priority: number | null
          provider_type: string
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          balance?: number | null
          base_url?: string | null
          created_at?: string | null
          handler_type?: string | null
          id?: string
          is_active?: boolean | null
          last_balance_check?: string | null
          last_synced_at?: string | null
          name: string
          priority?: number | null
          provider_type: string
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          balance?: number | null
          base_url?: string | null
          created_at?: string | null
          handler_type?: string | null
          id?: string
          is_active?: boolean | null
          last_balance_check?: string | null
          last_synced_at?: string | null
          name?: string
          priority?: number | null
          provider_type?: string
          settings?: Json | null
          updated_at?: string | null
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
            referencedRelation: "agent_stores"
            referencedColumns: ["user_id"]
          },
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
            referencedRelation: "agent_stores"
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
      scheduled_broadcasts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          message: string
          result: Json | null
          scheduled_at: string
          status: string
          target_filters: Json
          target_type: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          result?: Json | null
          scheduled_at: string
          status?: string
          target_filters?: Json
          target_type?: string
          title?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          result?: Json | null
          scheduled_at?: string
          status?: string
          target_filters?: Json
          target_type?: string
          title?: string
        }
        Relationships: []
      }
      scheduled_orders: {
        Row: {
          active: boolean | null
          amount: number | null
          created_at: string | null
          failure_count: number
          frequency: Database["public"]["Enums"]["schedule_frequency"]
          id: string
          network: string
          next_run_at: string
          order_type: string
          package_size: string | null
          recipient_name: string | null
          recipient_phone: string
          user_id: string
        }
        Insert: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          failure_count?: number
          frequency: Database["public"]["Enums"]["schedule_frequency"]
          id?: string
          network: string
          next_run_at: string
          order_type: string
          package_size?: string | null
          recipient_name?: string | null
          recipient_phone: string
          user_id: string
        }
        Update: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          failure_count?: number
          frequency?: Database["public"]["Enums"]["schedule_frequency"]
          id?: string
          network?: string
          next_run_at?: string
          order_type?: string
          package_size?: string | null
          recipient_name?: string | null
          recipient_phone?: string
          user_id?: string
        }
        Relationships: []
      }
      security_blacklist: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          reason: string | null
          type: string
          value: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          reason?: string | null
          type: string
          value: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          reason?: string | null
          type?: string
          value?: string
        }
        Relationships: []
      }
      security_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      service_status: {
        Row: {
          admin_note: string | null
          display_name: string
          network: string
          status: string
          updated_at: string | null
        }
        Insert: {
          admin_note?: string | null
          display_name: string
          network: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          admin_note?: string | null
          display_name?: string
          network?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sms_templates: {
        Row: {
          created_at: string
          id: string
          message: string
          name: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          name: string
          title?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          name?: string
          title?: string
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
          is_bot: boolean | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          sender_id: string
          is_bot?: boolean | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          sender_id?: string
          is_bot?: boolean | null
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
          agent_activation_fee: number | null
          airtime_provider_api_key: string | null
          airtime_provider_base_url: string | null
          announcement_message: string | null
          announcement_title: string | null
          at_markup_percentage: number | null
          auto_api_switch: boolean
          auto_failover_enabled: boolean | null
          auto_pending_sms_enabled: boolean | null
          auto_pending_sms_message: string | null
          background_custom_image_url: string | null
          backup_provider: string
          bece_cost_price: number | null
          bece_price: number | null
          customer_service_number: string
          dark_mode_enabled: boolean
          data_provider_api_key: string | null
          data_provider_base_url: string | null
          disable_ordering: boolean
          enable_privacy_shield: boolean | null
          free_data_claims_count: number | null
          free_data_enabled: boolean | null
          free_data_max_claims: number | null
          free_data_network: string | null
          free_data_package_size: string | null
          holiday_message: string
          holiday_mode_enabled: boolean
          home_page_video_muted: boolean | null
          home_page_video_url: string | null
          hubtel_client_id: string | null
          hubtel_client_secret: string | null
          id: number
          maintenance_mode: boolean | null
          manual_credit_sms_message: string | null
          mtn_markup_percentage: number | null
          order_failed_sms_message: string | null
          payment_success_sms_message: string | null
          paystack_secret_key: string | null
          preferred_provider: string
          registration_enabled: boolean | null
          scrolling_ad_image_url: string | null
          scrolling_ad_text: string | null
          secondary_data_provider_api_key: string | null
          secondary_data_provider_base_url: string | null
          show_announcement: boolean | null
          show_scrolling_ad: boolean | null
          store_visitor_popup_enabled: boolean
          sub_agent_base_fee: number
          support_channel_link: string
          telecel_markup_percentage: number | null
          traditional_background_enabled: boolean | null
          background_brightness: number | null
          background_contrast: number | null
          background_blueness: number | null
          twilio_account_sid: string
          twilio_auth_token: string
          twilio_from_number: string
          txtconnect_api_key: string | null
          txtconnect_sender_id: string | null
          updated_at: string
          updated_by: string | null
          wallet_topup_sms_message: string | null
          wassce_cost_price: number | null
          wassce_price: number | null
          whatsapp_bot_prompt: string | null
          withdrawal_completed_sms_message: string | null
          withdrawal_request_sms_message: string | null
        }
        Insert: {
          agent_activation_fee?: number | null
          airtime_provider_api_key?: string | null
          airtime_provider_base_url?: string | null
          announcement_message?: string | null
          announcement_title?: string | null
          at_markup_percentage?: number | null
          auto_api_switch?: boolean
          auto_failover_enabled?: boolean | null
          auto_pending_sms_enabled?: boolean | null
          auto_pending_sms_message?: string | null
          background_custom_image_url?: string | null
          backup_provider?: string
          bece_cost_price?: number | null
          bece_price?: number | null
          customer_service_number?: string
          dark_mode_enabled?: boolean
          data_provider_api_key?: string | null
          data_provider_base_url?: string | null
          disable_ordering?: boolean
          enable_privacy_shield?: boolean | null
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string
          holiday_mode_enabled?: boolean
          home_page_video_muted?: boolean | null
          home_page_video_url?: string | null
          hubtel_client_id?: string | null
          hubtel_client_secret?: string | null
          id?: number
          maintenance_mode?: boolean | null
          manual_credit_sms_message?: string | null
          mtn_markup_percentage?: number | null
          order_failed_sms_message?: string | null
          payment_success_sms_message?: string | null
          paystack_secret_key?: string | null
          preferred_provider?: string
          registration_enabled?: boolean | null
          scrolling_ad_image_url?: string | null
          scrolling_ad_text?: string | null
          secondary_data_provider_api_key?: string | null
          secondary_data_provider_base_url?: string | null
          show_announcement?: boolean | null
          show_scrolling_ad?: boolean | null
          store_visitor_popup_enabled?: boolean
          sub_agent_base_fee?: number
          support_channel_link?: string
          telecel_markup_percentage?: number | null
          traditional_background_enabled?: boolean | null
          background_brightness?: number | null
          background_contrast?: number | null
          background_blueness?: number | null
          twilio_account_sid?: string
          twilio_auth_token?: string
          twilio_from_number?: string
          txtconnect_api_key?: string | null
          txtconnect_sender_id?: string | null
          updated_at?: string
          updated_by?: string | null
          wallet_topup_sms_message?: string | null
          wassce_cost_price?: number | null
          wassce_price?: number | null
          whatsapp_bot_prompt?: string | null
          withdrawal_completed_sms_message?: string | null
          withdrawal_request_sms_message?: string | null
        }
        Update: {
          agent_activation_fee?: number | null
          airtime_provider_api_key?: string | null
          airtime_provider_base_url?: string | null
          announcement_message?: string | null
          announcement_title?: string | null
          at_markup_percentage?: number | null
          auto_api_switch?: boolean
          auto_failover_enabled?: boolean | null
          auto_pending_sms_enabled?: boolean | null
          auto_pending_sms_message?: string | null
          background_custom_image_url?: string | null
          backup_provider?: string
          bece_cost_price?: number | null
          bece_price?: number | null
          customer_service_number?: string
          dark_mode_enabled?: boolean
          data_provider_api_key?: string | null
          data_provider_base_url?: string | null
          disable_ordering?: boolean
          enable_privacy_shield?: boolean | null
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string
          holiday_mode_enabled?: boolean
          home_page_video_muted?: boolean | null
          home_page_video_url?: string | null
          hubtel_client_id?: string | null
          hubtel_client_secret?: string | null
          id?: number
          maintenance_mode?: boolean | null
          manual_credit_sms_message?: string | null
          mtn_markup_percentage?: number | null
          order_failed_sms_message?: string | null
          payment_success_sms_message?: string | null
          paystack_secret_key?: string | null
          preferred_provider?: string
          registration_enabled?: boolean | null
          scrolling_ad_image_url?: string | null
          scrolling_ad_text?: string | null
          secondary_data_provider_api_key?: string | null
          secondary_data_provider_base_url?: string | null
          show_announcement?: boolean | null
          show_scrolling_ad?: boolean | null
          store_visitor_popup_enabled?: boolean
          sub_agent_base_fee?: number
          support_channel_link?: string
          telecel_markup_percentage?: number | null
          traditional_background_enabled?: boolean | null
          background_brightness?: number | null
          background_contrast?: number | null
          background_blueness?: number | null
          twilio_account_sid?: string
          twilio_auth_token?: string
          twilio_from_number?: string
          txtconnect_api_key?: string | null
          txtconnect_sender_id?: string | null
          updated_at?: string
          updated_by?: string | null
          wallet_topup_sms_message?: string | null
          wassce_cost_price?: number | null
          wassce_price?: number | null
          whatsapp_bot_prompt?: string | null
          withdrawal_completed_sms_message?: string | null
          withdrawal_request_sms_message?: string | null
        }
        Relationships: []
      }
      user_credentials: {
        Row: {
          backed_up: boolean
          counter: number
          created_at: string
          credential_id: string
          device_name: string
          device_type: string | null
          id: string
          last_used_at: string | null
          public_key: string
          transports: string[] | null
          user_id: string
        }
        Insert: {
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          transports?: string[] | null
          user_id: string
        }
        Update: {
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          transports?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          allowed_ips: string[] | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          allowed_ips?: string[] | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          allowed_ips?: string[] | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          agent_id: string
          api_balance: number
          api_low_balance_alert_sent: boolean | null
          balance: number
          created_at: string
          credit_limit: number | null
          id: string
          loyalty_balance: number | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          api_balance?: number
          api_low_balance_alert_sent?: boolean | null
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          loyalty_balance?: number | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          api_balance?: number
          api_low_balance_alert_sent?: boolean | null
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          loyalty_balance?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      webauthn_challenges: {
        Row: {
          action: string
          challenge: string
          created_at: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          action?: string
          challenge: string
          created_at?: string
          expires_at?: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          challenge?: string
          created_at?: string
          expires_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_sessions: {
        Row: {
          agent_id: string
          created_at: string
          current_step: string
          order_data: Json | null
          phone_number: string
          updated_at: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          current_step?: string
          order_data?: Json | null
          phone_number: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          current_step?: string
          order_data?: Json | null
          phone_number?: string
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
          fee: number | null
          id: string
          net_amount: number | null
          paystack_transfer_reference: string | null
          status: string
          transfer_code: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          amount: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fee?: number | null
          id?: string
          net_amount?: number | null
          paystack_transfer_reference?: string | null
          status?: string
          transfer_code?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          amount?: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fee?: number | null
          id?: string
          net_amount?: number | null
          paystack_transfer_reference?: string | null
          status?: string
          transfer_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_sales_stats_summary: {
        Row: {
          agent_sales: number | null
          bucket_date: string | null
          customer_sales: number | null
          deposit_volume: number | null
          order_count: number | null
          sub_agent_sales: number | null
        }
        Relationships: []
      }
      agent_stores: {
        Row: {
          agent_approved: boolean | null
          agent_prices: Json | null
          disabled_packages: Json | null
          email: string | null
          full_name: string | null
          is_agent: boolean | null
          is_sub_agent: boolean | null
          parent_agent_id: string | null
          slug: string | null
          store_logo_url: string | null
          store_name: string | null
          store_primary_color: string | null
          sub_agent_activation_markup: number | null
          sub_agent_approved: boolean | null
          sub_agent_prices: Json | null
          support_number: string | null
          user_id: string | null
          whatsapp_group_link: string | null
          whatsapp_number: string
        Insert: {
          agent_activation_fee?: number | null
          announcement_message?: string | null
          announcement_title?: string | null
          at_markup_percentage?: number | null
          auto_api_switch?: boolean | null
          background_custom_image_url?: string | null
          bece_price?: number | null
          customer_service_number?: string | null
          dark_mode_enabled?: boolean | null
          disable_ordering?: boolean | null
          enable_privacy_shield?: boolean | null
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string | null
          holiday_mode_enabled?: boolean | null
          home_page_video_muted?: boolean | null
          home_page_video_url?: string | null
          id?: number | null
          mtn_markup_percentage?: number | null
          scrolling_ad_text?: string | null
          show_announcement?: boolean | null
          show_scrolling_ad?: boolean | null
          store_visitor_popup_enabled?: boolean | null
          support_channel_link?: string | null
          telecel_markup_percentage?: number | null
          traditional_background_enabled?: boolean | null
          wassce_price?: number | null
          tutorial_buy_video_url?: string | null
          tutorial_agent_video_url?: string | null
          tutorial_subagent_video_url?: string | null
        }
        Update: {
          agent_activation_fee?: number | null
          announcement_message?: string | null
          announcement_title?: string | null
          at_markup_percentage?: number | null
          auto_api_switch?: boolean | null
          background_custom_image_url?: string | null
          bece_price?: number | null
          customer_service_number?: string | null
          dark_mode_enabled?: boolean | null
          disable_ordering?: boolean | null
          enable_privacy_shield?: boolean | null
          free_data_claims_count?: number | null
          free_data_enabled?: boolean | null
          free_data_max_claims?: number | null
          free_data_network?: string | null
          free_data_package_size?: string | null
          holiday_message?: string | null
          holiday_mode_enabled?: boolean | null
          home_page_video_muted?: boolean | null
          home_page_video_url?: string | null
          id?: number | null
          mtn_markup_percentage?: number | null
          scrolling_ad_text?: string | null
          show_announcement?: boolean | null
          show_scrolling_ad?: boolean | null
          store_visitor_popup_enabled?: boolean | null
          support_channel_link?: string | null
          telecel_markup_percentage?: number | null
          traditional_background_enabled?: boolean | null
          wassce_price?: number | null
          tutorial_buy_video_url?: string | null
          tutorial_agent_video_url?: string | null
          tutorial_subagent_video_url?: string | null
        }
        Relationships: []
      }
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
      authenticate_client: {
        Args: { p_hash: string; p_prefix: string }
        Returns: {
          access_enabled: boolean
          allowed_actions: string[]
          custom_prices: Json
          full_name: string
          ip_whitelist: string[]
          is_sub_agent: boolean
          parent_agent_id: string
          rate_limit: number
          secret_key_hash: string
          test_mode: boolean
          user_id: string
          webhook_url: string
        }[]
      }
      bulk_suspend_users: {
        Args: { p_suspend: boolean; p_user_ids: string[] }
        Returns: Json
      }
      calculate_loyalty_points: { Args: { amount: number }; Returns: number }
      calculate_next_run: {
        Args: {
          current_run: string
          freq: Database["public"]["Enums"]["schedule_frequency"]
        }
        Returns: string
      }
      check_and_increment_rate_limit: {
        Args: { p_rate_limit: number; p_user_id: string }
        Returns: boolean
      }
      claim_daily_check_in: { Args: { p_user_id: string }; Returns: Json }
      claim_promo_code: {
        Args: { p_code: string; p_order_id?: string; p_phone: string }
        Returns: {
          discount_percentage: number
          is_free: boolean
          promo_id: string
        }[]
      }
      convert_loyalty_points: {
        Args: { points_to_convert: number; user_id: string }
        Returns: Json
      }
      create_order_rpc: {
        Args: {
          p_amount: number
          p_idem_key: string
          p_network: string
          p_package_size: string
          p_phone: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      credit_api_wallet: {
        Args: { p_amount: number; p_user_id: string }
        Returns: Json
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
      finalize_withdrawal: { Args: { p_withdrawal_id: string }; Returns: Json }
      get_admin_sales_stats_v2: {
        Args: { p_start_date: string }
        Returns: {
          agent_sales: number
          bucket_date: string
          customer_sales: number
          deposit_volume: number
          order_count: number
          sub_agent_sales: number
        }[]
      }
      get_agent_leaderboard: {
        Args: never
        Returns: {
          agent_name: string
          day_orders: number
          is_current_user: boolean
          month_orders: number
          rank_position: number
          streak: number
          week_orders: number
          week_sales_amount: number
        }[]
      }
      get_alltime_leaderboard: {
        Args: never
        Returns: {
          agent_name: string
          is_current_user: boolean
          rank_position: number
          total_amount: number
          total_orders: number
        }[]
      }
      get_public_stats: { Args: never; Returns: Json }
      get_velocity_accounts: {
        Args: never
        Returns: {
          email: string
          first_order_at: string
          full_name: string
          joined_at: string
          minutes_to_first_order: number
          user_id: string
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
      log_internal_error: {
        Args: {
          p_endpoint: string
          p_error: string
          p_method: string
          p_payload: Json
          p_stack: string
          p_user_id: string
        }
        Returns: string
      }
      log_security_event: {
        Args: { p_action: string; p_metadata?: Json; p_user_id: string }
        Returns: undefined
      }
      log_user_activity:
        | { Args: { p_ip: string; p_user_id: string }; Returns: undefined }
        | {
            Args: { p_ip: string; p_location?: string; p_user_id: string }
            Returns: undefined
          }
      normalize_phone_sql: { Args: { p_phone: string }; Returns: string }
      purge_test_accounts: { Args: never; Returns: Json }
      refresh_admin_sales_stats: { Args: never; Returns: undefined }
      request_withdrawal: {
        Args: { p_agent_id: string; p_amount: number }
        Returns: Json
      }
      rotate_api_key: { Args: never; Returns: Json }
      spin_the_wheel: { Args: { p_user_id: string }; Returns: Json }
      toggle_user_suspension: {
        Args: { p_suspend: boolean; p_user_id: string }
        Returns: undefined
      }
      user_transfer_to_api: { Args: { p_amount: number }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      schedule_frequency: "daily" | "weekly" | "monthly"
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
      schedule_frequency: ["daily", "weekly", "monthly"],
    },
  },
} as const
