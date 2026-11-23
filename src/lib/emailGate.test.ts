import { describe, expect, it } from 'vitest';
import { needsContactEmail } from './emailGate';

describe('needsContactEmail', () => {
  it('asks a Lichess sign-in without an address', () => {
    expect(needsContactEmail({ provider: 'lichess' }, { contactEmail: null, contactEmailVerifiedAt: null })).toBe(true);
  });

  it('keeps a Lichess sign-in at the gate until the address is confirmed', () => {
    expect(needsContactEmail({ provider: 'lichess' }, { contactEmail: 'me@example.com', contactEmailVerifiedAt: null })).toBe(true);
    expect(needsContactEmail({ provider: 'lichess' }, { contactEmail: 'me@example.com', contactEmailVerifiedAt: new Date() })).toBe(false);
  });

  it('never asks accounts that came with an address', () => {
    expect(needsContactEmail({ provider: 'google' }, { contactEmail: null, contactEmailVerifiedAt: null })).toBe(false);
    expect(needsContactEmail({ provider: 'email' }, { contactEmail: null, contactEmailVerifiedAt: null })).toBe(false);
  });

  it('waits for the profile', () => {
    expect(needsContactEmail({ provider: 'lichess' }, null)).toBe(false);
    expect(needsContactEmail(null, null)).toBe(false);
  });
});
