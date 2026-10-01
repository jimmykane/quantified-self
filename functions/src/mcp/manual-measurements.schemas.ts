import { z } from 'zod';
import { HEALTH_METRIC_CATALOG } from '../../../shared/health';
import { MANUAL_HEALTH_METRIC_IDS, MANUAL_HEALTH_VALUE_MAXIMUMS, MANUAL_VO2_CONTEXTS, MANUAL_VO2_METHODS,
  type ManualHealthMetricId } from '../../../shared/manual-health';

export const MCP_MANUAL_MEASUREMENTS_SCOPE = 'measurements:write';
export const MCP_MANUAL_MEASUREMENT_READ_TOOLS = [
  'list_manual_measurement_types', 'query_manual_measurements', 'get_manual_measurement',
] as const;
export const MCP_MANUAL_MEASUREMENT_WRITE_TOOLS = [
  'create_manual_measurement', 'update_manual_measurement', 'delete_manual_measurement',
] as const;
export const MCP_MANUAL_MEASUREMENT_TOOLS = [
  ...MCP_MANUAL_MEASUREMENT_READ_TOOLS, ...MCP_MANUAL_MEASUREMENT_WRITE_TOOLS,
] as const;
export type McpManualMeasurementTool = typeof MCP_MANUAL_MEASUREMENT_TOOLS[number];
export type McpManualMeasurementWriteTool = typeof MCP_MANUAL_MEASUREMENT_WRITE_TOOLS[number];

// Deliberate coverage, not automatic public exposure when the shared list grows.
export const MCP_MANUAL_MEASUREMENT_UNITS = {
  body_weight: ['kg', 'lb'], vo2_max: ['ml_per_kg_per_min'], body_fat: ['percent'],
  blood_pressure_systolic: ['mmHg'], muscle_mass: ['kg'], body_water: ['percent'],
  bone_mass: ['kg'], blood_oxygen_saturation: ['percent'],
} as const satisfies Record<ManualHealthMetricId, readonly string[]>;

const ref = z.string().min(1).max(512);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const instant = z.iso.datetime({ offset: true }).max(64).describe('Exact observation instant with a UTC offset. Resolve now once using catalog serverTime, then reuse it on retries.');
const value = z.number().positive().max(3_000);
const unit = z.enum(['kg', 'lb', 'percent', 'mmHg', 'ml_per_kg_per_min']);
const fields = {
  value: value.describe('Value in the explicit input unit; do not infer a unit from the number.'),
  unit,
  diastolicValue: z.number().positive().max(400).optional(),
  pulseValue: z.number().positive().max(400).nullable().optional(),
  vo2Context: z.enum(MANUAL_VO2_CONTEXTS).optional(),
  vo2Method: z.enum(MANUAL_VO2_METHODS).optional(),
};
export const MCP_MANUAL_MEASUREMENT_INPUTS = {
  list_manual_measurement_types: z.strictObject({}),
  query_manual_measurements: z.strictObject({
    metricId: z.enum(MANUAL_HEALTH_METRIC_IDS).optional(),
    start: instant.optional(), end: instant.optional(),
    limit: z.number().int().min(1).max(100).default(25), cursor: ref.optional(),
  }),
  get_manual_measurement: z.strictObject({ measurementRef: ref }),
  create_manual_measurement: z.strictObject({
    mutationId: z.uuid(), metricId: z.enum(MANUAL_HEALTH_METRIC_IDS), observedAt: instant, ...fields,
  }),
  update_manual_measurement: z.strictObject({
    measurementRef: ref, expectedRevision: revision,
    observedAt: instant.optional(), ...fields,
  }),
  delete_manual_measurement: z.strictObject({ measurementRef: ref, expectedRevision: revision }),
} as const;

const canonicalUnit = z.enum(['kg', 'percent', 'mmHg', 'ml_per_kg_per_min']);
const scalar = z.strictObject({ canonicalValue: z.number().positive().max(400), canonicalUnit: z.enum(['mmHg', 'bpm']),
  displayValue: z.string().max(80), displayUnit: z.string().max(40) });
export const MCP_MANUAL_MEASUREMENT_SCHEMA = z.strictObject({
  measurementRef: ref, revision, metricId: z.enum(MANUAL_HEALTH_METRIC_IDS),
  canonicalValue: z.number().positive().max(1000), canonicalUnit,
  displayValue: z.string().max(80), displayUnit: z.string().max(40),
  observedAt: instant, timezoneOffsetSeconds: z.number().int().min(-86_399).max(86_399),
  diastolic: scalar.nullable(), pulse: scalar.nullable(),
  vo2Context: z.enum(MANUAL_VO2_CONTEXTS).nullable(), vo2Method: z.enum(MANUAL_VO2_METHODS).nullable(),
}).refine(measurement => {
  const pressure = measurement.metricId === 'blood_pressure_systolic';
  const vo2 = measurement.metricId === 'vo2_max';
  // Keep the compact flat wire shape; reject inconsistent domain projections at
  // runtime without duplicating an eight-way union in every tool's catalog entry.
  return measurement.canonicalUnit === HEALTH_METRIC_CATALOG[measurement.metricId].canonicalUnit
    && measurement.canonicalValue <= MANUAL_HEALTH_VALUE_MAXIMUMS[measurement.metricId]
    && (pressure ? measurement.diastolic?.canonicalUnit === 'mmHg'
      && (measurement.pulse === null || measurement.pulse.canonicalUnit === 'bpm')
      : measurement.diastolic === null && measurement.pulse === null)
    && (vo2 ? measurement.vo2Context !== null && measurement.vo2Method !== null
      : measurement.vo2Context === null && measurement.vo2Method === null);
}, 'The manual measurement projection has inconsistent units or paired metadata.');
const mutation = z.strictObject({ measurement: MCP_MANUAL_MEASUREMENT_SCHEMA });
export const MCP_MANUAL_MEASUREMENT_OUTPUTS = {
  list_manual_measurement_types: z.strictObject({
    serverTime: instant,
    types: z.array(z.strictObject({ metricId: z.enum(MANUAL_HEALTH_METRIC_IDS), label: z.string().max(80),
      canonicalUnit, inputUnits: z.array(unit).min(1).max(2), defaultInputUnit: unit,
      requiresDiastolic: z.boolean(), vo2Contexts: z.array(z.enum(MANUAL_VO2_CONTEXTS)),
      vo2Methods: z.array(z.enum(MANUAL_VO2_METHODS)),
    })).max(8),
  }),
  query_manual_measurements: z.strictObject({ measurements: z.array(MCP_MANUAL_MEASUREMENT_SCHEMA).max(100),
    nextCursor: ref.nullable(), scanComplete: z.boolean(), scannedCount: z.number().int().min(0).max(500),
    skippedCount: z.number().int().min(0).max(500),
  }),
  get_manual_measurement: mutation,
  create_manual_measurement: mutation,
  update_manual_measurement: mutation,
  delete_manual_measurement: z.strictObject({ deleted: z.boolean() }),
} as const;
