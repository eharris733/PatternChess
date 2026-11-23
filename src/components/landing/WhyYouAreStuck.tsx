import type { ReactNode } from 'react';
import { ChevronIcon } from '../icons/ChevronIcon';
import { useT } from '../../i18n/useT';

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

type Footnote = {
  num: string;
  text: ReactNode;
  href: string;
};

// Copy lives in the i18n catalogs (`why.<i>.title` / `why.<i>.body`); `{cN}` marks a citation.
const BEATS = ['01', '02', '03', '04'] as const;
const CITES = { c1: <Cite n="1" />, c2: <Cite n="2" />, c3: <Cite n="3" />, c4: <Cite n="4" /> };

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
  const t = useT();
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            {t('why.title')}
          </h2>
        </div>

        <div className="flex flex-col">
          {BEATS.map((num, i) => (
            <div
              key={num}
              className={
                'grid grid-cols-[auto_1fr] gap-6 lg:gap-10 py-8 lg:py-10 ' +
                (i < BEATS.length - 1 ? 'border-b border-text-primary/15' : '')
              }
            >
              <span className="font-mono text-3xl text-gold-dark">{num}</span>
              <div className="flex flex-col gap-3 max-w-3xl">
                <h3 className="font-mono uppercase tracking-tight text-lg sm:text-xl text-text-primary">
                  {t(`why.${i}.title` as 'why.0.title')}
                </h3>
                <p className="text-base sm:text-lg text-text-primary/85 leading-relaxed">
                  {t.rich(`why.${i}.body` as 'why.0.body', CITES)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <details className="group mt-12 border-2 border-text-primary bg-surface">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 p-6 font-mono uppercase text-[10px] tracking-tight text-text-secondary list-none [&::-webkit-details-marker]:hidden">
            <span>{t('why.footnotes')}</span>
            <ChevronIcon className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
          </summary>
          <ol className="flex flex-col gap-3 px-6 pb-6 text-xs sm:text-sm text-text-primary/75 leading-relaxed">
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
                    {t('why.source')}
                  </a>
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}
