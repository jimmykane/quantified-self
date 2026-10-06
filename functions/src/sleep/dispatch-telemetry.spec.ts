import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';

const { loggerInfo } = vi.hoisted(() => ({ loggerInfo: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ info: loggerInfo }));

import {
    GARMIN_DISPATCH_IGNORED_SAMPLE_RATE,
    logGarminDispatchSummary,
    SleepDispatchReconciliationTelemetry,
    type GarminDispatchOutcome,
} from './dispatch-telemetry';

describe('temporary Garmin dispatch telemetry', () => {
    beforeEach(() => {
        loggerInfo.mockReset();
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });
    afterEach(() => vi.restoreAllMocks());

    function log(outcome: GarminDispatchOutcome, queueItem: unknown = {}) {
        logGarminDispatchSummary({
            queueItem: () => queueItem, outcome, writeKind: 'update', startedAtMs: performance.now() - 5,
            enqueueConfirmed: false,
        });
        return loggerInfo.mock.calls.at(-1)?.[1];
    }

    it('samples ignored calls at five percent and exposes the estimation weight', () => {
        expect(log('same_revision')).toMatchObject({
            telemetryVersion: 1, dispatchSource: 'firestore', outcome: 'same_revision',
            sampleRate: 0.05, sampleWeight: 20,
        });
        vi.mocked(Math.random).mockReturnValue(GARMIN_DISPATCH_IGNORED_SAMPLE_RATE);
        log('same_revision');
        expect(loggerInfo).toHaveBeenCalledTimes(1);
    });

    it('does not decode a snapshot when an ignored invocation is not sampled', () => {
        vi.mocked(Math.random).mockReturnValue(0.99);
        const queueItem = vi.fn(() => { throw new Error('snapshot must not be decoded'); });
        logGarminDispatchSummary({
            queueItem, outcome: 'deleted_write', writeKind: 'delete', startedAtMs: performance.now(),
            enqueueConfirmed: false,
        });
        expect(queueItem).not.toHaveBeenCalled();
        expect(loggerInfo).not.toHaveBeenCalled();
    });

    it.each<GarminDispatchOutcome>([
        'dispatched', 'stale', 'leased', 'deleted', 'deferred', 'error',
    ])('records every admitted %s outcome even outside the ignored-call sample', outcome => {
        vi.mocked(Math.random).mockReturnValue(0.99);
        expect(log(outcome)).toMatchObject({ outcome, sampleRate: 1, sampleWeight: 1 });
        expect(Math.random).not.toHaveBeenCalled();
    });

    it('allows only workload categories and relative times in the log payload', () => {
        const nowMs = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        const fields = log('dispatched', {
            provider: 'GarminAPI', type: 'garmin_ping_batch', dateCreated: nowMs - 1234,
            userID: 'private-user', id: 'private-row', queueRevision: 'private-revision',
            providerUserId: 'private-provider', garminCallbackURLs: ['https://private.example/token'],
            rawPayload: { privateHealth: 42 },
        });
        expect(fields).toMatchObject({
            provider: 'GarminAPI', queueType: 'garmin_ping_batch', queueAgeMs: 1234,
            writeKind: 'update', durationMs: expect.any(Number),
        });
        expect(Object.keys(fields).sort()).toEqual([
            'dispatchSource', 'durationMs', 'enqueueConfirmed', 'outcome', 'provider', 'queueAgeMs', 'queueType',
            'sampleRate', 'sampleWeight', 'telemetryVersion', 'writeKind',
        ].sort());
        expect(JSON.stringify(fields)).not.toContain('private');
    });

    it.each([undefined, null, { provider: 'private-user', type: 'private-row' }])(
        'maps absent or unrecognized dimensions to unknown', queueItem => {
            expect(log('error', queueItem)).toMatchObject({
                provider: 'unknown', queueType: 'unknown', queueAgeMs: null,
            });
        },
    );

    it.each(['1234', -1, Infinity, NaN, Date.now() + 100_000])(
        'does not invent queue age for invalid or future timestamps', dateCreated => {
            expect(log('error', { dateCreated })).toMatchObject({ queueAgeMs: null });
        },
    );

    it('ignores logger and sampler failures', () => {
        loggerInfo.mockImplementation(() => { throw new Error('logger unavailable'); });
        expect(() => log('error')).not.toThrow();
        vi.mocked(Math.random).mockImplementation(() => { throw new Error('sampler unavailable'); });
        expect(() => log('same_revision')).not.toThrow();
    });

    it('aggregates reconciliation by safe workload dimensions without exposing documents', () => {
        const telemetry = new SleepDispatchReconciliationTelemetry();
        const counts = telemetry.inspect({
            provider: 'GarminAPI', type: 'garmin_ping_batch', dateCreated: 100,
            userID: 'private-user', garminCallbackURLs: ['private-url'],
        }, 500);
        counts.markedDispatched += 1;
        telemetry.inspect({ provider: 'GarminAPI', type: 'garmin_ping_batch', dateCreated: 300 }, 500);
        telemetry.inspect({ provider: 'private-provider', type: 'private-type', dateCreated: 'invalid' }, 500);
        const totals = { inspected: 3, dispatched: 1, skippedRecent: 0 };
        expect(telemetry.complete(totals)).toBe(totals);
        expect(loggerInfo).toHaveBeenCalledOnce();
        const fields = loggerInfo.mock.calls[0][1];
        expect(fields).toMatchObject({
            ...totals, dispatchSource: 'scheduled', telemetryVersion: 1,
            workloads: [
                expect.objectContaining({
                    provider: 'GarminAPI', queueType: 'garmin_ping_batch', inspected: 2,
                    markedDispatched: 1, oldestQueueAgeMs: 400,
                }),
                expect.objectContaining({
                    provider: 'unknown', queueType: 'unknown', inspected: 1, oldestQueueAgeMs: null,
                }),
            ],
        });
        expect(JSON.stringify(fields)).not.toContain('private');
    });

    it('preserves reconciliation totals if the aggregate logger fails', () => {
        const telemetry = new SleepDispatchReconciliationTelemetry();
        loggerInfo.mockImplementation(() => { throw new Error('logger unavailable'); });
        const totals = { inspected: 0, dispatched: 0, skippedRecent: 0 };
        expect(telemetry.complete(totals)).toBe(totals);
    });
});
