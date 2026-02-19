import { describe, expect, it } from 'vitest';
import { JumpHeatmapWeightingService } from './jump-heatmap-weighting.service';

describe('JumpHeatmapWeightingService', () => {
  it('should combine hang time and distance into weighted feature heat values', () => {
    const service = new JumpHeatmapWeightingService();
    const featureCollection = service.buildWeightedFeatureCollection([
      { lng: 10, lat: 20, hangTime: 1, distance: 2 },
      { lng: 11, lat: 21, hangTime: 3, distance: 6 },
    ]);

    expect(featureCollection.features.length).toBe(2);
    expect(featureCollection.features[0].properties.heatWeight).toBeGreaterThanOrEqual(0);
    expect(featureCollection.features[0].properties.heatWeight).toBeLessThanOrEqual(1);
    expect(featureCollection.features[1].properties.heatWeight).toBeGreaterThanOrEqual(0);
    expect(featureCollection.features[1].properties.heatWeight).toBeLessThanOrEqual(1);
  });

  it('should use a single available metric when the other one is missing', () => {
    const service = new JumpHeatmapWeightingService();
    const featureCollection = service.buildWeightedFeatureCollection([
      { lng: 10, lat: 20, hangTime: 2, distance: null },
      { lng: 11, lat: 21, hangTime: null, distance: 4 },
      { lng: 12, lat: 22, hangTime: null, distance: null },
    ]);

    expect(featureCollection.features.length).toBe(2);
  });
});

