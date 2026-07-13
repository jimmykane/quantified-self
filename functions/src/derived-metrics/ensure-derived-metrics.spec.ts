import { describe, expect, it } from 'vitest';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_METRIC_SCHEMA_VERSION,
    type DerivedMetricKind,
} from '../../../shared/derived-metrics';
import { decideDerivedMetricsFreshness } from './ensure-derived-metrics';

type SnapshotShape = {
    status: string | null;
    schemaVersion: number | null;
    builtFromEventMutationVersion: number | null;
    asOfDayMs: number | null;
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

    it('returns fresh when requested metric snapshot is aligned and projected to today', () => {
        const decision = decideDerivedMetricsFreshness(baseInput);
        expect(decision).toEqual({
            shouldQueue: false,
            metricKindsToQueue: [],
            reason: 'fresh',
        });
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

    it('queues all requested kinds when schema version is behind', () => {
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
            metricKindsToQueue: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.Acwr],
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
});
