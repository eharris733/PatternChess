import { SevenStageLadder } from './SevenStageLadder';

export const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    title: 'Stockfish finds ALL your blunders',
    body: 'Yes, even the ones you played on the toilet.',
  },
  {
    num: '02',
    title: 'Drill them across days',
    body: 'A seven-stage ladder over 56 days, so you truly internalize your mistakes and learn from them.',
  },
  {
    num: '03',
    title: 'Repeat until the answer is automatic',
    body: 'Most blunders happen from time trouble and blind spots. The answer has to be automatic if you’re going to catch it in a real game under real pressure.',
  },
];

export function HowItWorks() {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            How it works
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-0 border-2 border-text-primary bg-surface">
          {HOW_IT_WORKS_STEPS.map((s, i) => (
            <div
              key={s.num}
              className={
                'p-6 lg:p-8 flex flex-col gap-3 ' +
                (i < HOW_IT_WORKS_STEPS.length - 1 ? 'md:border-r-2 border-b-2 md:border-b-0 border-text-primary' : '')
              }
            >
              <span className="font-mono text-3xl text-gold-dark">{s.num}</span>
              <h3 className="font-mono uppercase tracking-tight text-base text-text-primary">
                {s.title}
              </h3>
              <p className="text-sm text-text-primary/80 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <SevenStageLadder />
      </div>
    </section>
  );
}
