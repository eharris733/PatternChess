import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { supabase } from '../lib/supabase';

/** Funnel segments of `admin_outreach_leads` (migration 20261010160000). */
export type OutreachSegment =
  | 'demo_only'
  | 'signed_up_not_connected'
  | 'connected_no_games'
  | 'synced_never_trained'
  | 'contacted';

export const OUTREACH_SEGMENTS: OutreachSegment[] = [
  'demo_only',
  'signed_up_not_connected',
  'connected_no_games',
  'synced_never_trained',
  'contacted',
];

export interface OutreachLead {
  /** `lichess:<handle>` / `chesscom:<handle>` / `user:<uuid>` (lower-case handle). */
  leadKey: string;
  /** 'lichess' | 'chesscom' | 'user' (no handle). */
  platform: string | null;
  username: string | null;
  email: string | null;
  since: string | null;
  lastSeen: string | null;
  attempts: number | null;
  blunders: number | null;
  contactedAt: string | null;
  note: string | null;
  signedUp: boolean;
  trainedSinceContact: boolean;
}

export interface OutreachLeads {
  segment: OutreachSegment;
  /** Uncontacted count per segment, plus the total under `contacted`. */
  counts: Partial<Record<OutreachSegment, number>>;
  rows: OutreachLead[];
}

export interface LandingCtaRow {
  type: 'cta_click' | 'lead_return';
  source: string;
  events: number;
  visitors: number;
}

function useIsAdmin() {
  const { user } = useAuth();
  return { user, admin: !!user && isAdminEmail(user.email) };
}

export function useOutreachLeads(segment: OutreachSegment) {
  const { user, admin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'outreach', user?.id, segment],
    enabled: admin,
    staleTime: 60_000,
    // Keep the previous tab's payload (its counts) while the next one loads.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<OutreachLeads> => {
      const { data, error } = await supabase.rpc('admin_outreach_leads', { segment });
      if (error) throw error;
      const j = (data ?? {}) as any;
      return {
        segment,
        counts: (j.counts ?? {}) as OutreachLeads['counts'],
        rows: Array.isArray(j.rows) ? (j.rows as OutreachLead[]) : [],
      };
    },
  });
}

/** Mark (or, with `undo`, unmark) a lead as messaged. */
export function useMarkContacted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      leadKey: string;
      segment: OutreachSegment;
      note?: string;
      undo?: boolean;
    }) => {
      const { error } = input.undo
        ? await supabase.rpc('admin_unmark_contacted', { lead_key: input.leadKey })
        : await supabase.rpc('admin_mark_contacted', {
            lead_key: input.leadKey,
            segment: input.segment,
            note: input.note ?? '',
          });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'outreach'] }),
  });
}

/** Landing CTA clicks + win-back returns per source (last `days`). */
export function useLandingCtas(days = 30) {
  const { user, admin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'landingCtas', user?.id, days],
    enabled: admin,
    staleTime: 60_000,
    queryFn: async (): Promise<LandingCtaRow[]> => {
      const { data, error } = await supabase.rpc('admin_landing_ctas', { days });
      if (error) throw error;
      return (data ?? []) as unknown as LandingCtaRow[];
    },
  });
}
