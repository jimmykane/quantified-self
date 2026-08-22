import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataAscent, DataDescent, DataDistance, ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const requestWahooAPI = vi.fn();
  const getTokenData = vi.fn();
  const isDisconnectPendingForUser = vi.fn();
  const assertWahooConnectionAvailable = vi.fn();
  const getUserDeletionGuardState = vi.fn();
  const parseRoutePayload = vi.fn();
  const exportRoutesToFit = vi.fn();
  const tokenRefGet = vi.fn();
  const tokenQueryGet = vi.fn();
  const loggerWarn = vi.fn();
  const getActiveWahooTokenSnapshot = vi.fn();
  const captureWahooActiveAccountGuard = vi.fn();
  const assertWahooActiveAccountGuardCurrent = vi.fn();
  const tokenRef = { get: tokenRefGet };
  let onCallOptions: unknown = null;
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
  return {
    requestWahooAPI,
    getTokenData,
    isDisconnectPendingForUser,
    assertWahooConnectionAvailable,
    getUserDeletionGuardState,
    parseRoutePayload,
    exportRoutesToFit,
    tokenRefGet,
    tokenQueryGet,
    tokenRef,
    loggerWarn,
    getActiveWahooTokenSnapshot,
    captureWahooActiveAccountGuard,
    assertWahooActiveAccountGuardCurrent,
    WahooAPIRequestError,
    getOnCallOptions: () => onCallOptions,
    setOnCallOptions: (options: unknown) => {
      onCallOptions = options;
    },
  };
});

vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-functions/v2/https')>();
  return {
    ...actual,
    onCall: (options: unknown, handler: unknown) => {
      mocks.setOnCallOptions(options);
      return handler;
    },
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
vi.mock('./refresh-recovery', () => ({
  assertWahooConnectionAvailable: mocks.assertWahooConnectionAvailable,
  isWahooReconnectRequiredError: (error: unknown) => (error as { name?: string } | null)?.name === 'WahooReconnectRequiredError',
  isWahooRefreshBackoffError: () => false,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mocks.getUserDeletionGuardState,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('../routes/route-processing', () => ({
  parseRoutePayload: mocks.parseRoutePayload,
  getRouteParsingFailureMessage: (error: unknown, fileType: string) => error instanceof Error ? error.message : `Could not read this ${fileType.toUpperCase()} route file.`,
  RouteProcessingHttpStatusError: class RouteProcessingHttpStatusError extends Error {},
}));
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
  return {
    ...actual,
    SportsLib: { exportRoutesToFit: mocks.exportRoutesToFit },
  };
});
vi.mock('firebase-functions/logger', () => ({ warn: mocks.loggerWarn }));
vi.mock('./auth/api', () => ({
  requestWahooAPI: mocks.requestWahooAPI,
  WahooAPIRequestError: mocks.WahooAPIRequestError,
  WahooAPITransportError: class WahooAPITransportError extends Error {},
}));
vi.mock('./account', () => ({
  getActiveWahooTokenSnapshot: mocks.getActiveWahooTokenSnapshot,
  captureWahooActiveAccountGuard: mocks.captureWahooActiveAccountGuard,
  assertWahooActiveAccountGuardCurrent: mocks.assertWahooActiveAccountGuardCurrent,
  normalizeWahooUserID: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
}));

import {
  createWahooRouteSendContext,
  sendSavedRouteToWahoo,
  uploadFitRouteToWahoo,
  uploadRouteToWahoo,
} from './routes';
import { WahooAPIRequestError, WahooAPITransportError } from './auth/api';

function routeFile(overrides: Partial<Record<string, unknown>> = {}) {
  const stats = new Map<string, number>([
    [DataDistance.type, 12345],
    [DataAscent.type, 321],
    [DataDescent.type, 275],
  ]);
  return {
    hasRoutes: () => true,
    name: 'Morning ride',
    createdAt: new Date('2026-07-22T09:00:00.000Z'),
    getRoutes: () => [{
      activityType: 'cycling',
      getPointData: () => [{ latitudeDegrees: 60.1699, longitudeDegrees: 24.9384 }],
    }],
    getStats: () => ({ get: (type: string) => ({ getValue: () => stats.get(type) }) }),
    ...overrides,
  };
}

describe('Wahoo route uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
    mocks.isDisconnectPendingForUser.mockResolvedValue(false);
    mocks.assertWahooConnectionAvailable.mockResolvedValue(undefined);
    mocks.tokenQueryGet.mockResolvedValue({ docs: [{ ref: mocks.tokenRef }] });
    mocks.tokenRefGet.mockResolvedValue({ exists: true });
    mocks.getActiveWahooTokenSnapshot.mockResolvedValue({
      exists: true,
      id: 'wahoo-user',
      ref: mocks.tokenRef,
      data: () => ({ wahooUserID: 'wahoo-user' }),
    });
    mocks.captureWahooActiveAccountGuard.mockResolvedValue({
      providerUserId: 'wahoo-user',
      connectionStateGeneration: 'connection-1',
      credential: { accessToken: 'access-token' },
    });
    mocks.assertWahooActiveAccountGuardCurrent.mockResolvedValue(undefined);
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      wahooUserID: 'wahoo-user',
      scope: 'user_read workouts_read workouts_write routes_read routes_write offline_data',
    });
    mocks.parseRoutePayload.mockResolvedValue(routeFile());
    mocks.exportRoutesToFit.mockResolvedValue(Uint8Array.from([70, 73, 84]).buffer);
  });

  it('uses the shared high-memory route-processing runtime', () => {
    expect(mocks.getOnCallOptions()).toMatchObject({
      region: 'europe-west2',
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
      maxInstances: 20,
    });
  });

  it('creates an idempotent FIT route upload with Wahoo-required metadata', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { id: 42 } });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT'), '../morning.fit')).resolves.toEqual({
      status: 'success',
      providerRouteId: '42',
      message: 'Route uploaded to Wahoo.',
    });

    const [, lookupPath] = mocks.requestWahooAPI.mock.calls[0];
    expect(lookupPath).toMatch(/^\/v1\/routes\?external_id=qs-route-/);

    const [, uploadPath, request] = mocks.requestWahooAPI.mock.calls[1];
    expect(uploadPath).toBe('/v1/routes');
    expect(request.method).toBe('POST');
    expect(request.form.get('route[file]')).toBe('data:application/vnd.fit;base64,RklU');
    expect(request.form.get('route[filename]')).toBe('.._morning.fit');
    expect(request.form.get('route[name]')).toBe('Morning ride');
    expect(request.form.get('route[workout_type_family_id]')).toBe('0');
    expect(request.form.get('route[start_lat]')).toBe('60.1699');
    expect(request.form.get('route[start_lng]')).toBe('24.9384');
    expect(request.form.get('route[distance]')).toBe('12345');
    expect(request.form.get('route[ascent]')).toBe('321');
    expect(request.form.get('route[descent]')).toBe('275');
    expect(mocks.exportRoutesToFit).not.toHaveBeenCalled();
  });

  it.each(['Mountain Biking', 'mountain bike'])('classifies %s routes as biking in Wahoo', async (activityType) => {
    mocks.parseRoutePayload.mockResolvedValue(routeFile({
      getRoutes: () => [{
        activityType,
        getPointData: () => [{ latitudeDegrees: 60.1699, longitudeDegrees: 24.9384 }],
      }],
    }));
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { id: 42 } });

    await uploadFitRouteToWahoo('user-1', Buffer.from('FIT'));

    const [, , request] = mocks.requestWahooAPI.mock.calls[1];
    expect(request.form.get('route[workout_type_family_id]')).toBe('0');
  });

  it('converts a GPX route to FIT before creating an idempotent Wahoo route', async () => {
    mocks.parseRoutePayload.mockResolvedValue(routeFile({
      name: 'New Route File',
      getRoutes: () => [{
        name: 'Morning GPX route',
        activityType: 'cycling',
        getPointData: () => [{ latitudeDegrees: 60.1699, longitudeDegrees: 24.9384 }],
      }],
    }));
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { id: 42 } });

    await expect(uploadRouteToWahoo('user-1', Buffer.from('<gpx/>'), 'morning.gpx')).resolves.toEqual({
      status: 'success',
      providerRouteId: '42',
      message: 'Route uploaded to Wahoo.',
    });

    expect(mocks.parseRoutePayload).toHaveBeenCalledWith(Buffer.from('<gpx/>'), 'gpx');
    expect(mocks.exportRoutesToFit).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Route File' }));

    const [, uploadPath, request] = mocks.requestWahooAPI.mock.calls[1];
    expect(uploadPath).toBe('/v1/routes');
    expect(request.form.get('route[file]')).toBe('data:application/vnd.fit;base64,RklU');
    expect(request.form.get('route[filename]')).toBe('morning.fit');
    expect(request.form.get('route[name]')).toBe('Morning GPX route');
  });

  it('rejects unsupported Wahoo route file types before looking up a token', async () => {
    await expect(uploadRouteToWahoo('user-1', Buffer.from('TCX'), 'route.tcx'))
      .rejects.toMatchObject({ code: 'invalid-argument', message: 'Wahoo routes must be FIT or GPX files.' });
    expect(mocks.getTokenData).not.toHaveBeenCalled();
    expect(mocks.parseRoutePayload).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('returns a clear validation error when a GPX route cannot be converted to a FIT course', async () => {
    mocks.exportRoutesToFit.mockRejectedValue(new Error('multiple routes'));

    await expect(uploadRouteToWahoo('user-1', Buffer.from('<gpx/>'), 'route.gpx'))
      .rejects.toMatchObject({
        code: 'invalid-argument',
        message: expect.stringContaining('could not be converted'),
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('rejects a converted GPX FIT payload over the Wahoo route size limit', async () => {
    mocks.exportRoutesToFit.mockResolvedValue(new ArrayBuffer((20 * 1024 * 1024) + 1));

    await expect(uploadRouteToWahoo('user-1', Buffer.from('<gpx/>'), 'route.gpx'))
      .rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Cannot upload route because the converted FIT file is greater than 20MB.',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('updates the route owned by this app when its external id already exists', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [{ id: 9 }] })
      .mockResolvedValueOnce({ data: { id: 9 } });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT'))).resolves.toEqual({
      status: 'success',
      providerRouteId: '9',
      message: 'Route updated in Wahoo.',
    });

    const [, uploadPath, request] = mocks.requestWahooAPI.mock.calls[1];
    expect(uploadPath).toBe('/v1/routes/9');
    expect(request.method).toBe('PUT');
  });

  it.each([
    ['HTTP 409 conflict', new WahooAPIRequestError(
      'Wahoo API POST /v1/routes failed with 409',
      409,
    )],
    ['duplicate external-id validation error', new WahooAPIRequestError(
      'Wahoo API POST /v1/routes failed with 422',
      422,
      null,
      { errors: { external_id: ['has already been taken'] } },
    )],
  ])('recovers a concurrent create %s by updating the route now found by its external id', async (_scenario, createError) => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(createError)
      .mockResolvedValueOnce({ data: [{ id: 9 }] })
      .mockResolvedValueOnce({ data: { id: 9 } });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT'))).resolves.toEqual({
      status: 'success',
      providerRouteId: '9',
      message: 'Route updated in Wahoo.',
    });

    expect(mocks.requestWahooAPI.mock.calls.map(([, path]) => path)).toEqual([
      expect.stringMatching(/^\/v1\/routes\?external_id=qs-route-/),
      '/v1/routes',
      expect.stringMatching(/^\/v1\/routes\?external_id=qs-route-/),
      '/v1/routes/9',
    ]);
    expect(mocks.requestWahooAPI.mock.calls[3][2]).toMatchObject({ method: 'PUT' });
  });

  it('does not call Wahoo when account deletion starts while the FIT route is parsed', async () => {
    mocks.parseRoutePayload.mockImplementation(async () => {
      mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: true });
      return routeFile();
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ name: 'WahooRouteUploadSkippedForDeletedUserError' });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('does not call Wahoo when disconnect begins while the FIT route is parsed', async () => {
    mocks.parseRoutePayload.mockImplementation(async () => {
      mocks.isDisconnectPendingForUser.mockResolvedValue(true);
      return routeFile();
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Wahoo disconnect is pending.' });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('does not create a route when account deletion starts after the Wahoo lookup', async () => {
    mocks.requestWahooAPI.mockImplementationOnce(async () => {
      mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: true });
      return { data: [] };
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ name: 'WahooRouteUploadSkippedForDeletedUserError' });
    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
  });

  it('does not create a route when disconnect begins after the Wahoo lookup', async () => {
    mocks.requestWahooAPI.mockImplementationOnce(async () => {
      mocks.isDisconnectPendingForUser.mockResolvedValue(true);
      return { data: [] };
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Wahoo disconnect is pending.' });
    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
  });

  it('does not create a route after the active Wahoo credential changes during lookup', async () => {
    mocks.requestWahooAPI.mockResolvedValueOnce({ data: [] });
    mocks.assertWahooActiveAccountGuardCurrent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('credential changed'), { code: 'unauthenticated' }));

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.requestWahooAPI).toHaveBeenCalledTimes(1);
    expect(mocks.requestWahooAPI).toHaveBeenCalledWith(
      'access-token',
      expect.stringMatching(/^\/v1\/routes\?external_id=/),
    );
  });

  it('requires both Wahoo route scopes before making provider requests', async () => {
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      wahooUserID: 'wahoo-user',
      scope: 'user_read workouts_read workouts_write offline_data',
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('Reconnect Wahoo') });
    expect(mocks.parseRoutePayload).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('checks Wahoo route scopes before the saved-route worker downloads or converts a route', async () => {
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      wahooUserID: 'wahoo-user',
      scope: 'user_read workouts_read workouts_write offline_data',
    });

    await expect(createWahooRouteSendContext('user-1'))
      .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('Reconnect Wahoo') });
    expect(mocks.exportRoutesToFit).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('updates the same Wahoo route when a saved Quantified Self route is revised', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { id: 44 } })
      .mockResolvedValueOnce({ data: [{ id: 44 }] })
      .mockResolvedValueOnce({ data: { id: 44 } });

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .resolves.toMatchObject({ providerRouteId: '44', message: 'Route uploaded to Wahoo.' });
    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile({
      name: 'Revised morning ride',
      createdAt: new Date('2026-07-23T09:00:00.000Z'),
    }))).resolves.toMatchObject({ providerRouteId: '44', message: 'Route updated in Wahoo.' });

    const firstUploadRequest = mocks.requestWahooAPI.mock.calls[1][2];
    const secondUploadRequest = mocks.requestWahooAPI.mock.calls[3][2];
    expect(firstUploadRequest.form.get('route[external_id]')).toBe(secondUploadRequest.form.get('route[external_id]'));
    expect(firstUploadRequest.form.get('route[external_id]')).toMatch(/^qs-route-/);
    expect(mocks.requestWahooAPI.mock.calls[3][1]).toBe('/v1/routes/44');
    expect(secondUploadRequest.method).toBe('PUT');
    expect(mocks.parseRoutePayload).not.toHaveBeenCalled();
  });

  it('normalizes saved-route provider outages as retryable operations', async () => {
    mocks.requestWahooAPI.mockRejectedValueOnce(new WahooAPIRequestError(
      'Wahoo API GET /v1/routes failed with 503',
      503,
    ));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        name: 'ProviderOperationError',
        serviceName: ServiceNames.WahooAPI,
        operation: 'route_upload',
        disposition: 'retryable',
        retryMode: 'restart',
        dlqContext: 'WAHOO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
      });
  });

  it('normalizes saved-route transport failures as retryable operations', async () => {
    mocks.requestWahooAPI.mockRejectedValueOnce(new WahooAPITransportError(
      'Wahoo API request timed out.',
    ));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        name: 'ProviderOperationError',
        serviceName: ServiceNames.WahooAPI,
        operation: 'route_upload',
        disposition: 'retryable',
        retryMode: 'restart',
        dlqContext: 'WAHOO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
      });
  });

  it('preserves terminal token refresh cleanup as reconnect-required auth failure', async () => {
    mocks.getTokenData.mockRejectedValue(Object.assign(new Error('Refresh token revoked'), {
      name: 'TerminalServiceAuthError',
      providerErrorCode: 'invalid_grant',
    }));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        code: 'unauthenticated',
        message: 'Reconnect Wahoo before sending routes.',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('preserves the reconnect-required marker so saved-route delivery is parked', async () => {
    mocks.getTokenData.mockRejectedValue(Object.assign(new Error('Reconnect Wahoo to resume sync.'), {
      name: 'WahooReconnectRequiredError',
    }));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        name: 'WahooReconnectRequiredError',
        code: 'unauthenticated',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('rechecks reconnect-required state immediately before looking up a route', async () => {
    mocks.assertWahooConnectionAvailable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('Reconnect Wahoo.'), {
        name: 'WahooReconnectRequiredError',
      }));

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'unauthenticated' });

    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('preserves transient token setup failures for the route queue retry policy', async () => {
    const firestoreError = Object.assign(new Error('Firestore unavailable'), { code: 14 });
    mocks.getTokenData.mockRejectedValueOnce(firestoreError);

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toBe(firestoreError);
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('normalizes terminal token refresh cleanup during queued route context creation', async () => {
    mocks.getTokenData.mockRejectedValue(Object.assign(new Error('Refresh token revoked'), {
      name: 'TerminalServiceAuthError',
      providerErrorCode: 'invalid_grant',
    }));

    await expect(createWahooRouteSendContext('user-1'))
      .rejects.toMatchObject({
        code: 'unauthenticated',
        message: 'Reconnect Wahoo before sending routes.',
      });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('normalizes saved-route HTTP request timeouts as retryable operations', async () => {
    mocks.requestWahooAPI.mockRejectedValueOnce(new WahooAPIRequestError(
      'Wahoo API GET /v1/routes failed with 408',
      408,
    ));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        name: 'ProviderOperationError',
        serviceName: ServiceNames.WahooAPI,
        operation: 'route_upload',
        disposition: 'retryable',
        retryMode: 'restart',
        dlqContext: 'WAHOO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
      });
  });

  it('normalizes saved-route provider rejection as permanent', async () => {
    mocks.requestWahooAPI.mockRejectedValueOnce(new WahooAPIRequestError(
      'Wahoo API GET /v1/routes failed with 422',
      422,
      null,
      { error: 'The route file is malformed' },
    ));

    await expect(sendSavedRouteToWahoo('user-1', 'saved-route-1', routeFile()))
      .rejects.toMatchObject({
        name: 'ProviderOperationError',
        serviceName: ServiceNames.WahooAPI,
        operation: 'route_upload',
        disposition: 'permanent',
        retryMode: 'none',
        dlqContext: 'WAHOO_ROUTE_UPLOAD_REJECTED',
      });
  });

  it('rejects an empty route before parsing or making a provider request', async () => {
    await expect(uploadFitRouteToWahoo('user-1', Buffer.alloc(0)))
      .rejects.toMatchObject({ code: 'invalid-argument', message: 'File content is empty.' });
    expect(mocks.parseRoutePayload).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('requires a valid geographic starting coordinate', async () => {
    mocks.parseRoutePayload.mockResolvedValue(routeFile({
      getRoutes: () => [{
        activityType: 'cycling',
        getPointData: () => [{ latitudeDegrees: 91, longitudeDegrees: 24.9384 }],
      }],
    }));

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('starting coordinate') });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('rejects a FIT activity file that cannot be parsed as a route', async () => {
    mocks.parseRoutePayload.mockRejectedValue(new Error('This FIT file looks like an activity, not a route/course.'));

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('activity') });
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
  });

  it('surfaces a bounded Wahoo route rejection reason', async () => {
    mocks.requestWahooAPI.mockRejectedValue(new WahooAPIRequestError(
      'Wahoo API POST /v1/routes failed with 422',
      422,
      null,
      { error: 'The route file is malformed' },
    ));

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Wahoo rejected the route upload: The route file is malformed',
      });
  });
});
