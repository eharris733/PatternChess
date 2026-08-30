import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
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

    let trailingId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (trailingId !== null) window.clearTimeout(trailingId);
      trailingId = window.setTimeout(() => {
        trailingId = null;
        apiRef.current?.redrawAll();
        window.dispatchEvent(new Event('resize'));
      }, 250);
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
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
