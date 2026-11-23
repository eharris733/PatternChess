import { useCallback, useMemo, type ReactNode } from 'react';
import {
  interpolate,
  interpolateNodes,
  resolveTemplate,
  type Catalog,
  type Locale,
  type MissingKeyHandler,
  type TKey,
  type TVars,
} from './i18n';
import { useLocaleStore } from './localeStore';

const warned = new Set<string>();
const warnMissing: MissingKeyHandler = (key, locale) => {
  const id = `${locale}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] missing key "${key}" for ${locale}`);
};

export interface Translator {
  (key: TKey, vars?: TVars): string;
  /**
   * Same lookup, with React nodes allowed as placeholder values. Pass `count`
   * to pick the plural form when `{count}` itself is a node.
   */
  rich: (key: TKey, vars: Record<string, ReactNode>, count?: number) => ReactNode;
  /** An entry of an English label map (see `useLabel`). */
  label: (family: string, id: string, english: string) => string;
  locale: Locale;
}

function labelFor(catalog: Catalog, locale: Locale, family: string, id: string, english: string): string {
  if (locale === 'en') return english;
  const key = `label.${family}.${id}`;
  const hit = catalog[key];
  if (hit === undefined) {
    warnMissing(key, locale);
    return english;
  }
  return hit;
}

function makeTranslator(catalog: Catalog, locale: Locale): Translator {
  const t = ((key: TKey, vars?: TVars) =>
    interpolate(resolveTemplate(catalog, locale, key, vars, warnMissing), vars)) as Translator;
  t.rich = (key, vars, count) => {
    const n = count ?? (typeof vars.count === 'number' ? vars.count : undefined);
    return interpolateNodes(
      resolveTemplate(catalog, locale, key, n === undefined ? undefined : { count: n }, warnMissing),
      vars,
    );
  };
  t.label = (family, id, english) => labelFor(catalog, locale, family, id, english);
  t.locale = locale;
  return t;
}

/** `t(key, vars)` for the active language; re-renders on a language switch. */
export function useT(): Translator {
  const catalog = useLocaleStore((s) => s.catalog);
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(() => makeTranslator(catalog, locale), [catalog, locale]);
}

/**
 * Translates an entry of an existing English label map (SR_BUCKET_LABEL,
 * MOTIF_LABEL, ...): `label('srBucket', bucket, SR_BUCKET_LABEL[bucket])`.
 * English always shows the constant, so it stays the single English source.
 */
export function useLabel(): (family: string, id: string, english: string) => string {
  const catalog = useLocaleStore((s) => s.catalog);
  const locale = useLocaleStore((s) => s.locale);
  return useCallback(
    (family: string, id: string, english: string) => labelFor(catalog, locale, family, id, english),
    [catalog, locale],
  );
}

/** Translator for code outside React (reads the current language once). */
export function currentT(): Translator {
  const { catalog, locale } = useLocaleStore.getState();
  return makeTranslator(catalog, locale);
}
