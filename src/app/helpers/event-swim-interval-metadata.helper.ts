import type { LapInterface } from '@sports-alliance/sports-lib/metrics';
import type { AppSwimLength } from './event-swim-length.helper';

// Shared formatters also run in the chart worker. Keep this registry independent of
// the interval constructor and Sports Lib's file importers so they stay out of that bundle.
const intervalLengthsByLap = new WeakMap<LapInterface, readonly AppSwimLength[]>();

export function setDerivedSwimIntervalLengths(lap: LapInterface, lengths: readonly AppSwimLength[]): void {
  intervalLengthsByLap.set(lap, lengths);
}

/** Only locally constructed display intervals qualify for nominal length-count formatting. */
export function getDerivedSwimIntervalLengths(lap: LapInterface): readonly AppSwimLength[] | undefined {
  return intervalLengthsByLap.get(lap);
}
