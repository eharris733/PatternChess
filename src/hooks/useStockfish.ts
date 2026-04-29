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
