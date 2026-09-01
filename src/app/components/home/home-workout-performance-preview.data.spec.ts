import { describe, expect, it } from 'vitest';
import { convertIntensityZonesStatsToEchartsData } from '../../helpers/intensity-zones-chart-data-helper';
import { PerformanceCurveDataService } from '../../services/performance-curve-data.service';
import { buildHomeWorkoutPerformancePreviewActivity } from './home-workout-performance-preview.data';

describe('home workout performance preview data', () => {
  it('feeds the production durability, cadence-power, and intensity-zone data paths', () => {
    const activity = buildHomeWorkoutPerformancePreviewActivity({
      durationSeconds: 2_700,
      heartRateBins: [112, 126, 138, 145, 151, 158, 154, 149],
      powerBins: [180, 205, 225, 240, 218, 260, 235, 210],
    });
    const performanceData = new PerformanceCurveDataService();
    const durability = performanceData.buildDurabilitySeries([activity]);
    const cadencePower = performanceData.buildCadencePowerSeries([activity]);
    const intensityZones = convertIntensityZonesStatsToEchartsData([activity]);

    expect(durability).toHaveLength(1);
    expect(durability[0].points.length).toBeGreaterThan(20);
    expect(cadencePower).toHaveLength(1);
    expect(cadencePower[0].points.length).toBeGreaterThan(20);
    expect(intensityZones.series.map(series => series.type)).toEqual(['Heart Rate', 'Power']);
    expect(intensityZones.series.every(series => series.values.some(value => value > 0))).toBe(true);
  });
});
