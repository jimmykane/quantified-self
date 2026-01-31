import { StatsClassInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';

/**
 * Converts intensity zones stats to chart data format.
 * @param statsClassInstances - Array of stats class instances
 * @param shortLabels - If true, uses short zone labels (Z1, Z2...) instead of full labels (Zone 1, Zone 2...)
 */
export function convertIntensityZonesStatsToChartData(
  statsClassInstances: StatsClassInterface[],
  shortLabels: boolean = false
): any[] {
  const statsTypeMap = ActivityUtilities.getIntensityZonesStatsAggregated(statsClassInstances).reduce((map: { [key: string]: number }, stat) => {
    map[stat.getType()] = stat.getValue() as any;
    return map;
  }, {})

  const zoneLabel = (num: number) => shortLabels ? `Z${num}` : `Zone ${num}`;

  return DynamicDataLoader.zoneStatsTypeMap.reduce((data: any[], statsToTypeMapEntry) => {
    statsToTypeMapEntry.stats.forEach((statType, index) => {
      const value = statsTypeMap[statType];
      if (value !== undefined && value > 0) {
        data.push({
          zone: zoneLabel(index + 1),
          type: statsToTypeMapEntry.type,
          [statsToTypeMapEntry.type]: value,
        });
      }
    });
    return data;
  }, []);
}

/**
 * Scans the chart data to find which types have non-zero values.
 * @param data - The chart data returned by convertIntensityZonesStatsToChartData
 * @returns A Set of types that have at least one non-zero value.
 */
export function getActiveDataTypes(data: any[]): Set<string> {
  const activeTypes = new Set<string>();
  if (!data) return activeTypes;

  data.forEach(entry => {
    const type = entry.type;
    const value = entry[type];
    if (typeof value === 'number' && value > 0) {
      activeTypes.add(type);
    }
  });
  return activeTypes;
}
