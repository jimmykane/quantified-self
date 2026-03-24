import { DataDuration, DataPower } from '@sports-alliance/sports-lib';

const DEFAULT_MOBILE_MAX_LABEL_CONFIG = [
  { width: 360, count: 5 },
  { width: 430, count: 6 },
  { width: 600, count: 8 },
];

const DEFAULT_ANCHOR_DURATIONS = [1, 5, 15, 30, 60, 300, 1200, 3600, 7200];

interface MobileMaxLabelConfigEntry {
  width: number;
  count: number;
}

interface BuildPowerCurveVisibleDurationLabelSetOptions {
  isMobile: boolean;
  chartWidth: number;
  mobileMaxLabelConfig?: MobileMaxLabelConfigEntry[];
  anchorDurations?: number[];
}

function resolveMobileMaxLabelCount(
  chartWidth: number,
  mobileMaxLabelConfig: MobileMaxLabelConfigEntry[],
): number {
  const effectiveWidth = chartWidth > 0 ? chartWidth : 360;
  const config = mobileMaxLabelConfig.find((entry) => effectiveWidth <= entry.width);
  return config?.count ?? 8;
}

function findNearestDurationIndex(durations: number[], target: number): number | null {
  if (!durations.length) {
    return null;
  }

  let nearestIndex = 0;
  let nearestLogDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < durations.length; index += 1) {
    const candidate = durations[index];
    const logDistance = Math.abs(Math.log10(Math.max(1, candidate)) - Math.log10(Math.max(1, target)));
    if (logDistance < nearestLogDistance) {
      nearestLogDistance = logDistance;
      nearestIndex = index;
    }
  }

  const nearestDuration = durations[nearestIndex];
  const ratio = Math.abs(nearestDuration - target) / Math.max(target, 1);
  return ratio > 0.45 ? null : nearestIndex;
}

function findLargestGapMidpointIndex(durations: number[], selectedIndexes: Set<number>): number | null {
  const sorted = [...selectedIndexes].sort((left, right) => left - right);
  if (sorted.length < 2) {
    return null;
  }

  let bestStart = -1;
  let bestEnd = -1;
  let bestGap = -1;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end - start <= 1) {
      continue;
    }

    const gap = Math.log10(Math.max(1, durations[end])) - Math.log10(Math.max(1, durations[start]));
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = start;
      bestEnd = end;
    }
  }

  if (bestStart === -1 || bestEnd === -1) {
    return null;
  }

  const targetLog = (
    Math.log10(Math.max(1, durations[bestStart]))
    + Math.log10(Math.max(1, durations[bestEnd]))
  ) / 2;

  let midpointIndex = bestStart + 1;
  let midpointDistance = Number.POSITIVE_INFINITY;
  for (let index = bestStart + 1; index < bestEnd; index += 1) {
    const distance = Math.abs(Math.log10(Math.max(1, durations[index])) - targetLog);
    if (distance < midpointDistance) {
      midpointDistance = distance;
      midpointIndex = index;
    }
  }

  return midpointIndex;
}

export function formatPowerCurveDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }

  return new DataDuration(seconds).getDisplayValue(false, false).trim();
}

export function formatPowerCurvePowerLabel(power: number, includeUnit = false): string {
  if (!Number.isFinite(power)) {
    return '';
  }

  const dataPower = new DataPower(power);
  const value = `${dataPower.getDisplayValue()}`.trim();
  if (!includeUnit) {
    return value;
  }

  const unit = `${dataPower.getDisplayUnit()}`.trim();
  return unit.length > 0 ? `${value} ${unit}` : value;
}

export function buildPowerCurveVisibleDurationLabelSet(
  durations: number[],
  options: BuildPowerCurveVisibleDurationLabelSetOptions,
): Set<number> {
  if (!options.isMobile || durations.length === 0) {
    return new Set(durations);
  }

  const mandatoryIndexes = new Set<number>([0, durations.length - 1]);
  const anchorDurations = options.anchorDurations ?? DEFAULT_ANCHOR_DURATIONS;

  anchorDurations.forEach((anchorDuration) => {
    const directIndex = durations.indexOf(anchorDuration);
    if (directIndex >= 0) {
      mandatoryIndexes.add(directIndex);
      return;
    }

    const nearestIndex = findNearestDurationIndex(durations, anchorDuration);
    if (nearestIndex !== null) {
      mandatoryIndexes.add(nearestIndex);
    }
  });

  const maxLabels = Math.max(
    resolveMobileMaxLabelCount(options.chartWidth, options.mobileMaxLabelConfig ?? DEFAULT_MOBILE_MAX_LABEL_CONFIG),
    mandatoryIndexes.size,
  );

  if (durations.length <= maxLabels) {
    return new Set(durations);
  }

  const selectedIndexes = new Set<number>(mandatoryIndexes);
  while (selectedIndexes.size < maxLabels) {
    const nextIndex = findLargestGapMidpointIndex(durations, selectedIndexes);
    if (nextIndex === null) {
      break;
    }
    selectedIndexes.add(nextIndex);
  }

  return new Set(
    [...selectedIndexes]
      .sort((left, right) => left - right)
      .map((index) => durations[index]),
  );
}
