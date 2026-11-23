import { useEffect, useState } from 'react';

/** Milliseconds left until `target` (epoch ms), re-rendering every second; 0 once it passes. */
export function useCountdown(target: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= target) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  return target == null ? 0 : Math.max(0, target - now);
}
