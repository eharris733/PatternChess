import { useMemo } from 'react';
import clsx from 'clsx';
import type { RewardItem } from '../../lib/rewards';
import { useAuth } from '../../auth/useAuth';
import { resolveAvatar, type AvatarParts } from '../../lib/avatar';
import { MiniSwatch, THEME_SWATCHES } from '../ThemePicker';
import { PieceSetStrip } from '../PieceSetPicker';
import { PixelAvatar } from '../avatar/PixelAvatar';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';

/**
 * A picture of one reward: the theme swatch, the pieces, your avatar wearing
 * it, or a streak freeze. `sm` is the inline size used on /path rungs.
 */
export function RewardPreview({ item, size = 'md' }: { item: RewardItem; size?: 'sm' | 'md' }) {
  const { profile } = useAuth();
  const avatar = useMemo<AvatarParts | null>(() => {
    if (item.kind !== 'avatar') return null;
    return { ...resolveAvatar(profile?.avatar ?? null, profile?.id ?? 'player'), [item.part]: item.id };
  }, [item, profile?.avatar, profile?.id]);
  const sm = size === 'sm';

  switch (item.kind) {
    case 'theme': {
      const p = THEME_SWATCHES[item.id];
      if (sm) {
        return (
          <span className="grid h-7 w-7 shrink-0 grid-cols-2 border border-text-primary/40" aria-hidden>
            {[p.boardLight, p.boardDark, p.boardDark, p.boardLight].map((c, i) => (
              <span key={i} style={{ backgroundColor: c }} />
            ))}
          </span>
        );
      }
      return (
        <div className="w-28 shrink-0">
          <MiniSwatch palette={p} />
        </div>
      );
    }
    case 'pieceSet':
      return <PieceSetStrip set={item.id} className={clsx('shrink-0', sm ? 'w-16' : 'w-28')} />;
    case 'avatar':
      return avatar ? (
        <PixelAvatar parts={avatar} className={clsx('shrink-0 border border-text-primary/40', sm ? 'h-7 w-7' : 'h-12 w-12')} />
      ) : null;
    case 'streakFreeze':
      return <SnowflakeIcon className={clsx('shrink-0 text-accent', sm ? 'h-6 w-6' : 'h-12 w-12')} />;
  }
}
