import type { ReactNode } from 'react';
import { BrandMark } from '../BrandLogo';
import { GOLD_LIGHT, SITE_LABEL, readShareTheme } from '../../share/boardCanvas';

/**
 * The HTML twin of the canvas share frame (boardCanvas): caption bar, the
 * content, then the PatternChess footer bar, in the same theme colours — so
 * the live "Link" preview matches the Screenshot and GIF exactly.
 */
export function ShareFrame({ caption, children }: { caption: string; children: ReactNode }) {
  const theme = readShareTheme();
  return (
    <div className="w-full border-2 border-text-primary shadow-card" data-testid="share-frame">
      <div
        className="flex items-center justify-center px-3 py-2 text-center text-sm font-semibold"
        style={{ backgroundColor: theme.ink, color: theme.paper }}
      >
        {caption}
      </div>
      {/* The board's own outline/shadow would double up inside the frame. */}
      <div className="[&_.cg-wrap]:!shadow-none [&_.cg-wrap]:!outline-none">{children}</div>
      <div
        className="flex items-center justify-between gap-2 px-2.5 py-1.5"
        style={{ backgroundColor: theme.ink }}
      >
        <span className="flex items-center gap-1.5">
          <BrandMark className="h-5 w-5" showTrajectory={false} />
          <span className="font-mono text-xs font-bold tracking-tight" style={{ color: theme.paper }}>
            PATTERNCHESS
          </span>
        </span>
        <span className="font-mono text-[10px] font-bold" style={{ color: GOLD_LIGHT }}>
          {SITE_LABEL}
        </span>
      </div>
    </div>
  );
}
