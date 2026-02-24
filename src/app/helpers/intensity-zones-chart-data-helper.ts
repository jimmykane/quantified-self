import { StatsClassInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';

export interface IntensityZonesEChartsSeries {
  type: string;
  values: number[];
  percentages: number[];
}

export interface IntensityZonesEChartsData {
  zones: string[];
  series: IntensityZonesEChartsSeries[];
}

function getZoneStatsValueMap(statsClassInstances?: StatsClassInterface[] | null): Record<string, number> {
  const safeStatsClassInstances = Array.isArray(statsClassInstances) ? statsClassInstances : [];

  return ActivityUtilities.getIntensityZonesStatsAggregated(safeStatsClassInstances).reduce((map: Record<string, number>, stat) => {
    const value = stat.getValue();
    map[stat.getType()] = typeof value === 'number' ? value : 0;
    return map;
  }, {});
}

/**
 * Converts intensity zones stats to chart data format.
 * @param statsClassInstances - Array of stats class instances
 * @param shortLabels - If true, uses short zone labels (Z1, Z2...) instead of full labels (Zone 1, Zone 2...)
 */
export function convertIntensityZonesStatsToChartData(
  statsClassInstances?: StatsClassInterface[] | null,
  shortLabels: boolean = false
): any[] {
  const statsTypeMap = getZoneStatsValueMap(statsClassInstances);

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
 * Converts intensity zone stats to deterministic series data for ECharts.
 * Keeps zone and series ordering stable based on `DynamicDataLoader.zoneStatsTypeMap`.
 */
export function convertIntensityZonesStatsToEchartsData(
  statsClassInstances?: StatsClassInterface[] | null,
  shortLabels: boolean = false
): IntensityZonesEChartsData {
  const statsTypeMap = getZoneStatsValueMap(statsClassInstances);
  const zoneLabel = (num: number) => shortLabels ? `Z${num}` : `Zone ${num}`;

  const byType = DynamicDataLoader.zoneStatsTypeMap.map(statsToTypeMapEntry => ({
    type: statsToTypeMapEntry.type,
    values: statsToTypeMapEntry.stats.map(statType => {
      const value = statsTypeMap[statType];
      return typeof value === 'number' ? value : 0;
    })
  }));

  const activeSeries = byType.filter(typeEntry => typeEntry.values.some(value => value > 0));
  const maxConfiguredZoneCount = DynamicDataLoader.zoneStatsTypeMap.reduce((max, statsToTypeMapEntry) => {
    return Math.max(max, statsToTypeMapEntry.stats.length);
  }, 0);
  const orderedZoneIndexes = activeSeries.length > 0
    ? Array.from({ length: maxConfiguredZoneCount }, (_, i) => i)
    : [];

  const zones = orderedZoneIndexes.map(index => zoneLabel(index + 1));

  const series: IntensityZonesEChartsSeries[] = activeSeries.map(typeEntry => {
    const values = orderedZoneIndexes.map(index => typeEntry.values[index] ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const percentages = values.map(value => total > 0 ? (value / total) * 100 : 0);

    return {
      type: typeEntry.type,
      values,
      percentages
    };
  });

  return {
    zones,
    series
  };
}

/**
 * Determines whether an intensity-zones chart is meaningful enough to render.
 * Hides charts only when there is no intensity-zone data at all.
 */
export function shouldRenderIntensityZonesChart(statsClassInstances?: StatsClassInterface[] | null): boolean {
  const statsTypeMap = getZoneStatsValueMap(statsClassInstances);

  let hasActiveSeries = false;
  const activeZoneIndexes = DynamicDataLoader.zoneStatsTypeMap.reduce((indexes: Set<number>, statsToTypeMapEntry) => {
    const seriesHasData = statsToTypeMapEntry.stats.some((statType, zoneIndex) => {
      const value = statsTypeMap[statType];
      if (typeof value === 'number' && value > 0) {
        indexes.add(zoneIndex);
        return true;
      }
      return false;
    });

    if (seriesHasData) {
      hasActiveSeries = true;
    }

    return indexes;
  }, new Set<number>());

  return hasActiveSeries && activeZoneIndexes.size > 0;
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
