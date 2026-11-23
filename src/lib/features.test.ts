import { describe, expect, it } from 'vitest';
import { ADMIN_EMAILS } from '../auth/admin';
import { featureVisible, RELEASED } from './features';

describe('featureVisible', () => {
  it('shows unreleased features to admins only', () => {
    for (const f of Object.keys(RELEASED) as (keyof typeof RELEASED)[]) {
      expect(featureVisible(f, ADMIN_EMAILS[0])).toBe(true);
      expect(featureVisible(f, 'someone@example.com')).toBe(RELEASED[f]);
      expect(featureVisible(f, null)).toBe(RELEASED[f]);
    }
  });
  it('keeps Path and Learn unreleased for now', () => {
    expect(RELEASED.path).toBe(false);
    expect(RELEASED.learn).toBe(false);
  });
});
