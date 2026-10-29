import { describe, expect, it } from 'vitest';
import { globalReconciliationGeneration, nextTrainingLocalDay } from './reconciliation-coordinator';

describe('Training reconciliation clocks and legacy writers', () => {
  it('separates targeted edits while treating old writers as full invalidations', () => {
    expect(globalReconciliationGeneration({ generation: 830 })).toBe(830);
    expect(globalReconciliationGeneration({ generation: 835, targetedGeneration: 5 })).toBe(830);
    expect(globalReconciliationGeneration({ generation: 836, targetedGeneration: 5 })).toBe(831);
  });
  it.each([
    ['2026-03-28T22:00:00Z', 'Europe/Helsinki', '2026-03-29T21:00:00Z'],
    ['2026-10-24T21:00:00Z', 'Europe/Helsinki', '2026-10-25T22:00:00Z'],
    ['2026-10-29T10:00:00Z', 'Asia/Kathmandu', '2026-10-29T18:15:00Z'],
    ['2026-10-29T09:59:59Z', 'Pacific/Kiritimati', '2026-10-29T10:00:00Z'],
    ['2026-10-29T10:00:00Z', 'Pacific/Kiritimati', '2026-10-30T10:00:00Z'],
  ])('wakes at the next saved-zone midnight from %s in %s', (now, zone, expected) => {
    expect(nextTrainingLocalDay(Date.parse(now), zone)).toBe(Date.parse(expected));
  });
});
