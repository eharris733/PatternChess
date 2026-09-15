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
      benchmarks: {
        Row: {
          bucket: string
          kind: string
          sample_size: number
          source: string | null
          value: number
        }
        Insert: {
          bucket: string
          kind: string
          sample_size: number
          source?: string | null
          value: number
        }
        Update: {
          bucket?: string
          kind?: string
          sample_size?: number
          source?: string | null
          value?: number
        }
        Relationships: []
      }
      blunders: {
        Row: {
          analysis_depth: number | null
          correct_moves: Json
          created_at: string | null
          cycle_number: number
          deepened_at: string | null
          drill_data: Json | null
          eval_after: number
          eval_before: number
          eval_swing: number
          fen: string
          game_id: string | null
          id: string
          kind: string
          last_drill_failed: boolean
          last_drilled_at: string | null
          motifs: string[]
          move_number: number
          next_drill_at: string | null
          phase: string
          played_move: string
          retired_at: string | null
          side_to_move: string
          solution_line: Json | null
          times_attempted: number
          times_correct: number
          user_id: string | null
        }
        Insert: {
          analysis_depth?: number | null
          correct_moves?: Json
          created_at?: string | null
          cycle_number?: number
          deepened_at?: string | null
          drill_data?: Json | null
          eval_after: number
          eval_before: number
          eval_swing: number
          fen: string
          game_id?: string | null
          id?: string
          kind?: string
          last_drill_failed?: boolean
          last_drilled_at?: string | null
          motifs?: string[]
          move_number: number
          next_drill_at?: string | null
          phase?: string
          played_move: string
          retired_at?: string | null
          side_to_move: string
          solution_line?: Json | null
          times_attempted?: number
          times_correct?: number
          user_id?: string | null
        }
        Update: {
          analysis_depth?: number | null
          correct_moves?: Json
          created_at?: string | null
          cycle_number?: number
          deepened_at?: string | null
          drill_data?: Json | null
          eval_after?: number
          eval_before?: number
          eval_swing?: number
          fen?: string
          game_id?: string | null
          id?: string
          kind?: string
          last_drill_failed?: boolean
          last_drilled_at?: string | null
          motifs?: string[]
          move_number?: number
          next_drill_at?: string | null
          phase?: string
          played_move?: string
          retired_at?: string | null
          side_to_move?: string
          solution_line?: Json | null
          times_attempted?: number
          times_correct?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blunders_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      endgame_scenarios: {
        Row: {
          actual_result: string
          attempts: number
          blunder_id: string | null
          created_at: string
          deserved_result: string
          game_id: string
          id: string
          last_played_at: string | null
          start_fen: string
          status: string
          user_color: string
          user_id: string
        }
        Insert: {
          actual_result: string
          attempts?: number
          blunder_id?: string | null
          created_at?: string
          deserved_result: string
          game_id: string
          id?: string
          last_played_at?: string | null
          start_fen: string
          status?: string
          user_color: string
          user_id: string
        }
        Update: {
          actual_result?: string
          attempts?: number
          blunder_id?: string | null
          created_at?: string
          deserved_result?: string
          game_id?: string
          id?: string
          last_played_at?: string | null
          start_fen?: string
          status?: string
          user_color?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "endgame_scenarios_blunder_id_fkey"
            columns: ["blunder_id"]
            isOneToOne: false
            referencedRelation: "blunders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endgame_scenarios_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_events: {
        Row: {
          anon_id: string
          created_at: string
          id: string
          platform: string | null
          referrer: string | null
          type: string
          user_agent: string | null
          username: string | null
        }
        Insert: {
          anon_id: string
          created_at?: string
          id?: string
          platform?: string | null
          referrer?: string | null
          type: string
          user_agent?: string | null
          username?: string | null
        }
        Update: {
          anon_id?: string
          created_at?: string
          id?: string
          platform?: string | null
          referrer?: string | null
          type?: string
          user_agent?: string | null
          username?: string | null
        }
        Relationships: []
      }
      game_annotations: {
        Row: {
          annotations: Json
          created_at: string
          game_id: string
          id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          annotations?: Json
          created_at?: string
          game_id: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          annotations?: Json
          created_at?: string
          game_id?: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_annotations_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          analyzed_at: string | null
          clock_per_ply: Json | null
          created_at: string | null
          eco: string | null
          external_game_id: string
          id: string
          opening_name: string | null
          opponent: string
          opponent_rating: number | null
          parsed_metadata_at: string | null
          pgn: string
          platform: string
          played_at: string | null
          rated: boolean | null
          result: string | null
          time_control: string | null
          total_plies: number | null
          user_color: string | null
          user_id: string | null
          user_rating: number | null
          username: string
        }
        Insert: {
          analyzed_at?: string | null
          clock_per_ply?: Json | null
          created_at?: string | null
          eco?: string | null
          external_game_id: string
          id?: string
          opening_name?: string | null
          opponent: string
          opponent_rating?: number | null
          parsed_metadata_at?: string | null
          pgn: string
          platform: string
          played_at?: string | null
          rated?: boolean | null
          result?: string | null
          time_control?: string | null
          total_plies?: number | null
          user_color?: string | null
          user_id?: string | null
          user_rating?: number | null
          username: string
        }
        Update: {
          analyzed_at?: string | null
          clock_per_ply?: Json | null
          created_at?: string | null
          eco?: string | null
          external_game_id?: string
          id?: string
          opening_name?: string | null
          opponent?: string
          opponent_rating?: number | null
          parsed_metadata_at?: string | null
          pgn?: string
          platform?: string
          played_at?: string | null
          rated?: boolean | null
          result?: string | null
          time_control?: string | null
          total_plies?: number | null
          user_color?: string | null
          user_id?: string | null
          user_rating?: number | null
          username?: string
        }
        Relationships: []
      }
      landing_stats_cache: {
        Row: {
          computed_at: string
          id: number
          payload: Json
        }
        Insert: {
          computed_at?: string
          id?: number
          payload: Json
        }
        Update: {
          computed_at?: string
          id?: number
          payload?: Json
        }
        Relationships: []
      }
      opening_explorer_cache: {
        Row: {
          created_at: string
          db: string
          fen: string
          result: Json
          variant_key: string
        }
        Insert: {
          created_at?: string
          db?: string
          fen: string
          result: Json
          variant_key?: string
        }
        Update: {
          created_at?: string
          db?: string
          fen?: string
          result?: Json
          variant_key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          anon_id: string | null
          autoplay_refutation: boolean
          avatar_url: string | null
          board_theme: string
          chesscom_username: string | null
          created_at: string | null
          current_streak_days: number
          display_name: string | null
          id: string
          last_drill_local_date: string | null
          last_synced_chesscom_at: string | null
          last_synced_lichess_at: string | null
          lichess_username: string | null
          longest_streak_days: number
          preferred_rated_only: boolean
          preferred_time_controls: string[]
          reveal_before_solve: boolean
          show_engine_evals: boolean
          sounds_enabled: boolean
          timezone: string | null
          used_training_filter: boolean
        }
        Insert: {
          anon_id?: string | null
          autoplay_refutation?: boolean
          avatar_url?: string | null
          board_theme?: string
          chesscom_username?: string | null
          created_at?: string | null
          current_streak_days?: number
          display_name?: string | null
          id: string
          last_drill_local_date?: string | null
          last_synced_chesscom_at?: string | null
          last_synced_lichess_at?: string | null
          lichess_username?: string | null
          longest_streak_days?: number
          preferred_rated_only?: boolean
          preferred_time_controls?: string[]
          reveal_before_solve?: boolean
          show_engine_evals?: boolean
          sounds_enabled?: boolean
          timezone?: string | null
          used_training_filter?: boolean
        }
        Update: {
          anon_id?: string | null
          autoplay_refutation?: boolean
          avatar_url?: string | null
          board_theme?: string
          chesscom_username?: string | null
          created_at?: string | null
          current_streak_days?: number
          display_name?: string | null
          id?: string
          last_drill_local_date?: string | null
          last_synced_chesscom_at?: string | null
          last_synced_lichess_at?: string | null
          lichess_username?: string | null
          longest_streak_days?: number
          preferred_rated_only?: boolean
          preferred_time_controls?: string[]
          reveal_before_solve?: boolean
          show_engine_evals?: boolean
          sounds_enabled?: boolean
          timezone?: string | null
          used_training_filter?: boolean
        }
        Relationships: []
      }
      repertoire_moves: {
        Row: {
          color: string
          created_at: string
          epd: string
          id: string
          san: string
          uci: string
          user_id: string
        }
        Insert: {
          color: string
          created_at?: string
          epd: string
          id?: string
          san: string
          uci: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          epd?: string
          id?: string
          san?: string
          uci?: string
          user_id?: string
        }
        Relationships: []
      }
      training_sessions: {
        Row: {
          blunders_attempted: number
          blunders_correct: number
          cycles_completed: number
          ended_at: string | null
          id: string
          local_date: string
          started_at: string
          user_id: string
        }
        Insert: {
          blunders_attempted?: number
          blunders_correct?: number
          cycles_completed?: number
          ended_at?: string | null
          id?: string
          local_date: string
          started_at?: string
          user_id: string
        }
        Update: {
          blunders_attempted?: number
          blunders_correct?: number
          cycles_completed?: number
          ended_at?: string | null
          id?: string
          local_date?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_kpis: { Args: never; Returns: Json }
      admin_user_list: { Args: { category: string }; Returns: Json }
      get_blunder_motif_counts: { Args: never; Returns: Json }
      landing_stats: { Args: never; Returns: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
