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
    PostgrestVersion: "14.4"
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
      email_confirmations: {
        Row: {
          created_at: string
          email: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      email_sends: {
        Row: {
          id: number
          kind: string
          provider_id: string | null
          sent_at: string
          to_email: string
          user_id: string
        }
        Insert: {
          id?: never
          kind: string
          provider_id?: string | null
          sent_at?: string
          to_email: string
          user_id: string
        }
        Update: {
          id?: never
          kind?: string
          provider_id?: string | null
          sent_at?: string
          to_email?: string
          user_id?: string
        }
        Relationships: []
      }
      endgame_scenarios: {
        Row: {
          actual_result: string
          attempts: number
          blunder_id: string | null
          created_at: string
          cycle_number: number
          deserved_result: string
          game_id: string
          id: string
          last_drill_failed: boolean
          last_drilled_at: string | null
          last_played_at: string | null
          next_drill_at: string | null
          retired_at: string | null
          start_fen: string
          status: string
          times_attempted: number
          times_correct: number
          user_color: string
          user_id: string
          verified_at: string | null
          verify_eval_cp: number | null
        }
        Insert: {
          actual_result: string
          attempts?: number
          blunder_id?: string | null
          created_at?: string
          cycle_number?: number
          deserved_result: string
          game_id: string
          id?: string
          last_drill_failed?: boolean
          last_drilled_at?: string | null
          last_played_at?: string | null
          next_drill_at?: string | null
          retired_at?: string | null
          start_fen: string
          status?: string
          times_attempted?: number
          times_correct?: number
          user_color: string
          user_id: string
          verified_at?: string | null
          verify_eval_cp?: number | null
        }
        Update: {
          actual_result?: string
          attempts?: number
          blunder_id?: string | null
          created_at?: string
          cycle_number?: number
          deserved_result?: string
          game_id?: string
          id?: string
          last_drill_failed?: boolean
          last_drilled_at?: string | null
          last_played_at?: string | null
          next_drill_at?: string | null
          retired_at?: string | null
          start_fen?: string
          status?: string
          times_attempted?: number
          times_correct?: number
          user_color?: string
          user_id?: string
          verified_at?: string | null
          verify_eval_cp?: number | null
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
      event_digest_subscribers: {
        Row: {
          confirm_token: string
          confirmed_at: string | null
          country: string
          created_at: string
          email: string
          id: string
          last_sent_at: string | null
          region: string | null
          source_path: string | null
          status: string
          unsub_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          confirm_token?: string
          confirmed_at?: string | null
          country?: string
          created_at?: string
          email: string
          id?: string
          last_sent_at?: string | null
          region?: string | null
          source_path?: string | null
          status?: string
          unsub_token?: string
          unsubscribed_at?: string | null
        }
        Update: {
          confirm_token?: string
          confirmed_at?: string | null
          country?: string
          created_at?: string
          email?: string
          id?: string
          last_sent_at?: string | null
          region?: string | null
          source_path?: string | null
          status?: string
          unsub_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      funnel_events: {
        Row: {
          anon_id: string
          created_at: string
          id: string
          platform: string | null
          referrer: string | null
          source: string | null
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
          source?: string | null
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
          source?: string | null
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
          opening_classified_at: string | null
          opening_deviation_version: number | null
          opening_family: string | null
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
          opening_classified_at?: string | null
          opening_deviation_version?: number | null
          opening_family?: string | null
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
          opening_classified_at?: string | null
          opening_deviation_version?: number | null
          opening_family?: string | null
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
      lead_outreach: {
        Row: {
          contacted_at: string
          lead_key: string
          note: string | null
          segment: string
        }
        Insert: {
          contacted_at?: string
          lead_key: string
          note?: string | null
          segment: string
        }
        Update: {
          contacted_at?: string
          lead_key?: string
          note?: string | null
          segment?: string
        }
        Relationships: []
      }
      opening_deviations: {
        Row: {
          blunder_id: string | null
          book_end_ply: number | null
          book_tier: string | null
          chances_lost: number | null
          classification: string | null
          created_at: string
          eco: string | null
          epd_before: string | null
          eval_after: number | null
          eval_before: number | null
          eval_depth: number | null
          evaluated_at: string | null
          fen_before: string | null
          game_id: string
          id: string
          move_number: number | null
          opening_family: string | null
          opening_name: string | null
          past_book_checked_at: string | null
          played_games: number | null
          played_mover_win_pct: number | null
          played_san: string | null
          played_uci: string | null
          ply: number | null
          position_games: number | null
          reason: string | null
          rule_version: number
          status: string
          theory_moves: Json | null
          user_color: string | null
          user_id: string
        }
        Insert: {
          blunder_id?: string | null
          book_end_ply?: number | null
          book_tier?: string | null
          chances_lost?: number | null
          classification?: string | null
          created_at?: string
          eco?: string | null
          epd_before?: string | null
          eval_after?: number | null
          eval_before?: number | null
          eval_depth?: number | null
          evaluated_at?: string | null
          fen_before?: string | null
          game_id: string
          id?: string
          move_number?: number | null
          opening_family?: string | null
          opening_name?: string | null
          past_book_checked_at?: string | null
          played_games?: number | null
          played_mover_win_pct?: number | null
          played_san?: string | null
          played_uci?: string | null
          ply?: number | null
          position_games?: number | null
          reason?: string | null
          rule_version: number
          status: string
          theory_moves?: Json | null
          user_color?: string | null
          user_id: string
        }
        Update: {
          blunder_id?: string | null
          book_end_ply?: number | null
          book_tier?: string | null
          chances_lost?: number | null
          classification?: string | null
          created_at?: string
          eco?: string | null
          epd_before?: string | null
          eval_after?: number | null
          eval_before?: number | null
          eval_depth?: number | null
          evaluated_at?: string | null
          fen_before?: string | null
          game_id?: string
          id?: string
          move_number?: number | null
          opening_family?: string | null
          opening_name?: string | null
          past_book_checked_at?: string | null
          played_games?: number | null
          played_mover_win_pct?: number | null
          played_san?: string | null
          played_uci?: string | null
          ply?: number | null
          position_games?: number | null
          reason?: string | null
          rule_version?: number
          status?: string
          theory_moves?: Json | null
          user_color?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_deviations_blunder_id_fkey"
            columns: ["blunder_id"]
            isOneToOne: false
            referencedRelation: "blunders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_deviations_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          anon_id: string | null
          app_opens: number
          autoplay_refutation: boolean
          avatar_url: string | null
          board_theme: string
          chesscom_username: string | null
          commitment_level: string
          contact_email: string | null
          contact_email_verified_at: string | null
          course_prompt_count: number
          course_prompted_at: string | null
          created_at: string | null
          current_streak_days: number
          daily_games_goal: number
          daily_positions_goal: number
          display_name: string | null
          email_hour: number
          email_opt_in: boolean
          email_prompt_count: number
          email_prompted_at: string | null
          email_reminders: string
          email_reports: string
          email_unsub_token: string
          email_unsubscribed_at: string | null
          events_state: string | null
          flair: string | null
          followed_instagram: boolean
          id: string
          last_drill_local_date: string | null
          last_synced_chesscom_at: string | null
          last_synced_lichess_at: string | null
          leaderboard_opt_out: boolean
          learn_chapters_done: string[]
          lichess_username: string | null
          longest_streak_days: number
          opening_reviews_opened: number
          preferred_rated_only: boolean
          preferred_time_controls: string[]
          referral_code: string
          referrals_count: number
          referred_by: string | null
          reveal_before_solve: boolean
          shares_count: number
          show_answer_on_miss: boolean
          show_engine_evals: boolean
          signup_source: string | null
          sounds_enabled: boolean
          streak_freezes: number
          streak_freezes_used: number
          supporter_prompt_count: number
          supporter_prompted_at: string | null
          timezone: string | null
          used_training_filter: boolean
        }
        Insert: {
          anon_id?: string | null
          app_opens?: number
          autoplay_refutation?: boolean
          avatar_url?: string | null
          board_theme?: string
          chesscom_username?: string | null
          commitment_level?: string
          contact_email?: string | null
          contact_email_verified_at?: string | null
          course_prompt_count?: number
          course_prompted_at?: string | null
          created_at?: string | null
          current_streak_days?: number
          daily_games_goal?: number
          daily_positions_goal?: number
          display_name?: string | null
          email_hour?: number
          email_opt_in?: boolean
          email_prompt_count?: number
          email_prompted_at?: string | null
          email_reminders?: string
          email_reports?: string
          email_unsub_token?: string
          email_unsubscribed_at?: string | null
          events_state?: string | null
          flair?: string | null
          followed_instagram?: boolean
          id: string
          last_drill_local_date?: string | null
          last_synced_chesscom_at?: string | null
          last_synced_lichess_at?: string | null
          leaderboard_opt_out?: boolean
          learn_chapters_done?: string[]
          lichess_username?: string | null
          longest_streak_days?: number
          opening_reviews_opened?: number
          preferred_rated_only?: boolean
          preferred_time_controls?: string[]
          referral_code?: string
          referrals_count?: number
          referred_by?: string | null
          reveal_before_solve?: boolean
          shares_count?: number
          show_answer_on_miss?: boolean
          show_engine_evals?: boolean
          signup_source?: string | null
          sounds_enabled?: boolean
          streak_freezes?: number
          streak_freezes_used?: number
          supporter_prompt_count?: number
          supporter_prompted_at?: string | null
          timezone?: string | null
          used_training_filter?: boolean
        }
        Update: {
          anon_id?: string | null
          app_opens?: number
          autoplay_refutation?: boolean
          avatar_url?: string | null
          board_theme?: string
          chesscom_username?: string | null
          commitment_level?: string
          contact_email?: string | null
          contact_email_verified_at?: string | null
          course_prompt_count?: number
          course_prompted_at?: string | null
          created_at?: string | null
          current_streak_days?: number
          daily_games_goal?: number
          daily_positions_goal?: number
          display_name?: string | null
          email_hour?: number
          email_opt_in?: boolean
          email_prompt_count?: number
          email_prompted_at?: string | null
          email_reminders?: string
          email_reports?: string
          email_unsub_token?: string
          email_unsubscribed_at?: string | null
          events_state?: string | null
          flair?: string | null
          followed_instagram?: boolean
          id?: string
          last_drill_local_date?: string | null
          last_synced_chesscom_at?: string | null
          last_synced_lichess_at?: string | null
          leaderboard_opt_out?: boolean
          learn_chapters_done?: string[]
          lichess_username?: string | null
          longest_streak_days?: number
          opening_reviews_opened?: number
          preferred_rated_only?: boolean
          preferred_time_controls?: string[]
          referral_code?: string
          referrals_count?: number
          referred_by?: string | null
          reveal_before_solve?: boolean
          shares_count?: number
          show_answer_on_miss?: boolean
          show_engine_evals?: boolean
          signup_source?: string | null
          sounds_enabled?: boolean
          streak_freezes?: number
          streak_freezes_used?: number
          supporter_prompt_count?: number
          supporter_prompted_at?: string | null
          timezone?: string | null
          used_training_filter?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_leaderboard_cache: {
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
      supporters: {
        Row: {
          beta_invited_at: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          first_supported_at: string | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          beta_invited_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          first_supported_at?: string | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          beta_invited_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          first_supported_at?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
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
      admin_email_stats: { Args: never; Returns: Json }
      admin_kpis: { Args: never; Returns: Json }
      admin_landing_ctas: { Args: { days?: number }; Returns: Json }
      admin_mark_contacted: {
        Args: { lead_key: string; note?: string; segment: string }
        Returns: undefined
      }
      admin_outreach_leads: { Args: { segment: string }; Returns: Json }
      admin_retention: { Args: never; Returns: Json }
      admin_supporters: {
        Args: never
        Returns: {
          beta_invited_at: string
          cancel_at_period_end: boolean
          current_period_end: string
          email: string
          first_supported_at: string
          label: string
          status: string
          user_id: string
        }[]
      }
      admin_unmark_contacted: { Args: { lead_key: string }; Returns: undefined }
      admin_user_list: { Args: { category: string }; Returns: Json }
      apply_game_openings: { Args: { p_rows: Json }; Returns: number }
      blunder_counts_by_game: { Args: never; Returns: Json }
      bump_app_open: { Args: never; Returns: number }
      claim_referral: { Args: { code: string }; Returns: boolean }
      claim_signup_source: { Args: { source: string }; Returns: boolean }
      confirm_event_digest: {
        Args: { p_token: string }
        Returns: {
          country: string
          region: string
        }[]
      }
      email_candidates: {
        Args: { p_now?: string; p_user?: string }
        Returns: {
          data: Json
          kind: string
          to_email: string
          unsub_token: string
          user_id: string
        }[]
      }
      email_confirm: { Args: { p_token: string }; Returns: Json }
      email_outbox: {
        Args: { p_now?: string }
        Returns: {
          data: Json
          kind: string
          to_email: string
          unsub_token: string
          user_id: string
        }[]
      }
      email_prefs_by_token: { Args: { p_token: string }; Returns: Json }
      email_prefs_json: { Args: { p_user: string }; Returns: Json }
      email_report_data: {
        Args: { p_now: string; p_since: string; p_user: string }
        Returns: Json
      }
      email_unsubscribe: { Args: { p_token: string }; Returns: Json }
      email_update_prefs_by_token: {
        Args: {
          p_hour: number
          p_opt_in: boolean
          p_reminders: string
          p_reports: string
          p_token: string
        }
        Returns: Json
      }
      gen_referral_code: { Args: never; Returns: string }
      get_blunder_motif_counts: { Args: never; Returns: Json }
      increment_opening_reviews: { Args: never; Returns: number }
      increment_shares_count: { Args: never; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      is_supporter: { Args: { uid: string }; Returns: boolean }
      landing_stats: { Args: never; Returns: Json }
      leaderboard: {
        Args: { limit_n?: number; metric: string; win: string }
        Returns: Json
      }
      mark_ask_prompted: { Args: { p_ask: string }; Returns: undefined }
      mark_learn_chapter_done: { Args: { key: string }; Returns: number }
      public_leaderboard: { Args: never; Returns: Json }
      subscribe_event_digest: {
        Args: {
          p_country: string
          p_email: string
          p_region: string
          p_source_path: string
        }
        Returns: {
          confirm_token: string
          send_confirm: boolean
          status: string
          unsub_token: string
        }[]
      }
      supporter_badge: { Args: { uid: string }; Returns: string }
      training_totals: { Args: never; Returns: Json }
      unsubscribe_event_digest: { Args: { p_token: string }; Returns: boolean }
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
