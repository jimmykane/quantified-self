import { z } from 'zod';
import { DERIVED_METRIC_KINDS, DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_ACTIVITY_TYPES,
  DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_MAX_BYTES } from '../../../shared/derived-metrics';
import { MCP_DERIVED_PAYLOAD_SCHEMAS } from './derived-output-schemas';

const publicPolicy1 = MCP_DERIVED_PAYLOAD_SCHEMAS[DERIVED_METRIC_KINDS.TrainingPowerSystems];
// Policy2 changes only these pairs' evidence pooling. Future policies require
// a separate review; they must not enter this projection through a shared bump.
const currentPolicy2 = publicPolicy1.extend({ policyVersion: z.literal(2) });
const affectedTypes = new Set<string>(DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_ACTIVITY_TYPES);
const legacyPolicy1 = publicPolicy1.extend({
  activityTypes: z.array(publicPolicy1.shape.activityTypes.element.extend({
    history: publicPolicy1.shape.activityTypes.element.shape.history.max(85),
  })).max(4),
});
const metadataFields = ['dayBoundary', 'asOfDayMs', 'windowDays', 'historyDays',
  'cadence', 'excludesEffectiveDay', 'excludesMergedEvents'] as const;

/**
 * Preserve the registered exact-type policy1 result from a current snapshot.
 * The sidecar is independently fitted by the worker from the same bounded
 * curve inputs. A pooled policy2 fit is never relabelled as a policy1 fit.
 */
export function projectTrainingPowerSystemsPolicy1(
  payload: unknown,
  sidecar: unknown,
  redact: (value: unknown) => unknown,
): unknown | null {
  try {
    const existing = publicPolicy1.safeParse(redact(payload));
    if (existing.success) return existing.data;
    if (Buffer.byteLength(JSON.stringify(sidecar), 'utf8') > DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_MAX_BYTES) return null;
    const current = currentPolicy2.safeParse(redact(payload));
    const legacy = legacyPolicy1.safeParse(redact(sidecar));
    if (!current.success || !legacy.success
      || metadataFields.some(field => current.data[field] !== legacy.data[field])) return null;

    const currentTypes = current.data.activityTypes.map(entry => entry.activityType);
    const legacyTypes = legacy.data.activityTypes.map(entry => entry.activityType);
    if (new Set(currentTypes).size !== currentTypes.length
      || new Set(legacyTypes).size !== legacyTypes.length
      || legacyTypes.some(type => !affectedTypes.has(type))) return null;
    const expected = new Set(currentTypes.filter(type => affectedTypes.has(type)));
    if (expected.size !== legacyTypes.length || legacyTypes.some(type => !expected.has(type))) return null;
    if ([...current.data.activityTypes, ...legacy.data.activityTypes]
      .some(entry => entry.current.activityType !== entry.activityType)) return null;

    const independent = new Map(legacy.data.activityTypes.map(entry => [entry.activityType, entry]));
    const result = publicPolicy1.safeParse({
      ...current.data,
      policyVersion: 1,
      activityTypes: current.data.activityTypes.map(entry => independent.get(entry.activityType) || entry),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
