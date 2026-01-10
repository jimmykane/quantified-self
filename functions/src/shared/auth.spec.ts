import { vi, describe, it, expect, beforeEach } from 'vitest';
import { onAdminCall } from './auth';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';

const { mockOnCall } = vi.hoisted(() => {
    return {
        mockOnCall: vi.fn((_options: any, handler: any) => handler)
    };
});

vi.mock('firebase-functions/v2/https', () => ({
    onCall: mockOnCall,
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['*']
}));

describe('onAdminCall Wrapper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should throw "unauthenticated" if request has no auth', async () => {
        const handler = vi.fn();
        const wrapped = onAdminCall({}, handler);
        const request = { auth: undefined } as unknown as CallableRequest<any>;

        await expect(wrapped(request)).rejects.toThrow('The function must be called while authenticated.');
        expect(handler).not.toHaveBeenCalled();
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const handler = vi.fn();
        const wrapped = onAdminCall({}, handler);
        const request = {
            auth: { token: { admin: false } }
        } as unknown as CallableRequest<any>;

        await expect(wrapped(request)).rejects.toThrow('Only admins can call this function.');
        expect(handler).not.toHaveBeenCalled();
    });

    it('should execute handler if user is an admin', async () => {
        const handler = vi.fn().mockResolvedValue({ success: true });
        const wrapped = onAdminCall({}, handler);
        const request = {
            auth: { token: { admin: true } }
        } as unknown as CallableRequest<any>;

        const result = await wrapped(request);

        expect(result).toEqual({ success: true });
        expect(handler).toHaveBeenCalledWith(request);
    });

    it('should pass options to onCall', () => {
        const handler = vi.fn();
        onAdminCall({ memory: '512MiB', region: 'us-central1' }, handler);

        expect(mockOnCall).toHaveBeenCalledWith(
            expect.objectContaining({
                memory: '512MiB',
                region: 'us-central1',
                cors: ['*']
            }),
            expect.any(Function)
        );
    });
});
