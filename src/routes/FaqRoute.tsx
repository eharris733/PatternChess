import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { ChevronIcon } from '../components/icons/ChevronIcon';
import { useHead } from '../seo/useHead';
import { faqPageJsonLd, breadcrumbJsonLd, type FaqItem } from '../seo/jsonLd';

// IMPORTANT: the visible answer text below must stay identical to the `answer`
// strings fed to faqPageJsonLd — Google drops FAQ rich results when the
// structured-data answer does not match the on-page text.
const FAQS: FaqItem[] = [
  {
    question: 'What is the Woodpecker Method?',
    answer:
      'The Woodpecker Method, from the book by Axel Smith and Hans Tikkanen, is a training technique where you solve the same set of tactical positions over and over, each pass faster than the last. Repeating the same patterns at shrinking intervals moves them from slow calculation into instant recognition. PatternChess applies the same idea to the blunders from your own games.',
  },
  {
    question: 'How do I stop blundering in chess?',
    answer:
      'Blundering less comes from recognizing dangerous patterns before you move, and that recognition is built by repeated exposure. PatternChess collects the exact positions where you blundered and has you re-solve them across spaced sessions until the right move is automatic, so the same mistake stops repeating.',
  },
  {
    question: 'How does PatternChess find my blunders?',
    answer:
      'PatternChess imports your games from Chess.com or Lichess and runs the Stockfish engine over every position. It flags the moves where your winning chances dropped sharply — about 15% or more by the Lichess model — and turns those moments into trainable drills.',
  },
  {
    question: 'Is PatternChess free?',
    answer:
      'Yes. PatternChess is free to use. You sign in with Google, connect a Chess.com or Lichess username, and start training on your own games.',
  },
  {
    question: 'Does it work with Chess.com and Lichess?',
    answer:
      'Yes. PatternChess pulls your public game history directly from Chess.com and Lichess. Your browser fetches the games, the engine analyzes them, and your blunders become a training set.',
  },
  {
    question: 'What is spaced repetition for chess?',
    answer:
      'Spaced repetition means reviewing the same material at increasing intervals so it sticks in long-term memory instead of fading. PatternChess schedules each blunder you have drilled to come back on a widening ladder of days, which is far more durable than cramming in one sitting.',
  },
];

export function FaqRoute() {
  useHead({
    title: 'Chess training FAQ',
    description:
      'Answers to common questions about PatternChess, the Woodpecker Method, and training on the blunders from your own chess games.',
    canonical: '/faq',
    jsonLd: [
      faqPageJsonLd(FAQS),
      breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'FAQ', url: '/faq' },
      ]),
    ],
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="font-mono uppercase text-xs tracking-tight text-text-primary/60 hover:text-gold-dark transition-colors"
          >
            ← Back home
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Frequently asked questions</h1>

          <div className="mt-8 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group border-2 border-text-primary bg-surface">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-3 p-5 list-none [&::-webkit-details-marker]:hidden">
                  <h2 className="font-mono uppercase tracking-tight text-sm sm:text-base text-text-primary">
                    {faq.question}
                  </h2>
                  <ChevronIcon className="h-4 w-4 shrink-0 text-gold-dark transition-transform duration-200 group-open:rotate-90" />
                </summary>
                <div className="px-5 pb-5 text-base text-text-primary/85 leading-relaxed">
                  <p>{faq.answer}</p>
                </div>
              </details>
            ))}
          </div>

          <div className="mt-12 border-t-2 border-text-primary/10 pt-8">
            <Link
              to="/login"
              className="inline-block font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-5 py-3 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
            >
              Train your own blunders — free
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
