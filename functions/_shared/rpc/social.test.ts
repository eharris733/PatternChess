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

  it('returns the v2 columns: format, the decoded script, Buffer state (0008)', async () => {
    const script = { hookStyle: 'would-you-fall', headline: 'Would you fall for this?', subline: 'x', beats: { hook: 'h' }, captionLead: 'c' };
    addPost('t1', '2026-11-23', 'queued', {
      blunder_id: 'trap:8/8/8/8/8/8/8/8 w - -|a1a2',
      format: 'fall',
      fell_count: 11,
      script: JSON.stringify(script),
      script_source: 'claude',
      voice: 'am_michael',
      buffer_ig_post_id: 'buf1',
    });
    const [row] = (await socialQueue(db, '2026-11-22')).upcoming;
    expect(row).toMatchObject({ format: 'fall', fell_count: 11, script, script_source: 'claude', voice: 'am_michael', buffer_ig_post_id: 'buf1', buffer_error: null });
    // Old rows default to the blunder format; unknown formats and sources are refused.
    addPost('o1', '2026-11-24', 'queued');
    expect((await socialQueue(db, '2026-11-22')).upcoming[1].format).toBe('blunder');
    expect(() => addPost('x1', '2026-11-25', 'queued', { format: 'meme' })).toThrow();
    addPost('pro1', '2026-11-25', 'queued', { format: 'pro', slot: 1, youtube_title: 'One move decided it', buffer_yt_post_id: 'y1' });
    expect(() => addPost('x2', '2026-11-26', 'queued', { script_source: 'gpt' })).toThrow();
  });

  it('one live row per day and slot (0009)', async () => {
    addPost('a', '2026-11-23', 'queued');
    expect(() => addPost('b', '2026-11-23', 'queued')).toThrow();
    addPost('c', '2026-11-23', 'vetoed');
    addPost('evening', '2026-11-23', 'queued', { slot: 1, format: 'pro' });
    expect(() => addPost('d', '2026-11-23', 'queued', { slot: 1 })).toThrow();
    expect(() => addPost('e', '2026-11-24', 'queued', { slot: 2 })).toThrow();
    const q = await socialQueue(db, '2026-11-22');
    expect(q.upcoming.map((r) => [r.id, r.slot])).toEqual([['c', 0], ['a', 0], ['evening', 1]]);
    expect(q.upcoming[2]).toMatchObject({ format: 'pro', youtube_title: null, buffer_yt_post_id: null, yt_status: null });
  });

  it('restores a vetoed slot only when that slot is free', async () => {
    addPost('v', '2026-11-23', 'vetoed', { slot: 1 });
    addPost('morning', '2026-11-23', 'queued'); // the other slot is taken: fine
    await socialSetStatus(db, 'v', 'queued', '2026-11-22');
    expect(status('v')).toBe('queued');
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
