import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// easeOutExpo — fast start, gentle settle, so the final value lands with weight.
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Animates an integer up to `target` once `active` becomes true.
 * Honors prefers-reduced-motion by snapping straight to the final value.
 */
export function useCountUp(target: number, active: boolean, durationMs = 1600) {
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);
  valueRef.current = value;
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

    // Animate from wherever we are, not from 0: when live stats replace the
    // build-time snapshot mid-animation the number glides instead of resetting.
    const from = valueRef.current;
    let startTime: number | null = null;
    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const progress = Math.min((now - startTime) / durationMs, 1);
      setValue(Math.round(from + easeOutExpo(progress) * (target - from)));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // valueRef is intentionally read once at effect start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, durationMs]);

  return value;
}
