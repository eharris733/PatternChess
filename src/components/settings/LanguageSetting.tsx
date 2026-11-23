import clsx from 'clsx';
import { LOCALES, LOCALE_NATIVE_NAME } from '../../i18n/i18n';
import { useLocaleStore } from '../../i18n/localeStore';
import { useT } from '../../i18n/useT';

/**
 * /profile#language: the app language. Defaults to the browser's language;
 * a pick is remembered on this device (localStorage, `localeStore`). Each
 * option is named in its own language.
 */
export function LanguageSetting() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <section id="language" className="card flex flex-col gap-3 scroll-mt-6" data-testid="language-setting">
      <h2 className="heading-md">{t('language.title')}</h2>
      <div role="radiogroup" aria-label={t('language.picker')} className="flex flex-wrap gap-2">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={locale === l}
            lang={l}
            onClick={() => void setLocale(l)}
            data-testid={`language-${l}`}
            className={clsx(
              'border-2 px-3 py-1.5 text-sm transition-colors',
              locale === l
                ? 'border-gold-dark bg-gold-dark/10 font-semibold'
                : 'border-text-primary/20 hover:border-text-primary/50',
            )}
          >
            {LOCALE_NATIVE_NAME[l]}
          </button>
        ))}
      </div>
      <p className="text-text-primary text-xs">{t('language.help')}</p>
    </section>
  );
}
