import { useEffect, useState } from 'react';
import { StockfishWorkerClient } from '../stockfish/stockfishWorkerClient';

let singleton: StockfishWorkerClient | null = null;
let initPromise: Promise<StockfishWorkerClient> | null = null;

export function getStockfish(): Promise<StockfishWorkerClient> {
  if (singleton?.isReady) return Promise.resolve(singleton);
  if (initPromise) return initPromise;
  const client = new StockfishWorkerClient();
  initPromise = client
    .init()
    .then(() => {
      singleton = client;
      return client;
    })
    .catch((err) => {
      initPromise = null;
      throw err;
    });
  return initPromise;
}

// Dedicated worker for background sync analysis. Kept separate from the UI
// singleton so a long sync (which queues `go depth 12` for every position in
// every game) can't block UI engine calls on the training/review screens.
// Single-threaded on purpose so it doesn't fight the UI engine for Stockfish
// pthread cores.
let analysisSingleton: StockfishWorkerClient | null = null;
let analysisInitPromise: Promise<StockfishWorkerClient> | null = null;

export function getAnalysisStockfish(): Promise<StockfishWorkerClient> {
  if (analysisSingleton?.isReady) return Promise.resolve(analysisSingleton);
  if (analysisInitPromise) return analysisInitPromise;
  const client = new StockfishWorkerClient();
  analysisInitPromise = client
    .init({ preferST: true })
    .then(() => {
      analysisSingleton = client;
      return client;
    })
    .catch((err) => {
      analysisInitPromise = null;
      throw err;
    });
  return analysisInitPromise;
}

export function useStockfish() {
  const [ready, setReady] = useState(singleton?.isReady ?? false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'mt' | 'st' | null>(singleton?.engineMode ?? null);

  useEffect(() => {
    let cancelled = false;
    getStockfish()
      .then((c) => {
        if (!cancelled) {
          setReady(true);
          setMode(c.engineMode);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, error, mode };
}
