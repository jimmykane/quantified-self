import {
  DataCadenceAvg, DataDistance, DataDuration, DataElapsedTime, DataEnergy,
  DataHeartRateAvg, DataHeartRateMax, DataHeartRateMin, DataInterface,
  DataMovingTime, DataStrokeRateAvg, DataTimerTime, DynamicDataLoader, LapInterface,
} from '@sports-alliance/sports-lib';
import { AppSwimLength, getRecordedLapActive, isRestSwimLength } from './event-swim-length.helper';
import { isRestSwimLap, sumSwimValues } from './event-swim-analytics.helper';

export interface SwimRestBlockMetric {
  stat: DataInterface;
  availableCount: number;
}

function value(stat: DataInterface | void): number | null {
  const number = stat ? stat.getValue?.() : null;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

function canGroup(lap: LapInterface, lengths: readonly AppSwimLength[]): boolean {
  return isRestSwimLap(lap, lengths)
    && (getRecordedLapActive(lap) === false || (lengths.length > 0 && lengths.every(isRestSwimLength)))
    && value(lap.getDistance?.()) === 0 && value(lap.getDuration?.()) !== null
    && Number.isFinite(lap.startDate?.getTime()) && Number.isFinite(lap.endDate?.getTime())
    && lap.endDate > lap.startDate;
}

/** Use the complete recorded lap sequence: filtering first could hide an active set boundary.
 * Unknown timing, gaps and overlapping windows remain separate. No rounding tolerance is inferred.
 */
export function groupSwimRestLaps(
  laps: readonly LapInterface[], lengthsByLap: ReadonlyMap<LapInterface, readonly AppSwimLength[]>,
): LapInterface[][] {
  const groups: LapInterface[][] = [];
  for (const lap of laps) {
    const previous = groups[groups.length - 1];
    const last = previous?.[previous.length - 1];
    if (last && lap.type === last.type && last.endDate?.getTime() === lap.startDate?.getTime()
      && canGroup(last, lengthsByLap.get(last) || []) && canGroup(lap, lengthsByLap.get(lap) || [])) {
      previous.push(lap);
    } else {
      groups.push([lap]);
    }
  }
  return groups;
}

/** Display-only totals. HR averages are estimates weighted by recorded lap timer duration.
 * Missing HR never becomes zero; coverage describes contributing original laps.
 */
export function getSwimRestBlockMetric(laps: readonly LapInterface[], type: string): SwimRestBlockMetric | null {
  if (!laps.length) return null;
  if (type === DataDistance.type) return { stat: new DataDistance(0), availableCount: laps.length };
  const values = laps.map(lap => value(type === DataDuration.type ? lap.getDuration?.() : lap.getStat?.(type)));
  const totals = [DataDuration.type, DataTimerTime.type, DataElapsedTime.type, DataMovingTime.type, DataEnergy.type];
  if (totals.includes(type)) {
    return values.every(number => number !== null)
      ? { stat: DynamicDataLoader.getDataInstanceFromDataType(type, sumSwimValues(values)), availableCount: laps.length }
      : null;
  }
  if ([DataCadenceAvg.type, DataStrokeRateAvg.type].includes(type)) {
    return values.every(number => number === 0)
      ? { stat: DynamicDataLoader.getDataInstanceFromDataType(type, 0), availableCount: laps.length } : null;
  }
  if (![DataHeartRateAvg.type, DataHeartRateMin.type, DataHeartRateMax.type].includes(type)) return null;
  const available = values.flatMap((number, index) => {
    const duration = value(laps[index].getDuration?.());
    return number !== null && number > 0 && (type !== DataHeartRateAvg.type || duration > 0)
      ? [{ number, duration }] : [];
  });
  if (!available.length) return null;
  const result = type === DataHeartRateAvg.type
    ? sumSwimValues(available.map(item => item.number * item.duration)) / sumSwimValues(available.map(item => item.duration))
    : type === DataHeartRateMax.type ? Math.max(...available.map(item => item.number))
      : Math.min(...available.map(item => item.number));
  return { stat: DynamicDataLoader.getDataInstanceFromDataType(type, result), availableCount: available.length };
}
