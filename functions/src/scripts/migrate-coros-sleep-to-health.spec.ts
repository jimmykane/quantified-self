import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_IDS, HEALTH_SLEEP_REFERENCE_FIELDS } from '../../../shared/health';
import { validateHealthSourceRecordInput } from '../health/validation';
import {
  buildCOROSLegacyHealthMigrationCandidate,
  canCleanCOROSLegacySleepFieldsAfterHealthWrite,
  canCleanCOROSLegacySleepFieldsAfterSupersedingHealthConflict,
  parseCOROSSleepToHealthMigrationOptions,
} from './migrate-coros-sleep-to-health';
import { buildHealthSourceRecordWrite } from '../health/writer';

const SLEEP_DOCUMENT_ID = 'c'.repeat(64);

function legacySleepSession(): Record<string, unknown> {
  return {
    source: {
      provider: 'COROSAPI',
      providerUserId: 'private-coros-account',
      sourceSessionKey: '20260428:legacy',
      receivedAtMs: Date.parse('2026-04-29T12:00:00.000Z'),
    },
    sleepDate: '2026-04-28',
    startTimeMs: Date.parse('2026-04-27T22:00:00.000Z'),
    endTimeMs: Date.parse('2026-04-28T06:00:00.000Z'),
    timezoneOffsetSeconds: 0,
    createdAtMs: Date.parse('2026-04-29T12:00:00.000Z'),
    updatedAtMs: Date.parse('2026-04-29T12:00:00.000Z'),
    vitals: {
      restingHeartRateBpm: 47,
      overnightHrvMs: 62,
      averageHeartRateBpm: 51,
    },
    hrvSamples: [
      { offsetSeconds: 3_600, value: 58 },
      { timestampMs: Date.parse('2026-04-28T01:00:00.000Z'), value: 60 },
    ],
    providerFields: {
      coros: {
        happenDay: '20260428',
        step: 12_345,
        calorie: 2_478.5,
        rhr: 47,
        ppgHrv: 62,
        sleepAvgHr: 51,
        startTimezone: 0,
        endTimezone: 0,
      },
    },
  };
}

describe('COROS legacy Sleep to Health migration', () => {
  it('cleans legacy fields only after the exact Health content is durable', () => {
    expect(canCleanCOROSLegacySleepFieldsAfterHealthWrite('written')).toBe(true);
    expect(canCleanCOROSLegacySleepFieldsAfterHealthWrite('unchanged')).toBe(true);
    expect(canCleanCOROSLegacySleepFieldsAfterHealthWrite('stale')).toBe(false);
    expect(canCleanCOROSLegacySleepFieldsAfterHealthWrite('skipped_deleted_user')).toBe(false);
    expect(canCleanCOROSLegacySleepFieldsAfterHealthWrite('skipped_lifecycle_guard')).toBe(false);
  });

  it('cleans retained scalars when the same fetch already wrote superseding Health', async () => {
    const legacy = legacySleepSession();
    delete legacy.hrvSamples;
    const candidate = buildCOROSLegacyHealthMigrationCandidate(
      legacy,
      'user-1',
      SLEEP_DOCUMENT_ID,
    );
    expect(candidate).not.toBeNull();

    const supersedingInput = structuredClone(candidate?.health.input);
    supersedingInput.timezoneOffsetSeconds = 3_600;
    const steps = supersedingInput.metrics.find(metric => metric.metricId === HEALTH_METRIC_IDS.Steps);
    if (!steps || steps.kind !== 'value') throw new Error('Expected a steps value metric.');
    steps.native.value = 12_400;
    if (steps.canonical) steps.canonical.value = 12_400;
    supersedingInput.revision.token = 'fresh-provider-content';
    const existing = (await buildHealthSourceRecordWrite(
      'user-1',
      supersedingInput,
      Date.parse('2026-04-29T12:01:00.000Z'),
    )).sourceRecord;

    expect(canCleanCOROSLegacySleepFieldsAfterSupersedingHealthConflict(
      existing,
      candidate!,
      existing.id,
    )).toBe(true);
  });

  it('does not clean conflicts that could discard samples or change metric semantics', async () => {
    const candidateWithSamples = buildCOROSLegacyHealthMigrationCandidate(
      legacySleepSession(),
      'user-1',
      SLEEP_DOCUMENT_ID,
    );
    expect(candidateWithSamples).not.toBeNull();
    const existingWithSamples = (await buildHealthSourceRecordWrite(
      'user-1',
      candidateWithSamples?.health.input,
    )).sourceRecord;
    expect(canCleanCOROSLegacySleepFieldsAfterSupersedingHealthConflict(
      existingWithSamples,
      candidateWithSamples!,
      existingWithSamples.id,
    )).toBe(false);

    const legacyWithoutSamples = legacySleepSession();
    delete legacyWithoutSamples.hrvSamples;
    const scalarCandidate = buildCOROSLegacyHealthMigrationCandidate(
      legacyWithoutSamples,
      'user-1',
      SLEEP_DOCUMENT_ID,
    );
    expect(scalarCandidate).not.toBeNull();
    const changedReferenceInput = structuredClone(scalarCandidate?.health.input);
    const sleepReference = changedReferenceInput.metrics.find(metric => metric.kind === 'sleep_reference');
    if (!sleepReference || sleepReference.kind !== 'sleep_reference') {
      throw new Error('Expected a Sleep reference metric.');
    }
    sleepReference.reference.documentId = 'd'.repeat(64);
    changedReferenceInput.revision.token = 'different-sleep-reference';
    const changedReference = (await buildHealthSourceRecordWrite(
      'user-1',
      changedReferenceInput,
    )).sourceRecord;
    expect(canCleanCOROSLegacySleepFieldsAfterSupersedingHealthConflict(
      changedReference,
      scalarCandidate!,
      changedReference.id,
    )).toBe(false);

    const changedMetricInput = structuredClone(scalarCandidate?.health.input);
    const changedSteps = changedMetricInput.metrics.find(metric => metric.metricId === HEALTH_METRIC_IDS.Steps);
    if (!changedSteps || changedSteps.kind !== 'value') throw new Error('Expected a steps value metric.');
    changedSteps.native.metric = 'different-step-definition';
    changedMetricInput.revision.token = 'different-metric-definition';
    const changedMetric = (await buildHealthSourceRecordWrite(
      'user-1',
      changedMetricInput,
    )).sourceRecord;
    expect(canCleanCOROSLegacySleepFieldsAfterSupersedingHealthConflict(
      changedMetric,
      scalarCandidate!,
      changedMetric.id,
    )).toBe(false);
  });

  it('defaults to dry-run and gates an unscoped execution', () => {
    expect(parseCOROSSleepToHealthMigrationOptions([])).toMatchObject({
      execute: false,
      confirmAllUsers: false,
      limit: 100,
    });
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--execute']))
      .toThrow('Global execution requires --confirm-all-users');
    expect(parseCOROSSleepToHealthMigrationOptions([
      '--execute',
      '--confirm-all-users',
      '--limit=200',
      '--start-after',
      'users/u1/sleepSessions/session-1',
    ])).toMatchObject({
      execute: true,
      confirmAllUsers: true,
      limit: 200,
      startAfter: 'users/u1/sleepSessions/session-1',
    });
    expect(parseCOROSSleepToHealthMigrationOptions([
      '--uid=user-1',
      '--start-after=session-1',
    ])).toMatchObject({
      userID: 'user-1',
      startAfter: 'session-1',
    });
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--uid=unsafe/user']))
      .toThrow('--uid must be a safe bounded Firestore document ID');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--uid=..']))
      .toThrow('--uid must be a safe bounded Firestore document ID');
    expect(() => parseCOROSSleepToHealthMigrationOptions([
      '--uid=user-1',
      '--start-after=users/user-2/sleepSessions/session-1',
    ])).toThrow('--start-after must identify a safe Sleep document in the selected scope');
    expect(() => parseCOROSSleepToHealthMigrationOptions([
      '--start-after=session-1',
    ])).toThrow('--start-after must identify a safe Sleep document in the selected scope');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--uid', '--execute']))
      .toThrow('--uid requires a non-empty value');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--limit=1.5']))
      .toThrow('--limit must be an integer');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--limit=251']))
      .toThrow('--limit must be an integer between 1 and 250');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--limit=10', '--limit=20']))
      .toThrow('--limit cannot be repeated');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['--excute', '--confirm-all-users']))
      .toThrow('Unknown migration argument: --excute');
    expect(() => parseCOROSSleepToHealthMigrationOptions(['unexpected-position']))
      .toThrow('Unknown migration argument: unexpected-position');
  });

  it('reconstructs normalized metrics and HRV samples with Sleep references', () => {
    const candidate = buildCOROSLegacyHealthMigrationCandidate(
      legacySleepSession(),
      'user-1',
      SLEEP_DOCUMENT_ID,
    );

    expect(candidate).not.toBeNull();
    const input = validateHealthSourceRecordInput(candidate?.health.input);
    expect(input).toMatchObject({
      sourceRecordType: 'coros_daily',
      sourceRecordKey: '20260428',
      calendarDate: '2026-04-28',
    });
    expect(input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.Steps }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.TotalEnergy }),
      expect.objectContaining({
        kind: 'sleep_reference',
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        reference: expect.objectContaining({
          documentId: SLEEP_DOCUMENT_ID,
          field: HEALTH_SLEEP_REFERENCE_FIELDS.OvernightHrv,
        }),
      }),
    ]));
    expect(input.sampleSeries.find(series => series.metricId === HEALTH_METRIC_IDS.HeartRateVariability))
      .toMatchObject({
        nativeValues: [58, 60],
        canonicalValues: [58, 60],
      });
    expect(candidate?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recovers a valid Sleep date when the duplicate provider day is malformed', () => {
    const legacy = legacySleepSession();
    (legacy.providerFields as { coros: Record<string, unknown> }).coros.happenDay = 'invalid';

    const candidate = buildCOROSLegacyHealthMigrationCandidate(
      legacy,
      'user-1',
      SLEEP_DOCUMENT_ID,
    );

    expect(candidate?.health.input.sourceRecordKey).toBe('20260428');
    expect(candidate?.health.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.RestingHeartRate,
        semanticVariant: 'daily_resting',
      }),
    ]));
  });

  it('leaves inconsistent referenced Sleep vitals untouched for operator review', () => {
    const legacy = legacySleepSession();
    (legacy.vitals as Record<string, unknown>).restingHeartRateBpm = 0;

    expect(buildCOROSLegacyHealthMigrationCandidate(
      legacy,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();
  });

  it('ignores already-cleaned sessions and unsafe legacy records', () => {
    const cleaned = legacySleepSession();
    cleaned.hrvSamples = null;
    cleaned.providerFields = {
      coros: {
        happenDay: '20260428',
        step: null,
        calorie: null,
        rhr: null,
        ppgHrv: null,
        sleepAvgHr: null,
      },
    };
    expect(buildCOROSLegacyHealthMigrationCandidate(cleaned, 'user-1', SLEEP_DOCUMENT_ID)).toBeNull();

    const wrongProvider = legacySleepSession();
    (wrongProvider.source as Record<string, unknown>).provider = 'GarminAPI';
    expect(buildCOROSLegacyHealthMigrationCandidate(wrongProvider, 'user-1', SLEEP_DOCUMENT_ID)).toBeNull();
    expect(buildCOROSLegacyHealthMigrationCandidate(legacySleepSession(), 'user-1', 'unsafe/id')).toBeNull();
  });

    it('skips malformed legacy records instead of aborting the migration page', () => {
    const invalidMovedStep = legacySleepSession();
    (invalidMovedStep.providerFields as { coros: Record<string, unknown> }).coros.step = -1;
    expect(buildCOROSLegacyHealthMigrationCandidate(
      invalidMovedStep,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const invalidMovedVital = legacySleepSession();
    (invalidMovedVital.providerFields as { coros: Record<string, unknown> }).coros.ppgHrv = 'invalid';
    expect(buildCOROSLegacyHealthMigrationCandidate(
      invalidMovedVital,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const tooManyHrvSamples = legacySleepSession();
    tooManyHrvSamples.hrvSamples = Array.from({ length: 1_441 }, (_, index) => ({
      offsetSeconds: index,
      value: 50,
    }));
    expect(buildCOROSLegacyHealthMigrationCandidate(
      tooManyHrvSamples,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const outOfRangeTimestamp = legacySleepSession();
    outOfRangeTimestamp.startTimeMs = Number.MAX_SAFE_INTEGER;
    outOfRangeTimestamp.endTimeMs = Number.MAX_SAFE_INTEGER;
    expect(buildCOROSLegacyHealthMigrationCandidate(
      outOfRangeTimestamp,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const nullTimestampWithOffset = legacySleepSession();
    nullTimestampWithOffset.hrvSamples = [{
      timestampMs: null,
      offsetSeconds: 3_600,
      value: 58,
    }];
    const recoveredOffsetCandidate = buildCOROSLegacyHealthMigrationCandidate(
      nullTimestampWithOffset,
      'user-1',
      SLEEP_DOCUMENT_ID,
    );
    expect(recoveredOffsetCandidate?.health.input.sampleSeries[0]?.offsetMs).toEqual([3_600_000]);

    const outOfWindowHrvSample = legacySleepSession();
    outOfWindowHrvSample.hrvSamples = [{
      timestampMs: Date.parse('2026-04-25T01:00:00.000Z'),
      value: 58,
    }];
    expect(buildCOROSLegacyHealthMigrationCandidate(
      outOfWindowHrvSample,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const mismatchedProviderDay = legacySleepSession();
    (mismatchedProviderDay.providerFields as { coros: Record<string, unknown> }).coros.happenDay = '20260528';
    expect(buildCOROSLegacyHealthMigrationCandidate(
      mismatchedProviderDay,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const duplicateHrvTimestamp = legacySleepSession();
    duplicateHrvTimestamp.hrvSamples = [
      { timestampMs: Date.parse('2026-04-28T01:00:00.000Z'), value: 58 },
      { timestampMs: Date.parse('2026-04-28T01:00:00.000Z'), value: 60 },
    ];
    expect(buildCOROSLegacyHealthMigrationCandidate(
      duplicateHrvTimestamp,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const lossySubsecondHrvTimestamp = legacySleepSession();
    lossySubsecondHrvTimestamp.hrvSamples = [{
      timestampMs: Date.parse('2026-04-28T01:00:00.000Z') + 1,
      value: 58,
    }];
    expect(buildCOROSLegacyHealthMigrationCandidate(
      lossySubsecondHrvTimestamp,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();

    const overlongSleep = legacySleepSession();
    overlongSleep.startTimeMs = Date.parse('2026-04-26T01:00:00.000Z');
    expect(buildCOROSLegacyHealthMigrationCandidate(
      overlongSleep,
      'user-1',
      SLEEP_DOCUMENT_ID,
    )).toBeNull();
  });
});
