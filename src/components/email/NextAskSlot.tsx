import { useEffect, useState } from 'react';
import { useNextAsk } from '../../hooks/useNextAsk';
import type { AskKind, EmailAskVariant } from '../../lib/asks';
import { EmailAskCard } from './EmailAskCard';

/**
 * The dashboard's one ask card (above the daily plan). Holds on to the ask it
 * first showed: answering one changes the profile, and the card has to stay
 * up to say what happened until the player closes it.
 */
export function NextAskSlot() {
  const ask = useNextAsk();
  const [shown, setShown] = useState<{ kind: AskKind; emailVariant: EmailAskVariant | null } | null>(null);

  useEffect(() => {
    if (!shown && ask.kind) setShown({ kind: ask.kind, emailVariant: ask.emailVariant });
  }, [shown, ask.kind, ask.emailVariant]);

  const current = shown ?? (ask.kind ? { kind: ask.kind, emailVariant: ask.emailVariant } : null);
  if (!current) return null;
  const close = () => {
    ask.close();
    setShown(null);
  };

  if (current.kind === 'email' && current.emailVariant) {
    return <EmailAskCard variant={current.emailVariant} onClose={close} />;
  }
  return null;
}
