import {
  ActivityInterface, ActivityTypes, ActivityTypesHelper, DataActiveLap, DataActiveLengths,
  DataDistance, DataDuration, DataElapsedTime, DataEnergy, DataHeartRateAvg, DataHeartRateMax,
  DataInterface, DataTotalCycles, EventImporterJSON, LapInterface, LapTypes,
} from '@sports-alliance/sports-lib';
import { getRejectedSwimTiming, resolveSwimTiming } from '@shared/swim-timing';
import { AppSwimLength, getActivitySwimLengths, isRestSwimLength } from './event-swim-length.helper';
import { getSwimLengthDistance, getSwimLengthDuration, sumSwimValues } from './event-swim-analytics.helper';
import { setDerivedSwimIntervalLengths } from './event-swim-interval-metadata.helper';

function value(stat: DataInterface | void | null): number | null {
  const number = stat ? stat.getValue() : null;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

function total(lengths: readonly AppSwimLength[], read: (length: AppSwimLength) => number | null): number | null {
  const values = lengths.map(read);
  return values.every(number => number !== null && Number.isFinite(number) && number >= 0)
    ? sumSwimValues(values) : null;
}

/**
 * A table-only projection for pool recordings with ambiguous or missing lap membership.
 * Consecutive active lengths form a swim interval; consecutive idle lengths form a rest.
 * Never infer ownership from overlapping provider lap clocks, or rewrite source laps/lengths.
 * Complete, chronological length evidence is required; ordinary Garmin lap sequences stay native.
 */
export function getSwimIntervalActivity(activity: ActivityInterface): ActivityInterface | null {
  if (ActivityTypesHelper.resolveActivityType(activity.type) !== ActivityTypes.Swimming
    || !Number.isFinite(+activity.startDate) || !Number.isFinite(+activity.endDate)
    || +activity.endDate <= +activity.startDate) return null;
  const rawLengths = activity.getSwimLengths?.();
  const lengths = getActivitySwimLengths(activity);
  const activeCount = lengths.filter(length => !isRestSwimLength(length)).length;
  const recordedCount = value(activity.getStat?.(DataActiveLengths.type));
  if (!Array.isArray(rawLengths) || rawLengths.length !== lengths.length || !activeCount
    || recordedCount !== activeCount
    || lengths.some((length, index) => length.index !== index + 1
      || (length.type.toLowerCase() !== 'active' && !isRestSwimLength(length))
      || +length.endDate <= +length.startDate
      || +length.startDate < +activity.startDate || +length.endDate > +activity.endDate + 1000
      || (index > 0 && (+length.startDate <= +lengths[index - 1].startDate
        || Math.abs(+lengths[index - 1].endDate - +length.startDate) > 1000))
      || (isRestSwimLength(length) && length.distance && value(length.distance) !== 0))) return null;

  const nativeLaps = activity.getLaps?.() || [];
  // Missing rest membership does not invalidate the watch's active set boundaries.
  // A session-end record is a terminal segment/summary, not a parallel lap scheme.
  const hasUnassignedActiveLengths = lengths.some(length => !isRestSwimLength(length)
    && (!Number.isInteger(length.lapIndex) || length.lapIndex < 1 || length.lapIndex > nativeLaps.length));
  const schemeLaps = nativeLaps.filter(lap => lap.type !== LapTypes.session_end);
  const hasParallelLaps = schemeLaps.some((lap, index) => schemeLaps.slice(index + 1).some(other =>
    lap.type !== other.type && Math.min(+lap.endDate, +other.endDate) - Math.max(+lap.startDate, +other.startDate) > 1000));
  if (!hasUnassignedActiveLengths && !hasParallelLaps) return null;

  const groups: AppSwimLength[][] = [];
  for (const length of lengths) {
    const group = groups[groups.length - 1];
    if (group && isRestSwimLength(group[0]) === isRestSwimLength(length)) group.push(length);
    else groups.push([length]);
  }
  const laps: LapInterface[] = [];
  const intervalLengths: AppSwimLength[] = [];
  groups.forEach((group, index) => {
    const rest = isRestSwimLength(group[0]);
    const lap = EventImporterJSON.getLapFromJSON({
      startDate: +group[0].startDate, endDate: +group[group.length - 1].endDate,
      lapId: index + 1, type: LapTypes.Interval, stats: {}, startIndex: null, endIndex: null,
    }, index);
    setDerivedSwimIntervalLengths(lap, group);
    lap.addStat(new DataActiveLap(!rest));
    lap.addStat(new DataActiveLengths(rest ? 0 : group.length));
    const duration = total(group, getSwimLengthDuration);
    const elapsed = total(group, length => resolveSwimTiming(length).elapsedTime);
    const distance = rest ? 0 : total(group, getSwimLengthDistance);
    const strokes = rest ? null : total(group, length => length.strokes);
    const energy = total(group, length => value(length.calories));
    if (duration !== null) lap.addStat(new DataDuration(duration));
    if (elapsed !== null) lap.addStat(new DataElapsedTime(elapsed));
    if (distance !== null) lap.addStat(new DataDistance(distance));
    if (strokes !== null) lap.addStat(new DataTotalCycles(strokes));
    if (energy !== null) lap.addStat(new DataEnergy(energy));
    const rejected = group.map(getRejectedSwimTiming).find(Boolean);
    if (rejected) lap.timingValidity = rejected;
    const heartRates = group.map(length => ({ heartRate: value(length.avgHeartRate), duration: getSwimLengthDuration(length) }));
    if (duration > 0 && heartRates.every(item => item.heartRate !== null && item.duration !== null)) {
      lap.addStat(new DataHeartRateAvg(sumSwimValues(heartRates.map(item => item.heartRate * item.duration)) / duration));
    }
    const maxima = group.map(length => value(length.maxHeartRate));
    if (maxima.every(number => number !== null)) lap.addStat(new DataHeartRateMax(Math.max(...maxima)));
    laps.push(lap);
    intervalLengths.push(...group.map(length => ({ ...length, lapIndex: index + 1 })));
  });

  // Read-only view adapter: preserve session stats/streams for the existing whole-session
  // peak calculation. Only table consumers receive it; persistence and chart markers use source.
  const sourceMaxima = [activity, ...nativeLaps.filter(lap => +lap.startDate >= +activity.startDate
    && +lap.endDate <= +activity.endDate)].map(record => value(record.getStat?.(DataHeartRateMax.type)))
    .filter((maximum): maximum is number => maximum !== null);
  const sourceMaximum = sourceMaxima.length ? new DataHeartRateMax(Math.max(...sourceMaxima)) : null;
  return Object.create(activity, {
    getStat: { value: (type: string) => type === DataHeartRateMax.type && sourceMaximum
      ? sourceMaximum : activity.getStat(type) },
    getLaps: { value: () => laps },
    getSwimLengths: { value: () => intervalLengths },
  }) as ActivityInterface;
}
