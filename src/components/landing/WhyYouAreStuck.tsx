import type { ReactNode } from 'react';

function Cite({ n }: { n: string }) {
  return (
    <sup className="inline-block align-super">
      <a
        href={`#fn-${n}`}
        className="font-mono text-[11px] text-gold-dark hover:text-text-primary hover:bg-gold-dark/20 px-1 py-0.5 rounded-sm transition-colors"
      >
        [{n}]
      </a>
    </sup>
  );
}

type Beat = {
  num: string;
  title: string;
  body: ReactNode;
};

type Footnote = {
  num: string;
  text: ReactNode;
  href: string;
};

const BEATS: Beat[] = [
  {
    num: '01',
    title: 'Learning needs friction',
    body: (
      <>
        To improve, your brain has to struggle with the same idea — many times over. Most chess
        training skips this. Blitz while half-watching TV trains nothing. Puzzles slip away the
        moment you solve them.<Cite n="1" /> Patterns stick when you face the same position on
        different days until the answer is automatic.<Cite n="2" /><Cite n="3" />
      </>
    ),
  },
  {
    num: '02',
    title: 'Blunders decide your games',
    body: (
      <>
        Most games below 2000 elo are decided by one player handing the other a winning position.
        I've coached adult improvers for years and climbed to 2100 chess.com myself — that's the
        pattern, every time. Not a set of strategic innacuracies; One missed move. That's what you need to drill.
      </>
    ),
  },
  {
    num: '03',
    title: 'Drill the games you actually played',
    body: (
      <>
        The patterns that keep beating you are sitting in your own losses. PatternChess pulls
        your games from Chess.com or Lichess, runs Stockfish over them, and collects the moves
        where you actually lost ground into one structured set. Same shrinking-interval drill
        that took Tikkanen to three GM norms in seven weeks.<Cite n="4" />
      </>
    ),
  },
];

const FOOTNOTES: Footnote[] = [
  {
    num: '1',
    text: (
      <>
        Murre, J. M. J., &amp; Dros, J. (2015). Replication and Analysis of Ebbinghaus' Forgetting
        Curve. <em>PLOS ONE</em>, 10(7), e0120644. Half of new material is gone within a day
        without review.
      </>
    ),
    href: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644',
  },
  {
    num: '2',
    text: (
      <>
        Chase, W. G., &amp; Simon, H. A. (1973). Perception in chess. <em>Cognitive Psychology</em>,
        4(1), 55–81. The foundational study on chunking — masters recognize tens of thousands
        of board patterns at a glance, built through repeated exposure.
      </>
    ),
    href: 'https://andymatuschak.org/prompts/Chase1973.pdf',
  },
  {
    num: '3',
    text: (
      <>
        Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., &amp; Rohrer, D. (2006). Distributed
        practice in verbal recall tasks: A review and quantitative synthesis.{' '}
        <em>Psychological Bulletin</em>, 132(3), 354–380. Meta-analysis of 184 studies: material
        reviewed across days is retained far longer than the same material crammed in one
        sitting.
      </>
    ),
    href: 'https://pubmed.ncbi.nlm.nih.gov/16719566/',
  },
  {
    num: '4',
    text: (
      <>
        Smith, A., &amp; Tikkanen, H. (2018). <em>The Woodpecker Method</em>. Quality Chess.
        Tikkanen used the shrinking-interval drill on the same set of puzzles to score three
        GM norms in seven weeks.
      </>
    ),
    href: 'https://forwardchess.com/product/the-woodpecker-method',
  },
];

export function WhyYouAreStuck() {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            Why you're stuck
          </h2>
        </div>

        <div className="flex flex-col">
          {BEATS.map((b, i) => (
            <div
              key={b.num}
              className={
                'grid grid-cols-[auto_1fr] gap-6 lg:gap-10 py-8 lg:py-10 ' +
                (i < BEATS.length - 1 ? 'border-b border-text-primary/15' : '')
              }
            >
              <span className="font-mono text-3xl text-gold-dark">{b.num}</span>
              <div className="flex flex-col gap-3 max-w-3xl">
                <h3 className="font-mono uppercase tracking-tight text-lg sm:text-xl text-text-primary">
                  {b.title}
                </h3>
                <p className="text-base sm:text-lg text-text-primary/85 leading-relaxed">
                  {b.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 border-2 border-text-primary bg-surface p-6">
          <div className="font-mono uppercase text-[10px] tracking-tight text-text-primary/60 mb-4">
            Footnotes
          </div>
          <ol className="flex flex-col gap-3 text-xs sm:text-sm text-text-primary/75 leading-relaxed">
            {FOOTNOTES.map((f) => (
              <li
                key={f.num}
                id={`fn-${f.num}`}
                className="grid grid-cols-[auto_1fr] gap-3 scroll-mt-24 target:bg-gold-dark/10 target:px-2 target:py-1 target:rounded-sm"
              >
                <span className="font-mono text-gold-dark">{f.num}</span>
                <span>
                  {f.text}{' '}
                  <a
                    href={f.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono uppercase text-[10px] tracking-tight underline underline-offset-2 text-text-primary hover:text-gold-dark"
                  >
                    Source
                  </a>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
