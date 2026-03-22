import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

export interface EventStatAggregationPreferences {
  removeAscentForEventTypes?: ActivityTypes[];
  removeDescentForEventTypes?: ActivityTypes[];
}

export interface EventStatAggregationRequest {
  dataType: string;
  valueType: ChartDataValueTypes;
  categoryType: ChartDataCategoryTypes;
  requestedTimeInterval?: TimeIntervals;
  preferences?: EventStatAggregationPreferences;
}

export interface EventStatAggregationBucket {
  bucketKey: string | number;
  time?: number;
  totalCount: number;
  aggregateValue: number;
  seriesValues: Record<string, number>;
  seriesCounts: Record<string, number>;
}

export interface EventStatAggregationResult {
  dataType: string;
  valueType: ChartDataValueTypes;
  categoryType: ChartDataCategoryTypes;
  resolvedTimeInterval: TimeIntervals;
  buckets: EventStatAggregationBucket[];
}

export type EventStatAggregationEventInput = readonly EventInterface[] | null | undefined;

export type EventStatAggregationLogger = {
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};
