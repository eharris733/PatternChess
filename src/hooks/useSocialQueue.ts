import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { rpc } from '../lib/api';

/** What scripts/social/plan.ts drew (social_posts.puzzle). */
export interface SocialPuzzle {
  /** Missing on rows made before the fall format (= blunder). */
  format?: 'blunder' | 'fall';
  fen: string;
  side: 'white' | 'black';
  rating: number | null;
  timeControl: string | null;
  played: string;
  /** fall: the opponent's punishment. */
  refutation?: string[];
  solution: string[];
  motifLabel: string | null;
  fellCount?: number | null;
  headline?: string;
  hook: string;
}

/** The narrated script (social_posts.script, scripts/social/script.ts VideoScript). */
export interface SocialScript {
  hookStyle: string;
  headline: string;
  subline: string;
  beats: Partial<Record<'hook' | 'challenge' | 'played' | 'refutation' | 'reveal' | 'cta', string>>;
  captionLead: string;
}

export interface SocialPost {
  id: string;
  blunder_id: string;
  scheduled_for: string;
  status: 'queued' | 'vetoed' | 'posted' | 'failed';
  hook_template: string | null;
  motif: string | null;
  caption: string | null;
  tiktok_caption: string | null;
  puzzle: SocialPuzzle | null;
  media_url: string | null;
  poster_url: string | null;
  permalink: string | null;
  ig_error: string | null;
  tiktok_status: string | null;
  tiktok_error: string | null;
  plays: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  insights_at: string | null;
  posted_at: string | null;
  format: 'blunder' | 'fall';
  fell_count: number | null;
  script: SocialScript | null;
  script_source: 'claude' | 'template' | null;
  voice: string | null;
  buffer_ig_post_id: string | null;
  buffer_tiktok_post_id: string | null;
  buffer_error: string | null;
}

export interface SocialQueue {
  today: string;
  upcoming: SocialPost[];
  recent: SocialPost[];
}

const KEY = ['admin', 'socialQueue'];

/** The daily puzzle-video queue (`admin.socialQueue`, functions/_shared/rpc/social.ts). Admin only. */
export function useSocialQueue() {
  const { user } = useAuth();
  const admin = !!user && isAdminEmail(user.email);
  return useQuery({
    queryKey: [...KEY, user?.id],
    enabled: admin,
    staleTime: 60_000,
    retry: false,
    queryFn: () => rpc<SocialQueue>('admin.socialQueue'),
  });
}

export function useSetSocialStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'vetoed' | 'queued' }) => rpc('admin.socialSetStatus', v),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
