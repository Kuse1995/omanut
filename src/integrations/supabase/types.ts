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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          action_type: string
          company_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          description: string
          due_date: string | null
          id: string
          notes: string | null
          priority: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          action_type: string
          company_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          company_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_config: {
        Row: {
          branches: string
          created_at: string
          currency_prefix: string
          id: string
          instructions: string
          menu: string
          restaurant_hours: string
          restaurant_name: string
          seating_areas: string
          updated_at: string
        }
        Insert: {
          branches?: string
          created_at?: string
          currency_prefix?: string
          id?: string
          instructions?: string
          menu?: string
          restaurant_hours?: string
          restaurant_name?: string
          seating_areas?: string
          updated_at?: string
        }
        Update: {
          branches?: string
          created_at?: string
          currency_prefix?: string
          id?: string
          instructions?: string
          menu?: string
          restaurant_hours?: string
          restaurant_name?: string
          seating_areas?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_information: {
        Row: {
          company_id: string
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          importance: string | null
          info_type: string
          information: string
          updated_at: string
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          importance?: string | null
          info_type: string
          information: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          importance?: string | null
          info_type?: string
          information?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_information_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_information_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          branches: string | null
          business_type: string | null
          created_at: string | null
          credit_balance: number | null
          currency_prefix: string | null
          hours: string | null
          id: string
          menu_or_offerings: string | null
          metadata: Json | null
          name: string
          quick_reference_info: string | null
          seating_areas: string | null
          twilio_number: string | null
          updated_at: string | null
          voice_style: string | null
          whatsapp_number: string | null
          whatsapp_voice_enabled: boolean | null
        }
        Insert: {
          branches?: string | null
          business_type?: string | null
          created_at?: string | null
          credit_balance?: number | null
          currency_prefix?: string | null
          hours?: string | null
          id?: string
          menu_or_offerings?: string | null
          metadata?: Json | null
          name: string
          quick_reference_info?: string | null
          seating_areas?: string | null
          twilio_number?: string | null
          updated_at?: string | null
          voice_style?: string | null
          whatsapp_number?: string | null
          whatsapp_voice_enabled?: boolean | null
        }
        Update: {
          branches?: string | null
          business_type?: string | null
          created_at?: string | null
          credit_balance?: number | null
          currency_prefix?: string | null
          hours?: string | null
          id?: string
          menu_or_offerings?: string | null
          metadata?: Json | null
          name?: string
          quick_reference_info?: string | null
          seating_areas?: string | null
          twilio_number?: string | null
          updated_at?: string | null
          voice_style?: string | null
          whatsapp_number?: string | null
          whatsapp_voice_enabled?: boolean | null
        }
        Relationships: []
      }
      company_ai_overrides: {
        Row: {
          banned_topics: string
          company_id: string
          id: string
          qa_style: string
          system_instructions: string
          updated_at: string | null
        }
        Insert: {
          banned_topics?: string
          company_id: string
          id?: string
          qa_style?: string
          system_instructions?: string
          updated_at?: string | null
        }
        Update: {
          banned_topics?: string
          company_id?: string
          id?: string
          qa_style?: string
          system_instructions?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_ai_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_documents: {
        Row: {
          company_id: string
          created_at: string
          file_path: string
          file_size: number
          file_type: string
          filename: string
          id: string
          parsed_content: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          file_path: string
          file_size: number
          file_type: string
          filename: string
          id?: string
          parsed_content?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          file_path?: string
          file_size?: number
          file_type?: string
          filename?: string
          id?: string
          parsed_content?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          company_id: string | null
          created_at: string
          customer_name: string | null
          duration_seconds: number | null
          ended_at: string | null
          human_takeover: boolean | null
          id: string
          phone: string | null
          quality_flag: string | null
          started_at: string
          status: string
          takeover_at: string | null
          takeover_by: string | null
          transcript: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          human_takeover?: boolean | null
          id?: string
          phone?: string | null
          quality_flag?: string | null
          started_at?: string
          status?: string
          takeover_at?: string | null
          takeover_by?: string | null
          transcript?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          human_takeover?: boolean | null
          id?: string
          phone?: string | null
          quality_flag?: string | null
          started_at?: string
          status?: string
          takeover_at?: string | null
          takeover_by?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_usage: {
        Row: {
          amount_used: number
          company_id: string
          conversation_id: string | null
          created_at: string | null
          id: string
          reason: string | null
        }
        Insert: {
          amount_used: number
          company_id: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          reason?: string | null
        }
        Update: {
          amount_used?: number
          company_id?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_usage_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_images: {
        Row: {
          company_id: string
          conversation_id: string | null
          created_at: string
          id: string
          image_url: string
          prompt: string
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          image_url: string
          prompt: string
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          image_url?: string
          prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_images_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_images_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      image_generation_settings: {
        Row: {
          business_context: string | null
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          sample_prompts: string[] | null
          style_description: string | null
          updated_at: string
        }
        Insert: {
          business_context?: string | null
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          sample_prompts?: string[] | null
          style_description?: string | null
          updated_at?: string
        }
        Update: {
          business_context?: string | null
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          sample_prompts?: string[] | null
          style_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_generation_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      reservations: {
        Row: {
          area_preference: string | null
          branch: string | null
          company_id: string | null
          conversation_id: string | null
          created_at: string
          date: string
          email: string | null
          guests: number
          id: string
          name: string
          occasion: string | null
          phone: string
          status: string
          time: string
        }
        Insert: {
          area_preference?: string | null
          branch?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          date: string
          email?: string | null
          guests: number
          id?: string
          name: string
          occasion?: string | null
          phone: string
          status?: string
          time: string
        }
        Update: {
          area_preference?: string | null
          branch?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          date?: string
          email?: string | null
          guests?: number
          id?: string
          name?: string
          occasion?: string | null
          phone?: string
          status?: string
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          company_id: string
          created_at: string | null
          email: string
          id: string
          password_hash: string | null
          role: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          email: string
          id?: string
          password_hash?: string | null
          role?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          email?: string
          id?: string
          password_hash?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_credits: {
        Args: { p_amount: number; p_company_id: string; p_reason: string }
        Returns: undefined
      }
      admin_reset_password: {
        Args: { new_password: string; target_user_id: string }
        Returns: Json
      }
      deduct_credits: {
        Args: {
          p_amount: number
          p_company_id: string
          p_conversation_id?: string
          p_reason: string
        }
        Returns: undefined
      }
      delete_company: { Args: { p_company_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "client"
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
      app_role: ["admin", "user", "client"],
    },
  },
} as const
