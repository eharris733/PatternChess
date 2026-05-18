import { ECO_FAMILY_NAMES, ECO_OPENING_NAMES } from './ecoOpenings';

export interface OpeningDisplay {
  name: string | null;
  eco: string | null;
}

export function resolveOpeningName(
  eco: string | null,
  openingName: string | null,
): OpeningDisplay {
  const trimmed = openingName?.trim();
  const name = trimmed && trimmed.length > 0
    ? trimmed
    : (eco ? ECO_OPENING_NAMES[eco] ?? null : null);
  return { name, eco: eco?.trim() || null };
}

export function resolveOpeningFamilyName(family: string): OpeningDisplay {
  return { name: ECO_FAMILY_NAMES[family] ?? null, eco: family };
}

export function formatOpeningDisplay(d: OpeningDisplay): string | null {
  if (d.name && d.eco) return `${d.name} · ${d.eco}`;
  return d.name ?? d.eco ?? null;
}
