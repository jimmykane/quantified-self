'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-fetch BEFORE importing the module
vi.mock('node-fetch', () => {
    const fetchMock = vi.fn();
    return {
        default: fetchMock,
        __esModule: true
    };
});

// Mock firebase-functions/v2/https
vi.mock('firebase-functions/v2/https', () => {
    return {
        onCall: (options: any, handler: any) => {
            return handler;
        },
        HttpsError: class HttpsError extends Error {
            code: string;
            constructor(code: string, message: string) {
                super(message);
                this.code = code;
                this.name = 'HttpsError';
            }
        }
    };
});

import { stWorkoutDownloadAsFit } from './st-workout-download-as-fit';
import fetch from 'node-fetch';

// Helper to create mock request
function createMockRequest(overrides: Partial<{
    auth: { uid: string } | null;
    app: object | null;
    data: any;
}> = {}) {
    return {
        auth: overrides.auth !== undefined ? overrides.auth : { uid: 'test-user-id' },
        app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
        data: overrides.data ?? {},
    };
}

describe('stWorkoutDownloadAsFit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should block unauthenticated requests', async () => {
        const request = createMockRequest({
            auth: null,
            data: { activityID: '123' }
        });

        await expect(stWorkoutDownloadAsFit(request as any)).rejects.toThrow();

        try {
            await stWorkoutDownloadAsFit(request as any);
        } catch (e: any) {
            expect(e.code).toBe('unauthenticated');
        }
    });

    it('should block requests without App Check', async () => {
        const request = createMockRequest({
            app: null,
            data: { activityID: '123' }
        });

        await expect(stWorkoutDownloadAsFit(request as any)).rejects.toThrow();

        try {
            await stWorkoutDownloadAsFit(request as any);
        } catch (e: any) {
            expect(e.code).toBe('failed-precondition');
        }
    });

    it('should throw error if activityID is missing', async () => {
        const request = createMockRequest({
            data: {}
        });

        await expect(stWorkoutDownloadAsFit(request as any)).rejects.toThrow();

        try {
            await stWorkoutDownloadAsFit(request as any);
        } catch (e: any) {
            expect(e.code).toBe('invalid-argument');
            expect(e.message).toBe('No activity ID provided.');
        }
    });

    it('should fetch from sports-tracker and return base64 data', async () => {
        const mockBuffer = Buffer.from('mock fit data');
        (fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockBuffer.buffer.slice(
                mockBuffer.byteOffset,
                mockBuffer.byteOffset + mockBuffer.byteLength
            ))
        });

        const request = createMockRequest({
            data: { activityID: '123' }
        });

        const result = await stWorkoutDownloadAsFit(request as any);

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('123'), expect.any(Object));
        expect(result).toHaveProperty('file');
        expect(typeof result.file).toBe('string');
        // Verify it's base64
        expect(() => Buffer.from(result.file, 'base64')).not.toThrow();
    });

    it('should throw error if fetch fails', async () => {
        (fetch as any).mockResolvedValue({
            ok: false,
            status: 500,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
        });

        const request = createMockRequest({
            data: { activityID: '456' }
        });

        await expect(stWorkoutDownloadAsFit(request as any)).rejects.toThrow();

        try {
            await stWorkoutDownloadAsFit(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
        }
    });
});
