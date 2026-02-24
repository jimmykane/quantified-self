import { describe, expect, it, vi } from 'vitest';
import { PolylineSimplificationService } from './polyline-simplification.service';

function buildSinePolyline(totalPoints: number): number[][] {
  return Array.from({ length: totalPoints }, (_, index) => [index, Math.sin(index / 12)]);
}

describe('PolylineSimplificationService', () => {
  it('should simplify a dense polyline using target keep ratio', () => {
    const service = new PolylineSimplificationService();
    const coordinates = buildSinePolyline(200);

    const result = service.simplifyVisvalingamWhyatt(coordinates, {
      keepRatio: 0.35,
      minInputPoints: 2,
      minPointsToKeep: 2,
    });

    expect(result.simplified).toBe(true);
    expect(result.inputPointCount).toBe(200);
    expect(result.outputPointCount).toBe(70);
    expect(result.coordinates.length).toBe(70);
  });

  it('should keep start and end points when simplifying', () => {
    const service = new PolylineSimplificationService();
    const coordinates = buildSinePolyline(240);

    const result = service.simplifyVisvalingamWhyatt(coordinates, {
      keepRatio: 0.4,
      minInputPoints: 2,
      minPointsToKeep: 2,
    });

    expect(result.simplified).toBe(true);
    expect(result.coordinates[0]).toEqual(coordinates[0]);
    expect(result.coordinates[result.coordinates.length - 1]).toEqual(coordinates[coordinates.length - 1]);
  });

  it('should skip simplification when minInputPoints is not met', () => {
    const service = new PolylineSimplificationService();
    const coordinates = buildSinePolyline(80);

    const result = service.simplifyVisvalingamWhyatt(coordinates, {
      keepRatio: 0.2,
      minInputPoints: 120,
      minPointsToKeep: 2,
    });

    expect(result.simplified).toBe(false);
    expect(result.inputPointCount).toBe(80);
    expect(result.outputPointCount).toBe(80);
    expect(result.coordinates).toBe(coordinates);
  });

  it('should clamp unsafe options and return original when target does not reduce points', () => {
    const service = new PolylineSimplificationService();
    const coordinates = buildSinePolyline(160);

    const result = service.simplifyVisvalingamWhyatt(coordinates, {
      keepRatio: -1,
      minInputPoints: 0,
      minPointsToKeep: -100,
    });

    expect(result.simplified).toBe(false);
    expect(result.inputPointCount).toBe(160);
    expect(result.outputPointCount).toBe(160);
    expect(result.coordinates).toBe(coordinates);
  });

  it('should return original coordinates when vis-why execution fails', () => {
    const service = new PolylineSimplificationService();
    const coordinates = buildSinePolyline(180);

    vi.spyOn(service as any, 'runVisvalingamWhyatt').mockImplementation(() => {
      throw new Error('boom');
    });

    const result = service.simplifyVisvalingamWhyatt(coordinates, {
      keepRatio: 0.25,
      minInputPoints: 2,
      minPointsToKeep: 2,
    });

    expect(result.simplified).toBe(false);
    expect(result.inputPointCount).toBe(180);
    expect(result.outputPointCount).toBe(180);
    expect(result.coordinates).toBe(coordinates);
  });
});
