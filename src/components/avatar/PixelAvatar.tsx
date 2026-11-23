import { useMemo } from 'react';
import clsx from 'clsx';
import { AVATAR_GRID, avatarPixels, resolveAvatar, type AvatarParts } from '../../lib/avatar';
import { useAuth } from '../../auth/useAuth';

interface PixelAvatarProps {
  parts: AvatarParts;
  className?: string;
  /** Accessible name; decorative (aria-hidden) when omitted. */
  title?: string;
}

/** A pixel avatar as crisp SVG rects (src/lib/avatar.ts). Square; size it with className. */
export function PixelAvatar({ parts, className, title }: PixelAvatarProps) {
  const runs = useMemo(() => avatarPixels(parts), [parts]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${AVATAR_GRID} ${AVATAR_GRID}`}
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={clsx('block', className)}
    >
      {title && <title>{title}</title>}
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </svg>
  );
}

/** The signed-in player's avatar: their own, or the default generated from their id. */
export function MyAvatar({ className, title }: { className?: string; title?: string }) {
  const { profile } = useAuth();
  const parts = useMemo(() => resolveAvatar(profile?.avatar ?? null, profile?.id ?? 'player'), [profile?.avatar, profile?.id]);
  return <PixelAvatar parts={parts} className={className} title={title} />;
}
