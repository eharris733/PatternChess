import { SPACED_REPETITION_DAYS } from '../../models/blunder';

const STEPS = [
  {
    num: '01',
    title: 'Woodpecker method',
    body: 'Repeat the same positions on shrinking intervals until you can’t miss them. Same idea Magnus uses, applied to your own mistakes.',
  },
  {
    num: '02',
    title: 'Spaced repetition',
    body: 'A seven-stage ladder spaces drills out across days, not hours. You learn the pattern for good — not just for one session.',
  },
  {
    num: '03',
    title: 'Your blunders, not puzzles',
    body: 'Stockfish flags the moves where you lost real ground in your own games. No tactics trainer — just the mistakes you keep repeating.',
  },
];

export function HowItWorks() {
  return (
    <section className="border-b-2 border-[#1A1A1A]">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="flex items-baseline justify-between mb-12 border-b-2 border-[#1A1A1A] pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-[#1A1A1A]">
            How it works
          </h2>
          <span className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60">
            03 steps
          </span>
        </div>

        <div className="grid md:grid-cols-3 gap-0 border-2 border-[#1A1A1A] bg-white">
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className={
                'p-6 lg:p-8 flex flex-col gap-3 ' +
                (i < STEPS.length - 1 ? 'md:border-r-2 border-b-2 md:border-b-0 border-[#1A1A1A]' : '')
              }
            >
              <span className="font-mono text-3xl text-gold-dark">{s.num}</span>
              <h3 className="font-mono uppercase tracking-tight text-base text-[#1A1A1A]">
                {s.title}
              </h3>
              <p className="text-sm text-[#1A1A1A]/80 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 border-2 border-[#1A1A1A] bg-[#F4F4F0] p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
          <div>
            <div className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60 mb-1">
              The seven-stage ladder
            </div>
            <div className="font-mono text-sm sm:text-base text-[#1A1A1A]">
              Day{' '}
              {SPACED_REPETITION_DAYS.map((d, i) => (
                <span key={d}>
                  <span className="text-gold-dark font-bold">{d}</span>
                  {i < SPACED_REPETITION_DAYS.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          </div>
          <span className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60">
            Each drill survived advances you one rung.
          </span>
        </div>
      </div>
    </section>
  );
}
