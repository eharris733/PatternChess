import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useLeaderboard } from '../../hooks/useLeaderboard';
import { inviteUrl } from '../../lib/referral';
import { recordShare } from '../../share/recordShare';
import { copyText, shareLink } from '../../share/shareFile';
import { ShareIcon } from '../icons/ShareIcon';

/** "Invite a friend to compete": a referral link with your rank as the hook. */
export function InviteCard() {
  const { profile, refreshProfile } = useAuth();
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
        <p className="text-text-primary text-sm">
          Send your link. When a friend joins, they show up on the board next to you.
          {joined > 0 && (
            <span className="font-semibold">
              {' '}
              {joined} {joined === 1 ? 'friend has' : 'friends have'} joined so far.
            </span>
          )}
        </p>
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
