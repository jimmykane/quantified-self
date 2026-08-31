import type {
  MetricIndicatorTone,
  MetricIndicatorVariant,
} from '../metric-indicator/metric-indicator.component';

export interface TrainingSummaryIndicator {
  label: string;
  value: number | null;
  variant?: MetricIndicatorVariant;
  tone?: MetricIndicatorTone;
  compact?: boolean;
  showThresholds?: boolean;
}
export interface TrainingSummaryCard {
  id: string;
  label: string;
  valueText: string;
  captionText: string;
  qualifierText?: string;
  updateText?: string | null;
  kind?: 'state' | 'metric';
  span?: 'double';
  announcesStatus?: boolean;
  indicator?: TrainingSummaryIndicator;
}

export interface TrainingSummaryMetric {
  id: string;
  label: string;
  valueText: string;
  detailText?: string;
}
