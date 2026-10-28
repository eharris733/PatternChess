import { describe, expect, it } from 'vitest';
import { fetchAllRows, fetchInChunks, IN_CHUNK_SIZE, PAGE_SIZE } from './paginate';

function fakeQuery(total: number, calls: Array<[number, number]>) {
  return () => ({
    range(from: number, to: number) {
      calls.push([from, to]);
      const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
      return Promise.resolve({ data: rows, error: null });
    },
  });
}

describe('fetchAllRows', () => {
  it('pages past the 1000-row cap, reading ahead in parallel after a full first page', async () => {
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllRows(fakeQuery(2003, calls));
    expect(rows).toHaveLength(2003);
    expect(rows).toEqual(Array.from({ length: 2003 }, (_, i) => i));
    // First page alone, then one batch of four (pages 1–4; 3 and 4 come back empty).
    expect(calls.map(([from]) => from)).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it('keeps pages in order when they resolve out of order', async () => {
    const build = () => ({
      range(from: number, to: number) {
        const rows = Array.from({ length: Math.max(0, Math.min(to, 2499) - from + 1) }, (_, i) => from + i);
        // Later pages resolve first.
        const delay = from === 0 ? 0 : 50 - from / 100;
        return new Promise<{ data: number[]; error: null }>((r) =>
          setTimeout(() => r({ data: rows, error: null }), delay),
        );
      },
    });
    expect(await fetchAllRows(build)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });

  it('fetches another batch when a whole batch is full', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(fakeQuery(6500, calls))).toHaveLength(6500);
    expect(calls.map(([from]) => from / PAGE_SIZE)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('stops after one short page', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(fakeQuery(5, calls))).toHaveLength(5);
    expect(calls).toHaveLength(1);
  });

  it('reads one batch ahead when the total is an exact multiple', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(fakeQuery(PAGE_SIZE, calls))).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(5);
  });

  it('throws the query error', async () => {
    const err = new Error('boom');
    await expect(
      fetchAllRows(() => ({ range: () => Promise.resolve({ data: null, error: err }) })),
    ).rejects.toBe(err);
  });
});

describe('fetchInChunks', () => {
  it('splits long id lists', async () => {
    const ids = Array.from({ length: IN_CHUNK_SIZE * 2 + 1 }, (_, i) => `id${i}`);
    const sizes: number[] = [];
    const rows = await fetchInChunks(ids, async (chunk) => {
      sizes.push(chunk.length);
      return chunk;
    });
    expect(rows).toEqual(ids);
    expect(sizes).toEqual([IN_CHUNK_SIZE, IN_CHUNK_SIZE, 1]);
  });

  it('makes no request for an empty list', async () => {
    let called = false;
    await fetchInChunks([], async () => {
      called = true;
      return [];
    });
    expect(called).toBe(false);
  });
});
