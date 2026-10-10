/**
 * Win-back message templates for the admin outreach queue (/analytics). One
 * short, personal message per funnel segment; the admin sends each by hand on
 * Lichess / chess.com (or by email for Google signups without a handle).
 */
import type { OutreachSegment } from '../hooks/useOutreach';

export interface OutreachTemplateVars {
  username: string | null;
  blunders: number | null;
  link: string;
}

export const OUTREACH_SEGMENT_LABEL: Record<OutreachSegment, string> = {
  demo_only: 'Tried the demo',
  signed_up_not_connected: 'No account linked',
  connected_no_games: 'No games imported',
  synced_never_trained: 'Never trained',
  contacted: 'Contacted',
};

export const OUTREACH_SEGMENT_HINT: Record<OutreachSegment, string> = {
  demo_only: 'Entered a username on the landing page and never signed up.',
  signed_up_not_connected: 'Signed up without linking Lichess or chess.com. Email only.',
  connected_no_games: 'Linked a handle, but no games arrived.',
  synced_never_trained: 'Games analyzed, blunders waiting, never drilled one.',
  contacted: 'Everyone you have messaged, with what they did since.',
};

function hi(username: string | null): string {
  return username ? `Hi ${username},` : 'Hi,';
}

export function outreachMessage(segment: OutreachSegment, v: OutreachTemplateVars): string {
  switch (segment) {
    case 'demo_only':
      return `${hi(v.username)} you tried PatternChess a while back and it pulled the blunders from your recent games. I'm Elliot, the developer. Here's your analysis again: ${v.link}\n\nSign up free and it drills those exact positions until you spot them in your own games. Any feedback is welcome too.`;
    case 'signed_up_not_connected':
      return `${hi(v.username)} you signed up for PatternChess but haven't linked your Lichess or chess.com account yet. It takes about ten seconds: ${v.link}\n\nOnce your games are in, it finds your blunders and drills them. I'm the developer, so reply if anything got in the way.`;
    case 'connected_no_games':
      return `${hi(v.username)} you signed up for PatternChess but your games never came through, which is on me. Log in again (${v.link}) and the import retries. If it still fails, reply here and I'll fix it.`;
    case 'synced_never_trained':
    case 'contacted': {
      const found =
        v.blunders && v.blunders > 0
          ? `PatternChess found ${v.blunders} positions from your own games`
          : 'PatternChess found positions from your own games';
      return `${hi(v.username)} ${found} that are ready to drill. A session takes about five minutes: ${v.link}\n\nI'm Elliot, the developer. I'd love to hear what held you back.`;
    }
  }
}
