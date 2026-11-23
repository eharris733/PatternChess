import { describe, expect, it } from 'vitest';
import { loginUrlWithNext, safeNextPath } from './nextPath';

describe('safeNextPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNextPath('/supporter?checkout=1')).toBe('/supporter?checkout=1');
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/profile#email')).toBe('/profile#email');
  });

  it('rejects anything that could leave the site', () => {
    for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'supporter', '']) {
      expect(safeNextPath(bad)).toBeNull();
    }
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it('never points back at /login', () => {
    expect(safeNextPath('/login?next=/x')).toBeNull();
  });

  it('round-trips through loginUrlWithNext', () => {
    const url = new URL(loginUrlWithNext('/supporter?checkout=1'), 'https://patternchess.com');
    expect(url.pathname).toBe('/login');
    expect(safeNextPath(url.searchParams.get('next'))).toBe('/supporter?checkout=1');
  });
});
