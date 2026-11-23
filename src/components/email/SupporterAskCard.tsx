import { supabaseService } from '../../services/supabaseService';
import { useSupporterCheckout } from '../../hooks/useSupporterCheckout';
import { CloseIcon } from '../icons/CloseIcon';
import { HeartIcon } from '../icons/HeartIcon';

/** The dashboard's supporter ask (src/lib/asks.ts: open 4+, after a finished session). */
export function SupporterAskCard({ onClose }: { onClose: () => void }) {
  const { checkout, pending, error } = useSupporterCheckout();

  const record = () =>
    void supabaseService.markAskPrompted('supporter').catch((err) => console.warn('[ask] record failed', err));
  const dismiss = () => {
    onClose();
    record();
  };

  return (
    <section className="card flex items-start gap-3 border-gold-dark" data-testid="supporter-ask">
      <HeartIcon className="mt-1 h-5 w-5 shrink-0" />
      <div className="flex flex-1 flex-col gap-3">
        <span className="label">Support PatternChess</span>
        <h2 className="heading-md">Enjoying the plan? Help keep it running.</h2>
        <p className="text-sm text-text-primary">
          Your daily training on PatternChess is free, for you and for everyone else, and it stays that
          way. If it's helping your chess, $5 a month keeps the site running and new features coming.
        </p>
        <p className="text-sm text-text-primary">
          Supporters get flair next to their name, early access to the mobile app beta, and our thanks.
          Having a stake in your training is one more reason to show up for it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={pending != null}
            onClick={() => {
              record();
              checkout();
            }}
          >
            {pending === 'checkout' ? 'Opening checkout…' : 'Become a supporter, $5/mo'}
          </button>
          <button type="button" className="btn-ghost" onClick={dismiss}>
            Maybe later
          </button>
        </div>
        {error && <p className="text-incorrect text-sm">{error}</p>}
      </div>
      <button type="button" onClick={dismiss} aria-label="Maybe later" className="shrink-0 text-text-primary">
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
