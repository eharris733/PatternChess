import { useEffect, useRef, useState } from 'react';

export interface RenderedImage {
  blob: Blob | null;
  url: string | null;
  error: boolean;
}

/**
 * Builds an image with `render` whenever `key` changes (null = nothing to
 * build) and exposes it as a Blob + object URL. Results are cached per key
 * so toggling formats back and forth never re-encodes.
 */
export function useRenderedImage(key: string | null, render: () => Promise<Blob>): RenderedImage {
  const cache = useRef(new Map<string, { blob: Blob; url: string }>());
  const [state, setState] = useState<RenderedImage>({ blob: null, url: null, error: false });
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    if (key == null) {
      setState({ blob: null, url: null, error: false });
      return;
    }
    const hit = cache.current.get(key);
    if (hit) {
      setState({ ...hit, error: false });
      return;
    }
    let cancelled = false;
    setState({ blob: null, url: null, error: false });
    renderRef
      .current()
      .then((blob) => {
        const entry = { blob, url: URL.createObjectURL(blob) };
        cache.current.set(key, entry);
        if (!cancelled) setState({ ...entry, error: false });
      })
      .catch((err) => {
        console.warn('[share] render failed', err);
        if (!cancelled) setState({ blob: null, url: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    const entries = cache.current;
    return () => entries.forEach((e) => URL.revokeObjectURL(e.url));
  }, []);

  return state;
}
