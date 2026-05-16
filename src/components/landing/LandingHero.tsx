import type { ReactNode } from 'react';

export function LandingHero({ children }: { children?: ReactNode }) {
  return (
    <section className="border-b-2 border-[#1A1A1A]">
      <div className="max-w-6xl mx-auto px-6 py-20 lg:py-28">
        <p className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A] mb-6">
          For players stuck on a plateau
        </p>
        <h1 className="font-mono uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-[#1A1A1A] max-w-3xl">
          Don't play the same
          <br />
          <span className="text-gold-dark italic font-serif normal-case tracking-normal">blunder</span> twice.
        </h1>
        <p className="mt-6 max-w-2xl text-base sm:text-lg text-[#1A1A1A]/80 leading-relaxed">
          Woodpecker-method spaced repetition on the blunders from your own games. Drop in your
          username and we'll analyze your last 5 games for your worst blunder — no signup required.
        </p>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
