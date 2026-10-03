import { useEffect, useRef, useState } from 'react';

export interface AutoplaySegment {
  /** Number of positions in this segment; `select(0..length-1)` is called in order. */
  length: number;
  /** Puts position `i` of the segment on the board. */
  select: (i: number) => void;
  /** Runs once when the segment starts (e.g. switch the visible line tab). */
  onEnter?: () => void;
}

const STEP_MS = 700;

/**
 * Plays one or more move lines on the board, one position every 700 ms (or `stepMs`),
 * segment after segment (e.g. the refutation of a miss, then the solution).
 * Shared by every drill surface — pair it with `useDrillFeedbackPrefs`.
 *
 * Runs once per non-null `runKey`: a new key starts a fresh run, `null` stops
 * any run in progress. `segments` is read when the run starts; zero-length
 * segments are skipped. `stop` cancels (call it when the user steps a line
 * by hand); `skip` cancels and jumps to the final position of the last
 * segment. `active` is state so overlays can wait for the run to finish.
 */
export function useLineAutoplay({
  runKey,
  segments,
  stepMs = STEP_MS,
}: {
  runKey: string | null;
  segments: AutoplaySegment[];
  /** Delay between positions; drills keep the 700 ms default. */
  stepMs?: number;
}): { active: boolean; stop: () => void; skip: () => void } {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const ranKeyRef = useRef<string | null>(null);
  const [active, setActive] = useState(false);

  const stop = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActive(false);
  };

  const skip = () => {
    stop();
    const playable = segmentsRef.current.filter((s) => s.length > 0);
    const last = playable[playable.length - 1];
    if (!last) return;
    last.onEnter?.();
    last.select(last.length - 1);
  };

  useEffect(() => {
    if (runKey === null) {
      stop();
      ranKeyRef.current = null;
      return;
    }
    if (ranKeyRef.current === runKey) return;
    ranKeyRef.current = runKey;
    stop();

    const playable = segmentsRef.current.filter((s) => s.length > 0);
    if (playable.length === 0) return;

    let seg = 0;
    let idx = 0;
    playable[0].onEnter?.();
    playable[0].select(0);
    const total = playable.reduce((n, s) => n + s.length, 0);
    if (total <= 1) return;

    setActive(true);
    timerRef.current = setInterval(() => {
      idx += 1;
      if (idx >= playable[seg].length) {
        seg += 1;
        idx = 0;
        if (seg >= playable.length) {
          stop();
          return;
        }
        playable[seg].onEnter?.();
      }
      playable[seg].select(idx);
      if (seg === playable.length - 1 && idx === playable[seg].length - 1) stop();
    }, stepMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  // Unmount only; key changes are handled above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  return { active, stop, skip };
}
