// Staged dashboard asks, keyed on app opens (profiles.app_opens, bumped once
// per tab session). At most one shows at a time, as a dismissable card above
// the daily plan, never a modal and never mid-drill:
//
//   open ≥ 2  email      turn reminders on / add an address (Lichess sign-ins)
//   open ≥ 3  course     "we picked a course from your games" (a course is live, none followed)
//   open ≥ 4  supporter  after at least one finished session
//
// An answered or dismissed ask comes back once, 14 days later, then never.

export type AskKind = 'email' | 'course' | 'supporter';

export const ASK_ORDER: readonly AskKind[] = ['email', 'course', 'supporter'];

export const ASK_MIN_OPENS: Record<AskKind, number> = { email: 2, course: 3, supporter: 4 };

export const ASK_REOFFER_DAYS = 14;

export interface AskHistory {
  promptedAt: Date | null;
  count: number;
}

export interface AskInputs {
  opens: number;
  /** Per ask: whether it applies to this player right now. */
  eligible: Record<AskKind, boolean>;
  history: Record<AskKind, AskHistory>;
  now: Date;
}

/** True while the ask hasn't been used up: never shown, or shown once at least 14 days ago. */
export function askAvailable(h: AskHistory, now: Date): boolean {
  if (h.count <= 0) return true;
  if (h.count >= 2 || !h.promptedAt) return false;
  return now.getTime() - h.promptedAt.getTime() >= ASK_REOFFER_DAYS * 86_400_000;
}

/** The one ask to show, or null. */
export function nextAsk({ opens, eligible, history, now }: AskInputs): AskKind | null {
  for (const kind of ASK_ORDER) {
    if (opens >= ASK_MIN_OPENS[kind] && eligible[kind] && askAvailable(history[kind], now)) return kind;
  }
  return null;
}

export type EmailAskVariant = 'turn-on' | 'add-address';

/**
 * Which email ask fits, or null when there is nothing to ask: reminders are on
 * with a usable address, or a typed-in address is waiting for its confirmation click.
 */
export function emailAskVariant(p: {
  authEmail: string | null;
  contactEmail: string | null;
  contactEmailVerified: boolean;
  optIn: boolean;
}): EmailAskVariant | null {
  if (p.contactEmail && !p.contactEmailVerified) return null;
  const hasAddress = !!p.authEmail || (!!p.contactEmail && p.contactEmailVerified);
  if (!hasAddress) return 'add-address';
  return p.optIn ? null : 'turn-on';
}
