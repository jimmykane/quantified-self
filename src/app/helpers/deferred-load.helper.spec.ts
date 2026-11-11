import { describe, expect, it } from 'vitest';
import { deferredLoadLabel, isDeferredLoadArea } from './deferred-load.helper';

describe('deferred-load area boundary', () => {
  it('uses fixed product labels while retaining distinct public preview identifiers', () => {
    expect(deferredLoadLabel('power-settings')).toBe('Workout power settings');
    expect(deferredLoadLabel('dashboard-map')).toBe('Map');
    for (const area of ['health-overview', 'activity-map', 'training-hero']) {
      expect(isDeferredLoadArea(area)).toBe(true); expect(deferredLoadLabel(area)).toBe('Preview');
    }
  });
  it.each(['__proto__', 'constructor', 'toString', '/users/private-id', 'private exception', '', null, {}, 42])(
    'rejects arbitrary identifiers instead of displaying or reporting them (%j)', value => {
      expect(isDeferredLoadArea(value)).toBe(false); expect(deferredLoadLabel(value)).toBe('Content');
    });
});
