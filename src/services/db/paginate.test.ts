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
  it('pages past the 1000-row cap', async () => {
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllRows(fakeQuery(2003, calls));
    expect(rows).toHaveLength(2003);
    expect(rows[2002]).toBe(2002);
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ]);
  });

  it('stops after one short page', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(fakeQuery(5, calls))).toHaveLength(5);
    expect(calls).toHaveLength(1);
  });

  it('makes one extra request when the total is an exact multiple', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllRows(fakeQuery(PAGE_SIZE, calls))).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2);
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
