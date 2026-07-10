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
      admin_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          at: string
          id: string
          metadata: Json
          target: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          at?: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          at?: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          audience: Json
          body: string
          created_at: string
          dismissable: boolean
          expires_at: string | null
          id: string
          kind: string
          title: string
        }
        Insert: {
          audience?: Json
          body: string
          created_at?: string
          dismissable?: boolean
          expires_at?: string | null
          id?: string
          kind?: string
          title: string
        }
        Update: {
          audience?: Json
          body?: string
          created_at?: string
          dismissable?: boolean
          expires_at?: string | null
          id?: string
          kind?: string
          title?: string
        }
        Relationships: []
      }
      client_errors: {
        Row: {
          at: string
          id: string
          message: string
          route: string | null
          stack_redacted: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          at?: string
          id?: string
          message: string
          route?: string | null
          stack_redacted?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          at?: string
          id?: string
          message?: string
          route?: string | null
          stack_redacted?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      emergency_contacts: {
        Row: {
          approved_at: string | null
          created_at: string
          grantee_email: string
          grantee_id: string
          grantor_id: string
          id: string
          needs_reseal: boolean
          requested_at: string | null
          sealed_dek: string
          sealed_dek_ephemeral_pub: string
          sealed_dek_iv: string
          status: Database["public"]["Enums"]["emergency_status"]
          updated_at: string
          wait_days: number
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          grantee_email: string
          grantee_id: string
          grantor_id: string
          id?: string
          needs_reseal?: boolean
          requested_at?: string | null
          sealed_dek: string
          sealed_dek_ephemeral_pub: string
          sealed_dek_iv: string
          status?: Database["public"]["Enums"]["emergency_status"]
          updated_at?: string
          wait_days?: number
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          grantee_email?: string
          grantee_id?: string
          grantor_id?: string
          id?: string
          needs_reseal?: boolean
          requested_at?: string | null
          sealed_dek?: string
          sealed_dek_ephemeral_pub?: string
          sealed_dek_iv?: string
          status?: Database["public"]["Enums"]["emergency_status"]
          updated_at?: string
          wait_days?: number
        }
        Relationships: []
      }
      families: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      family_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          family_id: string
          id: string
          invited_by: string
          status: Database["public"]["Enums"]["family_invite_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          family_id: string
          id?: string
          invited_by: string
          status?: Database["public"]["Enums"]["family_invite_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          family_id?: string
          id?: string
          invited_by?: string
          status?: Database["public"]["Enums"]["family_invite_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_invites_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          created_at: string
          family_id: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["family_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["family_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["family_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_shared_accounts: {
        Row: {
          account_id: string
          created_at: string
          family_id: string
          id: string
          shared_by: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          family_id: string
          id?: string
          shared_by: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          family_id?: string
          id?: string
          shared_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_shared_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "vault_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_shared_accounts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          audience: Json
          created_at: string
          description: string | null
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          audience?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          audience?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auto_lock_pref: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          hide_codes_pref: boolean
          id: string
          locale: string | null
          onboarded_at: string | null
          role: string
          theme_pref: string
          updated_at: string
        }
        Insert: {
          auto_lock_pref?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          hide_codes_pref?: boolean
          id: string
          locale?: string | null
          onboarded_at?: string | null
          role?: string
          theme_pref?: string
          updated_at?: string
        }
        Update: {
          auto_lock_pref?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          hide_codes_pref?: boolean
          id?: string
          locale?: string | null
          onboarded_at?: string | null
          role?: string
          theme_pref?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_nonces: {
        Row: {
          action: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          payload: Json
          signature: string
          user_id: string
        }
        Insert: {
          action: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          payload?: Json
          signature: string
          user_id: string
        }
        Update: {
          action?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          payload?: Json
          signature?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      share_lookup_attempts: {
        Row: {
          attempted_at: string
          caller_user_id: string
        }
        Insert: {
          attempted_at?: string
          caller_user_id: string
        }
        Update: {
          attempted_at?: string
          caller_user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          price_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          price_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          price_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_login_events: {
        Row: {
          coarse_country: string | null
          coarse_region: string | null
          created_at: string
          device_label: string
          event_at: string
          id: string
          session_id: string | null
          user_agent: string
          user_id: string
        }
        Insert: {
          coarse_country?: string | null
          coarse_region?: string | null
          created_at?: string
          device_label?: string
          event_at?: string
          id?: string
          session_id?: string | null
          user_agent?: string
          user_id: string
        }
        Update: {
          coarse_country?: string | null
          coarse_region?: string | null
          created_at?: string
          device_label?: string
          event_at?: string
          id?: string
          session_id?: string | null
          user_agent?: string
          user_id?: string
        }
        Relationships: []
      }
      user_public_keys: {
        Row: {
          created_at: string
          ed25519_private_wrapped: string
          ed25519_private_wrapped_iv: string
          ed25519_public_key: string
          updated_at: string
          user_id: string
          x25519_private_wrapped: string
          x25519_private_wrapped_iv: string
          x25519_public_key: string
        }
        Insert: {
          created_at?: string
          ed25519_private_wrapped: string
          ed25519_private_wrapped_iv: string
          ed25519_public_key: string
          updated_at?: string
          user_id: string
          x25519_private_wrapped: string
          x25519_private_wrapped_iv: string
          x25519_public_key: string
        }
        Update: {
          created_at?: string
          ed25519_private_wrapped?: string
          ed25519_private_wrapped_iv?: string
          ed25519_public_key?: string
          updated_at?: string
          user_id?: string
          x25519_private_wrapped?: string
          x25519_private_wrapped_iv?: string
          x25519_public_key?: string
        }
        Relationships: []
      }
      user_sessions_meta: {
        Row: {
          coarse_country: string | null
          coarse_region: string | null
          device_label: string
          first_seen_at: string
          last_seen_at: string
          session_id: string
          user_agent: string
          user_id: string
        }
        Insert: {
          coarse_country?: string | null
          coarse_region?: string | null
          device_label?: string
          first_seen_at?: string
          last_seen_at?: string
          session_id: string
          user_agent?: string
          user_id: string
        }
        Update: {
          coarse_country?: string | null
          coarse_region?: string | null
          device_label?: string
          first_seen_at?: string
          last_seen_at?: string
          session_id?: string
          user_agent?: string
          user_id?: string
        }
        Relationships: []
      }
      vault_accounts: {
        Row: {
          algorithm: string
          counter_ciphertext: string | null
          counter_iv: string | null
          created_at: string
          crypto_version: number
          digits: number
          icon_slug: string | null
          id: string
          is_favorite: boolean
          issuer: string
          label: string
          needs_rotation: boolean
          otp_type: string
          period: number
          secret_ciphertext: string
          secret_iv: string
          sort_order: number
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          algorithm?: string
          counter_ciphertext?: string | null
          counter_iv?: string | null
          created_at?: string
          crypto_version?: number
          digits?: number
          icon_slug?: string | null
          id?: string
          is_favorite?: boolean
          issuer?: string
          label?: string
          needs_rotation?: boolean
          otp_type?: string
          period?: number
          secret_ciphertext: string
          secret_iv: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          algorithm?: string
          counter_ciphertext?: string | null
          counter_iv?: string | null
          created_at?: string
          crypto_version?: number
          digits?: number
          icon_slug?: string | null
          id?: string
          is_favorite?: boolean
          issuer?: string
          label?: string
          needs_rotation?: boolean
          otp_type?: string
          period?: number
          secret_ciphertext?: string
          secret_iv?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vault_meta: {
        Row: {
          created_at: string
          kdf_algorithm: string
          kdf_salt: string
          passphrase_hint: string | null
          recovery_wrapped_key: string | null
          recovery_wrapped_key_iv: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          kdf_algorithm?: string
          kdf_salt: string
          passphrase_hint?: string | null
          recovery_wrapped_key?: string | null
          recovery_wrapped_key_iv?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          kdf_algorithm?: string
          kdf_salt?: string
          passphrase_hint?: string | null
          recovery_wrapped_key?: string | null
          recovery_wrapped_key_iv?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vault_shares: {
        Row: {
          account_id: string
          algorithm_snapshot: string
          created_at: string
          digits_snapshot: number
          ephemeral_public_key: string
          id: string
          issuer_snapshot: string
          label_snapshot: string
          otp_type_snapshot: string
          owner_user_id: string
          period_snapshot: number
          recipient_user_id: string
          revoked_at: string | null
          sealed_ciphertext: string
          sealed_iv: string
          updated_at: string
        }
        Insert: {
          account_id: string
          algorithm_snapshot?: string
          created_at?: string
          digits_snapshot?: number
          ephemeral_public_key: string
          id?: string
          issuer_snapshot?: string
          label_snapshot?: string
          otp_type_snapshot?: string
          owner_user_id: string
          period_snapshot?: number
          recipient_user_id: string
          revoked_at?: string | null
          sealed_ciphertext: string
          sealed_iv: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          algorithm_snapshot?: string
          created_at?: string
          digits_snapshot?: number
          ephemeral_public_key?: string
          id?: string
          issuer_snapshot?: string
          label_snapshot?: string
          otp_type_snapshot?: string
          owner_user_id?: string
          period_snapshot?: number
          recipient_user_id?: string
          revoked_at?: string | null
          sealed_ciphertext?: string
          sealed_iv?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_shares_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "vault_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_emergency_request: {
        Args: { _contact_id: string }
        Returns: undefined
      }
      current_user_email: { Args: never; Returns: string }
      fetch_emergency_dek: {
        Args: { _contact_id: string }
        Returns: {
          grantor_id: string
          sealed_dek: string
          sealed_dek_ephemeral_pub: string
          sealed_dek_iv: string
        }[]
      }
      find_user_by_email: {
        Args: { _email: string }
        Returns: {
          ed25519_public_key: string
          user_id: string
          x25519_public_key: string
        }[]
      }
      get_family_member_public_keys: {
        Args: never
        Returns: {
          ed25519_public_key: string
          email: string
          user_id: string
          x25519_public_key: string
        }[]
      }
      get_user_family_id: { Args: { _user_id?: string }; Returns: string }
      has_active_subscription: { Args: { _user_id?: string }; Returns: boolean }
      is_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_family_admin: { Args: { _user_id?: string }; Returns: boolean }
      purge_old_client_errors: { Args: { days?: number }; Returns: number }
      purge_old_login_events: { Args: { days?: number }; Returns: number }
      purge_old_share_lookup_attempts: {
        Args: { minutes?: number }
        Returns: number
      }
      reject_emergency_request: {
        Args: { _contact_id: string }
        Returns: undefined
      }
    }
    Enums: {
      emergency_status: "active" | "requested" | "approved" | "revoked"
      family_invite_status:
        | "pending"
        | "accepted"
        | "declined"
        | "revoked"
        | "expired"
      family_role: "admin" | "member"
      plan_tier: "free" | "pro" | "family"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "incomplete_expired"
        | "unpaid"
        | "paused"
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
      emergency_status: ["active", "requested", "approved", "revoked"],
      family_invite_status: [
        "pending",
        "accepted",
        "declined",
        "revoked",
        "expired",
      ],
      family_role: ["admin", "member"],
      plan_tier: ["free", "pro", "family"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "unpaid",
        "paused",
      ],
    },
  },
} as const
