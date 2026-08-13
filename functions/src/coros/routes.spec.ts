import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataAscent, DataDistance, DataDuration } from '@sports-alliance/sports-lib';
import { PRO_REQUIRED_MESSAGE } from '../utils';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getTokenData: vi.fn(),
  getActiveCOROSTokenSnapshot: vi.fn(),
  getUserDeletionGuardState: vi.fn(),
  isServiceDisconnectPendingForUser: vi.fn(),
  hasProAccess: vi.fn(),
  decodeManualRouteUpload: vi.fn(),
  getManualRouteInputFormat: vi.fn(),
  parseManualRouteUpload: vi.fn(),
  exportManualRouteAsGPX: vi.fn(),
  onCallOptions: undefined as unknown,
}));

vi.mock('../request-helper', () => ({
  default: { post: (...args: unknown[]) => mocks.post(...args) },
  post: (...args: unknown[]) => mocks.post(...args),
}));
vi.mock('../tokens', () => ({
  getTokenData: (...args: unknown[]) => mocks.getTokenData(...args),
}));
vi.mock('./account', () => ({
  getActiveCOROSTokenSnapshot: (...args: unknown[]) => mocks.getActiveCOROSTokenSnapshot(...args),
}));
vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: (...args: unknown[]) => mocks.isServiceDisconnectPendingForUser(...args),
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: unknown[]) => mocks.getUserDeletionGuardState(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('../routes/manual-route-upload', () => ({
  decodeManualRouteUpload: (...args: unknown[]) => mocks.decodeManualRouteUpload(...args),
  getManualRouteInputFormat: (...args: unknown[]) => mocks.getManualRouteInputFormat(...args),
  parseManualRouteUpload: (...args: unknown[]) => mocks.parseManualRouteUpload(...args),
  exportManualRouteAsGPX: (...args: unknown[]) => mocks.exportManualRouteAsGPX(...args),
}));
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return { ...actual, hasProAccess: (...args: unknown[]) => mocks.hasProAccess(...args) };
});
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (options: unknown, handler: unknown) => {
    mocks.onCallOptions = options;
    return handler;
  },
  HttpsError: class HttpsError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

import {
  createCOROSRouteId,
  createCOROSOpenUserId,
  createCOROSRouteSendContext,
  importRouteToCOROSAPI,
  resolveCOROSRouteType,
  uploadGPXRouteToCOROS,
} from './routes';

type COROSRouteFile = Parameters<typeof resolveCOROSRouteType>[0];
type COROSRouteUploadParams = Parameters<typeof uploadGPXRouteToCOROS>[0];
type COROSRouteCallableRequest = Parameters<typeof importRouteToCOROSAPI>[0];

const activeGuard = { userExists: true, shouldSkip: false };

function tokenSnapshot(providerUserId = 'coros-user-1') {
  const current = { exists: true, id: providerUserId, data: () => ({ openId: providerUserId }) };
  return {
    ...current,
    ref: { get: vi.fn().mockResolvedValue(current) },
  };
}

function routeFile(activityType: unknown = 'cycling', overrides: Record<string, unknown> = {}): COROSRouteFile {
  const stats = new Map<string, number>([
    [DataDistance.type, 12345.678],
    [DataAscent.type, 321.236],
    [DataDuration.type, 600.4],
  ]);
  return {
    name: 'Morning route\r\nunsafe',
    createdAt: new Date('2026-05-27T12:00:00.000Z'),
    hasRoutes: () => true,
    getRoutes: () => [{ name: 'Morning ride', activityType, getPointData: () => [] }],
    getStats: () => ({ get: (type: string) => ({ getValue: () => stats.get(type) }) }),
    ...overrides,
  } as unknown as COROSRouteFile;
}

function uploadParams(overrides: Record<string, unknown> = {}): COROSRouteUploadParams {
  return {
    userID: 'user-1',
    gpxContent: '<gpx><rte /></gpx>',
    routeFile: routeFile(),
    stableRouteKey: 'saved-route:route-1',
    ...overrides,
  } as unknown as COROSRouteUploadParams;
}

function callableRequest(overrides: Partial<{
  auth: { uid: string } | null;
  app: object | null;
  data: Record<string, unknown>;
}> = {}): COROSRouteCallableRequest {
  return {
    auth: overrides.auth !== undefined ? overrides.auth : { uid: 'user-1' },
    app: overrides.app !== undefined ? overrides.app : { appId: 'app-1' },
    data: overrides.data ?? { file: 'R1BY', filename: 'route.gpx' },
  } as unknown as COROSRouteCallableRequest;
}

describe('COROS route uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserDeletionGuardState.mockResolvedValue(activeGuard);
    mocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
    mocks.getActiveCOROSTokenSnapshot.mockResolvedValue(tokenSnapshot());
    mocks.getTokenData.mockResolvedValue({ accessToken: 'access-token', openId: 'coros-user-1' });
    mocks.post.mockResolvedValue('{"message":"ok","result":"0000"}');
    mocks.hasProAccess.mockResolvedValue(true);
    mocks.decodeManualRouteUpload.mockReturnValue(Buffer.from('GPX'));
    mocks.getManualRouteInputFormat.mockReturnValue('gpx');
    mocks.parseManualRouteUpload.mockResolvedValue(routeFile());
    mocks.exportManualRouteAsGPX.mockResolvedValue('<gpx><rte /></gpx>');
  });

  it('uses the shared high-memory route-processing runtime', () => {
    expect(mocks.onCallOptions).toMatchObject({
      region: 'europe-west2',
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
      maxInstances: 20,
    });
  });

  it('posts a GPX route with every required COROS field and stable int64 id', async () => {
    const result = await uploadGPXRouteToCOROS(uploadParams());

    expect(result).toMatchObject({
      status: 'success',
      providerUserId: 'coros-user-1',
      message: 'Route uploaded to COROS.',
    });
    expect(BigInt(result.providerRouteId)).toBeGreaterThan(0n);
    expect(BigInt(result.providerRouteId)).toBeLessThan(1n << 63n);
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/coros/route/push'),
      headers: expect.objectContaining({
        token: 'access-token',
        'Content-Type': expect.stringContaining('multipart/form-data; boundary='),
      }),
      json: false,
      body: expect.any(Buffer),
    }));
    const body = (mocks.post.mock.calls[0][0].body as Buffer).toString('utf8');
    expect(body).toContain('name="openId"\r\n\r\ncoros-user-1');
    expect(body).toContain(`name="openUserId"\r\n\r\n${createCOROSOpenUserId('user-1')}`);
    expect(body).not.toContain('name="openUserId"\r\n\r\nuser-1');
    expect(body).toContain(`name="routeId"\r\n\r\n${result.providerRouteId}`);
    expect(body).toContain('name="routeFileType"\r\n\r\n0');
    expect(body).toContain('name="type"\r\n\r\n1');
    expect(body).toContain('name="name"\r\n\r\nMorning ride');
    expect(body).toContain('name="distance"\r\n\r\n12345.68');
    expect(body).toContain('name="duration"\r\n\r\n600');
    expect(body).toContain('name="elevationGain"\r\n\r\n321.24');
    expect(body).toContain('name="language"\r\n\r\nen-US');
    expect(body).toContain('<gpx><rte /></gpx>');
  });

  it('derives the same route id for the same revision and a new id for changed content', () => {
    const first = createCOROSRouteId('user-1', 'coros-user-1', 'route-1', '<gpx/>');
    expect(createCOROSRouteId('user-1', 'coros-user-1', 'route-1', '<gpx/>')).toBe(first);
    expect(createCOROSRouteId('user-1', 'coros-user-1', 'route-1', '<gpx changed="1"/>')).not.toBe(first);
  });

  it('derives a stable provider-scoped partner user id without exposing the Firebase uid', () => {
    const first = createCOROSOpenUserId('user-1');
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(createCOROSOpenUserId('user-1')).toBe(first);
    expect(createCOROSOpenUserId('user-2')).not.toBe(first);
    expect(first).not.toContain('user-1');
  });

  it.each([
    ['cycling', 1],
    ['Mountain Biking', 1],
    ['gravel ride', 1],
    ['running', 2],
    ['road running', 2],
    ['hiking', 2],
    [null, 2],
  ])('maps %s to COROS route type %s', (activityType, expected) => {
    expect(resolveCOROSRouteType(routeFile(activityType))).toBe(expected);
  });

  it('uses persisted activity types when route geometry has no type', () => {
    expect(resolveCOROSRouteType(routeFile(undefined), { activityTypes: ['road cycling'] })).toBe(1);
  });

  it('treats COROS duplicate route code 13001 as success', async () => {
    mocks.post.mockResolvedValueOnce('{"message":"duplicate","result":"13001"}');
    await expect(uploadGPXRouteToCOROS(uploadParams())).resolves.toMatchObject({
      status: 'success',
      duplicate: true,
      message: 'Route already exists in COROS.',
    });
  });

  it('force-refreshes once after provider code 5006', async () => {
    mocks.post
      .mockResolvedValueOnce('{"message":"expired","result":"5006"}')
      .mockResolvedValueOnce('{"message":"ok","result":"0000"}');

    await expect(uploadGPXRouteToCOROS(uploadParams())).resolves.toMatchObject({ status: 'success' });
    expect(mocks.getTokenData).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), false);
    expect(mocks.getTokenData).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), true);
  });

  it('classifies missing route entitlement and rate limiting explicitly', async () => {
    mocks.post.mockResolvedValueOnce('{"message":"no access","result":"30009"}');
    await expect(uploadGPXRouteToCOROS(uploadParams())).rejects.toMatchObject({
      disposition: 'permission_required',
      dlqContext: 'COROS_ROUTE_UPLOAD_PERMISSION_REQUIRED',
    });

    mocks.post.mockRejectedValueOnce({ statusCode: 429 });
    await expect(uploadGPXRouteToCOROS(uploadParams())).rejects.toMatchObject({
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'resource-exhausted',
      providerOperationId: expect.any(String),
    });
  });

  it('fails closed if the active COROS account changes after context creation', async () => {
    await expect(uploadGPXRouteToCOROS(uploadParams({ expectedProviderUserId: 'another-user' })))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('creates a route-send context pinned to the active account', async () => {
    await expect(createCOROSRouteSendContext('user-1')).resolves.toEqual({ providerUserId: 'coros-user-1' });
  });

  it('routes direct FIT/GPX uploads through shared parse and GPX conversion', async () => {
    const result = await importRouteToCOROSAPI(callableRequest());

    expect(result).toMatchObject({ status: 'success', providerRouteId: expect.any(String) });
    expect(mocks.decodeManualRouteUpload).toHaveBeenCalledWith('R1BY');
    expect(mocks.getManualRouteInputFormat).toHaveBeenCalledWith('route.gpx', 'COROS', 'FIT or GPX');
    expect(mocks.parseManualRouteUpload).toHaveBeenCalledWith(Buffer.from('GPX'), 'gpx');
    expect(mocks.exportManualRouteAsGPX).toHaveBeenCalledWith(expect.anything());
  });

  it('maps entitlement failures on the callable and enforces auth, App Check, and Pro', async () => {
    mocks.post.mockResolvedValueOnce('{"message":"no access","result":"30009"}');
    await expect(importRouteToCOROSAPI(callableRequest())).rejects.toMatchObject({
      code: 'permission-denied',
    });

    await expect(importRouteToCOROSAPI(callableRequest({ auth: null }))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(importRouteToCOROSAPI(callableRequest({ app: null }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    mocks.hasProAccess.mockResolvedValueOnce(false);
    await expect(importRouteToCOROSAPI(callableRequest())).rejects.toMatchObject({
      code: 'permission-denied',
      message: PRO_REQUIRED_MESSAGE,
    });
  });

  it('blocks deleted users and pending disconnects before provider access', async () => {
    mocks.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: true });
    await expect(uploadGPXRouteToCOROS(uploadParams())).rejects.toMatchObject({
      name: 'COROSRouteUploadSkippedForDeletedUserError',
    });
    expect(mocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();

    mocks.getUserDeletionGuardState.mockResolvedValue(activeGuard);
    mocks.isServiceDisconnectPendingForUser.mockResolvedValueOnce(true);
    await expect(uploadGPXRouteToCOROS(uploadParams())).rejects.toMatchObject({
      name: 'TokenUseSkippedForPendingDisconnectError',
    });
    expect(mocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
  });

  it('rejects missing distance and oversized converted GPX before provider access', async () => {
    await expect(uploadGPXRouteToCOROS(uploadParams({
      routeFile: routeFile('running', {
        getStats: () => ({ get: () => ({ getValue: () => undefined }) }),
      }),
    }))).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(uploadGPXRouteToCOROS(uploadParams({
      gpxContent: 'x'.repeat((20 * 1024 * 1024) + 1),
    }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
