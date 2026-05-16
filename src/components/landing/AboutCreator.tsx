export function AboutCreator() {
  return (
    <section>
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="flex items-baseline justify-between mb-12 border-b-2 border-[#1A1A1A] pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-[#1A1A1A]">
            Who built this
          </h2>
          <span className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60">
            One person · one problem
          </span>
        </div>

        <div className="grid md:grid-cols-[200px_1fr] gap-8 lg:gap-12 items-start">
          <div className="border-2 border-[#1A1A1A] bg-white aspect-square w-full md:w-[200px] flex items-center justify-center shadow-[3px_3px_0_#1A1A1A]">
            <span className="font-serif text-7xl text-[#1A1A1A]">E</span>
          </div>

          <div className="flex flex-col gap-5">
            <p className="font-mono uppercase text-[10px] tracking-tight text-gold-dark">
              Hi — I'm Elliot.
            </p>
            <p className="text-base sm:text-lg text-[#1A1A1A] leading-relaxed">
              I built PatternChess because I kept losing games the same way. The same hanging
              bishop. The same back-rank panic. Puzzle apps trained me on{' '}
              <em>other people's</em> mistakes — useful, but not the ones I actually make.
            </p>
            <p className="text-base text-[#1A1A1A]/80 leading-relaxed">
              So I built a tool that pulls down my own games, finds the moments where I gave
              the game away, and drills me on those positions until the pattern sticks.
              Woodpecker method, spaced repetition, my blunders.
            </p>
            <p className="text-base text-[#1A1A1A]/80 leading-relaxed">
              It's working. If you've ever stared at a position thinking <em>"I knew that"</em>
              {' '}— this is for you.
            </p>
            <div className="mt-2 flex flex-wrap gap-3 pt-3 border-t-2 border-[#1A1A1A]/10">
              <CreatorLink label="Twitter" href="#" />
              <CreatorLink label="Email" href="#" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreatorLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="font-mono uppercase text-[11px] tracking-tight border-2 border-[#1A1A1A] px-3 py-1.5 rounded-none text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F4F4F0] transition-colors"
    >
      {label}
    </a>
  );
}
