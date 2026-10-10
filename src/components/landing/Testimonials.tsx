import { TESTIMONIALS } from '../../content/testimonials';

/**
 * Player quotes, verbatim from src/content/testimonials.ts. Static data, so the
 * section is part of the prerendered HTML and never shifts the layout.
 */
export function Testimonials() {
  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-20">
        <div className="mb-10 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            What players say
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-0 border-2 border-text-primary bg-surface">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              className={
                'm-0 p-6 lg:p-8 flex flex-col gap-5 justify-between ' +
                (i < TESTIMONIALS.length - 1
                  ? 'md:border-r-2 border-b-2 md:border-b-0 border-text-primary'
                  : '')
              }
            >
              <div className="flex flex-col gap-3">
                <QuoteMark />
                <blockquote className="m-0 text-text-primary text-lg leading-snug">
                  {t.quote}
                </blockquote>
              </div>
              <figcaption className="flex flex-col gap-0.5">
                <span className="font-mono uppercase tracking-tight text-sm text-text-primary">
                  {t.name}
                </span>
                <span className="font-mono uppercase text-[10px] tracking-[0.12em] text-text-secondary">
                  {t.detail}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuoteMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 text-gold-dark"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 18v-5.5C4 8.4 6.2 5.7 10 5l.6 1.7C8.5 7.5 7.4 9 7.3 11H10v7H4zm10 0v-5.5c0-4.1 2.2-6.8 6-7.5l.6 1.7c-2.1.8-3.2 2.3-3.3 4.3H20v7h-6z" />
    </svg>
  );
}
