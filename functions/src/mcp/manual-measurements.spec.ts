import { describe, expect, it } from 'vitest';
import { MANUAL_HEALTH_METRIC_IDS } from '../../../shared/manual-health';
import { MCP_MANUAL_MEASUREMENT_INPUTS, MCP_MANUAL_MEASUREMENT_OUTPUTS,
  MCP_MANUAL_MEASUREMENT_UNITS } from './manual-measurements.schemas';
import { resolveManualMeasurementFields } from './manual-measurements.service';
const now = Date.parse('2026-10-01T09:00:00Z');
const base = { mutationId: '00000000-0000-4000-8000-000000000000',
  observedAt: '2026-10-01T11:30:12.123+03:00' };
describe('manual measurement MCP contracts', () => {
  it('deliberately covers exactly the shared editable types', () => {
    expect(Object.keys(MCP_MANUAL_MEASUREMENT_UNITS).sort()).toEqual([...MANUAL_HEALTH_METRIC_IDS].sort());
  });
  it.each([
    ['body_weight', 176.36980975, 'lb', {}], ['body_fat', 20, 'percent', {}],
    ['muscle_mass', 40, 'kg', {}], ['body_water', 55, 'percent', {}], ['bone_mass', 3, 'kg', {}],
    ['blood_oxygen_saturation', 98, 'percent', {}],
    ['blood_pressure_systolic', 120, 'mmHg', { diastolicValue: 80, pulseValue: 60 }],
    ['vo2_max', 50, 'ml_per_kg_per_min', { vo2Context: 'cycling', vo2Method: 'lab_test' }],
  ])('normalizes %s using canonical UI semantics', (metricId, value, unit, metadata) => {
    const args = MCP_MANUAL_MEASUREMENT_INPUTS.create_manual_measurement.parse({ ...base, metricId, value, unit, ...metadata as object });
    const result = resolveManualMeasurementFields(args, now);
    expect(result.metricId).toBe(metricId);
    expect(result.canonicalValue).toBeCloseTo(metricId === 'body_weight' ? 80 : value as number, 5);
    expect(result.observedAtMs).toBe(Date.parse(base.observedAt));
    expect(result.timezoneOffsetSeconds).toBe(10800);
  });
  it('preserves exact time and optional metadata on edits; null clears only paired pulse', () => {
    const existing = { metricId: 'blood_pressure_systolic' as const, canonicalValue: 120,
      diastolicValue: 80, pulseValue: 60, observedAtMs: now - 12345, timezoneOffsetSeconds: -12600 };
    const args = MCP_MANUAL_MEASUREMENT_INPUTS.update_manual_measurement.parse({
      measurementRef: 'ref', expectedRevision: 1, value: 125, unit: 'mmHg', pulseValue: null });
    expect(resolveManualMeasurementFields(args, now, existing)).toEqual({ ...existing, canonicalValue: 125, pulseValue: undefined });
  });
  it.each([
    { metricId: 'body_weight', value: 70, unit: 'percent' },
    { metricId: 'body_fat', value: 101, unit: 'percent' },
    { metricId: 'body_weight', value: 70, unit: 'kg', pulseValue: null },
    { metricId: 'blood_pressure_systolic', value: 120, unit: 'mmHg' },
    { metricId: 'vo2_max', value: 50, unit: 'ml_per_kg_per_min' },
    { metricId: 'bone_mass', value: 3, unit: 'kg', vo2Method: 'lab_test' },
  ])('rejects invalid unit or paired metadata %j', fields => {
    const args = MCP_MANUAL_MEASUREMENT_INPUTS.create_manual_measurement.parse({ ...base, ...fields });
    expect(() => resolveManualMeasurementFields(args, now)).toThrow();
  });
  it('rejects privileged input and private output neighbors', () => {
    const input = { ...base, metricId: 'body_weight', value: 80, unit: 'kg' };
    for (const key of ['uid', 'sourceRecordId', 'grantId', 'provider', 'canonicalValue']) {
      expect(MCP_MANUAL_MEASUREMENT_INPUTS.create_manual_measurement.safeParse({ ...input, [key]: 'private' }).success).toBe(false);
    }
    const output = { measurement: { measurementRef: 'ref', revision: 1, metricId: 'body_weight',
      canonicalValue: 80, canonicalUnit: 'kg', displayValue: '80', displayUnit: 'kg', observedAt: base.observedAt,
      timezoneOffsetSeconds: 10800, diastolic: null, pulse: null, vo2Context: null, vo2Method: null } };
    expect(MCP_MANUAL_MEASUREMENT_OUTPUTS.get_manual_measurement.safeParse(output).success).toBe(true);
    for (const key of ['sourceRecordId', 'source', 'userID', 'revisionDigest', 'device']) {
      expect(MCP_MANUAL_MEASUREMENT_OUTPUTS.get_manual_measurement.safeParse({ measurement: { ...output.measurement, [key]: 'private' } }).success).toBe(false);
    }
  });

  it.each([
    { canonicalUnit: 'percent' },
    { metricId: 'body_fat', canonicalUnit: 'percent', canonicalValue: 101 },
    { metricId: 'vo2_max', canonicalUnit: 'ml_per_kg_per_min', canonicalValue: 151,
      vo2Context: 'running', vo2Method: 'lab_test' },
    { pulse: { canonicalValue: 60, canonicalUnit: 'bpm', displayValue: '60', displayUnit: 'bpm' } },
    { vo2Context: 'running', vo2Method: 'lab_test' },
    { metricId: 'blood_pressure_systolic', canonicalUnit: 'mmHg', canonicalValue: 120 },
    { metricId: 'blood_pressure_systolic', canonicalUnit: 'mmHg', canonicalValue: 120,
      diastolic: { canonicalValue: 80, canonicalUnit: 'bpm', displayValue: '80', displayUnit: 'bpm' } },
    { metricId: 'blood_pressure_systolic', canonicalUnit: 'mmHg', canonicalValue: 120,
      diastolic: { canonicalValue: 80, canonicalUnit: 'mmHg', displayValue: '80', displayUnit: 'mmHg' },
      pulse: { canonicalValue: 60, canonicalUnit: 'mmHg', displayValue: '60', displayUnit: 'mmHg' } },
    { metricId: 'vo2_max', canonicalUnit: 'ml_per_kg_per_min', canonicalValue: 50 },
  ])('rejects inconsistent public measurement semantics %j', changes => {
    const measurement = { measurementRef: 'ref', revision: 1, metricId: 'body_weight',
      canonicalValue: 80, canonicalUnit: 'kg', displayValue: '80', displayUnit: 'kg', observedAt: base.observedAt,
      timezoneOffsetSeconds: 10800, diastolic: null, pulse: null, vo2Context: null, vo2Method: null,
      ...changes };
    expect(MCP_MANUAL_MEASUREMENT_OUTPUTS.get_manual_measurement.safeParse({ measurement }).success).toBe(false);
  });
});
