import { create } from 'zustand';
import { EN_CATALOG, detectLocale, isLocale, type Catalog, type Locale } from './i18n';

/**
 * The app language. Persisted per device in localStorage (`pc:locale`); with
 * no stored choice it follows the browser (`navigator.languages`). English is
 * bundled, other catalogs load as lazy chunks.
 *
 * Prerendered public pages are English by construction: `scripts/prerender.mjs`
 * snapshots with an `en-US` browser.
 */
const STORAGE_KEY = 'pc:locale';

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Catalog }>> = {
  es: () => import('./es.json'),
  pt: () => import('./pt.json'),
};

export function storedLocale(): Locale | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  return storedLocale() ?? detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages);
}

async function loadCatalog(locale: Locale): Promise<Catalog> {
  if (locale === 'en') return EN_CATALOG;
  const mod = await loaders[locale]();
  return mod.default;
}

function applyToDom(locale: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

interface LocaleState {
  /** The language whose catalog is active (what is on screen). */
  locale: Locale;
  catalog: Catalog;
  /** Picks a language: loads its catalog, then switches and persists it. */
  setLocale: (locale: Locale) => Promise<void>;
}

let requested: Locale = 'en';

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'en',
  catalog: EN_CATALOG,
  setLocale: async (locale) => {
    requested = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // per-device convenience only
    }
    const catalog = await loadCatalog(locale);
    // A later pick wins over a slower load.
    if (requested !== locale) return;
    applyToDom(locale);
    set({ locale, catalog });
  },
}));

/**
 * Boot: activates the stored / browser language before the first render so
 * non-English players don't see an English flash. Resolves within `timeoutMs`
 * even if the chunk is slow (the switch then lands when it arrives).
 */
export async function initLocale(timeoutMs = 1500): Promise<void> {
  const locale = initialLocale();
  requested = locale;
  if (locale === 'en') {
    applyToDom('en');
    return;
  }
  const load = loadCatalog(locale).then(
    (catalog) => {
      if (requested !== locale) return;
      applyToDom(locale);
      useLocaleStore.setState({ locale, catalog });
    },
    (err: unknown) => {
      console.warn('[i18n] could not load', locale, err);
    },
  );
  await Promise.race([load, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
