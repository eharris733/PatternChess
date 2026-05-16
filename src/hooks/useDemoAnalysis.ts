import { useCallback, useEffect, useRef, useState } from 'react';
import {
  runDemoAnalysis,
  DemoError,
  type DemoPlatform,
  type DemoResult,
} from '../services/landingDemoService';

export type DemoStatus = 'idle' | 'loading' | 'success' | 'no-blunders' | 'error';

export interface DemoErrorState {
  code: DemoError['code'];
  message: string;
}

export interface UseDemoAnalysisReturn {
  status: DemoStatus;
  progressLabel: string;
  result: DemoResult | null;
  error: DemoErrorState | null;
  run: (input: { platform: DemoPlatform; username: string }) => void;
  reset: () => void;
}

export function useDemoAnalysis(): UseDemoAnalysisReturn {
  const [status, setStatus] = useState<DemoStatus>('idle');
  const [progressLabel, setProgressLabel] = useState('');
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<DemoErrorState | null>(null);

  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    runIdRef.current += 1;
    setStatus('idle');
    setProgressLabel('');
    setResult(null);
    setError(null);
  }, []);

  const run = useCallback((input: { platform: DemoPlatform; username: string }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const myId = ++runIdRef.current;

    setStatus('loading');
    setProgressLabel('Starting…');
    setResult(null);
    setError(null);

    void runDemoAnalysis({
      platform: input.platform,
      username: input.username,
      signal: controller.signal,
      onProgress: (label) => {
        if (runIdRef.current !== myId) return;
        setProgressLabel(label);
      },
    })
      .then((r) => {
        if (runIdRef.current !== myId) return;
        setResult(r);
        setStatus(r.blunder ? 'success' : 'no-blunders');
      })
      .catch((e) => {
        if (runIdRef.current !== myId) return;
        if (e instanceof DemoError) {
          if (e.code === 'aborted') return;
          setError({ code: e.code, message: e.message });
        } else {
          setError({
            code: 'network',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        setStatus('error');
      });
  }, []);

  return { status, progressLabel, result, error, run, reset };
}
