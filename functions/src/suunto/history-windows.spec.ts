import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { suuntoHistoryBatchRange, suuntoHistoryWindowDays } from './history-windows';
const DAY = 86_400_000;

describe('Suunto history target coverage', () => {
  it.each(['sleep', 'health'] as const)('covers exact millisecond endpoints, leap days, DST and random %s ranges with at most four bounded children', resource => {
    let seed = 987654321;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let example = 0; example < 2000; example++) {
      const start = Date.parse('2000-01-01T00:00:00Z') + next() * 101;
      const duration = example === 0 ? 0 : next() * 197;
      const end = start + duration;
      let cursor = start;
      while (cursor <= end) {
        const batch = suuntoHistoryBatchRange(cursor, end, resource);
        const width = suuntoHistoryWindowDays(resource) * DAY;
        let children = 0;
        while (cursor < batch.endMs) {
          const targetEnd = Math.min(cursor + width, batch.endMs);
          assert.ok(targetEnd > cursor);
          assert.ok(targetEnd - cursor <= width);
          if (resource === 'health') assert.ok(targetEnd - cursor + 2 * DAY <= 28 * DAY);
          cursor = targetEnd; children++;
        }
        assert.ok(children <= 4);
        assert.equal(batch.nextStartMs, cursor);
      }
      expect(cursor).toBe(end + 1);
    }
  });
  it('honors a smaller retained batch after splitting and clamps an oversized batch', () => {
    const end = 200 * DAY;
    expect(suuntoHistoryBatchRange(0, end, 'health', 13).endMs).toBe(13 * DAY);
    expect(suuntoHistoryBatchRange(0, end, 'health', 500).endMs).toBe(104 * DAY);
    for (const days of [0, -1, NaN, Infinity]) expect(() => suuntoHistoryBatchRange(0, end, 'health', days)).toThrow();
  });
});
