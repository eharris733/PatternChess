import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import '../styles/chessground.css';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';

export interface ChessgroundReactProps {
  config: Config;
  contained?: boolean;
  className?: string;
  onReady?: (api: Api) => void;
}

export function ChessgroundReact({ config, contained = true, className, onReady }: ChessgroundReactProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const api = Chessground(el, config);
    apiRef.current = api;
    onReady?.(api);

    // Chessground caches its pixel bounds at construction; when the wrapper is
    // still settling into its final size (small list thumbnails especially),
    // pieces get translated against stale bounds and render clipped.
    const rafId = requestAnimationFrame(() => api.redrawAll());

    // Leading + trailing redraw: the sidebar animates its width over ~200ms,
    // and chessground hit-tests drags/clicks against cached bounds, so a
    // trailing-only debounce left the board misaligned for the whole
    // transition. Redraw on every observed tick (cheap — one bounds read),
    // then once more after things settle.
    const redraw = () => apiRef.current?.redrawAll();
    let trailingId: number | null = null;
    const observer = new ResizeObserver(() => {
      redraw();
      if (trailingId !== null) window.clearTimeout(trailingId);
      trailingId = window.setTimeout(() => {
        trailingId = null;
        redraw();
      }, 250);
    });
    observer.observe(el);
    // Standard chessground hook — AppShell fires it when the sidebar
    // transition ends so the final bounds are always fresh.
    document.addEventListener('chessground.resize', redraw);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener('chessground.resize', redraw);
      if (trailingId !== null) window.clearTimeout(trailingId);
      api.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.set(config);
  }, [config]);

  return (
    <div
      ref={wrapRef}
      className={className}
      data-contained={contained ? 'true' : 'false'}
      style={contained ? { width: '100%', height: '100%' } : undefined}
    />
  );
}
