import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';
import {
  detectLocale,
  interpolate,
  placeholders,
  resolveTemplate,
  type Catalog,
} from './i18n';
import { SR_BUCKET_LABEL, DRILL_KIND_LABEL, PHASE_LABEL } from '../models/blunder';
import { COMMITMENT_LABEL, COMMITMENT_TAGLINE } from '../lib/dailyGoal';
import { MOTIF_LABEL } from '../chess/motifs';
import { ENDGAME_TYPE_LABEL } from '../chess/endgameType';
import { MOVE_CLASSIFICATION_LABEL } from '../chess/winningChances';
import { DEVIATION_REASON_LABEL } from '../chess/openingDeviation';
import { SCENARIO_STATUS_LABEL } from '../models/endgameScenario';
import { GAME_STATE_LABEL } from '../chess/blunderContext';
import { COLOR_LABEL } from '../components/vault/vaultFilters';
import { BOOK_TIER_LABEL } from '../chess/bookFormat';
import { AVATAR_PART_LABEL } from '../lib/avatar';
import { RANKS } from '../lib/ranks';

/**
 * Every English label map that `useLabel(family, id, english)` translates.
 * Adding a family to a component means adding it here (and its ids to es/pt).
 */
const LABEL_FAMILIES: Record<string, Record<string, string>> = {
  srBucket: SR_BUCKET_LABEL,
  drillKind: DRILL_KIND_LABEL,
  phase: PHASE_LABEL,
  commitment: COMMITMENT_LABEL,
  commitmentTagline: COMMITMENT_TAGLINE,
  motif: MOTIF_LABEL,
  endgameType: ENDGAME_TYPE_LABEL,
  moveClass: MOVE_CLASSIFICATION_LABEL,
  deviationReason: DEVIATION_REASON_LABEL,
  scenarioStatus: SCENARIO_STATUS_LABEL,
  gameState: GAME_STATE_LABEL,
  color: COLOR_LABEL,
  bookTier: BOOK_TIER_LABEL,
  avatarPart: AVATAR_PART_LABEL,
  // Rank names are their own ids.
  rank: Object.fromEntries(RANKS.map((r) => [r.name, r.name])),
};

const labelKeys = Object.entries(LABEL_FAMILIES).flatMap(([family, map]) =>
  Object.keys(map).map((id) => `label.${family}.${id}`),
);

const EN: Catalog = en;
const CATALOGS: Record<string, Catalog> = { es, pt };

describe('i18n catalogs', () => {
  for (const [name, catalog] of Object.entries(CATALOGS)) {
    describe(name, () => {
      it('has every English key', () => {
        const missing = Object.keys(EN).filter((k) => catalog[k] === undefined);
        expect(missing).toEqual([]);
      });

      it('has every label-family entry', () => {
        const missing = labelKeys.filter((k) => catalog[k] === undefined);
        expect(missing).toEqual([]);
      });

      it('has no keys English lacks (stale or misspelled)', () => {
        const known = new Set([...Object.keys(EN), ...labelKeys]);
        expect(Object.keys(catalog).filter((k) => !known.has(k))).toEqual([]);
      });

      it('keeps the same placeholders as English', () => {
        // A singular form may spell the count out ("De tu última partida").
        const names = (k: string, v: string) =>
          placeholders(v)
            .filter((p) => !(k.endsWith('_one') && p === 'count'))
            .join();
        const bad = Object.keys(EN).filter(
          (k) => catalog[k] !== undefined && names(k, catalog[k]) !== names(k, EN[k]),
        );
        expect(bad).toEqual([]);
      });

      it('has no empty strings', () => {
        expect(Object.entries(catalog).filter(([, v]) => !v.trim())).toEqual([]);
      });

      it('keeps "Elo" as is', () => {
        const bad = Object.entries(catalog).filter(([, v]) => /\b(ELO|elo)\b/.test(v.replace(/\{\w+\}/g, '')));
        expect(bad).toEqual([]);
      });
    });
  }

  it('pairs every plural form', () => {
    const keys = Object.keys(EN);
    for (const k of keys) {
      if (k.endsWith('_one')) expect(keys).toContain(k.replace(/_one$/, '_other'));
      if (k.endsWith('_other')) expect(keys).toContain(k.replace(/_other$/, '_one'));
    }
  });
});

describe('detectLocale', () => {
  it('maps regional tags to the language', () => {
    expect(detectLocale(['es-MX', 'en'])).toBe('es');
    expect(detectLocale(['pt-BR'])).toBe('pt');
    expect(detectLocale(['pt_PT'])).toBe('pt');
  });
  it('takes the first supported language', () => {
    expect(detectLocale(['fr-FR', 'pt-BR', 'es'])).toBe('pt');
  });
  it('falls back to English', () => {
    expect(detectLocale(['de-DE'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });
});

describe('resolveTemplate', () => {
  it('picks the plural form from count', () => {
    // English drives which keys are plural; use a real plural key.
    expect(resolveTemplate(EN, 'en', 'plan.train.title', { count: 1 })).toBe(EN['plan.train.title_one']);
    expect(resolveTemplate(EN, 'en', 'plan.train.title', { count: 5 })).toBe(EN['plan.train.title_other']);
    expect(resolveTemplate(es, 'es', 'plan.train.title', { count: 5 })).toBe(es['plan.train.title_other']);
    expect(resolveTemplate(es, 'es', 'plan.train.title', { count: 1_000_000 })).toBe(es['plan.train.title_other']);
    // CLDR pt makes 0 singular; the catalogs read 0 as plural ("0 posições").
    expect(resolveTemplate(pt, 'pt', 'plan.train.title', { count: 0 })).toBe(pt['plan.train.title_other']);
    expect(resolveTemplate(pt, 'pt', 'plan.train.title', { count: 1 })).toBe(pt['plan.train.title_one']);
  });

  it('falls back to English and reports the miss', () => {
    const misses: string[] = [];
    const out = resolveTemplate({}, 'es', 'plan.title', undefined, (k) => misses.push(k));
    expect(out).toBe(EN['plan.title']);
    expect(misses).toEqual(['plan.title']);
  });

  it('interpolates named values', () => {
    expect(interpolate('hi {name}, {n}', { name: 'Ana', n: 3 })).toBe('hi Ana, 3');
    expect(interpolate('keep {unknown}', {})).toBe('keep {unknown}');
  });
});
