import { describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS, DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_MAX_BYTES } from '../../../shared/derived-metrics';
import { createMcpDataService, type McpDataServiceDependencies, isMcpTrainingMetricPayloadReadable,
  projectDerivedMetricPayloadForMcp, redactDerivedPayload } from './data.service';
import { MCP_DERIVED_PAYLOAD_SCHEMAS, MCP_TRAINING_METRIC_SCHEMA_VERSION } from './derived-output-schemas';
import { projectTrainingPowerSystemsPolicy1 } from './training-power-systems-compatibility';
import { createMcpOutputSchemaRegistry } from './tool-output-schemas';

function powerEntry(activityType: string, watts: number) {
  const component = (value: number) => ({ status: 'ready', reason: null, value });
  return { activityType, current: {
    effectiveDayMs: 86_400_000, activityType, status: 'ready', reason: null,
    criticalPower: component(watts), wPrime: component(10_000), maximumPower: component(1_000),
    sourceFingerprint: 'PRIVATE-source-fingerprint',
    diagnostics: { sourceCount: 3, historyStartDayMs: 0, historyEndDayMs: 0, historySpanDays: 0,
      rejectedPointCount: 0, rejectedShortPowerSpikePointCount: 0, criticalPowerAnchorCount: 3,
      earlyCriticalPowerAnchorCount: 1, longCriticalPowerAnchorCount: 1, criticalPowerContributingSourceCount: 3,
      maximumPowerAnchorCount: 3, maximumPowerContributingSourceCount: 3, criticalPowerNormalizedRmse: 0,
      criticalPowerSpreadRatio: 0, wPrimeSpreadRatio: 0, wPrimeCandidateCount: 3, wPrimeCandidateMinimumJoules: 10_000,
      wPrimeCandidateMaximumJoules: 10_000, criticalPowerLeaveOneOutSpreadRatio: 0, wPrimeLeaveOneOutSpreadRatio: 0,
      criticalPowerSourceRemovalFitCount: 3, criticalPowerSourceRemovalFailureCount: 0,
      criticalPowerSourceRemovalMaximumChangeRatio: 0, wPrimeSourceRemovalMaximumChangeRatio: 0,
      maximumPowerNormalizedRmse: 0, maximumPowerLeaveOneOutSpreadRatio: 0 },
  }, history: [{ effectiveDayMs: 86_400_000, status: 'ready', reason: null, criticalPowerStatus: 'ready',
    criticalPowerWatts: watts, wPrimeStatus: 'ready', wPrimeJoules: 10_000, maximumPowerStatus: 'ready', maximumPowerWatts: 1_000 }],
  evidenceCounts: { candidateActivityCount: 3, usableCurveActivityCount: 3, excludedActivityCount: 0 } };
}
const payload = (policyVersion: number, types = ['Cycling', 'Road Cycling', 'Running', 'Road Running']) => ({
  dayBoundary: 'UTC', asOfDayMs: 86_400_000, policyVersion, windowDays: 42, historyDays: 84,
  cadence: 'workout-date', excludesEffectiveDay: true, excludesMergedEvents: true,
  activityTypes: types.map((type, index) => powerEntry(type, (policyVersion === 1 ? 200 : 400) + index)),
});
const project = (current: unknown, legacy: unknown) => projectTrainingPowerSystemsPolicy1(current, legacy, redactDerivedPayload);

describe('truthful registered power-policy compatibility', () => {
  it('keeps independently fitted policy1 results and unchanged non-pair results without changing source payloads', () => {
    const current = payload(2, ['Cycling', 'Indoor Cycling', 'Road Cycling', 'Running', 'Road Running']);
    const legacy = payload(1);
    const before = JSON.stringify({ current, legacy });
    const result = project(current, legacy) as ReturnType<typeof payload>;
    expect(result.policyVersion).toBe(1);
    expect(result.activityTypes.map(entry => [entry.activityType, entry.current.criticalPower.value]))
      .toEqual([['Cycling', 200], ['Indoor Cycling', 401], ['Road Cycling', 201], ['Running', 202], ['Road Running', 203]]);
    expect(result.activityTypes[0].history[0].criticalPowerWatts).toBe(200);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify({ current, legacy })).toBe(before);
    expect(MCP_DERIVED_PAYLOAD_SCHEMAS[DERIVED_METRIC_KINDS.TrainingPowerSystems].safeParse(result).success).toBe(true);
    expect(isMcpTrainingMetricPayloadReadable(DERIVED_METRIC_KINDS.TrainingPowerSystems, current, legacy)).toBe(true);
    expect(projectDerivedMetricPayloadForMcp(DERIVED_METRIC_KINDS.TrainingPowerSystems, current, legacy)).toEqual(result);
  });

  it('continues to read a genuine policy1 payload without a sidecar', () => {
    const legacy = payload(1);
    expect(project(legacy, undefined)).toEqual(redactDerivedPayload(legacy));
    expect(isMcpTrainingMetricPayloadReadable(DERIVED_METRIC_KINDS.TrainingPowerSystems, legacy)).toBe(true);
  });

  it('returns no pooled result when its independent sidecar is missing, stale, ambiguous, incomplete or private', () => {
    const current = payload(2);
    const legacy = payload(1);
    const invalidSidecars = [undefined, null, { ...legacy, policyVersion: 2 }, { ...legacy, asOfDayMs: 0 },
      { ...legacy, windowDays: 43 }, { ...legacy, historyDays: 83 }, { ...legacy, dayBoundary: 'local' },
      { ...legacy, activityTypes: legacy.activityTypes.slice(1) },
      { ...legacy, activityTypes: [legacy.activityTypes[0], legacy.activityTypes[0], ...legacy.activityTypes.slice(2)] },
      { ...legacy, activityTypes: [...legacy.activityTypes, powerEntry('Indoor Cycling', 100)] },
      { ...legacy, activityTypes: [{ ...legacy.activityTypes[0], current: { ...legacy.activityTypes[0].current,
        activityType: 'Road Cycling' } }, ...legacy.activityTypes.slice(1)] },
      { ...legacy, activityTypes: [{ ...legacy.activityTypes[0], history: Array(86).fill(legacy.activityTypes[0].history[0]) },
        ...legacy.activityTypes.slice(1)] },
      { ...legacy, activityTypes: [{ ...legacy.activityTypes[0], providerPayload: 'PRIVATE' }, ...legacy.activityTypes.slice(1)] },
      { ...legacy, credentials: 'PRIVATE' },
      { ...legacy, privatePadding: 'x'.repeat(DERIVED_TRAINING_POWER_SYSTEMS_LEGACY_POLICY1_MAX_BYTES) },
    ];
    for (const sidecar of invalidSidecars) {
      expect(project(current, sidecar)).toBeNull();
      expect(isMcpTrainingMetricPayloadReadable(DERIVED_METRIC_KINDS.TrainingPowerSystems, current, sidecar)).toBe(false);
    }
    for (const invalidCurrent of [{ ...current, policyVersion: 3 },
      { ...current, activityTypes: [...current.activityTypes, current.activityTypes[0]] },
      { ...current, activityTypes: [{ ...current.activityTypes[0], current: { ...current.activityTypes[0].current,
        activityType: 'Indoor Cycling' } }, ...current.activityTypes.slice(1)] }]) expect(project(invalidCurrent, legacy)).toBeNull();
  });

  it('uses the private sidecar only to serve the existing strict get_training_metric result', async () => {
    const snapshot = { status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION, updatedAtMs: 100,
      sourceEventCount: 3, payload: payload(2), legacyPowerSystemsPolicy1: payload(1),
      providerCredentials: 'PRIVATE', builtFromEventMutationVersion: 5 };
    const dependencies = { fetchDerivedSnapshot: vi.fn(async () => snapshot) } as unknown as McpDataServiceDependencies;
    const result = await createMcpDataService(dependencies).getTrainingMetric('synthetic-user', DERIVED_METRIC_KINDS.TrainingPowerSystems);
    expect(result).toMatchObject({ schemaVersion: MCP_TRAINING_METRIC_SCHEMA_VERSION,
      payload: { policyVersion: 1, activityTypes: expect.arrayContaining([expect.objectContaining({
        current: expect.objectContaining({ criticalPower: { status: 'ready', reason: null, value: 200 } }),
      })]) } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|legacyPowerSystemsPolicy1|builtFromEventMutationVersion/);
    expect(createMcpOutputSchemaRegistry({ activityLocation: false, routeLocation: false })
      .get_training_metric.safeParse(result).success).toBe(true);
    snapshot.legacyPowerSystemsPolicy1.activityTypes = [];
    await expect(createMcpDataService(dependencies).getTrainingMetric('synthetic-user', DERIVED_METRIC_KINDS.TrainingPowerSystems))
      .rejects.toMatchObject({ code: 'metric_not_ready' });
  });
});
