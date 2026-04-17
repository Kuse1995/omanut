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
      agent_approval_requests: {
        Row: {
          action_params: Json | null
          action_summary: string
          action_type: string
          company_id: string
          id: string
          requested_at: string | null
          responded_at: string | null
          responded_by: string | null
          status: string | null
        }
        Insert: {
          action_params?: Json | null
          action_summary: string
          action_type: string
          company_id: string
          id?: string
          requested_at?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string | null
        }
        Update: {
          action_params?: Json | null
          action_summary?: string
          action_type?: string
          company_id?: string
          id?: string
          requested_at?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_approval_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      agent_performance: {
        Row: {
          agent_type: string
          company_id: string | null
          conversation_id: string | null
          conversation_resolved: boolean | null
          created_at: string | null
          handoff_occurred: boolean | null
          handoff_reason: string | null
          id: string
          notes: string | null
          routed_at: string | null
          routing_confidence: number | null
        }
        Insert: {
          agent_type: string
          company_id?: string | null
          conversation_id?: string | null
          conversation_resolved?: boolean | null
          created_at?: string | null
          handoff_occurred?: boolean | null
          handoff_reason?: string | null
          id?: string
          notes?: string | null
          routed_at?: string | null
          routing_confidence?: number | null
        }
        Update: {
          agent_type?: string
          company_id?: string | null
          conversation_id?: string | null
          conversation_resolved?: boolean | null
          created_at?: string | null
          handoff_occurred?: boolean | null
          handoff_reason?: string | null
          id?: string
          notes?: string | null
          routed_at?: string | null
          routing_confidence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_performance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_performance_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_queue: {
        Row: {
          ai_suggested_responses: Json | null
          ai_summary: string | null
          assigned_agent_id: string | null
          claimed_at: string | null
          company_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          department: string | null
          id: string
          priority: string
          sla_deadline: string | null
          status: string
          ticket_id: string | null
          wait_time_seconds: number | null
        }
        Insert: {
          ai_suggested_responses?: Json | null
          ai_summary?: string | null
          assigned_agent_id?: string | null
          claimed_at?: string | null
          company_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          department?: string | null
          id?: string
          priority?: string
          sla_deadline?: string | null
          status?: string
          ticket_id?: string | null
          wait_time_seconds?: number | null
        }
        Update: {
          ai_suggested_responses?: Json | null
          ai_summary?: string | null
          assigned_agent_id?: string | null
          claimed_at?: string | null
          company_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          department?: string | null
          id?: string
          priority?: string
          sla_deadline?: string | null
          status?: string
          ticket_id?: string | null
          wait_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_settings: {
        Row: {
          company_id: string
          content_themes: string[] | null
          created_at: string
          id: string
          notes: string | null
          posts_per_week: number
          preferred_posting_days: string[] | null
          preferred_posting_time: string | null
          preferred_tone: string | null
          target_audience: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          content_themes?: string[] | null
          created_at?: string
          id?: string
          notes?: string | null
          posts_per_week?: number
          preferred_posting_days?: string[] | null
          preferred_posting_time?: string | null
          preferred_tone?: string | null
          target_audience?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          content_themes?: string[] | null
          created_at?: string
          id?: string
          notes?: string | null
          posts_per_week?: number
          preferred_posting_days?: string[] | null
          preferred_posting_time?: string | null
          preferred_tone?: string | null
          target_audience?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_spending_limits: {
        Row: {
          company_id: string
          created_at: string | null
          daily_ad_budget_limit: number | null
          id: string
          require_approval_for_ai_config: boolean | null
          require_approval_for_publishing: boolean | null
          sale_approval_threshold: number | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          daily_ad_budget_limit?: number | null
          id?: string
          require_approval_for_ai_config?: boolean | null
          require_approval_for_publishing?: boolean | null
          sale_approval_threshold?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          daily_ad_budget_limit?: number | null
          id?: string
          require_approval_for_ai_config?: boolean | null
          require_approval_for_publishing?: boolean | null
          sale_approval_threshold?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_spending_limits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_error_logs: {
        Row: {
          ai_response: string
          analysis_details: Json | null
          auto_flagged: boolean | null
          company_id: string
          confidence_score: number | null
          conversation_id: string | null
          created_at: string
          detected_flags: string[] | null
          error_type: string
          expected_response: string | null
          fix_applied: string | null
          id: string
          original_message: string
          quality_score: number | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_response: string
          analysis_details?: Json | null
          auto_flagged?: boolean | null
          company_id: string
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          detected_flags?: string[] | null
          error_type?: string
          expected_response?: string | null
          fix_applied?: string | null
          id?: string
          original_message: string
          quality_score?: number | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_response?: string
          analysis_details?: Json | null
          auto_flagged?: boolean | null
          company_id?: string
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          detected_flags?: string[] | null
          error_type?: string
          expected_response?: string | null
          fix_applied?: string | null
          id?: string
          original_message?: string
          quality_score?: number | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_error_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_error_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_playground_sessions: {
        Row: {
          company_id: string
          created_at: string
          id: string
          messages: Json
          mode: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          messages?: Json
          mode?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          messages?: Json
          mode?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_playground_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bms_connections: {
        Row: {
          api_secret: string
          bms_type: string
          bridge_url: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          api_secret: string
          bms_type?: string
          bridge_url: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          api_secret?: string
          bms_type?: string
          bridge_url?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bms_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_conversations: {
        Row: {
          company_id: string
          created_at: string
          handed_off_by: string | null
          id: string
          message_content: string
          message_from: string
          response: string | null
          tool_context: Json | null
        }
        Insert: {
          company_id: string
          created_at?: string
          handed_off_by?: string | null
          id?: string
          message_content: string
          message_from: string
          response?: string | null
          tool_context?: Json | null
        }
        Update: {
          company_id?: string
          created_at?: string
          handed_off_by?: string | null
          id?: string
          message_content?: string
          message_from?: string
          response?: string | null
          tool_context?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_media_deliveries: {
        Row: {
          boss_phone: string
          company_id: string
          context: string | null
          created_at: string
          error_message: string | null
          id: string
          image_url: string
          max_retries: number
          related_id: string | null
          retry_count: number
          status: string
          twilio_sid: string | null
          updated_at: string
        }
        Insert: {
          boss_phone: string
          company_id: string
          context?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_url: string
          max_retries?: number
          related_id?: string | null
          retry_count?: number
          status?: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Update: {
          boss_phone?: string
          company_id?: string
          context?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_url?: string
          max_retries?: number
          related_id?: string | null
          retry_count?: number
          status?: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boss_media_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_conflicts: {
        Row: {
          company_id: string | null
          conflicting_event_id: string | null
          conflicting_event_title: string | null
          created_at: string | null
          id: string
          requested_date: string
          requested_time: string
          resolved: boolean | null
        }
        Insert: {
          company_id?: string | null
          conflicting_event_id?: string | null
          conflicting_event_title?: string | null
          created_at?: string | null
          id?: string
          requested_date: string
          requested_time: string
          resolved?: boolean | null
        }
        Update: {
          company_id?: string | null
          conflicting_event_id?: string | null
          conflicting_event_title?: string | null
          created_at?: string | null
          id?: string
          requested_date?: string
          requested_time?: string
          resolved?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_conflicts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
          admin_last_active: string | null
          agent_routing_enabled: boolean | null
          booking_buffer_minutes: number | null
          boss_phone: string | null
          branches: string | null
          business_type: string | null
          calendar_sync_enabled: boolean | null
          created_at: string | null
          credit_balance: number | null
          currency_prefix: string | null
          external_catalog_key: string | null
          external_catalog_table: string | null
          external_catalog_url: string | null
          google_calendar_id: string | null
          hours: string | null
          id: string
          meta_business_account_id: string | null
          meta_phone_number_id: string | null
          metadata: Json | null
          name: string
          payment_instructions: string | null
          payment_number_airtel: string | null
          payment_number_mtn: string | null
          payment_number_zamtel: string | null
          payments_disabled: boolean
          quick_reference_info: string | null
          service_locations: string | null
          services: string | null
          takeover_number: string | null
          test_mode: boolean | null
          twilio_number: string | null
          updated_at: string | null
          voice_style: string | null
          whatsapp_number: string | null
          whatsapp_payment_flow_id: string | null
          whatsapp_reservation_flow_id: string | null
          whatsapp_voice_enabled: boolean | null
        }
        Insert: {
          admin_last_active?: string | null
          agent_routing_enabled?: boolean | null
          booking_buffer_minutes?: number | null
          boss_phone?: string | null
          branches?: string | null
          business_type?: string | null
          calendar_sync_enabled?: boolean | null
          created_at?: string | null
          credit_balance?: number | null
          currency_prefix?: string | null
          external_catalog_key?: string | null
          external_catalog_table?: string | null
          external_catalog_url?: string | null
          google_calendar_id?: string | null
          hours?: string | null
          id?: string
          meta_business_account_id?: string | null
          meta_phone_number_id?: string | null
          metadata?: Json | null
          name: string
          payment_instructions?: string | null
          payment_number_airtel?: string | null
          payment_number_mtn?: string | null
          payment_number_zamtel?: string | null
          payments_disabled?: boolean
          quick_reference_info?: string | null
          service_locations?: string | null
          services?: string | null
          takeover_number?: string | null
          test_mode?: boolean | null
          twilio_number?: string | null
          updated_at?: string | null
          voice_style?: string | null
          whatsapp_number?: string | null
          whatsapp_payment_flow_id?: string | null
          whatsapp_reservation_flow_id?: string | null
          whatsapp_voice_enabled?: boolean | null
        }
        Update: {
          admin_last_active?: string | null
          agent_routing_enabled?: boolean | null
          booking_buffer_minutes?: number | null
          boss_phone?: string | null
          branches?: string | null
          business_type?: string | null
          calendar_sync_enabled?: boolean | null
          created_at?: string | null
          credit_balance?: number | null
          currency_prefix?: string | null
          external_catalog_key?: string | null
          external_catalog_table?: string | null
          external_catalog_url?: string | null
          google_calendar_id?: string | null
          hours?: string | null
          id?: string
          meta_business_account_id?: string | null
          meta_phone_number_id?: string | null
          metadata?: Json | null
          name?: string
          payment_instructions?: string | null
          payment_number_airtel?: string | null
          payment_number_mtn?: string | null
          payment_number_zamtel?: string | null
          payments_disabled?: boolean
          quick_reference_info?: string | null
          service_locations?: string | null
          services?: string | null
          takeover_number?: string | null
          test_mode?: boolean | null
          twilio_number?: string | null
          updated_at?: string | null
          voice_style?: string | null
          whatsapp_number?: string | null
          whatsapp_payment_flow_id?: string | null
          whatsapp_reservation_flow_id?: string | null
          whatsapp_voice_enabled?: boolean | null
        }
        Relationships: []
      }
      company_ai_overrides: {
        Row: {
          ab_test_enabled: boolean | null
          ab_test_model: string | null
          ab_test_variant: string | null
          analysis_model: string | null
          auto_flag_threshold: number | null
          auto_handoff_triggers: string[] | null
          banned_topics: string
          boss_agent_prompt: string | null
          boss_alert_triggers: Json | null
          boss_comparison_period: string | null
          boss_daily_briefing_template: string | null
          boss_data_focus: string[] | null
          boss_metric_goals: Json | null
          boss_preferred_language: string | null
          boss_report_frequency: string | null
          boss_reporting_style: string | null
          company_id: string
          complexity_threshold: number | null
          content_filtering_level: string | null
          custom_tools: Json | null
          enabled_tools: string[] | null
          escalation_rules: Json | null
          fallback_message: string | null
          id: string
          max_tokens: number | null
          max_tool_rounds: number | null
          primary_model: string | null
          primary_temperature: number | null
          qa_style: string
          quality_scoring_enabled: boolean | null
          require_confirmation_for: string[] | null
          response_length: string | null
          response_templates: Json | null
          response_timeout_seconds: number | null
          routing_confidence_threshold: number | null
          routing_enabled: boolean | null
          routing_model: string | null
          routing_temperature: number | null
          sales_agent_prompt: string | null
          service_mode: string
          supervisor_analysis_depth: string | null
          supervisor_context_window: number | null
          supervisor_enabled: boolean | null
          supervisor_focus_areas: string[] | null
          supervisor_live_analysis_enabled: boolean | null
          supervisor_output_format: string | null
          supervisor_pattern_detection: string[] | null
          supervisor_recommendation_style: string | null
          supervisor_research_enabled: boolean | null
          supervisor_urgency_triggers: Json | null
          support_agent_prompt: string | null
          system_instructions: string
          updated_at: string | null
          video_provider: string
          voice_model: string | null
          voice_style: string | null
        }
        Insert: {
          ab_test_enabled?: boolean | null
          ab_test_model?: string | null
          ab_test_variant?: string | null
          analysis_model?: string | null
          auto_flag_threshold?: number | null
          auto_handoff_triggers?: string[] | null
          banned_topics?: string
          boss_agent_prompt?: string | null
          boss_alert_triggers?: Json | null
          boss_comparison_period?: string | null
          boss_daily_briefing_template?: string | null
          boss_data_focus?: string[] | null
          boss_metric_goals?: Json | null
          boss_preferred_language?: string | null
          boss_report_frequency?: string | null
          boss_reporting_style?: string | null
          company_id: string
          complexity_threshold?: number | null
          content_filtering_level?: string | null
          custom_tools?: Json | null
          enabled_tools?: string[] | null
          escalation_rules?: Json | null
          fallback_message?: string | null
          id?: string
          max_tokens?: number | null
          max_tool_rounds?: number | null
          primary_model?: string | null
          primary_temperature?: number | null
          qa_style?: string
          quality_scoring_enabled?: boolean | null
          require_confirmation_for?: string[] | null
          response_length?: string | null
          response_templates?: Json | null
          response_timeout_seconds?: number | null
          routing_confidence_threshold?: number | null
          routing_enabled?: boolean | null
          routing_model?: string | null
          routing_temperature?: number | null
          sales_agent_prompt?: string | null
          service_mode?: string
          supervisor_analysis_depth?: string | null
          supervisor_context_window?: number | null
          supervisor_enabled?: boolean | null
          supervisor_focus_areas?: string[] | null
          supervisor_live_analysis_enabled?: boolean | null
          supervisor_output_format?: string | null
          supervisor_pattern_detection?: string[] | null
          supervisor_recommendation_style?: string | null
          supervisor_research_enabled?: boolean | null
          supervisor_urgency_triggers?: Json | null
          support_agent_prompt?: string | null
          system_instructions?: string
          updated_at?: string | null
          video_provider?: string
          voice_model?: string | null
          voice_style?: string | null
        }
        Update: {
          ab_test_enabled?: boolean | null
          ab_test_model?: string | null
          ab_test_variant?: string | null
          analysis_model?: string | null
          auto_flag_threshold?: number | null
          auto_handoff_triggers?: string[] | null
          banned_topics?: string
          boss_agent_prompt?: string | null
          boss_alert_triggers?: Json | null
          boss_comparison_period?: string | null
          boss_daily_briefing_template?: string | null
          boss_data_focus?: string[] | null
          boss_metric_goals?: Json | null
          boss_preferred_language?: string | null
          boss_report_frequency?: string | null
          boss_reporting_style?: string | null
          company_id?: string
          complexity_threshold?: number | null
          content_filtering_level?: string | null
          custom_tools?: Json | null
          enabled_tools?: string[] | null
          escalation_rules?: Json | null
          fallback_message?: string | null
          id?: string
          max_tokens?: number | null
          max_tool_rounds?: number | null
          primary_model?: string | null
          primary_temperature?: number | null
          qa_style?: string
          quality_scoring_enabled?: boolean | null
          require_confirmation_for?: string[] | null
          response_length?: string | null
          response_templates?: Json | null
          response_timeout_seconds?: number | null
          routing_confidence_threshold?: number | null
          routing_enabled?: boolean | null
          routing_model?: string | null
          routing_temperature?: number | null
          sales_agent_prompt?: string | null
          service_mode?: string
          supervisor_analysis_depth?: string | null
          supervisor_context_window?: number | null
          supervisor_enabled?: boolean | null
          supervisor_focus_areas?: string[] | null
          supervisor_live_analysis_enabled?: boolean | null
          supervisor_output_format?: string | null
          supervisor_pattern_detection?: string[] | null
          supervisor_recommendation_style?: string | null
          supervisor_research_enabled?: boolean | null
          supervisor_urgency_triggers?: Json | null
          support_agent_prompt?: string | null
          system_instructions?: string
          updated_at?: string | null
          video_provider?: string
          voice_model?: string | null
          voice_style?: string | null
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
      company_api_keys: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          scope: string
          scopes: string[]
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          scope?: string
          scopes?: string[]
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          scope?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "company_api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_boss_phones: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_primary: boolean
          label: string | null
          notify_alerts: boolean
          notify_payments: boolean
          notify_reservations: boolean
          phone: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          notify_alerts?: boolean
          notify_payments?: boolean
          notify_reservations?: boolean
          phone: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          notify_alerts?: boolean
          notify_payments?: boolean
          notify_reservations?: boolean
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_boss_phones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_departments: {
        Row: {
          company_id: string
          contact_info: string | null
          created_at: string
          description: string | null
          employees: Json | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_info?: string | null
          created_at?: string
          description?: string | null
          employees?: Json | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_info?: string | null
          created_at?: string
          description?: string | null
          employees?: Json | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_documents: {
        Row: {
          company_id: string
          created_at: string
          embedding: string | null
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
          embedding?: string | null
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
          embedding?: string | null
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
      company_media: {
        Row: {
          bms_product_id: string | null
          category: Database["public"]["Enums"]["media_category"]
          company_id: string
          created_at: string
          description: string | null
          embedding: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          media_type: string
          tags: string[] | null
          thumbnail_url: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          bms_product_id?: string | null
          category?: Database["public"]["Enums"]["media_category"]
          company_id: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          media_type: string
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          bms_product_id?: string | null
          category?: Database["public"]["Enums"]["media_category"]
          company_id?: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          media_type?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_media_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sla_config: {
        Row: {
          company_id: string
          created_at: string
          escalation_after_minutes: number
          id: string
          notification_channels: Json | null
          priority: string
          resolution_time_minutes: number
          response_time_minutes: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          escalation_after_minutes?: number
          id?: string
          notification_channels?: Json | null
          priority?: string
          resolution_time_minutes?: number
          response_time_minutes?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          escalation_after_minutes?: number
          id?: string
          notification_channels?: Json | null
          priority?: string
          resolution_time_minutes?: number
          response_time_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_sla_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_users: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string | null
          current_ticket_count: number | null
          id: string
          invited_at: string | null
          invited_by: string | null
          is_available: boolean | null
          is_default: boolean | null
          max_concurrent_tickets: number | null
          role: Database["public"]["Enums"]["company_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string | null
          current_ticket_count?: number | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_available?: boolean | null
          is_default?: boolean | null
          max_concurrent_tickets?: number | null
          role?: Database["public"]["Enums"]["company_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string | null
          current_ticket_count?: number | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_available?: boolean | null
          is_default?: boolean | null
          max_concurrent_tickets?: number | null
          role?: Database["public"]["Enums"]["company_role"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          active_agent: string | null
          archived: boolean | null
          assigned_to: string | null
          company_id: string | null
          created_at: string
          customer_name: string | null
          duration_seconds: number | null
          ended_at: string | null
          human_takeover: boolean | null
          id: string
          is_paused_for_human: boolean | null
          last_message_at: string | null
          last_message_preview: string | null
          phone: string | null
          pinned: boolean | null
          platform: string
          quality_flag: string | null
          started_at: string
          status: string
          summary_embedding: string | null
          takeover_at: string | null
          takeover_by: string | null
          transcript: string | null
          unread_count: number | null
        }
        Insert: {
          active_agent?: string | null
          archived?: boolean | null
          assigned_to?: string | null
          company_id?: string | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          human_takeover?: boolean | null
          id?: string
          is_paused_for_human?: boolean | null
          last_message_at?: string | null
          last_message_preview?: string | null
          phone?: string | null
          pinned?: boolean | null
          platform?: string
          quality_flag?: string | null
          started_at?: string
          status?: string
          summary_embedding?: string | null
          takeover_at?: string | null
          takeover_by?: string | null
          transcript?: string | null
          unread_count?: number | null
        }
        Update: {
          active_agent?: string | null
          archived?: boolean | null
          assigned_to?: string | null
          company_id?: string | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          human_takeover?: boolean | null
          id?: string
          is_paused_for_human?: boolean | null
          last_message_at?: string | null
          last_message_preview?: string | null
          phone?: string | null
          pinned?: boolean | null
          platform?: string
          quality_flag?: string | null
          started_at?: string
          status?: string
          summary_embedding?: string | null
          takeover_at?: string | null
          takeover_by?: string | null
          transcript?: string | null
          unread_count?: number | null
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
      customer_segments: {
        Row: {
          analysis_notes: string | null
          avg_response_time_seconds: number | null
          company_id: string
          conversion_potential: string | null
          conversion_score: number | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string
          detected_interests: string[] | null
          engagement_level: string | null
          engagement_score: number | null
          has_payment: boolean | null
          has_reservation: boolean | null
          id: string
          intent_category: string | null
          intent_score: number | null
          last_analyzed_at: string | null
          last_interaction_at: string | null
          segment_type: string | null
          total_conversations: number | null
          total_spend: number | null
          updated_at: string | null
        }
        Insert: {
          analysis_notes?: string | null
          avg_response_time_seconds?: number | null
          company_id: string
          conversion_potential?: string | null
          conversion_score?: number | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone: string
          detected_interests?: string[] | null
          engagement_level?: string | null
          engagement_score?: number | null
          has_payment?: boolean | null
          has_reservation?: boolean | null
          id?: string
          intent_category?: string | null
          intent_score?: number | null
          last_analyzed_at?: string | null
          last_interaction_at?: string | null
          segment_type?: string | null
          total_conversations?: number | null
          total_spend?: number | null
          updated_at?: string | null
        }
        Update: {
          analysis_notes?: string | null
          avg_response_time_seconds?: number | null
          company_id?: string
          conversion_potential?: string | null
          conversion_score?: number | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string
          detected_interests?: string[] | null
          engagement_level?: string | null
          engagement_score?: number | null
          has_payment?: boolean | null
          has_reservation?: boolean | null
          id?: string
          intent_category?: string | null
          intent_score?: number | null
          last_analyzed_at?: string | null
          last_interaction_at?: string | null
          segment_type?: string | null
          total_conversations?: number | null
          total_spend?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_sessions: {
        Row: {
          company_id: string
          created_at: string
          custom_persona: string | null
          demo_company_name: string
          expires_at: string
          id: string
          phone: string | null
          researched_data: Json | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          custom_persona?: string | null
          demo_company_name: string
          expires_at?: string
          id?: string
          phone?: string | null
          researched_data?: Json | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          custom_persona?: string | null
          demo_company_name?: string
          expires_at?: string
          id?: string
          phone?: string | null
          researched_data?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_product_deliveries: {
        Row: {
          company_id: string
          created_at: string | null
          customer_email: string | null
          customer_phone: string
          delivered_at: string | null
          delivery_method: string | null
          download_count: number | null
          download_url: string | null
          expires_at: string | null
          id: string
          max_downloads: number | null
          product_id: string | null
          transaction_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          customer_email?: string | null
          customer_phone: string
          delivered_at?: string | null
          delivery_method?: string | null
          download_count?: number | null
          download_url?: string | null
          expires_at?: string | null
          id?: string
          max_downloads?: number | null
          product_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          customer_email?: string | null
          customer_phone?: string
          delivered_at?: string | null
          delivery_method?: string | null
          download_count?: number | null
          download_url?: string | null
          expires_at?: string | null
          id?: string
          max_downloads?: number | null
          product_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_product_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_product_deliveries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "payment_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_product_deliveries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_messages: {
        Row: {
          created_at: string
          id: string
          is_processed: boolean
          message_text: string | null
          page_id: string
          sender_psid: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_processed?: boolean
          message_text?: string | null
          page_id: string
          sender_psid: string
        }
        Update: {
          created_at?: string
          id?: string
          is_processed?: boolean
          message_text?: string | null
          page_id?: string
          sender_psid?: string
        }
        Relationships: []
      }
      generated_images: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_assets_used: string[] | null
          company_id: string
          conversation_id: string | null
          created_at: string
          generation_params: Json | null
          id: string
          image_url: string
          prompt: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_assets_used?: string[] | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          generation_params?: Json | null
          id?: string
          image_url: string
          prompt: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_assets_used?: string[] | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          generation_params?: Json | null
          id?: string
          image_url?: string
          prompt?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string | null
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
      image_generation_feedback: {
        Row: {
          caption_suggestion: string | null
          caption_used: boolean | null
          company_id: string
          created_at: string
          engagement_score: number | null
          enhanced_prompt: string | null
          feedback_notes: string | null
          feedback_type: string | null
          generated_image_id: string | null
          id: string
          image_url: string
          learned_preferences: Json | null
          posted_at: string | null
          posting_time_suggestion: string | null
          prompt: string
          rating: number | null
          updated_at: string
          was_posted: boolean | null
        }
        Insert: {
          caption_suggestion?: string | null
          caption_used?: boolean | null
          company_id: string
          created_at?: string
          engagement_score?: number | null
          enhanced_prompt?: string | null
          feedback_notes?: string | null
          feedback_type?: string | null
          generated_image_id?: string | null
          id?: string
          image_url: string
          learned_preferences?: Json | null
          posted_at?: string | null
          posting_time_suggestion?: string | null
          prompt: string
          rating?: number | null
          updated_at?: string
          was_posted?: boolean | null
        }
        Update: {
          caption_suggestion?: string | null
          caption_used?: boolean | null
          company_id?: string
          created_at?: string
          engagement_score?: number | null
          enhanced_prompt?: string | null
          feedback_notes?: string | null
          feedback_type?: string | null
          generated_image_id?: string | null
          id?: string
          image_url?: string
          learned_preferences?: Json | null
          posted_at?: string | null
          posting_time_suggestion?: string | null
          prompt?: string
          rating?: number | null
          updated_at?: string
          was_posted?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "image_generation_feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_generation_feedback_generated_image_id_fkey"
            columns: ["generated_image_id"]
            isOneToOne: false
            referencedRelation: "generated_images"
            referencedColumns: ["id"]
          },
        ]
      }
      image_generation_settings: {
        Row: {
          best_posting_times: string[] | null
          brand_colors: Json | null
          brand_fonts: Json | null
          brand_tone: string | null
          business_context: string | null
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          learned_style_preferences: Json | null
          reference_asset_ids: string[] | null
          sample_prompts: string[] | null
          style_description: string | null
          top_performing_prompts: string[] | null
          updated_at: string
          visual_guidelines: string | null
        }
        Insert: {
          best_posting_times?: string[] | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_tone?: string | null
          business_context?: string | null
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          learned_style_preferences?: Json | null
          reference_asset_ids?: string[] | null
          sample_prompts?: string[] | null
          style_description?: string | null
          top_performing_prompts?: string[] | null
          updated_at?: string
          visual_guidelines?: string | null
        }
        Update: {
          best_posting_times?: string[] | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_tone?: string | null
          business_context?: string | null
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          learned_style_preferences?: Json | null
          reference_asset_ids?: string[] | null
          sample_prompts?: string[] | null
          style_description?: string | null
          top_performing_prompts?: string[] | null
          updated_at?: string
          visual_guidelines?: string | null
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
      mcp_active_company: {
        Row: {
          api_key_id: string
          company_id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          api_key_id: string
          company_id: string
          session_id: string
          updated_at?: string
        }
        Update: {
          api_key_id?: string
          company_id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_active_company_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      media_delivery_status: {
        Row: {
          company_id: string
          conversation_id: string | null
          created_at: string | null
          customer_phone: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          last_retry_at: string | null
          max_retries: number | null
          media_url: string
          next_retry_at: string | null
          retry_count: number | null
          sent_at: string | null
          status: string
          twilio_message_sid: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          created_at?: string | null
          customer_phone: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_retry_at?: string | null
          max_retries?: number | null
          media_url: string
          next_retry_at?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          twilio_message_sid?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          created_at?: string | null
          customer_phone?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          last_retry_at?: string | null
          max_retries?: number | null
          media_url?: string
          next_retry_at?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          twilio_message_sid?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_delivery_status_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_delivery_status_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reply_drafts: {
        Row: {
          ai_reply: string
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          id: string
          prompt_context: Json | null
          rejected_at: string | null
          rejection_reason: string | null
          sent_at: string | null
          source_id: string
          source_type: string
          status: string
          updated_at: string | null
        }
        Insert: {
          ai_reply: string
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          prompt_context?: Json | null
          rejected_at?: string | null
          rejection_reason?: string | null
          sent_at?: string | null
          source_id: string
          source_type: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          ai_reply?: string
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          prompt_context?: Json | null
          rejected_at?: string | null
          rejection_reason?: string | null
          sent_at?: string | null
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_reply_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
          message_metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          message_metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          message_metadata?: Json | null
          role?: string
        }
        Relationships: []
      }
      meta_credentials: {
        Row: {
          access_token: string
          ai_system_prompt: string | null
          company_id: string | null
          created_at: string | null
          id: string
          ig_user_id: string | null
          page_id: string
          platform: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          ai_system_prompt?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          ig_user_id?: string | null
          page_id: string
          platform: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          ai_system_prompt?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          ig_user_id?: string | null
          page_id?: string
          platform?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          collected_data: Json
          created_at: string
          created_company_id: string | null
          current_step: string
          expires_at: string
          id: string
          phone: string
          research_data: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          collected_data?: Json
          created_at?: string
          created_company_id?: string | null
          current_step?: string
          expires_at?: string
          id?: string
          phone: string
          research_data?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          collected_data?: Json
          created_at?: string
          created_company_id?: string | null
          current_step?: string
          expires_at?: string
          id?: string
          phone?: string
          research_data?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_created_company_id_fkey"
            columns: ["created_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_products: {
        Row: {
          category: string | null
          company_id: string | null
          created_at: string | null
          currency: string | null
          delivery_type: string | null
          description: string | null
          digital_file_path: string | null
          download_expiry_hours: number | null
          download_limit: number | null
          download_url: string | null
          duration_minutes: number | null
          embedding: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          product_type: string | null
          selar_link: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          company_id?: string | null
          created_at?: string | null
          currency?: string | null
          delivery_type?: string | null
          description?: string | null
          digital_file_path?: string | null
          download_expiry_hours?: number | null
          download_limit?: number | null
          download_url?: string | null
          duration_minutes?: number | null
          embedding?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          product_type?: string | null
          selar_link?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          company_id?: string | null
          created_at?: string | null
          currency?: string | null
          delivery_type?: string | null
          description?: string | null
          digital_file_path?: string | null
          download_expiry_hours?: number | null
          download_limit?: number | null
          download_url?: string | null
          duration_minutes?: number | null
          embedding?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          product_type?: string | null
          selar_link?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          admin_notes: string | null
          amount: number
          company_id: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string | null
          currency: string | null
          customer_name: string | null
          customer_phone: string
          designated_number: string | null
          id: string
          metadata: Json | null
          moneyunify_transaction_id: string | null
          payment_link: string | null
          payment_method: string | null
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payment_reference: string | null
          payment_status: string | null
          product_id: string | null
          updated_at: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          company_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_name?: string | null
          customer_phone: string
          designated_number?: string | null
          id?: string
          metadata?: Json | null
          moneyunify_transaction_id?: string | null
          payment_link?: string | null
          payment_method?: string | null
          payment_proof_uploaded_at?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          product_id?: string | null
          updated_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          company_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_name?: string | null
          customer_phone?: string
          designated_number?: string | null
          id?: string
          metadata?: Json | null
          moneyunify_transaction_id?: string | null
          payment_link?: string | null
          payment_method?: string | null
          payment_proof_uploaded_at?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          product_id?: string | null
          updated_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "payment_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_identity_profiles: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          exclusion_keywords: string[] | null
          id: string
          is_active: boolean
          media_id: string | null
          product_name: string
          updated_at: string
          visual_fingerprint: Json | null
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          exclusion_keywords?: string[] | null
          id?: string
          is_active?: boolean
          media_id?: string | null
          product_name: string
          updated_at?: string
          visual_fingerprint?: Json | null
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          exclusion_keywords?: string[] | null
          id?: string
          is_active?: boolean
          media_id?: string | null
          product_name?: string
          updated_at?: string
          visual_fingerprint?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_profiles_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "company_media"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_reply_templates: {
        Row: {
          category: string | null
          company_id: string
          content: string
          created_at: string
          id: string
          shortcut: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          company_id: string
          content: string
          created_at?: string
          id?: string
          shortcut?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          shortcut?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_reply_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          area_preference: string | null
          boss_approved_at: string | null
          boss_rejection_reason: string | null
          branch: string | null
          calendar_event_link: string | null
          calendar_sync_status: string | null
          company_id: string | null
          conversation_id: string | null
          created_at: string
          date: string
          email: string | null
          google_calendar_event_id: string | null
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
          boss_approved_at?: string | null
          boss_rejection_reason?: string | null
          branch?: string | null
          calendar_event_link?: string | null
          calendar_sync_status?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          date: string
          email?: string | null
          google_calendar_event_id?: string | null
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
          boss_approved_at?: string | null
          boss_rejection_reason?: string | null
          branch?: string | null
          calendar_event_link?: string | null
          calendar_sync_status?: string | null
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          date?: string
          email?: string | null
          google_calendar_event_id?: string | null
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
      scheduled_posts: {
        Row: {
          company_id: string
          content: string
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          image_url: string | null
          meta_post_id: string | null
          page_id: string
          scheduled_time: string
          status: string
          target_platform: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          company_id: string
          content: string
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          meta_post_id?: string | null
          page_id: string
          scheduled_time: string
          status?: string
          target_platform?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          meta_post_id?: string | null
          page_id?: string
          scheduled_time?: string
          status?: string
          target_platform?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          company_id: string | null
          created_at: string | null
          details: Json | null
          event_type: string
          id: string
          ip_address: string | null
          message: string
          severity: string
          source: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: string | null
          message: string
          severity?: string
          source: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: string | null
          message?: string
          severity?: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          issue_category: string
          issue_summary: string
          priority: string
          recommended_department: string | null
          recommended_employee: string | null
          resolution_notes: string | null
          resolved_at: string | null
          satisfaction_feedback: string | null
          satisfaction_score: number | null
          service_recommendations: Json | null
          status: string
          ticket_number: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          issue_category?: string
          issue_summary: string
          priority?: string
          recommended_department?: string | null
          recommended_employee?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          satisfaction_feedback?: string | null
          satisfaction_score?: number | null
          service_recommendations?: Json | null
          status?: string
          ticket_number: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          issue_category?: string
          issue_summary?: string
          priority?: string
          recommended_department?: string | null
          recommended_employee?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          satisfaction_feedback?: string | null
          satisfaction_score?: number | null
          service_recommendations?: Json | null
          status?: string
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      takeover_sessions: {
        Row: {
          company_id: string
          created_at: string | null
          expires_at: string | null
          id: string
          selected_conversation_id: string | null
          takeover_phone: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          selected_conversation_id?: string | null
          takeover_phone: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          selected_conversation_id?: string | null
          takeover_phone?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "takeover_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeover_sessions_selected_conversation_id_fkey"
            columns: ["selected_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          is_internal: boolean
          ticket_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
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
      video_generation_jobs: {
        Row: {
          aspect_ratio: string | null
          boss_phone: string
          company_id: string
          created_at: string | null
          error_message: string | null
          id: string
          operation_name: string
          poll_count: number | null
          prompt: string | null
          scheduled_post_data: Json | null
          status: string
          updated_at: string | null
          video_provider: string
          video_url: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          boss_phone: string
          company_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_name: string
          poll_count?: number | null
          prompt?: string | null
          scheduled_post_data?: Json | null
          status?: string
          updated_at?: string | null
          video_provider?: string
          video_url?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          boss_phone?: string
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_name?: string
          poll_count?: number | null
          prompt?: string | null
          scheduled_post_data?: Json | null
          status?: string
          updated_at?: string | null
          video_provider?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_generation_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          company_id: string | null
          content: string | null
          conversation_id: string | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          media_type: string | null
          media_url: string | null
          message_type: string | null
          metadata: Json | null
          status: string | null
          updated_at: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          company_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_type?: string | null
          metadata?: Json | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          company_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_type?: string | null
          metadata?: Json | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
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
      can_manage_company_users: {
        Args: { company_uuid: string }
        Returns: boolean
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
      find_unanswered_conversations: {
        Args: { cutoff_time: string }
        Returns: {
          company_id: string
          customer_name: string
          id: string
          last_message_at: string
          phone: string
        }[]
      }
      get_user_companies: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          is_default: boolean
          role: Database["public"]["Enums"]["company_role"]
        }[]
      }
      get_user_company_role: {
        Args: { company_uuid: string }
        Returns: Database["public"]["Enums"]["company_role"]
      }
      has_company_role: {
        Args: {
          company_uuid: string
          required_role: Database["public"]["Enums"]["company_role"]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_conversations: {
        Args: {
          match_company_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          customer_name: string
          id: string
          phone: string
          similarity: number
          started_at: string
          transcript: string
        }[]
      }
      match_documents: {
        Args: {
          match_company_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          filename: string
          id: string
          parsed_content: string
          similarity: number
        }[]
      }
      match_media: {
        Args: {
          match_company_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          description: string
          file_path: string
          id: string
          media_type: string
          similarity: number
          tags: string[]
        }[]
      }
      match_products: {
        Args: {
          match_company_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          currency: string
          delivery_type: string
          description: string
          id: string
          name: string
          price: number
          product_type: string
          selar_link: string
          similarity: number
        }[]
      }
      ticket_company_id: { Args: { p_ticket_id: string }; Returns: string }
      user_has_company_access: {
        Args: { company_uuid: string }
        Returns: boolean
      }
      user_has_company_access_v2: {
        Args: { company_uuid: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "client"
      company_role: "owner" | "manager" | "contributor" | "viewer"
      media_category:
        | "menu"
        | "interior"
        | "exterior"
        | "logo"
        | "products"
        | "promotional"
        | "staff"
        | "events"
        | "facilities"
        | "other"
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
      company_role: ["owner", "manager", "contributor", "viewer"],
      media_category: [
        "menu",
        "interior",
        "exterior",
        "logo",
        "products",
        "promotional",
        "staff",
        "events",
        "facilities",
        "other",
      ],
    },
  },
} as const
