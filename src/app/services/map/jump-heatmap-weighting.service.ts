import { Injectable } from '@angular/core';

export interface JumpHeatPointInput {
  lng: number;
  lat: number;
  hangTime: number | null;
  distance: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class JumpHeatmapWeightingService {
  public static readonly HANGTIME_WEIGHT = 0.7;
  public static readonly DISTANCE_WEIGHT = 0.3;

  public buildWeightedFeatureCollection(points: JumpHeatPointInput[]): { type: 'FeatureCollection'; features: any[] } {
    const hangTimes = (points || [])
      .map((point) => point.hangTime)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const distances = (points || [])
      .map((point) => point.distance)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const hangTimeRange = this.getMetricRange(hangTimes);
    const distanceRange = this.getMetricRange(distances);

    const features = (points || []).reduce<any[]>((featureArray, point) => {
      const normalizedHangTime = this.normalizeMetric(point.hangTime, hangTimeRange);
      const normalizedDistance = this.normalizeMetric(point.distance, distanceRange);

      let heatWeight: number | null = null;
      if (normalizedHangTime !== null && normalizedDistance !== null) {
        heatWeight = normalizedHangTime * JumpHeatmapWeightingService.HANGTIME_WEIGHT
          + normalizedDistance * JumpHeatmapWeightingService.DISTANCE_WEIGHT;
      } else if (normalizedHangTime !== null) {
        heatWeight = normalizedHangTime;
      } else if (normalizedDistance !== null) {
        heatWeight = normalizedDistance;
      }

      if (heatWeight === null) return featureArray;

      featureArray.push({
        type: 'Feature',
        properties: {
          heatWeight: Math.max(0, Math.min(1, heatWeight))
        },
        geometry: {
          type: 'Point',
          coordinates: [point.lng, point.lat]
        }
      });
      return featureArray;
    }, []);

    return {
      type: 'FeatureCollection',
      features
    };
  }

  private getMetricRange(values: number[]): { min: number; max: number } | null {
    if (!values.length) return null;
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  private normalizeMetric(value: number | null, range: { min: number; max: number } | null): number | null {
    if (value === null || !range) return null;
    if (range.min === range.max) return 1;
    const normalizedValue = (value - range.min) / (range.max - range.min);
    if (!Number.isFinite(normalizedValue)) return null;
    return Math.max(0, Math.min(1, normalizedValue));
  }
}

