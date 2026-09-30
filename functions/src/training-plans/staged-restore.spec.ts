import { describe, expect, it } from 'vitest';
import type { RestoreTrainingScheduleRevisionRequestV1 } from '../../../shared/training-plans';
import { hashTrainingScheduleRequestPayload } from './persistence';
import { readBulkRestoreLock, stagedRestoreIntentHash } from './staged-restore';

const request: RestoreTrainingScheduleRevisionRequestV1 = {
    mutationId: 'restore-original',
    scope: { kind: 'plan', id: 'plan-1' },
    targetRevision: 2,
    expectedRevisions: [
        { scope: 'state', id: 'current', revision: 3 },
        { scope: 'plan', id: 'plan-1', revision: 3 },
    ],
};

function lock() {
    return {
        schemaVersion: 1,
        kind: 'restore-plan',
        phase: 'staging',
        request,
        requestHash: hashTrainingScheduleRequestPayload(request),
        intentHash: stagedRestoreIntentHash(request),
        aliases: [],
        planId: 'plan-1',
        stateRevision: 3,
        planRevision: 3,
        createdAtMs: 1,
        nextAttemptAtMs: 2,
        attempts: 0,
        nextIndex: 0,
    };
}

describe('staged Training restore lock', () => {
    it('treats equivalent expected-revision order as one restore intent but retains exact request hashes', () => {
        const replacement = { ...request, mutationId: 'restore-replacement',
            expectedRevisions: [...request.expectedRevisions].reverse() };
        expect(stagedRestoreIntentHash(replacement)).toBe(stagedRestoreIntentHash(request));
        expect(hashTrainingScheduleRequestPayload(replacement)).not.toBe(hashTrainingScheduleRequestPayload(request));
        expect(readBulkRestoreLock({ ...lock(), aliases: [{ mutationId: replacement.mutationId,
            requestHash: hashTrainingScheduleRequestPayload(replacement) }] }).aliases).toHaveLength(1);
    });

    it('rejects malformed ownership, repeated aliases, and incomplete applying cursors', () => {
        expect(() => readBulkRestoreLock({ ...lock(), planId: 'other-plan' })).toThrow();
        expect(() => readBulkRestoreLock({ ...lock(), requestHash: 'bad' })).toThrow();
        expect(() => readBulkRestoreLock({ ...lock(), aliases: [{ mutationId: request.mutationId,
            requestHash: hashTrainingScheduleRequestPayload(request) }] })).toThrow();
        expect(() => readBulkRestoreLock({ ...lock(), phase: 'applying' })).toThrow();
        expect(() => readBulkRestoreLock({ ...lock(), phase: 'applying', changedWorkoutIds: [],
            nextIndex: 1, afterState: {}, afterPlans: [], revisions: [], response: {} })).toThrow();
    });
});
