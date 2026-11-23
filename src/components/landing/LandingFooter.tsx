import { Link } from 'react-router-dom';
import { BrandMark } from '../BrandLogo';
import { useT } from '../../i18n/useT';
import { useLocaleStore } from '../../i18n/localeStore';
import { isLocale, LOCALES, LOCALE_NATIVE_NAME, type MessageKey } from '../../i18n/i18n';

const LINKS: { label: MessageKey; to: string }[] = [
  { label: 'footer.about', to: '/about' },
  { label: 'footer.faq', to: '/faq' },
  { label: 'footer.watch', to: '/watch' },
  { label: 'footer.blog', to: '/blog' },
  { label: 'footer.gif', to: '/moments' },
  { label: 'footer.tournaments', to: '/events' },
  { label: 'footer.support', to: '/supporter' },
  { label: 'footer.privacy', to: '/privacy' },
  { label: 'footer.terms', to: '/terms' },
];

export function LandingFooter() {
  const t = useT();
  const locale = useLocaleStore((st) => st.locale);
  const setLocale = useLocaleStore((st) => st.setLocale);
  return (
    <footer className="border-t-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark className="h-6 w-6" showTrajectory={false} />
            <span className="font-mono uppercase text-xs tracking-tight text-text-primary">
              PatternChess
            </span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="font-mono uppercase text-xs tracking-tight text-text-primary hover:text-gold-dark transition-colors"
              >
                {t(link.label)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-6 flex flex-col items-center gap-3">
          {/* Signed-out visitors' only language switch (signed-in: /profile#language). */}
          <label className="flex items-center gap-2 font-mono uppercase text-[10px] tracking-tight text-text-primary">
            <span>{t('language.title')}</span>
            <select
              className="border-2 border-text-primary bg-surface px-2 py-1 font-mono text-xs normal-case text-text-primary"
              value={locale}
              onChange={(e) => {
                const next = e.currentTarget.value;
                if (isLocale(next)) void setLocale(next);
              }}
              data-testid="footer-language"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LOCALE_NATIVE_NAME[l]}
                </option>
              ))}
            </select>
          </label>
          <div className="text-center font-mono uppercase text-[10px] tracking-tight text-text-secondary">
            {t('footer.rights')}
          </div>
        </div>
      </div>
    </footer>
  );
}
