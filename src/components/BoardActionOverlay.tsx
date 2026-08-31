import { useEffect, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';

/**
 * Mobile-only visibility state for the post-attempt board cover: mounts only
 * below lg (the desktop panel button is always in view there) and resets the
 * dismissal whenever `resetKey` changes (new item, new phase).
 */
export function useActionOverlay(resetKey: string) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
  }, [resetKey]);
  return { enabled: !isDesktop && !dismissed, dismiss: () => setDismissed(true) };
}

/**
 * Board cover shown when a drill or play-out finishes: the outcome plus the
 * primary action, reachable without scrolling; dismissing reveals the board
 * and the lines below. Render inside <BoardStage overlay={...}>.
 */
export function BoardActionOverlay({
  message,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-text-primary/40 backdrop-blur-sm px-6">
      <p className="text-bg font-mono uppercase text-sm tracking-tight text-center [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]">
        {message}
      </p>
      <button className="btn-primary w-full max-w-[240px]" onClick={onAction}>
        {actionLabel}
      </button>
      <button className="btn-outline bg-surface w-full max-w-[240px]" onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>
  );
}
