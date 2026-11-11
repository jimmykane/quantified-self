import { describe, expect, it } from 'vitest';
import { createTerrainGeometry } from './onboarding-terrain.geometry';

describe('onboarding terrain geometry', () => {
  const geometry = createTerrainGeometry();

  it('creates a finite, indexed landscape and contours', () => {
    expect(geometry.vertices.length).toBeGreaterThan(100_000);
    expect(geometry.vertices.every(Number.isFinite)).toBe(true);
    expect(geometry.uvs.length).toBe(geometry.vertices.length / 3 * 2);
    expect(geometry.uvs.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(geometry.contours.every(Number.isFinite)).toBe(true);
    expect(
      geometry.indices.every((index) => index < geometry.vertices.length / 3)
    ).toBe(true);
    expect(geometry.indices.length % 3).toBe(0);
  });

  it('keeps the highlight on one connected elevation contour without crossing the mountain', () => {
    const { highlight, progress } = geometry;
    expect(progress.length).toBeGreaterThan(20);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 0; i < progress.length; i++) {
      expect(highlight[i * 3 + 1]).toBeCloseTo(2.762, 4);
      if (i === 0) continue;
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
      expect(
        Math.hypot(
          highlight[i * 3] - highlight[(i - 1) * 3],
          highlight[i * 3 + 2] - highlight[(i - 1) * 3 + 2]
        )
      ).toBeLessThan(0.5);
    }
    expect(geometry.span).toBeGreaterThan(0);
    expect(geometry.span).toBeLessThanOrEqual(0.15);
    expect(geometry.startProgress).toBeGreaterThan(0);
    expect(geometry.startProgress).toBeLessThan(1);
  });
});
