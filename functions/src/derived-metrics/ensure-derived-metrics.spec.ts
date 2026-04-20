import { describe, expect, it } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { decideDerivedMetricsFreshness } from './ensure-derived-metrics';

describe('decideDerivedMetricsFreshness', () => {
    const baseInput = {
        metricKinds: [DERIVED_METRIC_KINDS.Form],
        nowMs: Date.UTC(2026, 3, 15, 12, 0, 0),
        coordinatorStatus: 'idle' as const,
        coordinatorCompletedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorRequestedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorStartedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorUpdatedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorEventMutationVersion: 10,
        formSnapshotStatus: 'ready',
        formSnapshotBuiltFromEventMutationVersion: 10,
        latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 9, 0, 0),
    };

    it('returns fresh when coordinator and form snapshot are aligned with latest events', () => {
        const decision = decideDerivedMetricsFreshness(baseInput);
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('requests queue when form snapshot is missing for accounts with events', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            formSnapshotStatus: null,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'missing_form_snapshot',
        });
    });

    it('requests queue when snapshot build version is behind coordinator mutation version', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorEventMutationVersion: 11,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'event_mutation_version_behind',
        });
    });

    it('marks fresh when snapshot build version matches coordinator mutation version', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorEventMutationVersion: 12,
            formSnapshotBuiltFromEventMutationVersion: 12,
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('requeues once when legacy snapshots are missing build mutation version', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            formSnapshotBuiltFromEventMutationVersion: null,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'missing_snapshot_event_mutation_version',
        });
    });

    it('requeues when coordinator mutation version is missing', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorEventMutationVersion: null,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'missing_event_mutation_version',
        });
    });

    it('requests queue immediately when coordinator is failed', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'failed',
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'failed_status',
        });
    });

    it('keeps queued coordinator as fresh until stuck threshold is exceeded', () => {
        const healthyDecision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: baseInput.nowMs - (9 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (9 * 60 * 1000),
        });
        expect(healthyDecision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });

        const stuckDecision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: baseInput.nowMs - (11 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (11 * 60 * 1000),
        });
        expect(stuckDecision).toEqual({
            shouldQueue: true,
            reason: 'queued_stuck',
        });
    });

    it('requeues when processing exceeds stuck threshold', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'processing',
            coordinatorStartedAtMs: baseInput.nowMs - (16 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (16 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'processing_stuck',
        });
    });

    it('uses requestedAt for queued stuck detection even when updatedAt is recent', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: baseInput.nowMs - (11 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (2 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'queued_stuck',
        });
    });

    it('uses startedAt for processing stuck detection even when updatedAt is recent', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'processing',
            coordinatorStartedAtMs: baseInput.nowMs - (16 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (2 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'processing_stuck',
        });
    });

    it('queues when request contains non-form metrics and coordinator is idle', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'requested_metric_without_form',
        });
    });

    it('does not requeue non-form requests when coordinator is already queued and healthy', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            metricKinds: [DERIVED_METRIC_KINDS.RecoveryNow],
            coordinatorStatus: 'queued',
            coordinatorRequestedAtMs: baseInput.nowMs - (9 * 60 * 1000),
            coordinatorUpdatedAtMs: baseInput.nowMs - (9 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('keeps fresh when mutation versions match exactly', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorEventMutationVersion: 25,
            formSnapshotBuiltFromEventMutationVersion: 25,
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('requeues when latest event write is newer than the last completed run', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 11, 0, 0),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'latest_event_update_after_completion',
        });
    });
});
