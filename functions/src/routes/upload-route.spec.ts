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
  const mockRoutesCountGet = vi.fn();
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn();
  const mockStorageSave = vi.fn();
  const mockWriteAllRouteData = vi.fn();
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
    mockRoutesCountGet,
    mockDocGet,
    mockDocSet,
    mockStorageSave,
    mockWriteAllRouteData,
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
  const firestoreFn = vi.fn(() => ({
    collection: (path: string) => {
      if (path === 'users') {
        return {
          doc: () => ({
            collection: (name: string) => {
              if (name === 'routes') {
                return {
                  count: () => ({ get: hoisted.mockRoutesCountGet }),
                };
              }
              return {};
            },
          }),
        };
      }
      if (path === 'tmp') {
        return { doc: () => ({ id: 'tmp-generated-id' }) };
      }
      return { doc: () => ({}) };
    },
    doc: (path: string) => ({
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
        file: () => ({
          save: hoisted.mockStorageSave,
        }),
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

vi.mock('../shared/route-writer', () => ({
  RouteWriter: vi.fn(() => ({
    writeAllRouteData: (...args: unknown[]) => hoisted.mockWriteAllRouteData(...args),
  })),
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
  };

  return {
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
      name: 'Route',
      srcFileType: 'gpx',
      createdAt: Date.now(),
      routes: [],
      waypoints: [],
    }),
  };
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

describe('uploadRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockEnforceAppCheckFlag.value = true;
    hoisted.mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    hoisted.mockVerifyAppCheckToken.mockResolvedValue(undefined);
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
    hoisted.mockDocGet.mockResolvedValue({ exists: false });
    hoisted.mockDocSet.mockResolvedValue(undefined);
    hoisted.mockWriteAllRouteData.mockResolvedValue([]);
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

  it('uploads a GPX route through sports-lib route parsing and RouteWriter', async () => {
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
    expect(hoisted.mockWriteAllRouteData).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'morning-route',
        createdAt: expect.any(Date),
      }),
      expect.objectContaining({
        data: rawBody,
        extension: 'gpx',
        startDate: expect.any(Date),
        originalFilename: 'morning-route.gpx',
      }),
    );
    expect(hoisted.mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sportsLibVersionCode: 15000005,
        processedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true },
    );
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
    expect(hoisted.mockWriteAllRouteData).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      expect.objectContaining({
        data: compressedPayload,
        extension: 'gpx.gz',
        originalFilename: 'morning-route.gpx.gz',
      }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      routeId: expectedRouteID,
      duplicate: false,
    }));
  });

  it('marks duplicate route uploads without incrementing the route count', async () => {
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: 3 }) });
    hoisted.mockDocGet.mockResolvedValue({ exists: true });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
      uploadCountAfterWrite: 3,
    }));
  });

  it('allows basic users up to the route-specific basic limit', async () => {
    hoisted.mockHasBasicAccess.mockResolvedValue(true);
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: ROUTE_USAGE_LIMITS.basic - 1 }) });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      uploadLimit: ROUTE_USAGE_LIMITS.basic,
      uploadCountAfterWrite: ROUTE_USAGE_LIMITS.basic,
    }));
  });

  it('rejects new free route uploads at the route-specific free limit', async () => {
    hoisted.mockRoutesCountGet.mockResolvedValue({ data: () => ({ count: ROUTE_USAGE_LIMITS.free }) });
    const response = makeResponse();

    await invokeUploadRoute(makeRequest(), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      error: `Upload limit reached for your tier. You have ${ROUTE_USAGE_LIMITS.free} routes. Limit is ${ROUTE_USAGE_LIMITS.free}.`,
    });
    expect(hoisted.mockWriteAllRouteData).not.toHaveBeenCalled();
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
    expect(hoisted.mockWriteAllRouteData).not.toHaveBeenCalled();
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
    expect(hoisted.mockWriteAllRouteData).not.toHaveBeenCalled();
  });
});
