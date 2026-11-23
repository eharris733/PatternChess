// Copy of the non-US countries in src/lib/eventRegions.ts (EVENT_COUNTRIES),
// the app's source for `profiles.events_country`. The Worker keeps its own
// copy like usStates.ts; events.test.ts fails if the two ever drift apart.
export const EVENT_COUNTRY: Record<string, { name: string; slug: string }> = {
  CA: { name: 'Canada', slug: 'canada' },
  'GB-ENG': { name: 'England', slug: 'england' },
  'GB-SCT': { name: 'Scotland', slug: 'scotland' },
  'GB-WLS': { name: 'Wales', slug: 'wales' },
  IE: { name: 'Ireland', slug: 'ireland' },
  AU: { name: 'Australia', slug: 'australia' },
  NZ: { name: 'New Zealand', slug: 'new-zealand' },
  IN: { name: 'India', slug: 'india' },
  ZA: { name: 'South Africa', slug: 'south-africa' },
  DE: { name: 'Germany', slug: 'germany' },
  FR: { name: 'France', slug: 'france' },
  ES: { name: 'Spain', slug: 'spain' },
  NL: { name: 'Netherlands', slug: 'netherlands' },
};
