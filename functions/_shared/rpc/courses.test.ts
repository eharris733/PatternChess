import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { ALL_COURSES, FREE_COURSE_DAYS } from '../../../src/lib/courseCatalog';
import { RpcError } from './core';
import { handlers } from './courses';
import { openTestD1, type TestD1 } from './testD1';

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', image: null, provider: 'google' };

const DAY = 86_400_000;
const date = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const today = date(0);

// A course with at least one supporter-only day.
const course = ALL_COURSES.find((c) => c.days.length > FREE_COURSE_DAYS + 1)!;
const slug = course.slug;

let db: TestD1;
let kv: Map<string, string>;
let env: Record<string, unknown>;

function call<T = unknown>(name: string, user: SessionUser, args: Record<string, unknown> = {}): Promise<T> {
  const ctx = { db, env: env as unknown as AppEnv, user, request: new Request('https://x'), waitUntil: () => {} };
  return handlers[name].handler(ctx, args) as Promise<T>;
}

async function rejects(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RpcError);
  expect((err as RpcError).status).toBe(status);
  if (code) expect((err as RpcError).code).toBe(code);
}

function addUser(id: string) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, `${id}@example.com`, now, now);
  db.sqlite
    .prepare('INSERT INTO profiles (id, referral_code, email_unsub_token, created_at) VALUES (?, ?, ?, ?)')
    .run(id, `code${id.slice(-4)}`, `tok-${id}`, now);
}

function makeSupporter(id: string, status = 'active') {
  db.sqlite
    .prepare('INSERT INTO supporters (user_id, stripe_customer_id, status) VALUES (?, ?, ?)')
    .run(id, `cus_${id}`, status);
}

/** Pretend `day` was completed on `localDate` (bypassing the pacing check). */
function seedDone(id: string, day: number, localDate: string) {
  db.sqlite
    .prepare('INSERT INTO course_progress (user_id, course_slug, day, local_date) VALUES (?, ?, ?, ?)')
    .run(id, slug, day, localDate);
}

beforeEach(async () => {
  db = await openTestD1();
  addUser('u-alice');
  addUser('u-bob');
  kv = new Map([[`course-day:${slug}:${FREE_COURSE_DAYS + 1}`, JSON.stringify({ youtubeId: 'abcdefghijk', start: 10, end: 99, takeaway: 'Locked lesson.' })]]);
  env = {
    DB: db,
    CONTENT: { get: async (k: string) => kv.get(k) ?? null },
    VITE_SHOW_PENDING_COURSES: '1',
  };
});

afterEach(() => db.close());

describe('courses.completeDay + pacing', () => {
  it('opens day 2 as soon as day 1 is done, the same day', async () => {
    const rows = await call<{ day: number; local_date: string }[]>('courses.completeDay', alice, { slug, day: 1, localDate: today });
    expect(rows).toMatchObject([{ day: 1, local_date: today }]);
    const next = await call<{ day: number; local_date: string }[]>('courses.completeDay', alice, { slug, day: 2, localDate: today });
    expect(next).toMatchObject([
      { day: 1, local_date: today },
      { day: 2, local_date: today },
    ]);
  });

  it('is idempotent and per user', async () => {
    await call('courses.completeDay', alice, { slug, day: 1, localDate: today });
    await call('courses.completeDay', alice, { slug, day: 1, localDate: today });
    const p = await call<{ days: unknown[] }>('courses.progress', alice);
    expect(p.days).toHaveLength(1);
    expect((await call<{ days: unknown[] }>('courses.progress', bob)).days).toHaveLength(0);
  });

  it('never skips a day', async () => {
    await rejects(call('courses.completeDay', alice, { slug, day: 2, localDate: today }), 403, 'not_open');
  });

  it('gates supporter days', async () => {
    for (let d = 1; d <= FREE_COURSE_DAYS; d++) seedDone(alice.id, d, '2026-01-0' + d);
    const locked = FREE_COURSE_DAYS + 1;
    await rejects(call('courses.completeDay', alice, { slug, day: locked, localDate: today }), 403, 'supporters_only');
    makeSupporter(alice.id);
    const rows = await call<{ day: number }[]>('courses.completeDay', alice, { slug, day: locked, localDate: today });
    expect(rows.map((r) => r.day)).toContain(locked);
  });

  it('validates arguments', async () => {
    await rejects(call('courses.completeDay', alice, { slug: 'nope', day: 1, localDate: today }), 404);
    await rejects(call('courses.completeDay', alice, { slug, day: 99, localDate: today }), 400);
    await rejects(call('courses.completeDay', alice, { slug, day: 1, localDate: '22/11/2026' }), 400);
    await rejects(call('courses.completeDay', alice, { slug, day: 1, localDate: '2020-01-01' }), 400);
  });

  it('hides pending courses unless the preview flag is on', async () => {
    env.VITE_SHOW_PENDING_COURSES = undefined;
    expect(course.permission.status).toBe('pending');
    await rejects(call('courses.completeDay', alice, { slug, day: 1, localDate: today }), 404);
    await rejects(call('courses.setFocus', alice, { slug }), 404);
  });
});

describe('courses.setFocus', () => {
  it('switches the followed course', async () => {
    const other = ALL_COURSES.find((c) => c.slug !== slug && c.permission.status === 'pending')!;
    await call('courses.setFocus', alice, { slug });
    await call('courses.setFocus', alice, { slug: other.slug });
    expect((await call<{ focus: string | null }>('courses.progress', alice)).focus).toBe(other.slug);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM course_focus').get()).toEqual({ n: 1 });
  });

  it('sets and clears the caller focus only', async () => {
    expect(await call('courses.setFocus', alice, { slug })).toEqual({ focus: slug });
    expect((await call<{ focus: string | null }>('courses.progress', alice)).focus).toBe(slug);
    expect((await call<{ focus: string | null }>('courses.progress', bob)).focus).toBeNull();
    expect(await call('courses.setFocus', alice, { slug: null })).toEqual({ focus: null });
    expect((await call<{ focus: string | null }>('courses.progress', alice)).focus).toBeNull();
  });
});

describe('courses.dayContent', () => {
  const locked = FREE_COURSE_DAYS + 1;

  it('serves supporter days to active supporters once open', async () => {
    makeSupporter(alice.id);
    await rejects(call('courses.dayContent', alice, { slug, day: locked }), 403, 'not_open');
    for (let d = 1; d < locked; d++) seedDone(alice.id, d, today);
    expect(await call('courses.dayContent', alice, { slug, day: locked })).toEqual({
      youtubeId: 'abcdefghijk',
      start: 10,
      end: 99,
      takeaway: 'Locked lesson.',
      lesson: null,
    });
  });

  it("passes a supporter day's interactive lesson through", async () => {
    makeSupporter(alice.id);
    for (let d = 1; d < locked; d++) seedDone(alice.id, d, today);
    kv.set(
      `course-day:${slug}:${locked}`,
      JSON.stringify({ youtubeId: 'abcdefghijk', takeaway: 'Locked lesson.', lesson: 'some-lesson-abc123' }),
    );
    expect(await call('courses.dayContent', alice, { slug, day: locked })).toMatchObject({ lesson: 'some-lesson-abc123' });
  });

  it('refuses non-supporters and lapsed supporters', async () => {
    for (let d = 1; d < locked; d++) seedDone(bob.id, d, '2026-01-0' + d);
    await rejects(call('courses.dayContent', bob, { slug, day: locked }), 403, 'supporters_only');
    makeSupporter(bob.id, 'canceled');
    await rejects(call('courses.dayContent', bob, { slug, day: locked }), 403, 'supporters_only');
  });

  it('never serves free days (they are public) and 404s a missing lesson', async () => {
    makeSupporter(alice.id);
    await rejects(call('courses.dayContent', alice, { slug, day: 1 }), 400);
    for (let d = 1; d < locked; d++) seedDone(alice.id, d, '2026-01-0' + d);
    kv.clear();
    await rejects(call('courses.dayContent', alice, { slug, day: locked }), 404);
  });
});

describe('cascade', () => {
  it('drops progress and the followed course with the user', async () => {
    await call('courses.completeDay', alice, { slug, day: 1, localDate: today });
    await call('courses.setFocus', alice, { slug });
    db.sqlite.prepare('DELETE FROM user WHERE id = ?').run(alice.id);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM course_progress').get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM course_focus').get()).toEqual({ n: 0 });
  });
});
