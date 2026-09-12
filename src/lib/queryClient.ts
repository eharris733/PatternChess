import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dashboard/insight data only changes on sync or drilling, so a short TTL
      // just causes needless refetches (and the staggered reloads) on every
      // revisit. Keep data fresh for a couple of minutes and cached for longer;
      // mutations that change it invalidate their own keys explicitly.
      staleTime: 2 * 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
