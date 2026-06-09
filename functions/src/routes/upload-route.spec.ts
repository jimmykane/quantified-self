import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Response } from 'express';
import type { Request } from 'firebase-functions/v2/https';
import { ROUTE_USAGE_LIMITS } from '../../../shared/limits';

const hoisted = vi.hoisted(() => {
  const capturedOnRequestOptions = { value: undefined as unknown };
  const mockOnRequest = vi.fn((options: unknown, handler: unknown) => {
    capturedOnRequestOptions.value = options;
    return handler;
  });
  const mockVerifyIdToken = vi.fn();
  const mockVerifyAppCheckToken = vi.fn();
  const mockGetAll = vi.fn();
  const mockRoutesCountGet = vi.fn();
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn();
  const mockTransactionGet = vi.fn();
  const mockTransactionSet = vi.fn();
  const mockRunTransaction = vi.fn(async (handler: unknown) => (
    handler as (transaction: unknown) => Promise<unknown>
  )({
    get: mockTransactionGet,
    set: mockTransactionSet,
  }));
  const mockStorageSave = vi.fn();
  const mockStorageDelete = vi.fn();
  const mockStorageFile = vi.fn((path: string) => ({
    path,
    save: mockStorageSave,
    delete: mockStorageDelete,
  }));
  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockEnforceAppCheckFlag = { value: true };
  const mockSportsLib = {
    importRoutesFromFit: vi.fn(),
    importRoutesFromGPX: vi.fn(),
  } as Record<string, unknown>;
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
  const mockSportsLibVersionToCode = vi.fn(() => 15000005);

  return {
    capturedOnRequestOptions,
    mockOnRequest,
    mockVerifyIdToken,
    mockVerifyAppCheckToken,
    mockGetAll,
    mockRoutesCountGet,
    mockDocGet,
    mockDocSet,
    mockTransactionGet,
    mockTransactionSet,
    mockRunTransaction,
    mockStorageFile,
    mockStorageSave,
    mockStorageDelete,
    mockHasProAccess,
    mockHasBasicAccess,
    mockEnforceAppCheckFlag,
    mockSportsLib,
    mockServerTimestamp,
    mockSportsLibVersionToCode,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: hoisted.mockOnRequest,
}));

vi.mock('firebase-admin', () => {
  function userScopedDoc(path: string) {
    return {
      path,
      collection: (name: string) => {
        if (name === 'routes') {
          return {
            count: () => ({ get: hoisted.mockRoutesCountGet }),
          };
        }
        return {};
      },
    };
  }

  const firestoreFn = vi.fn(() => ({
    getAll: hoisted.mockGetAll,
    collection: (path: string) => {
      if (path === 'users') {
        return {
          doc: (id: string) => userScopedDoc(`users/${id}`),
        };
      }
      if (path === 'userDeletionTombstones') {
        return {
          doc: (id: string) => ({ path: `userDeletionTombstones/${id}` }),
        };
      }
      if (path === 'tmp') {
        return { doc: () => ({ id: 'tmp-generated-id', path: 'tmp/tmp-generated-id' }) };
      }
      return { doc: () => ({ path: `${path}/generated-id` }) };
    },
    runTransaction: hoisted.mockRunTransaction,
    doc: (path: string) => ({
      path,
      get: () => hoisted.mockDocGet(path),
      set: hoisted.mockDocSet,
    }),
  }));

  Object.assign(firestoreFn, {
    FieldValue: {
      serverTimestamp: hoisted.mockServerTimestamp,
    },
  });

  return {
    auth: () => ({
      verifyIdToken: hoisted.mockVerifyIdToken,
    }),
    appCheck: () => ({
      verifyToken: hoisted.mockVerifyAppCheckToken,
    }),
    firestore: firestoreFn,
    storage: () => ({
      bucket: () => ({
        name: 'test-bucket',
        file: hoisted.mockStorageFile,
      }),
    }),
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: hoisted.mockServerTimestamp,
  },
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  get ENFORCE_APP_CHECK() {
    return hoisted.mockEnforceAppCheckFlag.value;
  },
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
}));

vi.mock('@sports-alliance/sports-lib', () => ({
  SportsLib: hoisted.mockSportsLib,
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    uploadRoute: { name: 'uploadRoute', region: 'europe-west2' },
  },
}));

import { uploadRoute } from './upload-route';

type UploadRouteRequestDouble = Pick<Request, 'method' | 'rawBody' | 'header'>;
type UploadRouteResponseDouble = Pick<Response, 'status' | 'json'>;
type MockUploadRouteResponse = UploadRouteResponseDouble & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function makeRouteFile() {
  let id: string | null = null;
  const routeSegment = {
    id: null as string | null,
    getID() {
      return this.id;
    },
    setID(newID: string) {
      this.id = newID;
    },
    toJSON: () => ({
      id: routeSegment.id || undefined,
      name: 'Segment',
      activityType: 'cycling',
      points: [
        { latitudeDegrees: 60.1, longitudeDegrees: 24.9, altitude: 11 },
        { latitudeDegrees: 60.2, longitudeDegrees: 25.0, altitude: 12 },
      ],
      streams: { distance: [0, 1000] },
    }),
  };

  const routeFile = {
    name: '',
    srcFileType: 'gpx',
    createdAt: null as Date | null,
    getID: () => id,
    setID: (newID: string) => {
      id = newID;
    },
    getRoutes: () => [routeSegment],
    hasRoutes: () => true,
    getWaypoints: () => [],
    toJSON: () => ({
      id: id || undefined,
      name: routeFile.name || 'Route',
      srcFileType: routeFile.srcFileType,
      createdAt: routeFile.createdAt || Date.now(),
      routes: [routeSegment.toJSON()],
      waypoints: [],
    }),
  };

  return routeFile;
}

function makeRequest(overrides?: {
  method?: string;
  headers?: Record<string, string | undefined>;
  rawBody?: Buffer;
}): UploadRouteRequestDouble {
  const mergedHeaders: Record<string, string | undefined> = {
    authorization: 'Bearer token',
    'x-firebase-appcheck': 'app-check-token',
    'x-file-extension': 'gpx',
    ...(overrides?.headers || {}),
  };

  const headers = Object.fromEntries(
    Object.entries(mergedHeaders).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    method: overrides?.method || 'POST',
    rawBody: overrides?.rawBody ?? Buffer.from('<gpx></gpx>'),
    header: (name: string) => headers[name.toLowerCase()],
  };
}

function makeResponse(): MockUploadRouteResponse {
  const json = vi.fn();
  const response = {
    json,
    status: vi.fn(),
  } as MockUploadRouteResponse;
  response.status.mockImplementation(() => response);
  return response;
}

async function invokeUploadRoute(
  request: UploadRouteRequestDouble,
  response: UploadRouteResponseDouble,
): Promise<void> {
  const handler = uploadRoute as unknown as (req: UploadRouteRequestDouble, res: UploadRouteResponseDouble) => Promise<void>;
  await handler(request, response);
}

function makeSnapshot(
  exists: boolean,
  data: Record<string, unknown> = {},
  updateTime?: { seconds: number; nanoseconds: number },
) {
  return {
    exists,
    data: () => data,
    updateTime,
  };
}

function activeUserGuardSnapshot(ref: { path: string }) {
  if (ref.path === 'users/user-1') {
    return makeSnapshot(true);
  }
  if (ref.path === 'userDeletionTombstones/user-1') {
    return makeSnapshot(false);
  }
  return null;
}

function transactionSetCallForPath(path: string) {
  return hoisted.mockTransactionSet.mock.calls.find(([ref]) => (
    ref as { path?: string } | undefined
  )?.path === path);
}

function originalUploadPathPattern(routeID: string, extension: string): RegExp {
  return new RegExp(`^users/user-1/routes/${routeID}/uploads/[^/]+/original\\.${extension.replace('.', '\\.')}$`);
}

describe('uploadRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockEnforceAppCheckFlag.value = true;
    hoisted.mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    hoisted.mockVerifyAppCheckToken.mockResolvedValue(undefined);
    hoisted.mockGetAll.mockResolvedValue([
      makeSnapshot(true),
      makeSnapshot(false),
    ]);
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 0 });
      }
      return makeSnapshot(false);
    });
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockRunTransaction.mockImplementation(async (handler: unknown) => (
      handler as (transaction: unknown) => Promise<unknown>
    )({
      get: hoisted.mockTransactionGet,
      set: hoisted.mockTransactionSet,
    }));
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'users/user-1') {
        return makeSnapshot(true);
      }
      if (ref.path === 'userDeletionTombstones/user-1') {
        return makeSnapshot(false);
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 0 });
      }
      return makeSnapshot(false);
    });
    hoisted.mockTransactionSet.mockResolvedValue(undefined);
    hoisted.mockStorageSave.mockResolvedValue(undefined);
    hoisted.mockStorageDelete.mockResolvedValue(undefined);
    hoisted.mockHasProAccess.mockResolvedValue(false);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockSportsLib.importRoutesFromFit = vi.fn().mockResolvedValue(makeRouteFile());
    hoisted.mockSportsLib.importRoutesFromGPX = vi.fn().mockResolvedValue(makeRouteFile());
  });

  it('configures the route upload function with route processing runtime options', () => {
    expect(hoisted.capturedOnRequestOptions.value).toMatchObject({
      region: 'europe-west2',
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
    });
  });

  it('uploads a GPX route through sports-lib route parsing and an atomic route write', async () => {
    const response = makeResponse();
    const rawBody = Buffer.from('<gpx><rte></rte></gpx>');
    const request = makeRequest({
      rawBody,
      headers: {
        'x-file-extension': 'gpx',
        'x-original-filename': 'morning-route.gpx',
      },
    });

    await invokeUploadRoute(request, response);

    const expectedRouteID = createHash('sha256')
      .update('gpx')
      .update(':')
      .update('user-1')
      .update(':')
      .update(rawBody)
      .digest('hex');

    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalledWith(
      rawBody.toString(),
      expect.any(Function),
      expect.objectContaining({ generateUnitStreams: false }),
    );
    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(rawBody);

    const routeSetCall = transactionSetCallForPath(`users/user-1/routes/${expectedRouteID}`);
    expect(routeSetCall?.[1]).toMatchObject({
      id: expectedRouteID,
      userID: 'user-1',
      name: 'morning-route',
      routeCount: 1,
      pointCount: 2,
      originalFile: {
        path: expect.stringMatching(originalUploadPathPattern(expectedRouteID, 'gpx')),
        bucket: 'test-bucket',
        extension: 'gpx',
        originalFilename: 'morning-route.gpx',
        startDate: expect.any(Date),
      },
    });
    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: 1,
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(hoisted.mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: `users/user-1/routes/${expectedRouteID}/metaData/processing` }),
      expect.objectContaining({
        sportsLibVersionCode: 15000005,
        processedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true },
    );
    expect(hoisted.mockRoutesCountGet).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      routeId: expectedRouteID,
      routesCount: 1,
      routeCount: 1,
      duplicate: false,
      uploadLimit: ROUTE_USAGE_LIMITS.free,
      uploadCountAfterWrite: 1,
    });
  });

  it('returns an actionable error when the parser cannot find route data', async () => {
    hoisted.mockSportsLib.importRoutesFromGPX = vi.fn().mockRejectedValueOnce(new Error('No routes found in GPX'));
    const response = makeResponse();

    await invokeUploadRoute(makeRequest({
      rawBody: Buffer.from('<gpx></gpx>'),
      headers: {
        'x-file-extension': 'gpx',
        'x-original-filename': 'waypoints-only.gpx',
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'No route data was found in this file. Upload a FIT course/route or a GPX file that contains route or track points.',
    });
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('parses gzip-compressed GPX routes from decompressed bytes while storing the original upload', async () => {
    const response = makeResponse();
    const gpxPayload = Buffer.from('<gpx><rte><rtept lat="60.1" lon="24.9"></rtept></rte></gpx>');
    const compressedPayload = gzipSync(gpxPayload);
    const request = makeRequest({
      rawBody: compressedPayload,
      headers: {
        'x-file-extension': 'gpx.gz',
        'x-original-filename': 'morning-route.gpx.gz',
      },
    });

    await invokeUploadRoute(request, response);

    const expectedRouteID = createHash('sha256')
      .update('gpx')
      .update(':')
      .update('user-1')
      .update(':')
      .update(gpxPayload)
      .digest('hex');

    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalledWith(
      gpxPayload.toString(),
      expect.any(Function),
      expect.objectContaining({ generateUnitStreams: false }),
    );
    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(compressedPayload);
    expect(transactionSetCallForPath(`users/user-1/routes/${expectedRouteID}`)?.[1]).toMatchObject({
      originalFile: {
        path: expect.stringMatching(originalUploadPathPattern(expectedRouteID, 'gpx.gz')),
        extension: 'gpx.gz',
        originalFilename: 'morning-route.gpx.gz',
      },
    });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      routeId: expectedRouteID,
      duplicate: false,
    }));
  });

  it('rejects deleting users before gzip expansion or parsing', async () => {
    hoisted.mockGetAll.mockResolvedValueOnce([
      makeSnapshot(true),
      makeSnapshot(true, {}),
    ]);
    const response = makeResponse();
    const compressedPayload = gzipSync(Buffer.from('<gpx><rte></rte></gpx>'));

    await invokeUploadRoute(makeRequest({
      rawBody: compressedPayload,
      headers: {
        'x-file-extension': 'gpx.gz',
        'x-original-filename': 'morning-route.gpx.gz',
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(410);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Account is being deleted or no longer exists.',
    });
    expect(hoisted.mockHasBasicAccess).not.toHaveBeenCalled();
    expect(hoisted.mockSportsLib.importRoutesFromGPX).not.toHaveBeenCalled();
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('accepts highly-compressible gzip route payloads that stay under the absolute decompression cap', async () => {
    const response = makeResponse();
    const compressedPayload = gzipSync(Buffer.alloc(2 * 1024 * 1024, 'a'));

    await invokeUploadRoute(makeRequest({
      rawBody: compressedPayload,
      headers: {
        'x-file-extension': 'gpx.gz',
        'x-original-filename': 'oversized-route.gpx.gz',
      },
    }), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: false,
    }));
    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalled();
    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(compressedPayload);
    expect(hoisted.mockRunTransaction).toHaveBeenCalled();
  });

  it('short-circuits duplicate route uploads before parsing or storage writes', async () => {
    const rawBody = Buffer.from('<gpx></gpx>');
    const expectedRouteID = createHash('sha256')
      .update('gpx')
      .update(':')
      .update('user-1')
      .update(':')
      .update(rawBody)
      .digest('hex');
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path === `users/user-1/routes/${expectedRouteID}`) {
        return makeSnapshot(true, {
          routeCount: 2,
          routes: [{ id: 'segment-1' }, { id: 'segment-2' }],
          name: 'User renamed route',
          notes: 'Keep this note',
        });
      }
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 3 });
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest({ rawBody }), response);

    expect(hoisted.mockSportsLib.importRoutesFromGPX).not.toHaveBeenCalled();
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      routeId: expectedRouteID,
      routesCount: 2,
      routeCount: 2,
      duplicate: true,
      uploadLimit: ROUTE_USAGE_LIMITS.free,
      uploadCountAfterWrite: 3,
    });
  });

  it('preserves existing route documents when a duplicate appears during final write', async () => {
    const rawBody = Buffer.from('<gpx></gpx>');
    const expectedRouteID = createHash('sha256')
      .update('gpx')
      .update(':')
      .update('user-1')
      .update(':')
      .update(rawBody)
      .digest('hex');
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 3 });
      }
      return ref.path.includes('/routes/') ? makeSnapshot(true) : makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest({ rawBody }), response);

    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(rawBody);
    expect(hoisted.mockStorageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(transactionSetCallForPath(`users/user-1/routes/${expectedRouteID}`)).toBeUndefined();
    expect(transactionSetCallForPath(`users/user-1/routes/${expectedRouteID}/metaData/processing`)).toBeUndefined();
    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: 3,
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
      uploadCountAfterWrite: 3,
    }));
  });

  it('allows basic users up to the route-specific basic limit', async () => {
    hoisted.mockHasBasicAccess.mockResolvedValue(true);
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.basic - 1 });
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: ROUTE_USAGE_LIMITS.basic,
      uploadCountAfterWrite: ROUTE_USAGE_LIMITS.basic,
    }));
  });

  it('increments the route quota counter for pro users without applying a limit', async () => {
    hoisted.mockHasProAccess.mockResolvedValue(true);
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 250 });
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: 251,
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: null,
      uploadCountAfterWrite: 251,
    }));
  });

  it('rejects new free route uploads at the route-specific free limit', async () => {
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free });
      }
      return makeSnapshot(false);
    });
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: ROUTE_USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      error: `Upload limit reached for your tier. You have ${ROUTE_USAGE_LIMITS.free} routes. Limit is ${ROUTE_USAGE_LIMITS.free}.`,
    });
    expect(hoisted.mockSportsLib.importRoutesFromGPX).not.toHaveBeenCalled();
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
    expect(hoisted.mockTransactionSet).not.toHaveBeenCalled();
    expect(hoisted.mockStorageDelete).not.toHaveBeenCalled();
  });

  it('repairs a stale at-limit route quota counter before accepting a replacement upload', async () => {
    const counterUpdateTime = { seconds: 100, nanoseconds: 1 };
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: ROUTE_USAGE_LIMITS.free - 1 }) });
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free }, counterUpdateTime);
      }
      return makeSnapshot(false);
    });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free }, counterUpdateTime);
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(hoisted.mockRoutesCountGet).toHaveBeenCalledOnce();
    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: ROUTE_USAGE_LIMITS.free,
      reconciledAt: 'SERVER_TIMESTAMP',
      reconciledFromRouteCount: ROUTE_USAGE_LIMITS.free,
      reconciledActualRouteCount: ROUTE_USAGE_LIMITS.free - 1,
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: false,
      uploadCountAfterWrite: ROUTE_USAGE_LIMITS.free,
    }));
    expect(hoisted.mockStorageDelete).not.toHaveBeenCalled();
  });

  it('does not use a stale repaired count after the quota counter changes', async () => {
    const originalCounterUpdateTime = { seconds: 100, nanoseconds: 1 };
    const changedCounterUpdateTime = { seconds: 101, nanoseconds: 1 };
    hoisted.mockRoutesCountGet
      .mockResolvedValueOnce({ data: () => ({ count: ROUTE_USAGE_LIMITS.free - 1 }) })
      .mockResolvedValueOnce({ data: () => ({ count: ROUTE_USAGE_LIMITS.free }) });
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free }, originalCounterUpdateTime);
      }
      return makeSnapshot(false);
    });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(
          true,
          { routeCount: ROUTE_USAGE_LIMITS.free },
          changedCounterUpdateTime,
        );
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(hoisted.mockRoutesCountGet).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      error: `Upload limit reached for your tier. You have ${ROUTE_USAGE_LIMITS.free} routes. Limit is ${ROUTE_USAGE_LIMITS.free}.`,
    });
    expect(hoisted.mockTransactionSet).not.toHaveBeenCalled();
    expect(hoisted.mockStorageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('aborts an in-flight route upload when account deletion starts before the write transaction', async () => {
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'users/user-1') {
        return makeSnapshot(true);
      }
      if (ref.path === 'userDeletionTombstones/user-1') {
        return makeSnapshot(true, {});
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 0 });
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalled();
    expect(hoisted.mockStorageSave).toHaveBeenCalled();
    expect(hoisted.mockTransactionSet).not.toHaveBeenCalled();
    expect(hoisted.mockStorageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(response.status).toHaveBeenCalledWith(410);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Account is being deleted or no longer exists.',
    });
  });

  it('allows duplicate replacements at the route-specific free limit without incrementing quota', async () => {
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free });
      }
      if (path.includes('/routes/')) {
        return makeSnapshot(true);
      }
      return makeSnapshot(false);
    });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: ROUTE_USAGE_LIMITS.free });
      }
      return ref.path.includes('/routes/') ? makeSnapshot(true) : makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
      uploadCountAfterWrite: ROUTE_USAGE_LIMITS.free,
    }));
    expect(hoisted.mockSportsLib.importRoutesFromGPX).not.toHaveBeenCalled();
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
    expect(hoisted.mockStorageDelete).not.toHaveBeenCalled();
  });

  it('initializes the route quota counter from the aggregate route count before reserving quota', async () => {
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(false);
      }
      return makeSnapshot(false);
    });
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: 4 }) });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => activeUserGuardSnapshot(ref) || makeSnapshot(false));
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(hoisted.mockRoutesCountGet).toHaveBeenCalledTimes(2);
    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: 5,
      initializedAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadCountAfterWrite: 5,
    }));
  });

  it('repairs an invalid route quota counter from the aggregate route count before reserving quota', async () => {
    hoisted.mockDocGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 'invalid' });
      }
      return makeSnapshot(false);
    });
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: 4 }) });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return makeSnapshot(true, { routeCount: 'invalid' });
      }
      return makeSnapshot(false);
    });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(hoisted.mockRoutesCountGet).toHaveBeenCalledTimes(2);
    expect(transactionSetCallForPath('users/user-1/metaData/routeQuota')?.[1]).toMatchObject({
      routeCount: 5,
      repairedAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadCountAfterWrite: 5,
    }));
  });

  it('routes FIT course uploads to the FIT route importer', async () => {
    const response = makeResponse();
    const rawBody = Buffer.from([0x01, 0x02, 0x03]);
    const request = makeRequest({
      rawBody,
      headers: {
        'x-file-extension': 'fit',
        'x-original-filename': 'course.fit',
      },
    });

    await invokeUploadRoute(request, response);

    expect(hoisted.mockSportsLib.importRoutesFromFit).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ generateUnitStreams: false }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('rejects unsupported route file extensions', async () => {
    const response = makeResponse();
    await invokeUploadRoute(makeRequest({ headers: { 'x-file-extension': 'tcx' } }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Unsupported route file extension: tcx. Supported: fit, gpx.',
    });
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('returns a server error when the installed sports-lib build has no route parser API', async () => {
    hoisted.mockSportsLib.importRoutesFromFit = undefined;
    hoisted.mockSportsLib.importRoutesFromGPX = undefined;
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Route parsing is not available in the installed sports-lib version.',
    });
    expect(hoisted.mockStorageSave).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });
});
