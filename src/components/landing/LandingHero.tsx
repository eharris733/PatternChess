import type { ReactNode } from 'react';

export function LandingHero({ children }: { children?: ReactNode }) {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
        <h1 className="font-mono uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-text-primary max-w-3xl">
          Stop procrastinating your improvement
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-text-primary">
          Your games already show what you need to fix. PatternChess turns them into a daily plan:
          play a game, train a few of your blunders, keep the streak going.
        </p>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
