import { describe, expect, it } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { decideDerivedMetricsFreshness } from './ensure-derived-metrics';

describe('decideDerivedMetricsFreshness', () => {
    const baseInput = {
        metricKinds: [DERIVED_METRIC_KINDS.Form],
        nowMs: Date.UTC(2026, 3, 15, 12, 0, 0),
        coordinatorStatus: 'idle' as const,
        coordinatorCompletedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        coordinatorUpdatedAtMs: Date.UTC(2026, 3, 15, 10, 0, 0),
        formSnapshotStatus: 'ready',
        formSnapshotSourceDocCount: 10,
        formRangeEndDayMs: Date.UTC(2026, 3, 15),
        latestEventStartDayMs: Date.UTC(2026, 3, 15),
        latestEventUpdatedAtMs: Date.UTC(2026, 3, 15, 9, 30, 0),
        latestEventCount: 10,
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

    it('requests queue when raw event count differs from form snapshot source doc count', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            latestEventCount: 11,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'event_count_mismatch',
        });
    });

    it('uses source doc count as freshness comparator for raw event parity', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            formSnapshotSourceDocCount: 12,
            latestEventCount: 12,
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('requeues once when legacy snapshots are missing source doc count', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            formSnapshotSourceDocCount: null,
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'missing_source_doc_count',
        });
    });

    it('requests queue when latest event date is beyond form snapshot range', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            latestEventStartDayMs: Date.UTC(2026, 3, 16),
        });
        expect(decision).toEqual({
            shouldQueue: true,
            reason: 'latest_event_beyond_form_range',
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
            coordinatorUpdatedAtMs: baseInput.nowMs - (9 * 60 * 1000),
        });
        expect(healthyDecision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });

        const stuckDecision = decideDerivedMetricsFreshness({
            ...baseInput,
            coordinatorStatus: 'queued',
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
            coordinatorUpdatedAtMs: baseInput.nowMs - (16 * 60 * 1000),
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
            coordinatorUpdatedAtMs: baseInput.nowMs - (9 * 60 * 1000),
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });

    it('does not requeue when latest event is on same UTC day as form range end', () => {
        const decision = decideDerivedMetricsFreshness({
            ...baseInput,
            latestEventStartDayMs: baseInput.formRangeEndDayMs,
        });
        expect(decision).toEqual({
            shouldQueue: false,
            reason: 'fresh',
        });
    });
});
