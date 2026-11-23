import { describe, expect, it, vi } from 'vitest';
import {
  defaultProfileRow,
  fetchLichessUserInfo,
  genReferralCode,
  isAdminEmail,
  isPlaceholderEmail,
  mapLichessAccount,
  toSessionUser,
} from './auth';

describe('Lichess user info', () => {
  it('maps /api/account to the lowercase id + placeholder email', () => {
    expect(mapLichessAccount({ id: 'the_ski_patrol', username: 'The_Ski_Patrol' })).toEqual({
      id: 'the_ski_patrol',
      name: 'The_Ski_Patrol',
      email: 'the_ski_patrol@lichess.invalid',
      emailVerified: false,
      image: undefined,
      username: 'The_Ski_Patrol',
    });
  });

  it('calls /api/account with the bearer token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'h11ujl', username: 'h11UjL', perfs: {} }), { status: 200 }),
    );
    const info = await fetchLichessUserInfo('tok', fetchImpl as unknown as typeof fetch);
    expect(info?.id).toBe('h11ujl');
    expect(info?.email).toBe('h11ujl@lichess.invalid');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lichess.org/api/account');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('returns null without a token or on an API error', async () => {
    expect(await fetchLichessUserInfo(undefined)).toBeNull();
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    expect(await fetchLichessUserInfo('tok', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('placeholder + admin emails', () => {
  it('detects placeholders', () => {
    expect(isPlaceholderEmail('abc@lichess.invalid')).toBe(true);
    expect(isPlaceholderEmail('ABC@LICHESS.INVALID')).toBe(true);
    expect(isPlaceholderEmail('a@gmail.com')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  it('checks the admin allowlist case-insensitively', () => {
    expect(isAdminEmail('ElliotMHarris@gmail.com')).toBe(true);
    expect(isAdminEmail('someone@gmail.com')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it('toSessionUser hides placeholder emails and derives the provider', () => {
    expect(toSessionUser({ id: '1', email: 'x@lichess.invalid', name: 'X', emailVerified: false })).toMatchObject({
      email: null,
      provider: 'lichess',
    });
    expect(toSessionUser({ id: '2', email: 'a@gmail.com', emailVerified: true }).provider).toBe('google');
    expect(toSessionUser({ id: '3', email: 't@test.dev', emailVerified: false }).provider).toBe('email');
  });
});

describe('default profile', () => {
  it('fills a Lichess profile with the username and no email opt-in', () => {
    const row = defaultProfileRow({ id: 'u1', email: 'the_ski_patrol@lichess.invalid', name: 'The_Ski_Patrol' });
    expect(row).toMatchObject({
      id: 'u1',
      display_name: 'The_Ski_Patrol',
      lichess_username: 'The_Ski_Patrol',
      avatar_url: null,
      email_opt_in: false,
      preferred_time_controls: ['bullet', 'blitz', 'rapid', 'classical'],
      commitment_level: 'regular',
      daily_positions_goal: 10,
      email_hour: 18,
    });
    expect(row.referral_code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    expect(row.email_unsub_token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fills a Google profile with name, avatar and email opt-in', () => {
    const row = defaultProfileRow({ id: 'u2', email: 'a@gmail.com', name: 'Ann Lee', image: 'https://img' });
    expect(row).toMatchObject({ display_name: 'Ann Lee', avatar_url: 'https://img', lichess_username: null, email_opt_in: true });
  });

  it('referral codes avoid ambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(genReferralCode()).not.toMatch(/[01ilo]/);
  });
});
