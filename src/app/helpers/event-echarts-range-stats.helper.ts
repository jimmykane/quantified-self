import {
  ActivityUtilities,
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
    const values = series.points
      .filter((point) => point.x >= boundedRange.start && point.x <= boundedRange.end)
      .map((point) => point.y)
      .filter((value) => Number.isFinite(value));

    if (!values.length) {
      return stats;
    }

    const minValue = ActivityUtilities.getMin(values);
    const avgValue = ActivityUtilities.getAverage(values);
    const maxValue = ActivityUtilities.getMax(values);

    const stat: EventPanelRangeStat = {
      activityID: series.activityID,
      activityName: series.activityName,
      color: series.color,
      min: formatDataTypeValue(series.streamType, minValue),
      avg: formatDataTypeValue(series.streamType, avgValue),
      max: formatDataTypeValue(series.streamType, maxValue),
    };

    if (supportsGainLoss(series.streamType)) {
      stat.gain = formatDataTypeValue(
        series.streamType,
        ActivityUtilities.getGainOrLoss(values, true, input.gainAndLossThreshold)
      );
      stat.loss = formatDataTypeValue(
        series.streamType,
        ActivityUtilities.getGainOrLoss(values, false, input.gainAndLossThreshold)
      );
    }

    if (supportsSlope(series.streamType) && input.xAxisType === XAxisTypes.Distance) {
      const span = boundedRange.end - boundedRange.start;
      if (span > 0) {
        const slope = ((maxValue - minValue) / span) * 100;
        stat.slope = `${slope.toFixed(2)}%`;
      }
    }

    stats.push(stat);
    return stats;
  }, []);
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
