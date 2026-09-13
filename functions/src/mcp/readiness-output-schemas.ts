import { z } from 'zod';
import { normalizeReadinessHrvPersonalRange } from '../../../shared/readiness-hrv-validation';
import { normalizeDerivedTrainingReadinessMetricPayload } from '../../../shared/training-readiness-metric';

export const currentHrvRangeSchema = z.strictObject({
  tone: z.enum(['neutral', 'positive', 'caution', 'negative']),
  reason: z.enum(['building_baseline', 'insufficient_current', 'within_range', 'outside_range', 'far_outside_range']),
  observationDayCount: z.number().int().min(0).max(61),
  requiredObservationDayCount: z.literal(14),
  currentObservationDayCount: z.number().int().min(0).max(8),
  requiredCurrentObservationDayCount: z.literal(3),
  baselineAverage: z.number().positive().nullable(),
  currentAverage: z.number().positive().nullable(),
  normalRange: z.strictObject({ min: z.number(), max: z.number().positive() }).nullable(),
  latestMs: z.number().positive(),
  latestAtMs: z.number().int().positive(),
}).refine(value => normalizeReadinessHrvPersonalRange(value) !== null, 'Invalid HRV range evidence');

const nullableNumber = z.number().nullable();
export const currentReadinessHistorySchema = z.strictObject({
  formulaVersion: z.literal(4), dayBoundary: z.literal('UTC'),
  asOfDayMs: z.number().int(), generatedAtMs: z.number().int(), historyDays: z.literal(14),
  points: z.array(z.strictObject({
    dayMs: z.number().int(), score: z.number().int().min(0).max(100).nullable(),
    label: z.enum(['Ready', 'Mixed', 'Recover']).nullable(), confidence: z.enum(['low', 'medium', 'high']).nullable(),
    availableSignalCount: z.number().int().min(0).max(4), baselineEvidenceCount: z.number().int().min(0).max(14),
    totalSignalCount: z.literal(4), form: nullableNumber, rampRate: nullableNumber, sleepScore: nullableNumber,
    latestSleepAtMs: nullableNumber, hrvRatio: nullableNumber, hrvPersonalRange: currentHrvRangeSchema.nullable(),
    averageHeartRateRatio: nullableNumber, minimumHeartRateRatio: nullableNumber, overnightHeartRateRatio: nullableNumber,
  })).length(14),
}).refine(value => normalizeDerivedTrainingReadinessMetricPayload({ ...value, evidenceVersion: 1 }) !== null,
  'Invalid readiness history');
