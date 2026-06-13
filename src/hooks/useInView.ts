import { useEffect, useState } from 'react';

/**
 * Fires once when the observed element first scrolls into view. Uses a callback
 * ref so it attaches correctly even when the element mounts asynchronously
 * (e.g. after a query resolves). Falls back to immediately "in view" where
 * IntersectionObserver is unavailable.
 */
export function useInView<T extends Element>(threshold = 0.3) {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!node || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, inView, threshold]);

  return { ref: setNode, inView };
}
