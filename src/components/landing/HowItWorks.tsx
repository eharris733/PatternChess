import { SevenStageLadder } from './SevenStageLadder';

const STEPS = [
  {
    num: '01',
    title: 'Repeat until it’s automatic',
    body: 'The same positions, on shrinking intervals, until you can’t miss them. Same idea Magnus uses, applied to your own mistakes.',
  },
  {
    num: '02',
    title: 'Drills spread across days',
    body: 'A seven-stage ladder spaces your drills across days. The pattern locks into long-term memory instead of disappearing after the session.',
  },
  {
    num: '03',
    title: 'Stockfish finds them in your games',
    body: 'We pull your last games, run Stockfish over every move, and turn each one where you actually lost ground into a drill in your queue.',
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
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className={
                'p-6 lg:p-8 flex flex-col gap-3 ' +
                (i < STEPS.length - 1 ? 'md:border-r-2 border-b-2 md:border-b-0 border-text-primary' : '')
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
