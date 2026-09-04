import { HEALTH_METRIC_IDS, type HealthMetricId } from './health';

export const MANUAL_HEALTH_METRIC_IDS = [
  HEALTH_METRIC_IDS.BodyWeight,
  HEALTH_METRIC_IDS.Vo2Max,
] as const;

export type ManualHealthMetricId = typeof MANUAL_HEALTH_METRIC_IDS[number];

export const MANUAL_VO2_CONTEXTS = ['general', 'running', 'cycling'] as const;
export type ManualVo2Context = typeof MANUAL_VO2_CONTEXTS[number];

export const MANUAL_VO2_METHODS = ['lab_test', 'field_test', 'other_estimate'] as const;
export type ManualVo2Method = typeof MANUAL_VO2_METHODS[number];

export const MANUAL_HEALTH_SOURCE_RECORD_TYPE = 'manual_measurement' as const;
export const MANUAL_HEALTH_AGGREGATION = 'measurement' as const;
export const MANUAL_WEIGHT_SEMANTIC_VARIANT = 'point' as const;

export interface ManualHealthMeasurementFields {
  metricId: ManualHealthMetricId;
  canonicalValue: number;
  observedAtMs: number;
  timezoneOffsetSeconds: number;
  vo2Context?: ManualVo2Context;
  vo2Method?: ManualVo2Method;
}

export interface CreateManualHealthMeasurementRequest extends ManualHealthMeasurementFields {
  mode: 'create';
  /** Client-generated UUID used solely as an idempotency key. */
  clientMutationId: string;
}

export interface UpdateManualHealthMeasurementRequest extends ManualHealthMeasurementFields {
  mode: 'update';
  sourceRecordId: string;
  expectedRevisionOrder: number;
}

export type SaveManualHealthMeasurementRequest =
  | CreateManualHealthMeasurementRequest
  | UpdateManualHealthMeasurementRequest;

export interface SaveManualHealthMeasurementResponse {
  sourceRecordId: string;
  revisionOrder: number;
}

export interface DeleteManualHealthMeasurementRequest {
  sourceRecordId: string;
  expectedRevisionOrder: number;
}

export interface DeleteManualHealthMeasurementResponse {
  deleted: boolean;
}

export function isManualHealthMetricId(value: unknown): value is ManualHealthMetricId {
  return typeof value === 'string'
    && (MANUAL_HEALTH_METRIC_IDS as readonly HealthMetricId[]).includes(value as HealthMetricId);
}

export function manualVo2SemanticVariant(
  context: ManualVo2Context,
  method: ManualVo2Method,
): string {
  return `manual_${context}_${method}`;
}
