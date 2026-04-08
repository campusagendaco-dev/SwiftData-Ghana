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
      global_package_settings: {
        Row: {
          agent_price: number | null
          id: string
          is_unavailable: boolean
          network: string
          package_size: string
          public_price: number | null
          updated_at: string
        }
        Insert: {
          agent_price?: number | null
          id?: string
          is_unavailable?: boolean
          network: string
          package_size: string
          public_price?: number | null
          updated_at?: string
        }
        Update: {
          agent_price?: number | null
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
          failure_reason: string | null
          id: string
          network: string | null
          order_type: string
          package_size: string | null
          profit: number
          status: string
          updated_at: string
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
          failure_reason?: string | null
          id?: string
          network?: string | null
          order_type?: string
          package_size?: string | null
          profit?: number
          status?: string
          updated_at?: string
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
          failure_reason?: string | null
          id?: string
          network?: string | null
          order_type?: string
          package_size?: string | null
          profit?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agent_approved: boolean
          agent_prices: Json
          created_at: string
          disabled_packages: Json
          email: string
          full_name: string
          id: string
          is_agent: boolean
          markups: Json
          momo_account_name: string
          momo_network: string
          momo_number: string
          onboarding_complete: boolean
          phone: string
          slug: string | null
          store_name: string
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
          created_at?: string
          disabled_packages?: Json
          email?: string
          full_name?: string
          id?: string
          is_agent?: boolean
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          phone?: string
          slug?: string | null
          store_name?: string
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
          created_at?: string
          disabled_packages?: Json
          email?: string
          full_name?: string
          id?: string
          is_agent?: boolean
          markups?: Json
          momo_account_name?: string
          momo_network?: string
          momo_number?: string
          onboarding_complete?: boolean
          phone?: string
          slug?: string | null
          store_name?: string
          support_number?: string
          topup_reference?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_group_link?: string | null
          whatsapp_number?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          auto_api_switch: boolean
          backup_provider: string
          customer_service_number: string
          dark_mode_enabled: boolean
          disable_ordering: boolean
          holiday_message: string
          holiday_mode_enabled: boolean
          id: number
          preferred_provider: string
          support_channel_link: string
          updated_at: string
        }
        Insert: {
          auto_api_switch?: boolean
          backup_provider?: string
          customer_service_number?: string
          dark_mode_enabled?: boolean
          disable_ordering?: boolean
          holiday_message?: string
          holiday_mode_enabled?: boolean
          id?: number
          preferred_provider?: string
          support_channel_link?: string
          updated_at?: string
        }
        Update: {
          auto_api_switch?: boolean
          backup_provider?: string
          customer_service_number?: string
          dark_mode_enabled?: boolean
          disable_ordering?: boolean
          holiday_message?: string
          holiday_mode_enabled?: boolean
          id?: number
          preferred_provider?: string
          support_channel_link?: string
          updated_at?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
