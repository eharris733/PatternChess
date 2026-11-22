import { Link } from 'react-router-dom';
import { TrainingLadder } from './TrainingLadder';

export const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    title: 'Stockfish finds ALL your blunders',
    body: 'Yes, even the ones you played on the toilet.',
  },
  {
    num: '02',
    title: 'Train a few every day',
    body: 'Each blunder comes back on a four-rep ladder over about a month. A few minutes a day keeps the pattern mastered for your next game.',
  },
  {
    num: '03',
    title: 'Repeat until the answer is automatic',
    body: 'Blunders happen from time trouble and blind spots. The best move has to be automatic in order to find it under pressure.',
  },
  {
    num: '04',
    title: 'Keep the streak',
    body: 'Play a game, train your positions, come back tomorrow. Your streak, the weekly board and email reminders keep you honest to your goals.',
  },
];

// 1 column on phones, 2×2 on tablets, 4 across on desktop.
function stepBorders(i: number, n: number): string {
  const c = ['border-text-primary'];
  if (i < n - 1) c.push('border-b-2');
  if (i >= n - 2) c.push('md:border-b-0');
  else c.push('md:border-b-2');
  if (i % 2 === 0) c.push('md:border-r-2');
  c.push(i < n - 1 ? 'lg:border-r-2' : 'lg:border-r-0', 'lg:border-b-0');
  return c.join(' ');
}

export function HowItWorks() {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            How it works
          </h2>
          <Link
            to="/watch"
            className="font-mono uppercase text-xs tracking-tight text-text-primary underline underline-offset-4 hover:text-gold-dark"
          >
            Watch the 1-minute video →
          </Link>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-0 border-2 border-text-primary bg-surface">
          {HOW_IT_WORKS_STEPS.map((s, i) => (
            <div
              key={s.num}
              className={'p-6 lg:p-8 flex flex-col gap-3 ' + stepBorders(i, HOW_IT_WORKS_STEPS.length)}
            >
              <span className="font-mono text-3xl text-gold-dark">{s.num}</span>
              <h3 className="font-mono uppercase tracking-tight text-base text-text-primary">
                {s.title}
              </h3>
              <p className="text-sm text-text-primary/80 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <TrainingLadder />
      </div>
    </section>
  );
}
