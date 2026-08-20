import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const requestWahooAPI = vi.fn();
  const getTokenData = vi.fn();
  const isDisconnectPendingForUser = vi.fn();
  const getUserDeletionGuardState = vi.fn();
  const tokenRefGet = vi.fn();
  const tokenQueryGet = vi.fn();
  const loggerInfo = vi.fn();
  const loggerWarn = vi.fn();
  const hasProAccess = vi.fn();
  const recordActivitySyncOutboundFingerprint = vi.fn();
  const WahooAPIRequestError = class WahooAPIRequestError extends Error {
    constructor(
      _message: string,
      public statusCode: number,
      public resetAfterSeconds: number | null = null,
      public responseBody: unknown = null,
    ) {
      super(_message);
    }
  };
  const tokenRef = { get: tokenRefGet };
  return {
    requestWahooAPI,
    getTokenData,
    isDisconnectPendingForUser,
    getUserDeletionGuardState,
    tokenRefGet,
    tokenQueryGet,
    tokenRef,
    loggerInfo,
    loggerWarn,
    hasProAccess,
    recordActivitySyncOutboundFingerprint,
    WahooAPIRequestError,
  };
});

vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-functions/v2/https')>();
  return {
    ...actual,
    onCall: (_options: unknown, handler: unknown) => handler,
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          limit: () => ({ get: mocks.tokenQueryGet }),
        }),
      }),
    }),
  }),
}));

vi.mock('../tokens', () => ({ getTokenData: mocks.getTokenData }));
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: mocks.hasProAccess,
  };
});
vi.mock('../activity-sync/outbound-fingerprint', () => ({
  recordActivitySyncOutboundFingerprint: mocks.recordActivitySyncOutboundFingerprint,
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError: class ActivitySyncOutboundFingerprintSkippedForDeletedUserError extends Error {
    readonly name = 'ActivitySyncOutboundFingerprintSkippedForDeletedUserError';
  },
}));
vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: mocks.isDisconnectPendingForUser,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mocks.getUserDeletionGuardState,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('firebase-functions/logger', () => ({
  info: mocks.loggerInfo,
  warn: mocks.loggerWarn,
}));
vi.mock('./auth/api', () => ({
  requestWahooAPI: mocks.requestWahooAPI,
  WahooAPIRequestError: mocks.WahooAPIRequestError,
  WahooAPITransportError: class WahooAPITransportError extends Error {},
}));

import {
  getWahooActivityUploadStatus,
  getWahooAPIWorkoutFileUploadStatus,
  importActivityToWahooAPI,
  uploadActivityFileToWahoo,
} from './activities';
import { ActivitySyncOutboundFingerprintSkippedForDeletedUserError } from '../activity-sync/outbound-fingerprint';
import { WahooAPIRequestError, WahooAPITransportError } from './auth/api';
import { ProviderOperationError } from '../shared/provider-operation-error';


describe('Wahoo activity uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
    mocks.isDisconnectPendingForUser.mockResolvedValue(false);
    mocks.hasProAccess.mockResolvedValue(true);
    mocks.recordActivitySyncOutboundFingerprint.mockResolvedValue({
      exactFingerprintId: 'exact-v1-test',
      fingerprintIds: ['exact-v1-test'],
      activityTypes: ['Hiking'],
    });
    mocks.tokenQueryGet.mockResolvedValue({ docs: [{ ref: mocks.tokenRef }] });
    mocks.tokenRefGet.mockResolvedValue({ exists: true, id: 'wahoo-user' });
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      scope: 'user_read workouts_read workouts_write offline_data',
    });
  });

  it('creates a URL-encoded FIT upload with a safe filename and time zone', async () => {
    mocks.requestWahooAPI.mockResolvedValue({ data: { token: 'upload-1', status: 'pending' } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      filename: '../ride.fit',
      timeZone: 'Europe/Helsinki',
    })).resolves.toEqual({
      status: 'pending',
      message: 'Wahoo is processing the activity.',
      uploadId: 'upload-1',
      workoutKey: undefined,
    });

    const [, path, request] = mocks.requestWahooAPI.mock.calls[0];
    expect(path).toBe('/v1/workout_file_uploads');
    expect(request.method).toBe('POST');
    expect(request.form.get('workout_file_upload[file]')).toBe('data:application/vnd.fit;base64,RklU');
    expect(request.form.get('workout_file_upload[filename]')).toBe('.._ride.fit');
    expect(request.form.get('workout_file_upload[time_zone]')).toBe('Europe/Helsinki');
    expect(mocks.recordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
  });

  it('records a direct-upload echo receipt before posting the activity to Wahoo', async () => {
    mocks.requestWahooAPI.mockResolvedValue({ data: { token: 'upload-1', status: 'pending' } });
    const fileBuffer = Buffer.from('FIT');

    await expect(importActivityToWahooAPI({
      auth: { uid: 'user-1' },
      app: { appId: 'test-app' },
      data: { file: fileBuffer.toString('base64'), filename: 'ride.fit' },
    } as never)).resolves.toMatchObject({
      status: 'pending',
      uploadId: 'upload-1',
    });

    expect(mocks.recordActivitySyncOutboundFingerprint).toHaveBeenCalledWith({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer,
    });
    expect(mocks.recordActivitySyncOutboundFingerprint.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.requestWahooAPI.mock.invocationCallOrder[0]);
  });

  it('corrects a completed mapped activity before returning upload success', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-hike', status: 'complete', workout_id: 485861650 },
      })
      .mockResolvedValueOnce({ data: { id: 485861650 } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).resolves.toMatchObject({
      status: 'success',
      uploadId: 'upload-hike',
      workoutKey: '485861650',
      expectedWorkoutTypeId: 9,
    });

    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(2);
    expect(mocks.requestWahooAPI.mock.calls[0][1]).toBe('/v1/workout_file_uploads');
    const [, correctionPath, correctionRequest] = mocks.requestWahooAPI.mock.calls[1];
    expect(correctionPath).toBe('/v1/workouts/485861650');
    expect(correctionRequest.method).toBe('PUT');
    expect(correctionRequest.form.get('workout[workout_type_id]')).toBe('9');
    expect(correctionRequest.form.get('workout[name]')).toBeNull();
  });

  it('retains the accepted upload when disconnect begins before type correction', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: { token: 'upload-disconnect', status: 'complete', workout_id: 485861650 },
    });
    mocks.isDisconnectPendingForUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).rejects.toMatchObject({
      name: 'TokenUseSkippedForPendingDisconnectError',
      providerOperationId: 'upload-disconnect',
      expectedWorkoutTypeId: 9,
    });

    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
  });

  it('keeps Wahoo inference when no mapped activity type is supplied', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: { token: 'upload-unmapped', status: 'complete', workout_id: 485861651 },
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .resolves.toMatchObject({ status: 'success', uploadId: 'upload-unmapped' });

    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
    expect(mocks.requestWahooAPI.mock.calls[0][2]?.method).toBe('POST');
  });

  it('retries only status and the idempotent type PUT after a transient correction failure', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-resume', status: 'complete', workout_id: 485861652 },
      })
      .mockRejectedValueOnce(new WahooAPIRequestError('temporary', 500));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).rejects.toMatchObject({
      name: 'ProviderOperationError',
      disposition: 'retryable',
      retryMode: 'resume',
      providerOperationId: 'upload-resume',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_RETRY_EXHAUSTED',
    });

    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-resume', status: 'complete', workout_id: 485861652 },
      })
      .mockResolvedValueOnce({ data: { id: 485861652 } });

    await expect(getWahooActivityUploadStatus('user-1', 'upload-resume', 9))
      .resolves.toMatchObject({ status: 'success', expectedWorkoutTypeId: 9 });

    expect(mocks.requestWahooAPI.mock.calls.map(([, , request]) => request?.method || 'GET'))
      .toEqual(['POST', 'PUT', 'GET', 'PUT']);
  });

  it('fails closed when a mapped completed upload has no usable workout ID', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: { token: 'upload-no-workout', status: 'complete', workout_summary_id: 123 },
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).rejects.toMatchObject({
      disposition: 'permanent',
      providerOperationId: 'upload-no-workout',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_MISSING_WORKOUT_ID',
    });
    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
  });

  it('does not replay the FIT POST when correction requires a token refresh', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-auth-refresh', status: 'complete', workout_id: 485861653 },
      })
      .mockRejectedValueOnce(new WahooAPIRequestError('expired', 401))
      .mockResolvedValueOnce({ data: { id: 485861653 } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).resolves.toMatchObject({ status: 'success', uploadId: 'upload-auth-refresh' });

    expect(mocks.requestWahooAPI.mock.calls.map(([, , request]) => request?.method || 'GET'))
      .toEqual(['POST', 'PUT', 'PUT']);
    expect(mocks.getTokenData.mock.calls.map((call) => call[2])).toEqual([false, false, true]);
  });

  it('rejects client-supplied unknown workout type IDs before calling Wahoo', async () => {
    await expect(getWahooActivityUploadStatus('user-1', 'upload-1', 999))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('keeps Wahoo inferred type during a direct upload status check', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: { token: 'upload-status-resume', status: 'pending' },
    });
    await expect(importActivityToWahooAPI({
      auth: { uid: 'user-1' },
      app: { appId: 'test-app' },
      data: { file: Buffer.from('FIT').toString('base64') },
    } as never)).resolves.toMatchObject({ status: 'pending', uploadId: 'upload-status-resume' });

    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-status-resume', status: 'complete', workout_id: 485861654 },
      });

    await expect(getWahooAPIWorkoutFileUploadStatus({
      auth: { uid: 'user-1' },
      app: { appId: 'test-app' },
      data: {
        uploadId: 'upload-status-resume',
        // Deliberately ignored: direct uploads retain Wahoo's inferred type.
        expectedWorkoutTypeId: 9,
      },
    } as never)).resolves.toMatchObject({ status: 'success' });

    expect(mocks.requestWahooAPI.mock.calls.map(([, , request]) => request?.method || 'GET'))
      .toEqual(['POST', 'GET']);
  });

  it('stops before Wahoo when the direct-upload echo receipt cannot be written', async () => {
    mocks.recordActivitySyncOutboundFingerprint.mockRejectedValueOnce(
      new ActivitySyncOutboundFingerprintSkippedForDeletedUserError('user-1'),
    );

    await expect(importActivityToWahooAPI({
      auth: { uid: 'user-1' },
      app: { appId: 'test-app' },
      data: { file: Buffer.from('FIT').toString('base64') },
    } as never)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Account is being deleted or no longer exists.',
    });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('does not write a direct-upload echo receipt without a connected Wahoo account', async () => {
    mocks.tokenQueryGet.mockResolvedValueOnce({ docs: [] });

    await expect(importActivityToWahooAPI({
      auth: { uid: 'user-1' },
      app: { appId: 'test-app' },
      data: { file: Buffer.from('FIT').toString('base64') },
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.recordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('maps a duplicate Wahoo upload to the existing activity result contract', async () => {
    mocks.requestWahooAPI.mockResolvedValue({ data: { token: 'upload-2', status: 'duplicate', workout_id: 42 } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'))).resolves.toEqual({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in Wahoo.',
      uploadId: 'upload-2',
      workoutKey: '42',
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Wahoo reported a duplicate activity upload',
      expect.objectContaining({ operation: 'upload', status: 'duplicate' }),
    );
  });

  it('corrects a mapped duplicate when Wahoo identifies the existing workout', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { token: 'upload-duplicate-hike', status: 'duplicate', workout_id: 485861650 },
      })
      .mockResolvedValueOnce({ data: { id: 485861650 } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).resolves.toMatchObject({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      uploadId: 'upload-duplicate-hike',
      workoutKey: '485861650',
      expectedWorkoutTypeId: 9,
    });

    expect(mocks.requestWahooAPI.mock.calls.map(([, path, request]) => ({
      path,
      method: request?.method || 'GET',
    }))).toEqual([
      { path: '/v1/workout_file_uploads', method: 'POST' },
      { path: '/v1/workouts/485861650', method: 'PUT' },
    ]);
  });

  it('fails closed when a duplicate type correction cannot be resumed without an upload ID', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({
        data: { status: 'duplicate', workout_id: 485861650 },
      })
      .mockRejectedValueOnce(new WahooAPIRequestError('temporary', 500));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'), {
      expectedWorkoutTypeId: 9,
    })).rejects.toMatchObject({
      disposition: 'permanent',
      retryMode: 'none',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_DUPLICATE_NO_RESUME_ID',
    });

    expect(mocks.requestWahooAPI.mock.calls.map(([, , request]) => request?.method || 'GET'))
      .toEqual(['POST', 'PUT']);
  });

  it('treats an asynchronous Wahoo error marked as duplicate as an existing activity', async () => {
    mocks.requestWahooAPI.mockResolvedValue({
      data: { token: 'upload-3', status: 'error', error: 'This workout file is a duplicate.' },
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'))).resolves.toEqual({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in Wahoo.',
      uploadId: 'upload-3',
      workoutKey: undefined,
    });
  });

  it('maps an HTTP duplicate response to an existing activity and logs the safe provider reason', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/workout_file_uploads failed with 422',
      422,
      null,
      { errors: { workout_file_upload: ['already exists'] } },
    ));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT'))).resolves.toEqual({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in Wahoo.',
      uploadId: undefined,
      workoutKey: undefined,
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Wahoo identified the activity upload as a duplicate',
      expect.objectContaining({
        operation: 'upload',
        statusCode: 422,
        providerMessage: 'already exists',
      }),
    );
  });

  it('logs and returns a bounded provider reason for a non-duplicate Wahoo rejection', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/workout_file_uploads failed with 422',
      422,
      null,
      { error: 'FIT file is malformed' },
    ));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Wahoo rejected the activity upload: FIT file is malformed',
      });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Wahoo activity upload request failed',
      expect.objectContaining({
        operation: 'upload',
        statusCode: 422,
        providerMessage: 'FIT file is malformed',
      }),
    );
  });

  it('checks the persisted Wahoo upload token instead of posting a FIT file again', async () => {
    mocks.requestWahooAPI.mockResolvedValue({ data: { status: 'complete', workout_id: 123 } });

    await expect(getWahooActivityUploadStatus('user-1', 'upload-token')).resolves.toEqual({
      status: 'success',
      message: 'Activity uploaded to Wahoo.',
      uploadId: 'upload-token',
      workoutKey: '123',
    });

    expect(mocks.requestWahooAPI).toHaveBeenCalledWith(
      'access-token',
      '/v1/workout_file_uploads/upload-token',
    );
  });

  it('marks a definitive asynchronous processing failure as safe to restart', async () => {
    mocks.requestWahooAPI.mockResolvedValue({
      data: { token: 'upload-token', status: 'failed', error: 'FIT file is malformed' },
    });

    await expect(getWahooActivityUploadStatus('user-1', 'upload-token'))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Wahoo could not process this activity: FIT file is malformed',
        details: {
          retryMode: 'restart',
          providerOperation: 'activity_upload_status',
        },
      });
  });

  it('rejects a completed upload response without the token required for safe reconciliation', async () => {
    mocks.requestWahooAPI.mockResolvedValue({ data: { status: 'complete', workout_id: 123 } });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
      });
  });

  it.each(['../other-path', 'token with spaces'])('rejects malformed completed upload token %s', async (token) => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: {
        status: 'complete',
        token,
      },
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
      });
  });

  it('rejects a malformed pending upload token before it can be persisted', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({
      data: {
        status: 'processing',
        token: '../other-path',
      },
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
      });
  });

  it('requires the Wahoo workout write scope before sending a file', async () => {
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      scope: 'user_read workouts_read offline_data',
    });

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('does not call Wahoo when disconnect begins during token resolution', async () => {
    mocks.isDisconnectPendingForUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        name: 'TokenUseSkippedForPendingDisconnectError',
        code: 'failed-precondition',
      });
    expect(mocks.getTokenData).toHaveBeenCalledTimes(1);
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('rejects files larger than 20MB before sending to Wahoo', async () => {
    await expect(uploadActivityFileToWahoo('user-1', Buffer.alloc((20 * 1024 * 1024) + 1)))
      .rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Cannot upload activity because the size is greater than 20MB.',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('fails closed when Wahoo cannot confirm whether the activity POST was accepted', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPITransportError('Wahoo API request timed out.'));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        disposition: 'permanent',
        retryMode: 'none',
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
      });
  });

  it('fails closed when Wahoo responds with a request timeout after the activity POST', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/workout_file_uploads failed with 408',
      408,
    ));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        disposition: 'permanent',
        retryMode: 'none',
        statusCode: 408,
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
      });
  });

  it('keeps an explicit Wahoo rate-limit response retryable', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/workout_file_uploads failed with 429',
      429,
    ));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('exposes ambiguous upload failures through the canonical provider error type', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/workout_file_uploads failed with 503',
      503,
    ));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toBeInstanceOf(ProviderOperationError);
  });

  it('normalizes terminal token refresh cleanup as reconnect-required auth failure', async () => {
    mocks.getTokenData.mockRejectedValue(Object.assign(new Error('Refresh token revoked'), {
      name: 'TerminalServiceAuthError',
      providerErrorCode: 'invalid_grant',
    }));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'unauthenticated',
        message: 'Reconnect Wahoo before sending activities.',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });
});
