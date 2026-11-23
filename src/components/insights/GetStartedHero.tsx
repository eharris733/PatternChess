import { usePgnUploadStore } from '../../state/pgnUploadStore';
import { useOnboardingStore } from '../../state/onboardingStore';
import { useT } from '../../i18n/useT';

export function GetStartedHero() {
  const t = useT();
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const resetOnboarding = useOnboardingStore((s) => s.reset);

  return (
    <section className="card flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="heading-lg">{t('dash.hero.title')}</h2>
        <p className="text-text-primary">
          {t('dash.hero.body')}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={() => resetOnboarding()}
        >
          {t('dash.hero.connect')}
        </button>
        <button type="button" className="btn-outline" onClick={openUpload}>
          {t('vault.upload')}
        </button>
      </div>
    </section>
  );
}
