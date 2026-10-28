import {
  ActivityInterface, DataActiveLengths, DataDistance, DataDuration, DataPoolLength, LapInterface, LapTypes, Stream, XAxisTypes,
} from '@sports-alliance/sports-lib';

/** Authored numeric records only; no retained activity or provider identifiers. */
export function createNominalYardPoolFixture(
  count = 4, nominal = 25, overrides: { pool?: number; elapsed?: number; speed?: number; total?: number } = {},
) {
  const pool = overrides.pool ?? (nominal === 25 ? 25.04 * 0.9144 : 49.98 * 0.9144);
  const elapsed = overrides.elapsed ?? (nominal === 25 ? 30 : 20);
  const speed = overrides.speed ?? (nominal === 25 ? 0.762 : 2.286);
  const rawLengths = Array.from({ length: count }, (_, index) => ({ index: index + 1, lapIndex: 1,
    startDate: index * elapsed * 1000, endDate: (index + 1) * elapsed * 1000, type: 'active',
    timerTime: elapsed, elapsedTime: elapsed, distance: pool, poolLength: pool, avgSpeed: speed, strokes: 10 }));
  const lap = { type: LapTypes.Manual, startDate: new Date(0), endDate: new Date(count * elapsed * 1000),
    getDistance: () => new DataDistance(Math.round(count * nominal * 0.9144 * 10) / 10),
    getDuration: () => new DataDuration(count * elapsed), getStat: () => undefined, getStatsAsArray: () => [],
  } as unknown as LapInterface;
  const time = new Stream(XAxisTypes.Time, Array.from({ length: count * elapsed + 1 }, (_, index) => index));
  const activity = { startDate: new Date(0), endDate: new Date(count * elapsed * 1000),
    type: 'Swimming', creator: { name: 'Suunto synthetic' }, getID: () => 'authored-swim',
    getSwimLengths: () => rawLengths, getLaps: () => [lap], getAllStreams: () => [time],
    getStream: (type: string) => type === XAxisTypes.Time ? time : undefined,
    getDistance: () => new DataDistance(overrides.total ?? count * nominal * 0.9144),
    getStat: (type: string) => type === DataPoolLength.type ? new DataPoolLength(pool)
      : type === DataActiveLengths.type ? new DataActiveLengths(count) : undefined,
  } as unknown as ActivityInterface;
  return { activity, rawLengths, lap };
}
