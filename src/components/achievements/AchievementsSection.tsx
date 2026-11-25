import { useState } from 'react';
import { RARE_PCT, rarityLabel, useAchievementRarity } from '../../hooks/useAchievementRarity';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useAchievements } from '../../hooks/useAchievements';
import { authService } from '../../services/authService';
import {
  ACHIEVEMENT_CATEGORY_LABEL,
  ACHIEVEMENT_CATEGORY_ORDER,
  achievementProgressLabel,
  type AchievementIcon,
  type EvaluatedAchievement,
} from '../../lib/achievements';
import { flairById } from '../../lib/flair';
import { inviteUrl } from '../../lib/referral';
import { recordShare } from '../../share/recordShare';
import { TrophyIcon } from '../icons/TrophyIcon';
import { OpeningIcon } from '../icons/OpeningIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { LearnIcon } from '../icons/LearnIcon';
import { ClockIcon } from '../icons/ClockIcon';
import { CalendarIcon } from '../icons/CalendarIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { InstagramIcon } from '../icons/InstagramIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { Skeleton } from '../Skeleton';
import { ShareImageModal } from '../share/ShareImageModal';
import { resolveAvatar } from '../../lib/avatar';

const TILE_ICON: Record<AchievementIcon, typeof TrophyIcon> = {
  trophy: TrophyIcon,
  opening: OpeningIcon,
  endgame: EndgameIcon,
  learn: LearnIcon,
  clock: ClockIcon,
  calendar: CalendarIcon,
};

function AchievementTile({
  a,
  pct,
  onAction,
  onShare,
}: {
  a: EvaluatedAchievement;
  /** Share of players who have it (achievements.rarity); undefined = unknown. */
  pct?: number;
  onAction?: (a: EvaluatedAchievement) => void;
  onShare: (a: EvaluatedAchievement) => void;
}) {
  const rarity = rarityLabel(pct);
  const rare = a.earned && pct != null && pct < RARE_PCT;
  const Icon = TILE_ICON[a.icon ?? 'trophy'];
  const external = a.action ? /^https?:/.test(a.action.href) : false;
  return (
    <div
      data-testid={`achievement-${a.id}`}
      className={clsx(
        'flex flex-col gap-2 rounded-none border-2 border-text-primary p-4',
        a.earned ? 'bg-surface-3' : 'bg-surface opacity-80',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('shrink-0', a.earned ? 'text-gold-dark' : 'text-text-primary/50')}>
          <Icon className="h-6 w-6" />
        </span>
        {a.earned ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-tight text-correct">
            <CheckIcon className="h-3.5 w-3.5" />
            Unlocked
          </span>
        ) : (
          <span className="text-text-primary text-xs tabular-nums">
            {achievementProgressLabel(a)}
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-text-primary">{a.title}</p>
        <p className="text-text-primary text-xs mt-0.5">{a.description}</p>
        {rarity && (
          <p
            className={clsx('mt-1 font-mono text-[10px] uppercase tracking-tight', rare ? 'text-gold-dark' : 'text-text-primary')}
            data-testid={`achievement-rarity-${a.id}`}
          >
            {rare ? `Rare · ${rarity}` : rarity}
          </p>
        )}
      </div>
      {a.earned && (
        <button
          type="button"
          className="btn-outline mt-auto inline-flex items-center gap-2 self-start text-xs"
          data-testid={`share-achievement-${a.id}`}
          onClick={() => onShare(a)}
        >
          <ShareIcon className="h-4 w-4" />
          Share
        </button>
      )}
      {!a.earned && a.action && !external && (
        <Link to={a.action.href} className="btn-outline inline-flex items-center gap-2 self-start text-xs">
          {a.action.label}
        </Link>
      )}
      {!a.earned && a.action && external && (
        <a
          href={a.action.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onAction?.(a)}
          className="btn-outline inline-flex items-center gap-2 self-start text-xs"
        >
          <InstagramIcon className="h-4 w-4" />
          {a.action.label}
        </a>
      )}
      {!a.earned && (
        <div className="mt-auto h-1.5 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
          <div
            className="h-full bg-gold-dark transition-[width] duration-300"
            style={{ width: `${Math.round(a.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** "Only 4% of players have this" for the share card (rare ones only say "Only"). */
function shareRarity(pct: number | undefined): string | null {
  const label = rarityLabel(pct);
  if (!label || pct == null) return null;
  return `${pct < RARE_PCT ? 'Only ' : ''}${label} have this`;
}

/** Every achievement by category, with an unlocked meter; earned tiles are shareable. */
export function AchievementsSection({ id }: { id?: string }) {
  const { profile, refreshProfile } = useAuth();
  const { achievements, earned, total, isPending } = useAchievements();
  const rarity = useAchievementRarity();
  const [sharing, setSharing] = useState<EvaluatedAchievement | null>(null);
  const fraction = total > 0 ? earned / total : 0;
  const playerLabel =
    profile?.lichessUsername ?? profile?.chesscomUsername ?? profile?.displayName?.split(/\s+/)[0] ?? null;

  // The only tile action today is the Instagram follow: the click opens the
  // link (new tab) and flags the profile so the achievement unlocks.
  const onTileAction = (a: EvaluatedAchievement) => {
    if (!profile || a.id !== 'follow-instagram') return;
    void authService
      .markFollowedInstagram(profile.id)
      .then(() => refreshProfile())
      .catch((err) => console.warn('[achievements] persist followed_instagram failed', err));
  };

  return (
    <section id={id} className="flex flex-col gap-4" data-testid="achievements-section">
      <div className="card flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <span className="label">Achievements unlocked</span>
          {isPending ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="text-text-primary text-sm tabular-nums">
              <span className="font-mono text-text-primary">{earned}</span> / {total}
            </span>
          )}
        </header>
        <div className="h-2 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
          <div
            className="h-full bg-gold-dark transition-[width] duration-300"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
          const items = achievements.filter((a) => a.category === category);
          if (items.length === 0) return null;
          const earnedInCat = items.filter((a) => a.earned).length;
          return (
            <div key={category} className="flex flex-col gap-3">
              <header className="flex items-baseline justify-between">
                <h3 className="heading-md">{ACHIEVEMENT_CATEGORY_LABEL[category]}</h3>
                <span className="text-text-primary text-xs tabular-nums">
                  {earnedInCat}/{items.length}
                </span>
              </header>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((a) => (
                  <AchievementTile key={a.id} a={a} pct={rarity.data?.pct[a.id]} onAction={onTileAction} onShare={setSharing} />
                ))}
              </div>
            </div>
          );
        })
      )}

      {sharing && (
        <ShareImageModal
          title="Share this achievement"
          filename={`patternchess-${sharing.id}.png`}
          shareText={`I unlocked "${sharing.title}" on PatternChess.`}
          shareUrl={inviteUrl(profile?.referralCode)}
          render={async () => {
            const { renderAchievementCard } = await import('../../share/achievementCard');
            return renderAchievementCard({
              title: sharing.title,
              description: sharing.description,
              categoryLabel: ACHIEVEMENT_CATEGORY_LABEL[sharing.category],
              playerLabel,
              flairTitle: flairById(profile?.flair)?.title ?? null,
              avatar: profile ? resolveAvatar(profile.avatar, profile.id) : null,
              rarityLine: shareRarity(rarity.data?.pct[sharing.id]),
            });
          }}
          onShared={() => recordShare(!!profile, refreshProfile)}
          onClose={() => setSharing(null)}
        />
      )}
    </section>
  );
}
