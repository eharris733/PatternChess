import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { getReferralSummary } from '../../services/supabaseService';
import { useLeaderboard } from '../../hooks/useLeaderboard';
import { inviteUrl } from '../../lib/referral';
import { recordShare } from '../../share/recordShare';
import { copyText, shareLink } from '../../share/shareFile';
import { ShareIcon } from '../icons/ShareIcon';

/**
 * "Invite a friend to compete": a referral link with your rank as the hook,
 * and the referral reward (3 months of Supporter perks per friend who trains
 * their first 20 positions; functions/_shared/supporterGrants.ts).
 */
export function InviteCard() {
  const { profile, refreshProfile, user } = useAuth();
  const summary = useQuery({
    queryKey: ['referralSummary', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => getReferralSummary(),
  });
  const needed = summary.data?.positionsNeeded ?? 20;
  const earned = summary.data?.rewardsEarned ?? 0;
  const perksUntil = summary.data?.perksUntil ?? null;
  const board = useLeaderboard('solved', 'all');
  const [copied, setCopied] = useState(false);
  const rank = board.data?.me?.rank ?? null;
  const url = inviteUrl(profile?.referralCode);
  const text =
    rank != null
      ? `I'm #${rank} on the PatternChess leaderboard. Think you can beat me?`
      : 'I train my own blunders on PatternChess. Come compete with me on the leaderboard.';
  const joined = profile?.referralsCount ?? 0;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const onShare = async () => {
    const outcome = await shareLink({ title: 'Compete with me on PatternChess', text, url });
    if (outcome === 'shared') recordShare(!!profile, refreshProfile);
    else if (outcome === null) await onCopy();
  };
  const onCopy = async () => {
    if (await copyText(`${text} ${url}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      recordShare(!!profile, refreshProfile);
    }
  };

  return (
    <section
      className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="invite-card"
    >
      <div className="flex flex-col gap-1">
        <h2 className="heading-md">Invite a friend to compete</h2>
        <p className="text-text-primary text-sm" data-testid="invite-reward">
          Send your link. When a friend joins and trains their first {needed} positions, you get 3
          months of Supporter perks, up to a year ahead.
          {joined > 0 && (
            <span className="font-semibold">
              {' '}
              {joined} {joined === 1 ? 'friend has' : 'friends have'} joined so far.
            </span>
          )}
        </p>
        {earned > 0 && (
          <p className="text-text-primary text-sm font-semibold" data-testid="invite-earned">
            {perksUntil
              ? `Your invites have earned you Supporter perks until ${perksUntil.toLocaleDateString()}.`
              : `Your invites earned ${earned} ${earned === 1 ? 'reward' : 'rewards'} so far.`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {canShare && (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => void onShare()}>
            <ShareIcon className="h-4 w-4" />
            Invite
          </button>
        )}
        <button
          type="button"
          className={canShare ? 'btn-outline' : 'btn-primary'}
          data-testid="invite-copy"
          onClick={() => void onCopy()}
        >
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
      </div>
    </section>
  );
}
