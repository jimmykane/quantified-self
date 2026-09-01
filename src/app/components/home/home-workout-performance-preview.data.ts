import {
  type ActivityInterface,
  ActivityTypes,
  DataCadence,
  DataHeartRate,
  DataPower,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';

interface HomeWorkoutPerformancePreviewOptions {
  durationSeconds: number;
  heartRateBins: readonly number[];
  powerBins: readonly number[];
}

function expandWorkoutBins(values: readonly number[], durationSeconds: number): number[] {
  if (values.length < 2 || durationSeconds < 2) {
    return [...values];
  }

  const finalBinIndex = values.length - 1;
  return Array.from({ length: durationSeconds }, (_, second) => {
    const position = (second / (durationSeconds - 1)) * finalBinIndex;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(finalBinIndex, lowerIndex + 1);
    const progress = position - lowerIndex;
    return Math.round(values[lowerIndex] + ((values[upperIndex] - values[lowerIndex]) * progress));
  });
}

function buildCadenceStream(power: readonly number[]): number[] {
  return power.map((watts, index) => {
    const naturalVariation = (Math.sin(index / 41) * 3.5) + (Math.sin(index / 113) * 2);
    return Math.round(Math.min(104, Math.max(62, 77 + (watts * 0.045) + naturalVariation)));
  });
}

function countZoneDurations(values: readonly number[], lowerLimits: readonly number[]): number[] {
  const durations = Array.from({ length: lowerLimits.length + 1 }, () => 0);
  values.forEach((value) => {
    const firstUpperLimit = lowerLimits.findIndex(limit => value < limit);
    const zoneIndex = firstUpperLimit === -1 ? lowerLimits.length : firstUpperLimit;
    durations[zoneIndex] += 1;
  });
  return durations;
}

export function buildHomeWorkoutPerformancePreviewActivity(
  options: HomeWorkoutPerformancePreviewOptions,
): ActivityInterface {
  const startDate = new Date('2026-06-14T06:30:00.000Z');
  const endDate = new Date(startDate.getTime() + (options.durationSeconds * 1_000));
  const heartRate = expandWorkoutBins(options.heartRateBins, options.durationSeconds);
  const power = expandWorkoutBins(options.powerBins, options.durationSeconds);
  const cadence = buildCadenceStream(power);
  const heartRateZoneDurations = countZoneDurations(heartRate, [107, 125, 142, 160]);
  const powerZoneDurations = countZoneDurations(power, [100, 150, 200, 250, 300, 350]);
  const stats = new Map<string, { getValue: () => number }>();
  const addZoneStats = (seriesType: string, durations: readonly number[]): void => {
    const zoneTypes = DynamicDataLoader.zoneStatsTypeMap.find(entry => entry.type === seriesType)?.stats ?? [];
    zoneTypes.forEach((zoneType, index) => {
      stats.set(zoneType, { getValue: () => durations[index] ?? 0 });
    });
  };
  addZoneStats(DataHeartRate.type, heartRateZoneDurations);
  addZoneStats(DataPower.type, powerZoneDurations);

  const streams = new Map<string, number[]>([
    [DataHeartRate.type, heartRate],
    [DataPower.type, power],
    [DataCadence.type, cadence],
  ]);
  const activity = {
    name: 'Morning Ride',
    type: ActivityTypes.Cycling,
    creator: { name: 'Garmin Edge', devices: [] },
    startDate,
    endDate,
    getID: () => 'home-workout-performance-preview',
    getDuration: () => ({ getValue: () => options.durationSeconds }),
    getStat: (statType: string) => stats.get(statType),
    getStreamData: (streamType: string) => streams.get(streamType) ?? [],
    getStream: (streamType: string) => {
      const data = streams.get(streamType);
      if (!data) {
        throw new Error(`Preview stream ${streamType} is unavailable`);
      }
      return { getData: () => data };
    },
  };

  // The homepage fixture intentionally implements only the read surface used by the
  // production performance-chart helpers; it never enters persistence or event editing.
  return activity as unknown as ActivityInterface;
}
