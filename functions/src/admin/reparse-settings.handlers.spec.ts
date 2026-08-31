import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { SetSportsLibReparseSettingsResponse } from '../../../shared/admin-queue-stats';
import {
    getAdminRequest,
    mockDoc,
    mockGetUser,
    setSportsLibReparseSettings,
} from './test-utils/admin-test-harness';

const invokeSettingsRequest = (
    request: CallableRequest<unknown>,
): Promise<SetSportsLibReparseSettingsResponse> => (
    setSportsLibReparseSettings as unknown as (
        request: CallableRequest<unknown>
    ) => Promise<SetSportsLibReparseSettingsResponse>
)(request);

const invokeSettings = (data: unknown): Promise<SetSportsLibReparseSettingsResponse> => (
    invokeSettingsRequest(getAdminRequest<unknown>(data))
);

describe('setSportsLibReparseSettings Cloud Function', () => {
    const checkpointSet = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        checkpointSet.mockResolvedValue(undefined);
        mockDoc.mockReturnValue({ set: checkpointSet });
        mockGetUser.mockResolvedValue({ uid: 'target-user' });
    });

    it('enables a targeted scan after validating the Firebase user', async () => {
        const result = await invokeSettings({
            enabled: true,
            targetUid: ' target-user ',
        });

        expect(mockGetUser).toHaveBeenCalledWith('target-user');
        expect(mockDoc).toHaveBeenCalledWith('systemJobs/sportsLibReparse');
        expect(checkpointSet).toHaveBeenCalledWith({
            runtimeSettings: {
                enabled: true,
                targetUid: 'target-user',
                updatedAt: 'mock-timestamp',
                updatedBy: 'admin',
            },
        }, { merge: true });
        expect(result).toEqual({
            success: true,
            settings: {
                enabled: true,
                targetUid: 'target-user',
                source: 'firestore',
                configurationValid: true,
                updatedAt: null,
                updatedBy: 'admin',
            },
        });
    });

    it('requires an authenticated admin caller', async () => {
        const requestWithoutAuth = {
            data: { enabled: false, targetUid: null },
            auth: undefined,
            app: { appId: 'test-app' },
        } as unknown as CallableRequest<unknown>;
        await expect(invokeSettingsRequest(requestWithoutAuth))
            .rejects.toMatchObject({ code: 'unauthenticated' });

        const nonAdminRequest = {
            data: { enabled: false, targetUid: null },
            auth: { uid: 'user', token: { admin: false } },
            app: { appId: 'test-app' },
        } as unknown as CallableRequest<unknown>;
        await expect(invokeSettingsRequest(nonAdminRequest))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(checkpointSet).not.toHaveBeenCalled();
    });

    it('enables a global scan when the target UID is blank', async () => {
        await invokeSettings({
            enabled: true,
            targetUid: '   ',
            confirmGlobal: true,
        });

        expect(mockGetUser).not.toHaveBeenCalled();
        expect(checkpointSet).toHaveBeenCalledWith(expect.objectContaining({
            runtimeSettings: expect.objectContaining({ enabled: true, targetUid: null }),
        }), { merge: true });
    });

    it('rejects an unconfirmed global enable request', async () => {
        await expect(invokeSettings({
            enabled: true,
            targetUid: null,
        })).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(mockGetUser).not.toHaveBeenCalled();
        expect(checkpointSet).not.toHaveBeenCalled();
    });

    it('allows an operator to disable immediately without requiring the retained target user to exist', async () => {
        mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });

        await invokeSettings({
            enabled: false,
            targetUid: 'deleted-user',
        });

        expect(mockGetUser).not.toHaveBeenCalled();
        expect(checkpointSet).toHaveBeenCalledWith(expect.objectContaining({
            runtimeSettings: expect.objectContaining({ enabled: false, targetUid: 'deleted-user' }),
        }), { merge: true });
    });

    it.each([
        { enabled: 'true', targetUid: null },
        { enabled: false, targetUid: null, confirmGlobal: 'yes' },
        { enabled: true, targetUid: 'invalid/user' },
        { enabled: true, targetUid: 'a'.repeat(129) },
    ])('rejects invalid settings without writing them: %j', async (data) => {
        await expect(invokeSettings(data))
            .rejects.toMatchObject({ code: 'invalid-argument' });

        expect(mockGetUser).not.toHaveBeenCalled();
        expect(checkpointSet).not.toHaveBeenCalled();
    });

    it('rejects an enabled target that is not a Firebase user', async () => {
        mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });

        await expect(invokeSettings({
            enabled: true,
            targetUid: 'missing-user',
        })).rejects.toMatchObject({ code: 'not-found' });

        expect(checkpointSet).not.toHaveBeenCalled();
    });

    it('returns a safe internal error when the checkpoint write fails', async () => {
        checkpointSet.mockRejectedValue({ code: 'firestore/unavailable' });

        await expect(invokeSettings({
            enabled: false,
            targetUid: null,
        })).rejects.toMatchObject({
            code: 'internal',
            message: 'Failed to save sports-lib reparse settings.',
        });
    });
});
