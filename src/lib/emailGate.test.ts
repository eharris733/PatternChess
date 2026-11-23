import { describe, expect, it } from 'vitest';
import { needsContactEmail } from './emailGate';

describe('needsContactEmail', () => {
  it('asks a Lichess sign-in without an address', () => {
    expect(needsContactEmail({ provider: 'lichess' }, { contactEmail: null })).toBe(true);
  });

  it('lets a Lichess sign-in through once an address is saved (confirmed or not)', () => {
    expect(needsContactEmail({ provider: 'lichess' }, { contactEmail: 'me@example.com' })).toBe(false);
  });

  it('never asks accounts that came with an address', () => {
    expect(needsContactEmail({ provider: 'google' }, { contactEmail: null })).toBe(false);
    expect(needsContactEmail({ provider: 'email' }, { contactEmail: null })).toBe(false);
  });

  it('waits for the profile', () => {
    expect(needsContactEmail({ provider: 'lichess' }, null)).toBe(false);
    expect(needsContactEmail(null, null)).toBe(false);
  });
});
