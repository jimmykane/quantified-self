import { StatsClassInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';

export function convertIntensityZonesStatsToChartData(statsClassInstances: StatsClassInterface[]): any[] {
  const statsTypeMap = ActivityUtilities.getIntensityZonesStatsAggregated(statsClassInstances).reduce((map, stat) => {
    map[stat.getType()] = stat.getValue()
    return map;
  }, {})
  return DynamicDataLoader.zoneStatsTypeMap.reduce((data, statsToTypeMapEntry) => {
    data.push({
      zone: `Zone 1`,
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[0]],
    }, {
      zone: `Zone 2`,
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[1]],
    }, {
      zone: `Zone 3`,
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[2]],
    }, {
      zone: `Zone 4`,
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[3]],
    }, {
      zone: `Zone 5`,
      type: statsToTypeMapEntry.type,
      [statsToTypeMapEntry.type]: statsTypeMap[statsToTypeMapEntry.stats[4]],
    });
    return data;
  }, []);
}
