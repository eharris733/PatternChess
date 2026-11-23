import type { ReactNode } from 'react';
import { useT } from '../../i18n/useT';

export function LandingHero({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
        <h1 className="font-mono uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-text-primary max-w-3xl">
          {t('landing.hero.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-primary">
          {t('landing.hero.lede')}
        </p>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
