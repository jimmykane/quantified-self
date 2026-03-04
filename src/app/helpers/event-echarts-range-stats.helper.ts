import {
  DataAltitude,
  DataGPSAltitude,
  DataStrydAltitude,
  DynamicDataLoader,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { EventChartPanelModel } from './event-echarts-data.helper';
import { EventChartRange, normalizeEventRange } from './event-echarts-xaxis.helper';

export interface EventPanelRangeStat {
  activityID: string;
  activityName: string;
  color: string;
  min: { value: string; unit: string };
  avg: { value: string; unit: string };
  max: { value: string; unit: string };
  gain?: { value: string; unit: string };
  loss?: { value: string; unit: string };
  slope?: string;
}

export interface ComputeEventPanelRangeStatsInput {
  panel: EventChartPanelModel;
  range: EventChartRange | null;
  xAxisType: XAxisTypes;
  gainAndLossThreshold: number;
}

export function computeEventPanelRangeStats(input: ComputeEventPanelRangeStatsInput): EventPanelRangeStat[] {
  const range = normalizeEventRange(input.range);
  if (!range) {
    return [];
  }

  const boundedRange = normalizeEventRange({
    start: Math.max(input.panel.minX, range.start),
    end: Math.min(input.panel.maxX, range.end),
  });

  if (!boundedRange || boundedRange.end <= boundedRange.start) {
    return [];
  }

  return input.panel.series.reduce<EventPanelRangeStat[]>((stats, series) => {
    const aggregates = computeSeriesRangeAggregates(series.points, boundedRange, supportsGainLoss(series.streamType), input.gainAndLossThreshold);
    if (!aggregates) {
      return stats;
    }

    const stat: EventPanelRangeStat = {
      activityID: series.activityID,
      activityName: series.activityName,
      color: series.color,
      min: formatDataTypeValue(series.streamType, aggregates.min),
      avg: formatDataTypeValue(series.streamType, aggregates.sum / aggregates.count),
      max: formatDataTypeValue(series.streamType, aggregates.max),
    };

    if (aggregates.gain !== undefined && aggregates.loss !== undefined) {
      stat.gain = formatDataTypeValue(
        series.streamType,
        aggregates.gain
      );
      stat.loss = formatDataTypeValue(
        series.streamType,
        aggregates.loss
      );
    }

    if (supportsSlope(series.streamType) && input.xAxisType === XAxisTypes.Distance) {
      const span = boundedRange.end - boundedRange.start;
      if (span > 0) {
        const slope = ((aggregates.max - aggregates.min) / span) * 100;
        stat.slope = `${slope.toFixed(2)}%`;
      }
    }

    stats.push(stat);
    return stats;
  }, []);
}

function computeSeriesRangeAggregates(
  points: EventChartPanelModel['series'][number]['points'],
  range: EventChartRange,
  includeGainLoss: boolean,
  gainAndLossThreshold: number
): { min: number; max: number; sum: number; count: number; gain?: number; loss?: number } | null {
  if (!points.length) {
    return null;
  }

  const startIndex = findFirstPointAtOrAfter(points, range.start);
  const endExclusive = findFirstPointAfter(points, range.end);
  if (startIndex >= endExclusive) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;
  let gain = 0;
  let loss = 0;
  let previousValue: number | null = null;

  for (let index = startIndex; index < endExclusive; index += 1) {
    const y = points[index]?.y;
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      continue;
    }

    if (y < min) {
      min = y;
    }
    if (y > max) {
      max = y;
    }
    sum += y;
    count += 1;

    if (includeGainLoss && previousValue !== null) {
      const delta = y - previousValue;
      if (delta >= gainAndLossThreshold) {
        gain += delta;
      } else if (delta <= -gainAndLossThreshold) {
        loss += Math.abs(delta);
      }
    }

    previousValue = y;
  }

  if (count === 0) {
    return null;
  }

  return includeGainLoss
    ? { min, max, sum, count, gain, loss }
    : { min, max, sum, count };
}

function findFirstPointAtOrAfter(
  points: EventChartPanelModel['series'][number]['points'],
  xValue: number
): number {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].x < xValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findFirstPointAfter(
  points: EventChartPanelModel['series'][number]['points'],
  xValue: number
): number {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].x <= xValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function supportsGainLoss(streamType: string): boolean {
  return [
    DataAltitude.type,
    DataGPSAltitude.type,
    DataStrydAltitude.type,
  ].includes(streamType);
}

function supportsSlope(streamType: string): boolean {
  return supportsGainLoss(streamType);
}

function formatDataTypeValue(streamType: string, value: unknown): { value: string; unit: string } {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return {
      value: '--',
      unit: '',
    };
  }

  try {
    const dataInstance = DynamicDataLoader.getDataInstanceFromDataType(streamType, numericValue);
    const displayValue = sanitizeDisplayValue(dataInstance.getDisplayValue?.());
    if (!displayValue) {
      return {
        value: `${numericValue.toFixed(2)}`,
        unit: `${dataInstance.getDisplayUnit?.() ?? ''}`,
      };
    }

    return {
      value: displayValue,
      unit: `${dataInstance.getDisplayUnit?.() ?? ''}`,
    };
  } catch {
    return {
      value: `${numericValue.toFixed(2)}`,
      unit: '',
    };
  }
}

function sanitizeDisplayValue(value: unknown): string {
  const displayValue = `${value ?? ''}`.trim();
  if (!displayValue) {
    return '';
  }

  return /nan|infinity/i.test(displayValue)
    ? ''
    : displayValue;
}
