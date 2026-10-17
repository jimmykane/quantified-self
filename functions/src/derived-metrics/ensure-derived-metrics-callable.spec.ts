import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

const mocks = vi.hoisted(() => ({
    firestore: vi.fn(),
    get: vi.fn(),
    markDirty: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', async (importOriginal) => ({
    ...await importOriginal<typeof import('firebase-functions/v2/https')>(),
    onCall: vi.fn((_options, handler) => handler),
}));
vi.mock('firebase-admin', () => ({ firestore: mocks.firestore }));
vi.mock('./derived-metrics.service', () => ({ markDerivedMetricsDirtyAndMaybeQueue: mocks.markDirty }));
vi.mock('../mcp/data.service', () => ({ isMcpTrainingMetricPayloadReadable: vi.fn(() => false) }));

import { ensureDerivedMetrics } from './ensure-derived-metrics';

const invoke = ensureDerivedMetrics as unknown as (request: unknown) => Promise<unknown>;
const request = () => ({
    auth: { uid: 'synthetic-private-owner', token: { email: 'private@example.invalid' } },
    app: { appId: 'synthetic-private-app', token: 'synthetic-private-token' },
    data: { metricKinds: [DERIVED_METRIC_KINDS.FormNow], privateValue: 'synthetic-private-payload' },
    rawRequest: { headers: { authorization: 'synthetic-private-credentials' } },
});
const response = { accepted: true, queued: true, generation: 2, metricKinds: [DERIVED_METRIC_KINDS.FormNow] };

describe('ensureDerivedMetrics rejection diagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('FUNCTIONS_EMULATOR', 'false');
        mocks.get.mockReset().mockResolvedValue({ data: () => ({}), docs: [] });
        mocks.markDirty.mockReset().mockResolvedValue(response);
        const ref: Record<string, unknown> = { get: mocks.get };
        for (const method of ['doc', 'collection', 'orderBy', 'limit', 'select']) {
            ref[method] = vi.fn(() => ref);
        }
        mocks.firestore.mockReset().mockReturnValue(ref);
        vi.mocked(logger.warn).mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('keeps authentication rejection ahead of App Check and all data access', async () => {
        await expect(invoke({ ...request(), auth: undefined, app: undefined })).rejects.toMatchObject({
            code: 'unauthenticated', message: 'The function must be called while authenticated.',
        });
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            '[derived-metrics] ensureDerivedMetrics request rejected.',
            { stage: 'authentication', errorCode: 'unauthenticated', reason: 'authentication_required' },
        );
        expect(mocks.firestore).not.toHaveBeenCalled();
        expect(mocks.markDirty).not.toHaveBeenCalled();
    });

    it('logs only fixed labels for an unverified App Check context and preserves its response', async () => {
        await expect(invoke({ ...request(), app: undefined })).rejects.toMatchObject({
            code: 'failed-precondition', message: 'App Check verification failed.',
        });
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            '[derived-metrics] ensureDerivedMetrics request rejected.',
            { stage: 'app_check', errorCode: 'failed-precondition', reason: 'app_check_unverified' },
        );
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('synthetic-private');
        expect(mocks.firestore).not.toHaveBeenCalled();
        expect(mocks.markDirty).not.toHaveBeenCalled();
    });

    it('leaves successful freshness checks and metric selection unchanged without new logs', async () => {
        await expect(invoke(request())).resolves.toBe(response);
        expect(mocks.markDirty).toHaveBeenCalledExactlyOnceWith('synthetic-private-owner', [DERIVED_METRIC_KINDS.FormNow]);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('preserves the local emulator App Check bypass', async () => {
        vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
        await expect(invoke({ ...request(), app: undefined })).resolves.toBe(response);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('keeps an asynchronous HttpsError intact without logging its private message or details', async () => {
        const error = new HttpsError('resource-exhausted', 'synthetic-private-error', { uid: 'synthetic-private-owner' });
        mocks.get.mockRejectedValue(error);
        await expect(invoke(request())).rejects.toBe(error);
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            '[derived-metrics] ensureDerivedMetrics request rejected.',
            { stage: 'freshness_check', errorCode: 'resource-exhausted', reason: 'request_rejected' },
        );
        expect(logger.error).not.toHaveBeenCalled();
        expect(mocks.markDirty).not.toHaveBeenCalled();
    });

    it('leaves unexpected error logging to Firebase instead of duplicating it', async () => {
        const error = new Error('synthetic-private-error');
        mocks.get.mockRejectedValue(error);
        await expect(invoke(request())).rejects.toBe(error);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('preserves the original rejection if logging fails', async () => {
        vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logger failure'); });
        await expect(invoke({ ...request(), app: undefined })).rejects.toMatchObject({
            code: 'failed-precondition', message: 'App Check verification failed.',
        });
        expect(mocks.firestore).not.toHaveBeenCalled();
    });
});
