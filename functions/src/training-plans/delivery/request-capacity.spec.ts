import { describe, expect, it } from 'vitest';
import { GARMIN_PRODUCTION_WINDOWS, WAHOO_PRODUCTION_WINDOWS, reserveWindow } from './request-capacity';
describe('production rolling request capacity', () => {
  for (const window of [...GARMIN_PRODUCTION_WINDOWS, ...WAHOO_PRODUCTION_WINDOWS]) {
    it(`enforces ${window.scope} ${window.limit}/${window.windowMs} without a boundary burst`, () => {
      let counter;
      for (let i = 0; i < window.limit; i++) counter = reserveWindow(counter, window, window.bucketMs - 1).counter;
      expect(reserveWindow(counter, window, window.bucketMs).due).toBe(window.windowMs + window.bucketMs);
      expect(reserveWindow(counter, window, window.windowMs + window.bucketMs - 1).due).toBe(window.windowMs + window.bucketMs);
      expect(reserveWindow(counter, window, window.windowMs + window.bucketMs).counter.buckets).toHaveLength(1);
    });
  }
  it('honors an adapter delay independently of available request counts', () => {
    expect(reserveWindow({ buckets: [], notBeforeMs: 999999 }, GARMIN_PRODUCTION_WINDOWS[0], 1).due).toBe(999999);
  });
});
