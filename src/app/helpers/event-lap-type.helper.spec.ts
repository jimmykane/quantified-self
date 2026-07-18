import { ActivityInterface, LapInterface, LapTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildAllowedEventLapTypeSet,
  hasVisibleEventLaps,
  isEventLapTypeAllowed,
  normalizeEventLapType,
} from './event-lap-type.helper';

function createActivityWithLapTypes(types: Array<LapTypes | string | null | undefined>): ActivityInterface {
  return {
    getLaps: () => types.map((type) => ({ type }) as LapInterface),
  } as ActivityInterface;
}

describe('event lap type helper', () => {
  it('normalizes known aliases and preserves custom lap types', () => {
    expect(normalizeEventLapType('auto')).toBe(LapTypes.AutoLap);
    expect(normalizeEventLapType('Custom Lap')).toBe('Custom Lap');
  });

  it('filters missing, blank, and excluded lap types', () => {
    expect(isEventLapTypeAllowed(undefined, [])).toBe(false);
    expect(isEventLapTypeAllowed(null, [])).toBe(false);
    expect(isEventLapTypeAllowed('   ', [])).toBe(false);
    expect(isEventLapTypeAllowed(LapTypes.session_end, [])).toBe(false);
    expect(isEventLapTypeAllowed(LapTypes.Manual, [])).toBe(true);
  });

  it('builds an allowlist without missing or excluded lap types', () => {
    expect(buildAllowedEventLapTypeSet([
      undefined,
      ' ',
      LapTypes.session_end,
      LapTypes.Manual,
    ])).toEqual(new Set([LapTypes.Manual]));
  });

  it('only reports visible laps when at least one lap has a renderable type', () => {
    expect(hasVisibleEventLaps([
      createActivityWithLapTypes([undefined, null, ' ', LapTypes.session_end]),
    ])).toBe(false);
    expect(hasVisibleEventLaps([
      createActivityWithLapTypes([undefined, LapTypes.Manual]),
    ])).toBe(true);
  });
});
