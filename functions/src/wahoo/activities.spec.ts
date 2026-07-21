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
  const WahooAPIRequestError = class WahooAPIRequestError extends Error {
    constructor(
      _message: string,
      public statusCode: number,
      _resetAfterSeconds: number | null = null,
      public responseBody: unknown = null,
    ) {
      super(_message);
      void _resetAfterSeconds;
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
    WahooAPIRequestError,
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

import { getWahooActivityUploadStatus, uploadActivityFileToWahoo } from './activities';
import { WahooAPIRequestError, WahooAPITransportError } from './auth/api';

describe('Wahoo activity uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
    mocks.isDisconnectPendingForUser.mockResolvedValue(false);
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

  it('returns a retryable error when Wahoo cannot be reached', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPITransportError('Wahoo API request timed out.'));

    await expect(uploadActivityFileToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'unavailable' });
  });
});
