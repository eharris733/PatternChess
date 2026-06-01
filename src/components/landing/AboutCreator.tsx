export function AboutCreator() {
  return (
    <section>
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            Why I built this
          </h2>
        </div>

        <div className="grid md:grid-cols-[200px_1fr] gap-8 lg:gap-12 items-start">
          <div className="border-2 border-text-primary bg-surface aspect-square w-full md:w-[200px] flex items-center justify-center shadow-card overflow-hidden">
            <img
              src="/popchess-brenda.png"
              alt="PatternChess mascot"
              className="w-full h-full object-contain p-2"
            />
          </div>

          <div className="flex flex-col gap-5">
            <p className="text-base sm:text-lg text-text-primary leading-relaxed">
              I built PatternChess because I wanted to test an insight I had from my own
              training. I started studying chess seriously as an adult, and the only method
              that got me results was spaced repetition. I'd print out a set of puzzles and
              review them every night until I could solve a set of 200-300 puzzles in one
              sitting.
            </p>
            <p className="text-base sm:text-lg text-text-primary leading-relaxed">
              The issue was, these positions taught me how to win. They didn't teach me how to
              stop losing. Without an expensive coach, no one could tell me exactly where my
              blindspots were, and I had no way of training the exact positions I was losing
              in. As a professional software engineer, I thought I might finally be able to
              come up with a solution. So I built one.
            </p>
            <div className="mt-2 flex flex-wrap gap-3 pt-3 border-t-2 border-text-primary/10">
              <CreatorLink label="Chess.com" href="https://www.chess.com/member/eharris733" />
              <CreatorLink label="Lichess" href="https://lichess.org/@/bewaretheschnook" />
              <CreatorLink label="GitHub" href="https://github.com/eharris733" />
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
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono uppercase text-[11px] tracking-tight border-2 border-text-primary px-3 py-1.5 rounded-none text-text-primary hover:bg-text-primary hover:text-bg transition-colors"
    >
      {label}
    </a>
  );
}
