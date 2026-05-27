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
      answers: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          participant_id: string
          question_id: string
          response_ms: number
          selected_option: string
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct?: boolean
          participant_id: string
          question_id: string
          response_ms?: number
          selected_option: string
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          participant_id?: string
          question_id?: string
          response_ms?: number
          selected_option?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      participant_scores: {
        Row: {
          answer_count: number
          birth_date: string | null
          correct_count: number
          device_token: string | null
          event_id: string | null
          id: string
          participant_id: string
          participant_name: string
          presentation_id: string
          score: number
          session_id: string
          total_response_ms: number
          updated_at: string
        }
        Insert: {
          answer_count?: number
          birth_date?: string | null
          correct_count?: number
          device_token?: string | null
          event_id?: string | null
          id?: string
          participant_id: string
          participant_name?: string
          presentation_id: string
          score?: number
          session_id: string
          total_response_ms?: number
          updated_at?: string
        }
        Update: {
          answer_count?: number
          birth_date?: string | null
          correct_count?: number
          device_token?: string | null
          event_id?: string | null
          id?: string
          participant_id?: string
          participant_name?: string
          presentation_id?: string
          score?: number
          session_id?: string
          total_response_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      participants: {
        Row: {
          answer_count: number
          birth_date: string
          correct_count: number
          created_at: string
          device_token: string | null
          event_id: string | null
          id: string
          name: string
          score: number
          session_id: string
          total_response_ms: number
        }
        Insert: {
          answer_count?: number
          birth_date: string
          correct_count?: number
          created_at?: string
          device_token?: string | null
          event_id?: string | null
          id?: string
          name: string
          score?: number
          session_id: string
          total_response_ms?: number
        }
        Update: {
          answer_count?: number
          birth_date?: string
          correct_count?: number
          created_at?: string
          device_token?: string | null
          event_id?: string | null
          id?: string
          name?: string
          score?: number
          session_id?: string
          total_response_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      presentations: {
        Row: {
          ai_context: string | null
          chronological_index: number | null
          created_at: string
          default_time_limit: number
          event_id: string | null
          execution_status: string
          file_url: string
          id: string
          presented_at: string | null
          sort_order: number
          title: string
          user_id: string
        }
        Insert: {
          ai_context?: string | null
          chronological_index?: number | null
          created_at?: string
          default_time_limit?: number
          event_id?: string | null
          execution_status?: string
          file_url: string
          id?: string
          presented_at?: string | null
          sort_order?: number
          title: string
          user_id?: string
        }
        Update: {
          ai_context?: string | null
          chronological_index?: number | null
          created_at?: string
          default_time_limit?: number
          event_id?: string | null
          execution_status?: string
          file_url?: string
          id?: string
          presented_at?: string | null
          sort_order?: number
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          correct_option: string
          created_at: string
          difficulty: string
          display_mode: string
          id: string
          is_prize_question: boolean
          options: Json
          position: number
          presentation_id: string
          prize_multiplier: number
          question_text: string
          question_type: string
          slide_number: number
          time_limit: number
        }
        Insert: {
          correct_option: string
          created_at?: string
          difficulty?: string
          display_mode?: string
          id?: string
          is_prize_question?: boolean
          options: Json
          position?: number
          presentation_id: string
          prize_multiplier?: number
          question_text: string
          question_type?: string
          slide_number: number
          time_limit?: number
        }
        Update: {
          correct_option?: string
          created_at?: string
          difficulty?: string
          display_mode?: string
          id?: string
          is_prize_question?: boolean
          options?: Json
          position?: number
          presentation_id?: string
          prize_multiplier?: number
          question_text?: string
          question_type?: string
          slide_number?: number
          time_limit?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_remotes: {
        Row: {
          created_at: string
          device_token: string | null
          id: string
          last_seen_at: string
          operator_name: string
          session_id: string
          slot: number
        }
        Insert: {
          created_at?: string
          device_token?: string | null
          id?: string
          last_seen_at?: string
          operator_name: string
          session_id: string
          slot: number
        }
        Update: {
          created_at?: string
          device_token?: string | null
          id?: string
          last_seen_at?: string
          operator_name?: string
          session_id?: string
          slot?: number
        }
        Relationships: []
      }
      sessions: {
        Row: {
          active_question_id: string | null
          created_at: string
          current_slide: number
          fired_question_ids: string[]
          force_podium: boolean
          id: string
          is_fullscreen: boolean
          presentation_id: string
          question_revealed: boolean
          question_started_at: string | null
          show_join_qr: boolean
          show_ranking: boolean
          show_sidebar: boolean
          status: string
          updated_at: string
        }
        Insert: {
          active_question_id?: string | null
          created_at?: string
          current_slide?: number
          fired_question_ids?: string[]
          force_podium?: boolean
          id?: string
          is_fullscreen?: boolean
          presentation_id: string
          question_revealed?: boolean
          question_started_at?: string | null
          show_join_qr?: boolean
          show_ranking?: boolean
          show_sidebar?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          active_question_id?: string | null
          created_at?: string
          current_slide?: number
          fired_question_ids?: string[]
          force_podium?: boolean
          id?: string
          is_fullscreen?: boolean
          presentation_id?: string
          question_revealed?: boolean
          question_started_at?: string | null
          show_join_qr?: boolean
          show_ranking?: boolean
          show_sidebar?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_active_question_id_fkey"
            columns: ["active_question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
