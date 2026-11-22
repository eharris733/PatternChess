import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { emailAskVariant, nextAsk, type AskKind, type EmailAskVariant } from '../lib/asks';

// One open per tab session: reloads and route changes don't count.
const COUNTED_KEY = 'pc:open-counted';
// Once an ask is answered, the rest wait for the next session.
const ANSWERED_KEY = 'pc:ask-answered';

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode: the open may be counted again; harmless.
  }
}

/**
 * The player's app-open count. AppShell mounts this so the open is counted on
 * any first page; `useNextAsk` reads the same query.
 */
export function useAppOpens(): number | null {
  const { user, profile } = useAuth();
  const { data } = useQuery({
    queryKey: ['appOpens', user?.id],
    enabled: !!user && !!profile,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<number> => {
      const loaded = profile?.appOpens ?? 0;
      if (readSession(COUNTED_KEY) === user!.id) return loaded;
      const n = await supabaseService.bumpAppOpen();
      writeSession(COUNTED_KEY, user!.id);
      return n ?? loaded + 1;
    },
  });
  return data ?? null;
}

export interface NextAsk {
  kind: AskKind | null;
  /** Set when `kind` is 'email'. */
  emailVariant: EmailAskVariant | null;
  /** Hide the card for the rest of the session (the caller records the answer). */
  close: () => void;
}

/** The single dashboard ask to show right now (src/lib/asks.ts). */
export function useNextAsk(): NextAsk {
  const { user, profile } = useAuth();
  const opens = useAppOpens();
  const [closed, setClosed] = useState(() => readSession(ANSWERED_KEY) === '1');
  const close = useCallback(() => {
    writeSession(ANSWERED_KEY, '1');
    setClosed(true);
  }, []);

  if (!profile || opens == null || closed) return { kind: null, emailVariant: null, close };

  const emailVariant = emailAskVariant({
    authEmail: user?.email || null,
    contactEmail: profile.contactEmail,
    contactEmailVerified: !!profile.contactEmailVerifiedAt,
    optIn: profile.emailOptIn,
  });
  // The /profile switch stamps email_prompted_at without a count: an explicit
  // answer, so it counts as one.
  const emailHistory = {
    ...profile.asks.email,
    count: Math.max(profile.asks.email.count, profile.asks.email.promptedAt ? 1 : 0),
  };
  const kind = nextAsk({
    opens,
    now: new Date(),
    history: { ...profile.asks, email: emailHistory },
    eligible: {
      // Someone who unsubscribed from an email has answered for good.
      email: emailVariant != null && !profile.emailUnsubscribedAt,
      // Turned on by the courses and supporter PRs.
      course: false,
      supporter: false,
    },
  });
  return { kind, emailVariant: kind === 'email' ? emailVariant : null, close };
}
