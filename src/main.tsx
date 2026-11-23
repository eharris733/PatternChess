import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import App from './App';
import { queryClient } from './lib/queryClient';
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  queryPersister,
  shouldPersistQuery,
} from './lib/queryPersist';
import { AuthProvider } from './auth/AuthProvider';
import { captureReferralFromUrl } from './lib/referral';
import { installStaleChunkReload } from './lib/staleChunkReload';
import { captureSignupSourceFromUrl } from './lib/signupSource';
import { initLocale } from './i18n/localeStore';
import './index.css';

captureReferralFromUrl();
captureSignupSourceFromUrl();
installStaleChunkReload();

// A non-English player's catalog loads before the first render (capped wait),
// so the app never flashes English at them.
void initLocale().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE_MS,
          buster: PERSIST_BUSTER,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </React.StrictMode>,
  );
});
