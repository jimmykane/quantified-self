export const POWER_CURVE_STAT_TYPE = 'PowerCurve';
export const POWER_CURVE_DROPPED_POINT_SAMPLE_LIMIT = 5;

export interface PowerCurvePoint {
  duration: number;
  power: number;
  wattsPerKg?: number;
}

export interface DroppedPowerCurvePointSample {
  rawPointType: string;
  durationType?: string;
  powerType?: string;
  wattsPerKgType?: string;
}

export interface NormalizePowerCurvePointsResult {
  points: PowerCurvePoint[];
  droppedPointCount: number;
  droppedPointSamples: DroppedPowerCurvePointSample[];
}

export function describePowerCurveValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'object') {
    const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
    return constructorName ? `object:${constructorName}` : 'object';
  }
  return typeof value;
}

export function toPowerCurveFiniteNumber(value: unknown): number | null {
  return resolvePowerCurveFiniteNumber(value, new Set<object>());
}

function resolvePowerCurveFiniteNumber(value: unknown, seenObjects: Set<object>): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (seenObjects.has(value)) {
    return null;
  }
  seenObjects.add(value);

  const rawValue = (value as { getValue?: () => unknown }).getValue?.();
  if (rawValue !== undefined) {
    const resolvedValue = resolvePowerCurveFiniteNumber(rawValue, seenObjects);
    if (resolvedValue !== null) {
      return resolvedValue;
    }
  }

  for (const nestedCandidate of Object.values(value as Record<string, unknown>)) {
    const resolvedValue = resolvePowerCurveFiniteNumber(nestedCandidate, seenObjects);
    if (resolvedValue !== null) {
      return resolvedValue;
    }
  }
  return null;
}

export function normalizePowerCurvePoints(statValue: unknown): NormalizePowerCurvePointsResult {
  if (!Array.isArray(statValue)) {
    if (statValue === null || statValue === undefined) {
      return {
        points: [],
        droppedPointCount: 0,
        droppedPointSamples: [],
      };
    }

    return {
      points: [],
      droppedPointCount: 1,
      droppedPointSamples: [{
        rawPointType: `stat_value_${describePowerCurveValueType(statValue)}`,
      }],
    };
  }

  const pointsByDuration = new Map<number, PowerCurvePoint>();
  const droppedPointSamples: DroppedPowerCurvePointSample[] = [];
  let droppedPointCount = 0;

  statValue.forEach((rawPoint) => {
    if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) {
      droppedPointCount += 1;
      pushDroppedPowerCurvePointSample(droppedPointSamples, {
        rawPointType: describePowerCurveValueType(rawPoint),
      });
      return;
    }

    const point = rawPoint as { duration?: unknown; power?: unknown; wattsPerKg?: unknown };
    const duration = toPowerCurveFiniteNumber(point.duration);
    const power = toPowerCurveFiniteNumber(point.power);
    const wattsPerKg = toPowerCurveFiniteNumber(point.wattsPerKg);
    if (!duration || duration <= 0 || !power || power <= 0) {
      droppedPointCount += 1;
      pushDroppedPowerCurvePointSample(droppedPointSamples, {
        rawPointType: 'object',
        durationType: describePowerCurveValueType(point.duration),
        powerType: describePowerCurveValueType(point.power),
        wattsPerKgType: describePowerCurveValueType(point.wattsPerKg),
      });
      return;
    }

    const normalizedPoint: PowerCurvePoint = {
      duration: Number(duration),
      power: Number(power),
    };
    if (wattsPerKg && wattsPerKg > 0) {
      normalizedPoint.wattsPerKg = Number(wattsPerKg);
    }

    const existingPoint = pointsByDuration.get(normalizedPoint.duration);
    if (isPowerCurvePointBetter(normalizedPoint, existingPoint)) {
      pointsByDuration.set(normalizedPoint.duration, normalizedPoint);
    }
  });

  return {
    points: [...pointsByDuration.values()].sort((left, right) => left.duration - right.duration),
    droppedPointCount,
    droppedPointSamples,
  };
}

export function buildPowerCurveEnvelope(pointsCollection: readonly PowerCurvePoint[][]): PowerCurvePoint[] {
  const pointsByDuration = new Map<number, PowerCurvePoint>();

  pointsCollection.forEach((points) => {
    points.forEach((point) => {
      const existingPoint = pointsByDuration.get(point.duration);
      if (isPowerCurvePointBetter(point, existingPoint)) {
        pointsByDuration.set(point.duration, { ...point });
      }
    });
  });

  return [...pointsByDuration.values()].sort((left, right) => left.duration - right.duration);
}

function pushDroppedPowerCurvePointSample(
  samples: DroppedPowerCurvePointSample[],
  sample: DroppedPowerCurvePointSample,
): void {
  if (samples.length >= POWER_CURVE_DROPPED_POINT_SAMPLE_LIMIT) {
    return;
  }
  samples.push(sample);
}

function isPowerCurvePointBetter(
  candidate: PowerCurvePoint,
  existing: PowerCurvePoint | null | undefined,
): boolean {
  if (!existing || candidate.power > existing.power) {
    return true;
  }
  return candidate.power === existing.power
    && (candidate.wattsPerKg ?? 0) > (existing.wattsPerKg ?? 0);
}
