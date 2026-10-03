import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import '../styles/chessground.css';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';

const SQUARE = /^[a-h][1-8]$/;

function validShape(s: DrawShape): boolean {
  return SQUARE.test(s.orig) && (s.dest === undefined || SQUARE.test(s.dest));
}

function hasSize(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Whether chessground can draw shapes right now. It draws against bounds it
 * memoized at its last full redraw, not the live size: a board built at 0×0
 * whose wrapper has since been laid out still holds 0×0 bounds until the next
 * redrawAll (the /training mount). Rebuild once in that case.
 */
function boundsReady(api: Api, el: HTMLElement): boolean {
  const usable = () => {
    const b = api.state.dom.bounds();
    return b.width > 0 && b.height > 0;
  };
  if (usable()) return true;
  if (!hasSize(el)) return false;
  api.redrawAll();
  return usable();
}

/**
 * Chessground draws shapes in units of its cached bounds: a 0×0 board (not
 * laid out yet, or inside a hidden container) divides 0/0, and a shape with a
 * malformed square parses to NaN — either way every arrow becomes
 * `<line x1="NaN">`. Drop malformed shapes always, and hold all shapes back
 * while the board has no size (they're applied on the first real size).
 */
function sanitizeConfig(config: Config, sized: boolean): Config {
  const d = config.drawable;
  if (!d || (!d.shapes && !d.autoShapes)) return config;
  const clean = (shapes: DrawShape[]) => (sized ? shapes.filter(validShape) : []);
  // Only touch keys the caller set: chessground's merge copies an explicit
  // `undefined` over its default arrays (and then crashes reading them).
  const drawable = { ...d };
  if (d.shapes) drawable.shapes = clean(d.shapes);
  if (d.autoShapes) drawable.autoShapes = clean(d.autoShapes);
  return { ...config, drawable };
}

export interface ChessgroundReactProps {
  config: Config;
  contained?: boolean;
  className?: string;
  onReady?: (api: Api) => void;
}

export function ChessgroundReact({ config, contained = true, className, onReady }: ChessgroundReactProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  // True while shapes are held back for a 0×0 board (see sanitizeConfig).
  const shapesPendingRef = useRef(false);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    // Built without shapes; they go on once its bounds are known to be real.
    const api = Chessground(el, sanitizeConfig(config, false));
    const d = config.drawable;
    if (boundsReady(api, el)) {
      if (d?.shapes || d?.autoShapes) api.set(sanitizeConfig({ drawable: d }, true));
    } else {
      shapesPendingRef.current = true;
    }
    apiRef.current = api;
    onReady?.(api);

    // Chessground caches its pixel bounds at construction; when the wrapper is
    // still settling into its final size (small list thumbnails especially),
    // pieces get translated against stale bounds and render clipped.
    const rafId = requestAnimationFrame(() => redraw());

    // Leading + trailing redraw: the sidebar animates its width over ~200ms,
    // and chessground hit-tests drags/clicks against cached bounds, so a
    // trailing-only debounce left the board misaligned for the whole
    // transition. Redraw on every observed tick (cheap — one bounds read),
    // then once more after things settle.
    const redraw = () => {
      const a = apiRef.current;
      if (!a) return;
      // Collapsed to 0×0 (hidden, or mid layout swap on /training): there is
      // nothing to draw, and redrawing with arrows in state would render
      // them at NaN. Drop the arrows and restore them on the next real size.
      if (!hasSize(el)) {
        const { shapes, autoShapes } = a.state.drawable;
        if (shapes.length > 0 || autoShapes.length > 0) a.set({ drawable: { shapes: [], autoShapes: [] } });
        shapesPendingRef.current = true;
        return;
      }
      a.redrawAll();
      // First real size after a 0×0 mount: bounds are fresh now, so the
      // held-back shapes can be drawn.
      if (shapesPendingRef.current && boundsReady(a, el)) {
        shapesPendingRef.current = false;
        const d = configRef.current.drawable;
        if (d?.shapes || d?.autoShapes) a.set(sanitizeConfig({ drawable: d }, true));
      }
    };
    let trailingId: number | null = null;
    let leadingRaf: number | null = null;
    // Only a real size change needs a redraw: redrawAll rebuilds the board's
    // DOM, so firing it for a no-op observation (or a sub-pixel jitter)
    // snaps any piece animation in flight — the "twitch" during autoplay.
    // Seeded with the size at construction: the observer's first callback
    // reports that same size, and the rAF redraw above already covers settling.
    const sizeKey = (w: number, h: number) => `${Math.round(w)}x${Math.round(h)}`;
    const initial = el.getBoundingClientRect();
    let lastSize = sizeKey(initial.width, initial.height);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      const size = rect ? sizeKey(rect.width, rect.height) : '';
      if (size === lastSize) return;
      lastSize = size;
      // Next frame, not synchronously: a redraw inside the observer callback
      // trips "ResizeObserver loop completed with undelivered notifications".
      if (leadingRaf === null) {
        leadingRaf = requestAnimationFrame(() => {
          leadingRaf = null;
          redraw();
        });
      }
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
      if (leadingRaf !== null) cancelAnimationFrame(leadingRaf);
      if (trailingId !== null) window.clearTimeout(trailingId);
      api.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    const api = apiRef.current;
    if (!api || !el) return;
    const sized = boundsReady(api, el);
    if (!sized) shapesPendingRef.current = true;
    api.set(sanitizeConfig(config, sized));
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
