import type { ReactNode } from 'react';

export function LandingHero({ children }: { children?: ReactNode }) {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
        <h1 className="font-mono uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-text-primary max-w-3xl">
          Learn from your{' '}
          <span className="text-gold-dark italic font-serif normal-case tracking-normal">Blunders</span>
        </h1>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
