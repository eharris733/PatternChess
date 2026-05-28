import { usePgnUploadStore } from '../../state/pgnUploadStore';
import { useOnboardingStore } from '../../state/onboardingStore';

export function GetStartedHero() {
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const resetOnboarding = useOnboardingStore((s) => s.reset);

  return (
    <section className="card flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="heading-lg">Sync your online account to find your blunders.</h2>
        <p className="text-text-secondary">
          PatternChess finds the blunders in your real games and turns them into
          spaced-repetition drills. Connect your Lichess or Chess.com account, or
          upload your own PGNs to your vault.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={() => resetOnboarding()}
        >
          Connect Lichess or Chess.com
        </button>
        <button type="button" className="btn-outline" onClick={openUpload}>
          Upload PGNs
        </button>
      </div>
    </section>
  );
}
