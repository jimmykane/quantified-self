import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_FORM_PAYLOAD_VERSION,
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_ENTRY_TYPES,
} from '../../../shared/derived-metrics';
import {
  getMcpTrainingImpact,
  type McpTrainingImpactDocument,
  type McpTrainingImpactInput,
  type McpTrainingImpactReads,
} from './training-impact.service';

const DAY_ONE = Date.parse('2026-01-01T00:00:00.000Z');
const DAY_TWO = Date.parse('2026-01-02T00:00:00.000Z');
const NOW = Date.parse('2026-01-03T00:00:00.000Z');

function formSnapshot(
  dailyLoads: Array<{ dayMs: number; load: number }>,
  status: 'ready' | 'building' | 'failed' | 'stale' = 'ready',
) {
  return {
    entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
    metricKind: DERIVED_METRIC_KINDS.Form,
    schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
    status,
    payload: status === 'ready' ? {
      payloadVersion: DERIVED_FORM_PAYLOAD_VERSION,
      dayBoundary: 'UTC',
      rangeStartDayMs: dailyLoads[0]?.dayMs ?? null,
      rangeEndDayMs: dailyLoads[dailyLoads.length - 1]?.dayMs ?? null,
      dailyLoads: dailyLoads.map(entry => ({ ...entry, activityCount: 1 })),
      excludesMergedEvents: true,
    } : null,
  };
}

function activity(
  id: string,
  eventId: string,
  startDate: string,
  tss: unknown,
  legacyTss?: unknown,
): McpTrainingImpactDocument {
  return {
    id,
    data: {
      eventID: eventId,
      startDate: new Date(startDate),
      endDate: new Date(Date.parse(startDate) + 60 * 60 * 1000),
      stats: {
        ...(tss === undefined ? {} : { 'Training Stress Score': tss }),
        ...(legacyTss === undefined ? {} : { 'Power Training Stress Score': legacyTss }),
      },
    },
  };
}

function reads(options: {
  activities?: McpTrainingImpactDocument[];
  events?: McpTrainingImpactDocument[];
  snapshot?: Record<string, unknown> | null;
  activeOwner?: boolean;
} = {}): McpTrainingImpactReads {
  return {
    activeOwner: vi.fn().mockResolvedValue(options.activeOwner !== false),
    fetchActivities: vi.fn().mockResolvedValue(options.activities || [
      activity('activity-1', 'event-1', '2026-01-01T10:00:00.000Z', 42),
    ]),
    fetchEvents: vi.fn().mockResolvedValue(options.events || [
      { id: 'event-1', data: {} },
    ]),
    fetchFormSnapshot: vi.fn().mockResolvedValue(
      options.snapshot === undefined
        ? formSnapshot([{ dayMs: DAY_ONE, load: 42 }])
        : options.snapshot,
    ),
  };
}

function sessionInput(overrides: Partial<McpTrainingImpactInput> = {}): McpTrainingImpactInput {
  return {
    uid: 'user-1',
    mode: 'session',
    references: [{ activityId: 'activity-1', eventId: 'event-1' }],
    localDate: null,
    timeZone: null,
    nowMs: NOW,
    ...overrides,
  };
}

describe('MCP Training impact service', () => {
  it('models zero overrides and user exclusions without leaking policy data or calling them benchmarks', async () => {
    const loadReads = reads();
    loadReads.fetchLoadMetadata = vi.fn().mockResolvedValue(new Map([['event-1', {
      version: 1, revision: 1, excluded: false, controls: { 'activity-1': { override: 0 } },
    }]]));
    const zero = await getMcpTrainingImpact(sessionInput(), loadReads);
    expect(zero.contribution?.trainingStressScore).toBe(0);
    expect(zero.sessionRole).toBe('no-load');
    expect(JSON.stringify(zero)).not.toMatch(/controls|policy|revision|activity-1|event-1/);
    loadReads.fetchLoadMetadata = vi.fn().mockResolvedValue(new Map([['event-1', {
      version: 1, revision: 2, excluded: true, controls: {},
    }]]));
    const excluded = await getMcpTrainingImpact(sessionInput(), loadReads);
    expect(excluded).toMatchObject({ status: 'excluded', reason: 'no_usable_sessions', contribution: null,
      coverage: { excludedSessionCount: 1, benchmarkOrMergeSessionCount: 0, notCompletedSessionCount: 0 } });
  });
  it('holds impact while its Form snapshot predates the load edit', async () => {
    const loadReads = reads();
    loadReads.fetchLoadMetadata = vi.fn().mockResolvedValue(new Map([['event-1', {
      version: 1, revision: 2, excluded: false, controls: { 'activity-1': { override: 5 } }, updatedAt: NOW,
    }]]));
    expect(await getMcpTrainingImpact(sessionInput(), loadReads)).toMatchObject({ status: 'updating', reason: 'form_updating', contribution: null });
  });
  it('waits for the day rebuild when a different selected workout was just excluded', async () => {
    const loadReads = reads({ activities: [
      activity('activity-1', 'event-1', '2026-01-01T10:00:00.000Z', 42),
      activity('activity-2', 'event-2', '2026-01-01T12:00:00.000Z', 42),
    ], events: [{ id: 'event-1', data: {} }, { id: 'event-2', data: {} }],
    snapshot: formSnapshot([{ dayMs: DAY_ONE, load: 84 }]) });
    loadReads.fetchLoadMetadata = vi.fn().mockResolvedValue(new Map([['event-2', {
      version: 1, revision: 1, excluded: true, controls: {}, updatedAt: NOW,
    }]]));
    expect(await getMcpTrainingImpact(sessionInput({ mode: 'day', localDate: '2026-01-01', timeZone: 'UTC',
      references: [{ activityId: 'activity-1', eventId: 'event-1' }, { activityId: 'activity-2', eventId: 'event-2' }],
    }), loadReads)).toMatchObject({ status: 'updating', reason: 'form_updating', contribution: null,
      coverage: { excludedSessionCount: 1, benchmarkOrMergeSessionCount: 0 } });
  });
  it('returns a ready identity-free session contribution and actual UTC-day outcome', async () => {
    const result = await getMcpTrainingImpact(sessionInput(), reads());

    expect(result).toMatchObject({
      schemaVersion: 1,
      mode: 'session',
      localDate: null,
      timeZone: null,
      status: 'ready',
      reason: null,
      sessionRole: 'pushed-above-maintenance',
      coverage: {
        requestedSessionCount: 1,
        eligibleSessionCount: 1,
        modeledSessionCount: 1,
        missingTssSessionCount: 0,
        excludedSessionCount: 0,
        benchmarkOrMergeSessionCount: 0,
        notCompletedSessionCount: 0,
        unavailableSessionCount: 0,
      },
      contribution: {
        trainingStressScore: 42,
        fitnessLoadCtlContribution: 1,
        fatigueLoadAtlContribution: 6,
        freshnessFormContribution: -5,
      },
      outcomes: [{
        trainingDay: '2026-01-01',
        fitnessLoadOutcome: 'raised',
        fitnessLoadCtlChange: 1,
      }],
      model: {
        basis: 'TSS',
        ctlTimeConstantDays: 42,
        atlTimeConstantDays: 7,
        measuresPhysiologicalAdaptation: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /activity-1|event-1|provider|device|sourceKey|title|label/,
    );
  });

  it('uses wrapped legacy TSS and treats zero as a valid modeled contribution', async () => {
    const legacy = reads({
      activities: [activity(
        'activity-1',
        'event-1',
        '2026-01-01T10:00:00.000Z',
        undefined,
        { rawValue: 84 },
      )],
      snapshot: formSnapshot([{ dayMs: DAY_ONE, load: 84 }]),
    });
    await expect(getMcpTrainingImpact(sessionInput(), legacy)).resolves.toMatchObject({
      status: 'ready',
      contribution: {
        trainingStressScore: 84,
        fitnessLoadCtlContribution: 2,
      },
    });

    const zero = reads({
      activities: [activity(
        'activity-1',
        'event-1',
        '2026-01-01T10:00:00.000Z',
        { value: 0 },
      )],
      snapshot: formSnapshot([{ dayMs: DAY_ONE, load: 0 }]),
    });
    await expect(getMcpTrainingImpact(sessionInput(), zero)).resolves.toMatchObject({
      status: 'ready',
      sessionRole: 'no-load',
      contribution: {
        trainingStressScore: 0,
        fitnessLoadCtlContribution: 0,
        fatigueLoadAtlContribution: 0,
        freshnessFormContribution: 0,
      },
    });
  });

  it('keeps missing TSS, merge/benchmark records, and incomplete activities explicit', async () => {
    const missing = reads({
      activities: [activity(
        'activity-1',
        'event-1',
        '2026-01-01T10:00:00.000Z',
        undefined,
      )],
    });
    await expect(getMcpTrainingImpact(sessionInput(), missing)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'missing_tss',
      contribution: null,
    });
    expect(missing.fetchFormSnapshot).not.toHaveBeenCalled();

    const benchmark = reads({
      events: [{ id: 'event-1', data: { mergeType: 'benchmark' } }],
    });
    await expect(getMcpTrainingImpact(sessionInput(), benchmark)).resolves.toMatchObject({
      status: 'excluded',
      reason: 'benchmark_or_merge',
      contribution: null,
    });
    expect(benchmark.fetchFormSnapshot).not.toHaveBeenCalled();

    const merged = reads({
      events: [{ id: 'event-1', data: { isMerge: true } }],
    });
    await expect(getMcpTrainingImpact(sessionInput(), merged)).resolves.toMatchObject({
      status: 'excluded',
      reason: 'benchmark_or_merge',
    });

    const explicitMulti = reads({
      events: [{ id: 'event-1', data: { isMerge: true, mergeType: 'multi' } }],
    });
    await expect(getMcpTrainingImpact(sessionInput(), explicitMulti)).resolves.toMatchObject({
      status: 'ready',
      contribution: { trainingStressScore: 42 },
    });

    const pendingActivity = activity(
      'activity-1',
      'event-1',
      '2026-01-01T10:00:00.000Z',
      42,
    );
    pendingActivity.data.endDate = new Date(NOW + 1);
    await expect(getMcpTrainingImpact(
      sessionInput(),
      reads({ activities: [pendingActivity] }),
    )).resolves.toMatchObject({
      status: 'excluded',
      reason: 'not_completed',
    });
  });

  it.each([
    ['building', 'updating', 'form_updating'],
    ['stale', 'updating', 'form_updating'],
    ['failed', 'unavailable', 'form_failed'],
  ] as const)(
    'maps a %s Form snapshot to %s without calculating a contribution',
    async (snapshotStatus, expectedStatus, expectedReason) => {
      const result = await getMcpTrainingImpact(
        sessionInput(),
        reads({ snapshot: formSnapshot([], snapshotStatus) }),
      );
      expect(result).toMatchObject({
        status: expectedStatus,
        reason: expectedReason,
        contribution: null,
        sessionRole: null,
        outcomes: [],
        coverage: { unavailableSessionCount: 1 },
      });
    },
  );

  it('fails closed when a ready Form payload has inconsistent retained-range metadata', async () => {
    const malformed = formSnapshot([{ dayMs: DAY_ONE, load: 42 }]);
    (malformed.payload as { rangeEndDayMs: number | null }).rangeEndDayMs = null;

    await expect(getMcpTrainingImpact(
      sessionInput(),
      reads({ snapshot: malformed }),
    )).resolves.toMatchObject({
      status: 'updating',
      reason: 'form_updating',
      contribution: null,
      outcomes: [],
    });
  });

  it('returns one contribution total and separate outcomes for two UTC Training days', async () => {
    const dayReads = reads({
      activities: [
        activity('activity-1', 'event-1', '2026-01-01T22:30:00.000Z', 42),
        activity('activity-2', 'event-2', '2026-01-02T10:00:00.000Z', 84),
      ],
      events: [
        { id: 'event-1', data: {} },
        { id: 'event-2', data: {} },
      ],
      snapshot: formSnapshot([
        { dayMs: DAY_ONE, load: 42 },
        { dayMs: DAY_TWO, load: 84 },
      ]),
    });
    const result = await getMcpTrainingImpact({
      uid: 'user-1',
      mode: 'day',
      references: [
        { activityId: 'activity-1', eventId: 'event-1' },
        { activityId: 'activity-2', eventId: 'event-2' },
      ],
      localDate: '2026-01-02',
      timeZone: 'Europe/Helsinki',
      nowMs: NOW,
    }, dayReads);

    expect(result).toMatchObject({
      mode: 'day',
      localDate: '2026-01-02',
      timeZone: 'Europe/Helsinki',
      status: 'ready',
      sessionRole: null,
      contribution: {
        trainingStressScore: 126,
        fitnessLoadCtlContribution: 3,
        fatigueLoadAtlContribution: 18,
        freshnessFormContribution: -15,
      },
    });
    expect(result.outcomes.map(outcome => outcome.trainingDay)).toEqual([
      '2026-01-01',
      '2026-01-02',
    ]);
  });

  it('returns an aggregate partial result without exposing which activity was unavailable', async () => {
    const result = await getMcpTrainingImpact({
      uid: 'user-1',
      mode: 'day',
      references: [
        { activityId: 'activity-1', eventId: 'event-1' },
        { activityId: 'activity-2', eventId: 'event-2' },
        { activityId: 'activity-3', eventId: 'event-3' },
      ],
      localDate: '2026-01-01',
      timeZone: 'UTC',
      nowMs: NOW,
    }, reads({
      activities: [
        activity('activity-1', 'event-1', '2026-01-01T10:00:00.000Z', 42),
        activity('activity-2', 'event-2', '2026-01-01T11:00:00.000Z', undefined),
        activity('activity-3', 'event-3', '2026-01-01T12:00:00.000Z', 999),
      ],
      events: [
        { id: 'event-1', data: {} },
        { id: 'event-2', data: {} },
        { id: 'event-3', data: { isMerge: true } },
      ],
    }));

    expect(result).toMatchObject({
      status: 'partial',
      reason: 'partial_coverage',
      coverage: {
        requestedSessionCount: 3,
        eligibleSessionCount: 1,
        modeledSessionCount: 1,
        missingTssSessionCount: 1,
        excludedSessionCount: 1,
        benchmarkOrMergeSessionCount: 1,
        notCompletedSessionCount: 0,
        unavailableSessionCount: 0,
      },
      contribution: { trainingStressScore: 42 },
    });
    expect(result).not.toHaveProperty('sessions');
  });

  it('keeps one UTC outcome when the other half of a local day is outside retained Form history', async () => {
    const result = await getMcpTrainingImpact({
      uid: 'user-1',
      mode: 'day',
      references: [
        { activityId: 'activity-1', eventId: 'event-1' },
        { activityId: 'activity-2', eventId: 'event-2' },
      ],
      localDate: '2026-01-02',
      timeZone: 'Europe/Helsinki',
      nowMs: NOW,
    }, reads({
      activities: [
        activity('activity-1', 'event-1', '2026-01-01T22:30:00.000Z', 42),
        activity('activity-2', 'event-2', '2026-01-02T10:00:00.000Z', 84),
      ],
      events: [
        { id: 'event-1', data: {} },
        { id: 'event-2', data: {} },
      ],
      snapshot: formSnapshot([{ dayMs: DAY_TWO, load: 84 }]),
    }));

    expect(result).toMatchObject({
      status: 'partial',
      reason: 'partial_coverage',
      coverage: {
        requestedSessionCount: 2,
        eligibleSessionCount: 2,
        modeledSessionCount: 1,
        unavailableSessionCount: 1,
      },
      contribution: { trainingStressScore: 84 },
      outcomes: [{ trainingDay: '2026-01-02' }],
    });
  });

  it('rejects duplicate, cross-date, unavailable, and cross-owner selections', async () => {
    await expect(getMcpTrainingImpact(sessionInput({
      mode: 'day',
      references: [
        { activityId: 'activity-1', eventId: 'event-1' },
        { activityId: 'activity-1', eventId: 'event-1' },
      ],
      localDate: '2026-01-01',
      timeZone: 'UTC',
    }), reads())).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(getMcpTrainingImpact(sessionInput({
      mode: 'day',
      localDate: '2026-01-02',
      timeZone: 'UTC',
    }), reads())).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(getMcpTrainingImpact(sessionInput(), reads({ activities: [] })))
      .rejects.toMatchObject({ code: 'detail_not_available' });

    const inactive = reads({ activeOwner: false });
    await expect(getMcpTrainingImpact(sessionInput(), inactive))
      .rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(inactive.fetchActivities).not.toHaveBeenCalled();
    expect(inactive.fetchEvents).not.toHaveBeenCalled();
    expect(inactive.fetchFormSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed when owner deletion begins while the exact reads are in flight', async () => {
    const guardedReads = reads();
    vi.mocked(guardedReads.activeOwner)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(getMcpTrainingImpact(sessionInput(), guardedReads))
      .rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(guardedReads.fetchActivities).toHaveBeenCalledTimes(1);
    expect(guardedReads.fetchEvents).toHaveBeenCalledTimes(1);
    expect(guardedReads.fetchFormSnapshot).toHaveBeenCalledTimes(1);
  });

  it('treats a ready Form snapshot that does not contain the activity load as updating', async () => {
    const result = await getMcpTrainingImpact(
      sessionInput(),
      reads({ snapshot: formSnapshot([{ dayMs: DAY_ONE, load: 20 }]) }),
    );
    expect(result).toMatchObject({
      status: 'updating',
      reason: 'form_updating',
      contribution: null,
      coverage: { unavailableSessionCount: 1 },
    });
  });

  it('does not calculate a day when selected TSS exceeds the matching Form day in aggregate', async () => {
    const result = await getMcpTrainingImpact({
      uid: 'user-1',
      mode: 'day',
      references: [
        { activityId: 'activity-1', eventId: 'event-1' },
        { activityId: 'activity-2', eventId: 'event-2' },
      ],
      localDate: '2026-01-01',
      timeZone: 'UTC',
      nowMs: NOW,
    }, reads({
      activities: [
        activity('activity-1', 'event-1', '2026-01-01T10:00:00.000Z', 30),
        activity('activity-2', 'event-2', '2026-01-01T12:00:00.000Z', 30),
      ],
      events: [
        { id: 'event-1', data: {} },
        { id: 'event-2', data: {} },
      ],
      snapshot: formSnapshot([{ dayMs: DAY_ONE, load: 50 }]),
    }));

    expect(result).toMatchObject({
      status: 'updating',
      reason: 'form_updating',
      coverage: {
        requestedSessionCount: 2,
        eligibleSessionCount: 2,
        modeledSessionCount: 0,
        unavailableSessionCount: 2,
      },
      contribution: null,
      outcomes: [],
    });
  });
});
