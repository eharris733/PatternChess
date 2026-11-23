/**
 * Lightweight i18n: flat JSON catalogs keyed by dotted ids, `{name}`
 * placeholders and `_one` / `_other` plural forms.
 *
 * English (`en.json`) is bundled and is the source of truth for the key set
 * (`MessageKey`); Spanish and Portuguese are lazy chunks loaded by
 * `localeStore`. Every key in `en.json` must exist in every other catalog
 * (asserted by `i18n.test.ts`), and a key missing at runtime falls back to
 * English with a `[i18n] missing key` warning.
 *
 * Label maps that already have an English source of truth (SR_BUCKET_LABEL,
 * MOTIF_LABEL, COMMITMENT_LABEL, ...) keep it: their translations live in the
 * non-English catalogs under `label.<family>.<id>` and are read through
 * `useLabel()`, which falls back to the English constant. `LABEL_FAMILIES`
 * in the test lists every family a catalog must cover.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import en from './en.json';

export type Locale = 'en' | 'es' | 'pt';
export const LOCALES: readonly Locale[] = ['en', 'es', 'pt'];

/** Each language's own name: the picker shows a language in that language. */
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
};

export type Catalog = Record<string, string>;
export type MessageKey = keyof typeof en;

/** Base keys of plural pairs (`foo_one` + `foo_other` → `foo`). */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer B}_one` ? B : never;
}[MessageKey];

export type TKey = MessageKey | PluralKey;
export type TVars = Record<string, string | number>;

export const EN_CATALOG: Catalog = en;

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'es' || v === 'pt';
}

/**
 * The first supported language in the browser's preference list
 * (`navigator.languages`), by primary subtag: `es-MX` → es, `pt-BR` → pt.
 * Anything else is English.
 */
export function detectLocale(languages: readonly string[] | undefined | null): Locale {
  for (const tag of languages ?? []) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, n: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(n);
}

export type MissingKeyHandler = (key: string, locale: Locale) => void;

/** Looks a key up in `catalog`, then English; reports a miss in a non-English catalog. */
function lookup(
  catalog: Catalog,
  locale: Locale,
  key: string,
  onMissing?: MissingKeyHandler,
): string | undefined {
  const hit = catalog[key];
  if (hit !== undefined) return hit;
  const fallback = EN_CATALOG[key];
  if (locale !== 'en' && fallback !== undefined) onMissing?.(key, locale);
  return fallback;
}

/** Resolves a key (choosing the plural form from `vars.count`) to its raw template. */
export function resolveTemplate(
  catalog: Catalog,
  locale: Locale,
  key: string,
  vars?: TVars,
  onMissing?: MissingKeyHandler,
): string {
  const count = vars?.count;
  if (typeof count === 'number' && EN_CATALOG[`${key}_one`] !== undefined) {
    // es/pt also have a "many" category (1 000 000 de ...); our catalogs only
    // carry one/other, so anything but "one" reads the "other" form. CLDR's pt
    // counts 0 as "one" ("0 posição"); every catalog here reads 0 as plural.
    const form = count !== 0 && pluralCategory(locale, count) === 'one' ? 'one' : 'other';
    const t = lookup(catalog, locale, `${key}_${form}`, onMissing);
    if (t !== undefined) return t;
  }
  const t = lookup(catalog, locale, key, onMissing);
  if (t === undefined) {
    onMissing?.(key, locale);
    return key;
  }
  return t;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills `{name}` placeholders with plain values. Unknown names are left as is.
 * Numbers get locale grouping (1,234 / 1.234); pass a string for ratings,
 * years or ids that must print as is.
 */
export function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (m, name: string) => {
    const v = vars[name];
    return v === undefined ? m : typeof v === 'number' ? v.toLocaleString() : v;
  });
}

/**
 * Fills placeholders with React nodes (a bold count, a link). The pieces are
 * passed as varargs children of one fragment, so they need no keys.
 */
export function interpolateNodes(template: string, vars: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(template.slice(last, idx));
    const v = vars[m[1]];
    out.push(v === undefined ? m[0] : typeof v === 'number' ? v.toLocaleString() : v);
    last = idx + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return createElement(Fragment, null, ...out);
}

/** Placeholder names in a template, for the catalog parity test. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}
