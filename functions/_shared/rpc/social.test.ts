import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handlers, socialQueue, socialSetStatus } from './social';
import { openTestD1, type TestD1 } from './testD1';

let db: TestD1;
beforeEach(async () => {
  db = await openTestD1();
});
afterEach(() => db.close());

function addPost(id: string, scheduled: string | null, status: string, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    blunder_id: `b-${id}`,
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    scheduled_for: scheduled,
    status,
    puzzle: JSON.stringify({ side: 'white' }),
    ...extra,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO social_posts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

const status = (id: string) =>
  (db.sqlite.prepare(`SELECT status FROM social_posts WHERE id = ?`).get(id) as { status: string }).status;

describe('social queue', () => {
  it('lists upcoming queued/vetoed rows and the last 14 days of posts, decoded', async () => {
    addPost('old', '2026-11-01', 'posted');
    addPost('p1', '2026-11-20', 'posted', { plays: 120 });
    addPost('f1', '2026-11-21', 'failed', { ig_error: 'boom' });
    addPost('q0', '2026-11-22', 'queued');
    addPost('v1', '2026-11-23', 'vetoed');
    addPost('q1', '2026-11-23', 'queued');
    addPost('r1', null, 'rejected');
    const q = await socialQueue(db, '2026-11-22');
    expect(q.upcoming.map((r) => r.id)).toEqual(['q0', 'v1', 'q1']);
    expect(q.recent.map((r) => r.id)).toEqual(['f1', 'p1']);
    expect(q.upcoming[0].puzzle).toEqual({ side: 'white' });
  });

  it('one live row per day', () => {
    addPost('a', '2026-11-23', 'queued');
    expect(() => addPost('b', '2026-11-23', 'queued')).toThrow();
    addPost('c', '2026-11-23', 'vetoed');
  });

  it('vetoes and restores upcoming rows only', async () => {
    addPost('past', '2026-11-21', 'queued');
    addPost('q', '2026-11-23', 'queued');
    await expect(socialSetStatus(db, 'past', 'vetoed', '2026-11-22')).rejects.toMatchObject({ status: 400 });
    await expect(socialSetStatus(db, 'q', 'posted', '2026-11-22')).rejects.toMatchObject({ status: 400 });
    await expect(socialSetStatus(db, 'nope', 'vetoed', '2026-11-22')).rejects.toMatchObject({ status: 404 });
    await socialSetStatus(db, 'q', 'vetoed', '2026-11-22');
    expect(status('q')).toBe('vetoed');
    await expect(socialSetStatus(db, 'q', 'vetoed', '2026-11-22')).rejects.toMatchObject({ status: 409 });
    // The planner refilled the day: restoring would collide.
    addPost('refill', '2026-11-23', 'queued');
    await expect(socialSetStatus(db, 'q', 'queued', '2026-11-22')).rejects.toMatchObject({ status: 409 });
    db.sqlite.prepare(`DELETE FROM social_posts WHERE id = 'refill'`).run();
    await socialSetStatus(db, 'q', 'queued', '2026-11-22');
    expect(status('q')).toBe('queued');
  });

  it('registers admin-only handlers', () => {
    expect(handlers['admin.socialQueue'].auth).toBe('admin');
    expect(handlers['admin.socialSetStatus'].auth).toBe('admin');
  });
});
