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
  const statsTypeMap = ActivityUtilities.getIntensityZonesStatsAggregated(statsClassInstances).reduce((map, stat) => {
    map[stat.getType()] = stat.getValue()
    return map;
  }, {})

  const zoneLabel = (num: number) => shortLabels ? `Z${num}` : `Zone ${num}`;

  return DynamicDataLoader.zoneStatsTypeMap.reduce((data, statsToTypeMapEntry) => {
    data.push({
      zone: zoneLabel(1),
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[0]],
    }, {
      zone: zoneLabel(2),
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[1]],
    }, {
      zone: zoneLabel(3),
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[2]],
    }, {
      zone: zoneLabel(4),
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[3]],
    }, {
      zone: zoneLabel(5),
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[4]],
    });
    return data;
  }, []);
}
