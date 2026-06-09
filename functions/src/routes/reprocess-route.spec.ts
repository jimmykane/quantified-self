import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockTransactionGet = vi.fn();
  const mockTransactionSet = vi.fn();
  const mockRunTransaction = vi.fn(async (handler: unknown) => (
    handler as (transaction: unknown) => Promise<unknown>
  )({
    get: mockTransactionGet,
    set: mockTransactionSet,
  }));
  const mockStorageDownload = vi.fn();
  const mockStorageFile = vi.fn((path: string) => ({
    path,
    download: mockStorageDownload,
  }));
  const mockStorageBucket = vi.fn(() => ({
    file: mockStorageFile,
  }));
  const mockSportsLib = {
    importRoutesFromFit: vi.fn(),
    importRoutesFromGPX: vi.fn(),
  } as Record<string, unknown>;
  const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
  const mockSportsLibVersionToCode = vi.fn(() => 15000006);
  const mockGetUserDeletionGuardState = vi.fn();
  const mockGetUserDeletionGuardStateInTransaction = vi.fn();
  let onCallOptions: unknown = null;

  return {
    mockDocGet,
    mockTransactionGet,
    mockTransactionSet,
    mockRunTransaction,
    mockStorageDownload,
    mockStorageFile,
    mockStorageBucket,
    mockSportsLib,
    mockServerTimestamp,
    mockSportsLibVersionToCode,
    mockGetUserDeletionGuardState,
    mockGetUserDeletionGuardStateInTransaction,
    getOnCallOptions: () => onCallOptions,
    setOnCallOptions: (options: unknown) => {
      onCallOptions = options;
    },
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (options: unknown, handler: unknown) => {
    hoisted.setOnCallOptions(options);
    return handler;
  },
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    doc: (path: string) => ({
      path,
      get: () => hoisted.mockDocGet(path),
    }),
    runTransaction: hoisted.mockRunTransaction,
  }),
  storage: () => ({
    bucket: hoisted.mockStorageBucket,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: hoisted.mockServerTimestamp,
  },
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  enforceAppCheck: (request: { app?: unknown }) => {
    if (!request.app) {
      throw new Error('App Check verification failed.');
    }
  },
}));

vi.mock('@sports-alliance/sports-lib', () => ({
  SportsLib: hoisted.mockSportsLib,
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
  sportsLibVersionToCode: (...args: unknown[]) => hoisted.mockSportsLibVersionToCode(...args),
}));

vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: {
    reprocessRoute: { name: 'reprocessRoute', region: 'europe-west2' },
  },
}));

vi.mock('../shared/user-deletion-guard', () => {
  class MockUserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      readonly uid: string,
      readonly phase: string,
      readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  }

  return {
    getUserDeletionGuardState: (...args: unknown[]) => hoisted.mockGetUserDeletionGuardState(...args),
    getUserDeletionGuardStateInTransaction: (...args: unknown[]) => (
      hoisted.mockGetUserDeletionGuardStateInTransaction(...args)
    ),
    UserDeletionGuardReadError: MockUserDeletionGuardReadError,
  };
});

import { reprocessRoute } from './reprocess-route';

function makeSnapshot(exists: boolean, data: Record<string, unknown> = {}) {
  return {
    exists,
    data: () => data,
  };
}

function makeRouteDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    userID: 'user-1',
    name: 'User Renamed Route',
    srcFileType: 'gpx',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    importedAt: 'ORIGINAL_IMPORTED_AT',
    routeCount: 1,
    waypointCount: 0,
    pointCount: 2,
    activityTypes: ['cycling'],
    streamTypes: [],
    routes: [{
      id: 'existing-segment-1',
      name: 'Existing Segment',
      activityType: 'cycling',
      pointCount: 2,
      streamTypes: [],
    }],
    originalFiles: [{
      path: 'users/user-1/routes/route-1/uploads/source/original.gpx',
      bucket: 'route-bucket',
      extension: 'gpx',
      originalFilename: 'source-route.gpx',
    }],
    ...overrides,
  };
}

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
      name: 'Parsed Segment',
      activityType: 'cycling',
      stats: {
        Distance: 1234,
        Ascent: 12,
        Descent: 10,
        'Minimum Grade': -2,
        'Maximum Grade': 4,
      },
      points: [
        { latitudeDegrees: 60.1, longitudeDegrees: 24.9, altitude: 11 },
        { latitudeDegrees: 60.2, longitudeDegrees: 25.0, altitude: 14 },
      ],
      streams: { distance: [0, 1234] },
    }),
  };

  const routeFile = {
    name: 'Parsed Route Name',
    srcFileType: 'gpx',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    getID: () => id,
    setID: (newID: string) => {
      id = newID;
    },
    getRoutes: () => [routeSegment],
    hasRoutes: () => true,
    getWaypoints: () => [{ latitudeDegrees: 60.1, longitudeDegrees: 24.9, name: 'Waypoint' }],
    toJSON: () => ({
      id: id || undefined,
      name: routeFile.name,
      srcFileType: routeFile.srcFileType,
      createdAt: routeFile.createdAt,
      routes: [routeSegment.toJSON()],
      waypoints: routeFile.getWaypoints(),
    }),
  };

  return routeFile;
}

function transactionSetCallForPath(path: string) {
  return hoisted.mockTransactionSet.mock.calls.find(([ref]) => (
    ref as { path?: string } | undefined
  )?.path === path);
}

describe('reprocessRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const activeDeletionGuard = {
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    };
    hoisted.mockGetUserDeletionGuardState.mockResolvedValue(activeDeletionGuard);
    hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValue(activeDeletionGuard);
    const routeDocument = makeRouteDocument();
    hoisted.mockDocGet.mockResolvedValue(makeSnapshot(true, routeDocument));
    hoisted.mockTransactionGet.mockResolvedValue(makeSnapshot(true, routeDocument));
    hoisted.mockStorageDownload.mockResolvedValue([Buffer.from('<gpx><rte></rte></gpx>')]);
    hoisted.mockSportsLib.importRoutesFromGPX = vi.fn().mockResolvedValue(makeRouteFile());
    hoisted.mockSportsLib.importRoutesFromFit = vi.fn().mockResolvedValue(makeRouteFile());
  });

  it('registers with route processing runtime limits', () => {
    expect(hoisted.getOnCallOptions()).toMatchObject({
      region: 'europe-west2',
      memory: '4GiB',
      cpu: 2,
      concurrency: 1,
      timeoutSeconds: 3600,
      maxInstances: 20,
    });
  });

  it('rejects unauthenticated requests and missing route IDs', async () => {
    await expect(reprocessRoute({
      auth: null,
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });

    await expect(reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: '' },
    } as any)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns not-found for a missing route document', async () => {
    hoisted.mockDocGet.mockResolvedValueOnce(makeSnapshot(false));

    await expect(reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('skips routes without original source files', async () => {
    hoisted.mockDocGet.mockResolvedValueOnce(makeSnapshot(true, makeRouteDocument({
      originalFiles: [],
      originalFile: undefined,
    })));

    const result = await reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any);

    expect(result).toEqual({
      routeId: 'route-1',
      status: 'skipped',
      reason: 'NO_ORIGINAL_FILES',
      sourceFilesCount: 0,
      routeCount: 0,
      waypointCount: 0,
      pointCount: 0,
    });
    expect(hoisted.mockStorageDownload).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('does not download or write when account deletion is active before reprocess work', async () => {
    hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Account is being deleted or no longer exists.',
    });

    expect(hoisted.mockStorageDownload).not.toHaveBeenCalled();
    expect(hoisted.mockSportsLib.importRoutesFromGPX).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('does not write when account deletion starts before the reprocess transaction', async () => {
    hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Account is being deleted or no longer exists.',
    });

    expect(hoisted.mockStorageDownload).toHaveBeenCalled();
    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalled();
    expect(hoisted.mockTransactionSet).not.toHaveBeenCalled();
  });

  it('returns unavailable when account deletion state cannot be verified', async () => {
    hoisted.mockGetUserDeletionGuardState.mockRejectedValueOnce(new Error('guard unavailable'));

    await expect(reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Could not verify account state. Please retry.',
    });

    expect(hoisted.mockStorageDownload).not.toHaveBeenCalled();
    expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
  });

  it('reprocesses saved GPX source and preserves user-owned route fields', async () => {
    const result = await reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any);

    expect(hoisted.mockStorageBucket).toHaveBeenCalledWith('route-bucket');
    expect(hoisted.mockStorageFile).toHaveBeenCalledWith('users/user-1/routes/route-1/uploads/source/original.gpx');
    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalledWith(
      '<gpx><rte></rte></gpx>',
      expect.any(Function),
      expect.objectContaining({ generateUnitStreams: false }),
    );

    const routeSetCall = transactionSetCallForPath('users/user-1/routes/route-1');
    expect(routeSetCall?.[1]).toMatchObject({
      id: 'route-1',
      userID: 'user-1',
      name: 'User Renamed Route',
      importedAt: 'ORIGINAL_IMPORTED_AT',
      routeCount: 1,
      waypointCount: 1,
      pointCount: 2,
      originalFiles: [{
        path: 'users/user-1/routes/route-1/uploads/source/original.gpx',
        bucket: 'route-bucket',
        extension: 'gpx',
        originalFilename: 'source-route.gpx',
      }],
      routes: [{
        id: 'existing-segment-1',
        name: 'Parsed Segment',
        pointCount: 2,
      }],
      stats: expect.objectContaining({
        Distance: 1234,
        Ascent: 12,
        Descent: 10,
      }),
    });
    expect(routeSetCall?.[2]).toBeUndefined();
    expect(transactionSetCallForPath('users/user-1/routes/route-1/metaData/processing')?.[1]).toMatchObject({
      sportsLibVersionCode: 15000006,
      processedAt: 'SERVER_TIMESTAMP',
    });
    expect(result).toEqual({
      routeId: 'route-1',
      status: 'completed',
      sourceFilesCount: 1,
      routeCount: 1,
      waypointCount: 1,
      pointCount: 2,
    });
  });

  it('replaces stale server-owned fields without dropping user-owned fields', async () => {
    const staleRouteDocument = makeRouteDocument({
      description: 'Keep this user note',
      creator: { name: 'Old creator from prior parse' },
      sourceFileType: 'legacy-source-type',
      stats: {
        Distance: 999999,
        OldComputedStat: 1,
      },
    });
    hoisted.mockDocGet.mockResolvedValueOnce(makeSnapshot(true, staleRouteDocument));
    hoisted.mockTransactionGet.mockResolvedValueOnce(makeSnapshot(true, staleRouteDocument));

    await reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any);

    const routeSetCall = transactionSetCallForPath('users/user-1/routes/route-1');
    const payload = routeSetCall?.[1] as Record<string, unknown>;
    const stats = payload.stats as Record<string, unknown>;

    expect(routeSetCall?.[2]).toBeUndefined();
    expect(payload.description).toBe('Keep this user note');
    expect(payload.creator).toBeUndefined();
    expect(payload.sourceFileType).toBeUndefined();
    expect(stats.Distance).toBe(1234);
    expect(stats.OldComputedStat).toBeUndefined();
  });

  it('decompresses saved gzip route sources before parsing', async () => {
    const gpxPayload = Buffer.from('<gpx><trk></trk></gpx>');
    hoisted.mockDocGet.mockResolvedValueOnce(makeSnapshot(true, makeRouteDocument({
      srcFileType: 'gpx.gz',
      originalFiles: [{
        path: 'users/user-1/routes/route-1/uploads/source/original.gpx.gz',
        extension: 'gpx.gz',
      }],
    })));
    hoisted.mockStorageDownload.mockResolvedValueOnce([gzipSync(gpxPayload)]);

    await reprocessRoute({
      auth: { uid: 'user-1' },
      app: { appId: 'app-id' },
      data: { routeId: 'route-1' },
    } as any);

    expect(hoisted.mockSportsLib.importRoutesFromGPX).toHaveBeenCalledWith(
      gpxPayload.toString(),
      expect.any(Function),
      expect.any(Object),
    );
  });
});
