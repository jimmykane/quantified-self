import { describe, expect, it, vi } from 'vitest';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_METRIC_SCHEMA_VERSION,
    DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION,
    type DerivedMetricKind,
} from '../../../shared/derived-metrics';

const callableRegistration = vi.hoisted(() => ({
    options: [] as unknown[],
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((options: unknown, handler: unknown) => {
        callableRegistration.options.push(options);
        return handler;
    }),
    HttpsError: class HttpsError extends Error {
        constructor(public readonly code: string, message: string) {
            super(message);
        }
    },
}));

import {
    decideDerivedMetricsFreshness,
    isDerivedMetricSnapshotReadableByMcp,
    prepareDerivedMetricsForUser,
    resolveDerivedMetricKindsToQueue,
    resolveDerivedMetricSnapshotPayloadValidity,
    resolveReadyDerivedMetricKinds,
} from './ensure-derived-metrics';

type SnapshotShape = {
    status: string | null;
    schemaVersion: number | null;
    builtFromEventMutationVersion: number | null;
    asOfDayMs: number | null;
    payloadValid: boolean;
};

function buildMetricSnapshots(
    overrides?: Partial<Record<DerivedMetricKind, Partial<SnapshotShape>>>,
): Record<DerivedMetricKind, SnapshotShape> {
    const allKinds = Object.values(DERIVED_METRIC_KINDS) as DerivedMetricKind[];
    return allKinds.reduce((result, kind) => {
        const override = overrides?.[kind] || {};
        result[kind] = {
            status: override.status ?? 'ready',
            schemaVersion: override.schemaVersion ?? DERIVED_METRIC_SCHEMA_VERSION,
            builtFromEventMutationVersion: override.builtFromEventMutationVersion ?? 10,
            asOfDayMs: override.asOfDayMs ?? Date.UTC(2026, 3, 15),
            payloadValid: override.payloadValid ?? true,
        };
        return result;
    }, {} as Record<DerivedMetricKind, SnapshotShape>);
}

describe('decideDerivedMetricsFreshness', () => {
    const nowMs = Date.UTC(2026, 3, 15, 12, 0, 0);
    const baseInput = {
        metricKinds: [DERIVED_METRIC_KINDS.FormNow],
        nowMs,
        coordinatorStatus: 'idle' as const,
        coordinatorCompletedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorRequestedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorStartedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorUpdatedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorEventMutationVersion: 10,
        latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 9, 0, 0),
        metricSnapshotsByKind: buildMetricSnapshots({
            [DERIVED_METRIC_KINDS.FormNow]: {
                asOfDayMs: Date.UTC(2026, 3, 15),
            },
        }),
    };

    it('uses enough memory for concurrent coordinator and snapshot reads', () => {
        expect(callableRegistration.options).toContainEqual(expect.objectContaining({
            memory: '512MiB',
            timeoutSeconds: 120,
            maxInstances: 100,
        }));
    });

    it('returns fresh when requested metric snapshot is aligned and projected to today', () => {
        const decision = decideDerivedMetricsFreshness(baseInput);
        expect(decision).toEqual({
            shouldQueue: false,
            metricKindsToQueue: [],
            reason: 'fresh',
        });
    });

    it('reports only independently fresh snapshots as ready and waits for in-flight work', () => {
        const metricKinds = [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d];
        const input = {
            ...baseInput,
            metricKinds,
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormPlus7d]: { asOfDayMs: Date.UTC(2026, 3, 14) },
            }),
        };
        expect(resolveReadyDerivedMetricKinds(input)).toEqual([DERIVED_METRIC_KINDS.FormNow]);
        expect(resolveReadyDerivedMetricKinds({ ...input, coordinatorStatus: 'processing' })).toEqual([]);
    });

    it('adds an unscheduled stale kind while another kind is processing', () => {
        const input = {
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d],
            coordinatorStatus: 'processing' as const,
            coordinatorStartedAtMs: nowMs - 1_000,
            coordinatorUpdatedAtMs: nowMs - 1_000,
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormPlus7d]: { status: 'building' },
            }),
        };
        expect(resolveDerivedMetricKindsToQueue({
            input, generation: 5, scheduledMetricKinds: [DERIVED_METRIC_KINDS.FormNow],
        })).toEqual([DERIVED_METRIC_KINDS.FormPlus7d]);
        expect(resolveDerivedMetricKindsToQueue({
            input, generation: 5,
            scheduledMetricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d],
        })).toEqual([]);
    });

    it('queues only calendar-sensitive stale kinds when asOfDay is behind today', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d],
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { asOfDayMs: Date.UTC(2026, 3, 14) },
                [DERIVED_METRIC_KINDS.FormPlus7d]: { asOfDayMs: Date.UTC(2026, 3, 15) },
            }),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'calendar_day_behind',
        });
    });

    it('refreshes a build comparison when its current window is from yesterday', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.TrainingBuildComparison]: { asOfDayMs: Date.UTC(2026, 3, 14) },
            }),
        });

        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
            reason: 'calendar_day_behind',
        });
    });

    it('queues only the requested snapshot whose schema version is behind', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1 },
                [DERIVED_METRIC_KINDS.Acwr]: { schemaVersion: DERIVED_METRIC_SCHEMA_VERSION },
            }),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'schema_version_mismatch',
        });
    });

    it('does not report a future schema version ready before MCP can read it', () => {
        const input = {
            ...baseInput,
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { schemaVersion: DERIVED_METRIC_SCHEMA_VERSION + 1 },
            }),
        };
        expect(decideDerivedMetricsFreshness(input).reason).toBe('schema_version_mismatch');
        expect(resolveReadyDerivedMetricKinds(input)).toEqual([]);
    });

    it('does not report a null payload ready before MCP can read it', () => {
        expect(resolveDerivedMetricSnapshotPayloadValidity(DERIVED_METRIC_KINDS.FormNow, null)).toBe(false);
        const input = {
            ...baseInput,
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { payloadValid: false },
            }),
        };
        expect(decideDerivedMetricsFreshness(input).reason).toBe('invalid_metric_payload');
        expect(resolveReadyDerivedMetricKinds(input)).toEqual([]);
    });

    it('rejects a projected payload that the MCP Training read cannot serve', () => {
        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingSummary, {},
        )).toBe(true);
        expect(isDerivedMetricSnapshotReadableByMcp(
            DERIVED_METRIC_KINDS.TrainingSummary, {},
        )).toBe(false);
    });

    it('queues hard- and calendar-stale snapshots together in request order', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d],
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: {
                    schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1,
                    asOfDayMs: Date.UTC(2026, 3, 15),
                },
                [DERIVED_METRIC_KINDS.FormPlus7d]: {
                    asOfDayMs: Date.UTC(2026, 3, 14),
                },
            }),
        });

        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.FormPlus7d],
            reason: 'schema_version_mismatch',
        });
    });

    it('queues all requested kinds when requested snapshot is missing', () => {
        const snapshots = buildMetricSnapshots();
        snapshots[DERIVED_METRIC_KINDS.FormNow] = {
            status: null,
            schemaVersion: null,
            builtFromEventMutationVersion: null,
            asOfDayMs: null,
            payloadValid: false,
        };
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricSnapshotsByKind: snapshots,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'missing_metric_snapshot',
        });
    });

    it('keeps queued coordinator as fresh until stuck threshold is exceeded', () => {
        const healthyDecision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: nowMs - (9 * 60 * 1000),
            coordinatorUpdatedAtMs: nowMs - (9 * 60 * 1000),
        });
        expect(healthyDecision).toEqual({
            shouldQueue: false,
            metricKindsToQueue: [],
            reason: 'fresh',
        });

        const stuckDecision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: nowMs - (11 * 60 * 1000),
            coordinatorUpdatedAtMs: nowMs - (11 * 60 * 1000),
        });
        expect(stuckDecision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'queued_stuck',
        });
    });

    it('requeues when processing exceeds stuck threshold', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'processing',
            coordinatorStartedAtMs: nowMs - (16 * 60 * 1000),
            coordinatorUpdatedAtMs: nowMs - (16 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'processing_stuck',
        });
    });

    it('requeues when latest event write is newer than the last completed run', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 11, 0, 0),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow],
            reason: 'latest_event_update_after_completion',
        });
    });

    it('queues the whole requested scope when a latest-event fallback accompanies a calendar-stale snapshot', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
            latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 11, 0, 0),
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { asOfDayMs: Date.UTC(2026, 3, 14) },
            }),
        });

        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
            reason: 'calendar_day_behind',
        });
    });

    it('queues the whole requested scope when a latest-event fallback accompanies a hard-stale snapshot', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
            latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 11, 0, 0),
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.FormNow]: { payloadValid: false },
            }),
        });

        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
            reason: 'invalid_metric_payload',
        });
    });

    it('queues a ready snapshot whose shared payload contract is invalid', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.TrainingReadiness],
            metricSnapshotsByKind: buildMetricSnapshots({
                [DERIVED_METRIC_KINDS.TrainingReadiness]: { payloadValid: false },
            }),
        });

        expect(decision).toEqual({
            shouldQueue: true,
            metricKindsToQueue: [DERIVED_METRIC_KINDS.TrainingReadiness],
            reason: 'invalid_metric_payload',
        });
    });

    it('uses the shared readiness contract to reject history from an older formula', () => {
        const asOfDayMs = Date.UTC(2026, 3, 15);
        const legacyPayload = {
            formulaVersion: 2,
            dayBoundary: 'UTC',
            asOfDayMs,
            generatedAtMs: asOfDayMs + (12 * 60 * 60 * 1000),
            historyDays: 14,
            points: Array.from({ length: 14 }, (_, index) => ({
                dayMs: asOfDayMs - ((13 - index) * 24 * 60 * 60 * 1000),
                score: 65,
                label: 'Mixed',
                confidence: 'low',
                availableSignalCount: 1,
                baselineEvidenceCount: 0,
                totalSignalCount: 4,
                form: 4,
                rampRate: 1,
                sleepScore: null,
                latestSleepAtMs: null,
                hrvRatio: null,
                averageHeartRateRatio: null,
                minimumHeartRateRatio: null,
                overnightHeartRateRatio: null,
            })),
        };

        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingReadiness,
            legacyPayload,
        )).toBe(false);
        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.Form,
            legacyPayload,
        )).toBe(true);
    });

    it('rebuilds only build comparisons created before the current recovery calculation', () => {
        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingBuildComparison,
            { recoveryVersion: DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION - 1 },
        )).toBe(false);
        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingBuildComparison,
            { recoveryVersion: DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION },
        )).toBe(true);
    });

    it('rebuilds durability snapshots that lack exact supporting-workout start times', () => {
        const legacyPayload = {
            scopes: [{
                recentSupportingEvents: [{ startDayMs: Date.UTC(2026, 7, 25) }],
            }],
        };
        const currentPayload = {
            scopes: [{
                recentSupportingEvents: [{
                    startDayMs: Date.UTC(2026, 7, 25),
                    startMs: Date.UTC(2026, 7, 25, 9),
                }],
            }],
        };

        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingDurability,
            legacyPayload,
        )).toBe(false);
        expect(resolveDerivedMetricSnapshotPayloadValidity(
            DERIVED_METRIC_KINDS.TrainingDurability,
            currentPayload,
        )).toBe(true);
    });
});

describe('prepareDerivedMetricsForUser', () => {
    const kind = DERIVED_METRIC_KINDS.FormNow;
    const nowMs = Date.UTC(2026, 3, 15, 12);
    const readyInput = {
        metricKinds: [kind], nowMs, coordinatorStatus: 'idle' as const,
        coordinatorCompletedAtMs: nowMs - 1_000, coordinatorRequestedAtMs: nowMs - 2_000,
        coordinatorStartedAtMs: nowMs - 2_000, coordinatorUpdatedAtMs: nowMs - 1_000,
        coordinatorEventMutationVersion: 1, latestEventUpdatedAtMs: null,
        metricSnapshotsByKind: buildMetricSnapshots({
            [kind]: { builtFromEventMutationVersion: 1, asOfDayMs: Date.UTC(2026, 3, 15) },
        }),
    };

    it('returns a ready snapshot after joining the existing queue once', async () => {
        const ensure = vi.fn().mockResolvedValue({ accepted: true, queued: false, generation: 3, metricKinds: [kind] });
        const readProbe = vi.fn()
            .mockResolvedValueOnce({ generation: 3, scheduledMetricKinds: [kind], input: { ...readyInput, coordinatorStatus: 'processing' } })
            .mockResolvedValueOnce({ generation: 3, scheduledMetricKinds: [], input: readyInput });
        const result = await prepareDerivedMetricsForUser('owner', [kind], 5_000, {
            ensure, readProbe, now: () => nowMs, sleep: vi.fn().mockResolvedValue(undefined),
        });
        expect(result).toEqual({ status: 'ready', metricKinds: [kind], readyMetricKinds: [kind], retryAfterSeconds: null });
        expect(ensure).toHaveBeenCalledOnce();
        expect(readProbe).toHaveBeenCalledTimes(2);
    });

    it('returns retry guidance after the bounded wait without queueing again', async () => {
        let currentMs = nowMs;
        const ensure = vi.fn().mockResolvedValue({ accepted: true, queued: true, generation: 3, metricKinds: [kind] });
        const readProbe = vi.fn().mockResolvedValue({ generation: 3, scheduledMetricKinds: [kind],
            input: { ...readyInput, coordinatorStatus: 'processing' } });
        const result = await prepareDerivedMetricsForUser('owner', [kind], 2_000, {
            ensure, readProbe, now: () => currentMs,
            sleep: vi.fn().mockImplementation(async (ms: number) => { currentMs += ms; }),
        });
        expect(result).toEqual({ status: 'preparing', metricKinds: [kind], readyMetricKinds: [], retryAfterSeconds: 5 });
        expect(ensure).toHaveBeenCalledOnce();
    });

    it('reports unavailable when the queue rejects the request', async () => {
        const ensure = vi.fn().mockResolvedValue({ accepted: false, queued: false, generation: null, metricKinds: [kind] });
        const readProbe = vi.fn();
        const result = await prepareDerivedMetricsForUser('owner', [kind], 5_000, {
            ensure, readProbe, now: () => nowMs, sleep: vi.fn(),
        });
        expect(result.status).toBe('unavailable');
        expect(readProbe).not.toHaveBeenCalled();
    });
});
