import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataAscent, DataDescent, DataDistance, ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const requestWahooAPI = vi.fn();
  const getTokenData = vi.fn();
  const isDisconnectPendingForUser = vi.fn();
  const getUserDeletionGuardState = vi.fn();
  const parseRoutePayload = vi.fn();
  const tokenRefGet = vi.fn();
  const tokenQueryGet = vi.fn();
  const loggerWarn = vi.fn();
  const tokenRef = { get: tokenRefGet };
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
    getUserDeletionGuardState,
    parseRoutePayload,
    tokenRefGet,
    tokenQueryGet,
    tokenRef,
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
vi.mock('../routes/route-processing', () => ({
  parseRoutePayload: mocks.parseRoutePayload,
  getRouteParsingFailureMessage: (error: unknown) => error instanceof Error ? error.message : 'Could not read this FIT route file.',
  RouteProcessingHttpStatusError: class RouteProcessingHttpStatusError extends Error {},
}));
vi.mock('firebase-functions/logger', () => ({ warn: mocks.loggerWarn }));
vi.mock('./auth/api', () => ({
  requestWahooAPI: mocks.requestWahooAPI,
  WahooAPIRequestError: mocks.WahooAPIRequestError,
  WahooAPITransportError: class WahooAPITransportError extends Error {},
}));

import { uploadFitRouteToWahoo } from './routes';
import { WahooAPIRequestError } from './auth/api';

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
    mocks.tokenQueryGet.mockResolvedValue({ docs: [{ ref: mocks.tokenRef }] });
    mocks.tokenRefGet.mockResolvedValue({ exists: true });
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      scope: 'user_read workouts_read workouts_write routes_read routes_write offline_data',
    });
    mocks.parseRoutePayload.mockResolvedValue(routeFile());
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

  it('recovers a concurrent create conflict by updating the route now found by its external id', async () => {
    mocks.requestWahooAPI
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new WahooAPIRequestError(
        'Wahoo API POST /v1/routes failed with 409',
        409,
      ))
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

  it('requires both Wahoo route scopes before making provider requests', async () => {
    mocks.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.WahooAPI,
      accessToken: 'access-token',
      scope: 'user_read workouts_read workouts_write offline_data',
    });

    await expect(uploadFitRouteToWahoo('user-1', Buffer.from('FIT')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('Reconnect Wahoo') });
    expect(mocks.parseRoutePayload).not.toHaveBeenCalled();
    expect(mocks.requestWahooAPI).not.toHaveBeenCalled();
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
