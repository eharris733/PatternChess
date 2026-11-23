import { CREATOR_LINKS } from '../../seo/siteMeta';
import { useT } from '../../i18n/useT';

export function AboutCreator() {
  const t = useT();
  return (
    <section>
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="mb-12 border-b-2 border-text-primary pb-4">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            {t('about.title')}
          </h2>
        </div>

        <div className="grid md:grid-cols-[200px_1fr] gap-8 lg:gap-12 items-start">
          <div className="border-2 border-text-primary bg-surface aspect-square w-full md:w-[200px] flex items-center justify-center shadow-card overflow-hidden">
            <img
              src="/popchess-brenda.webp"
              alt={t('about.mascot')}
              width={165}
              height={155}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain p-2"
            />
          </div>

          <div className="flex flex-col gap-5">
            <p className="text-base sm:text-lg text-text-primary leading-relaxed">
              {t('about.p1')}
            </p>
            <p className="text-base sm:text-lg text-text-primary leading-relaxed">
              {t('about.p2')}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 pt-3 border-t-2 border-text-primary/10">
              {CREATOR_LINKS.map((l) => (
                <CreatorLink key={l.label} label={l.label} href={l.href} />
              ))}
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
