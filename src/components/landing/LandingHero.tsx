import type { ReactNode } from 'react';

export function LandingHero({ children }: { children?: ReactNode }) {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-20 lg:py-28">
        <h1 className="font-mono uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-text-primary max-w-3xl">
          You're stuck because you make the same{' '}
          <span className="text-gold-dark italic font-serif normal-case tracking-normal">Blunders</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-base sm:text-lg text-text-primary/80 leading-relaxed">
          Enter your account name to see the blunders holding you back.
        </p>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
