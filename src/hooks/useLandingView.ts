import { useEffect } from 'react';
import { trackLandingView } from '../services/funnelService';

// Fire a single landing_view per browser session, but only after a human signal
// — a real interaction (pointer/scroll/key/touch) or a visible dwell. This is
// the client half of bot filtering: most crawlers fetch the HTML without ever
// producing these signals. Distinct-anon_id counting in the RPC dedupes the
// rest, so once-per-session here is enough.
let sentThisSession = false;
const SESSION_KEY = 'pc_lv_sent';
const DWELL_MS = 5000;

export function useLandingView(): void {
  useEffect(() => {
    if (sentThisSession) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY)) {
        sentThisSession = true;
        return;
      }
    } catch {
      // ignore storage errors
    }

    let done = false;
    const events = ['pointermove', 'pointerdown', 'scroll', 'keydown', 'touchstart'] as const;

    const fire = () => {
      if (done) return;
      done = true;
      sentThisSession = true;
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        // ignore
      }
      cleanup();
      trackLandingView();
    };

    const onSignal = () => fire();
    // Dwell fallback: a visitor who reads without interacting still counts, but
    // only if the tab is actually visible (skips prerenders / background bots).
    const onDwell = () => {
      if (document.visibilityState === 'visible') fire();
    };
    const timer = window.setTimeout(onDwell, DWELL_MS);

    function cleanup() {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, onSignal);
    }

    for (const e of events) window.addEventListener(e, onSignal, { passive: true });
    return cleanup;
  }, []);
}
