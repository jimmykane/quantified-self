'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  GARMIN_DELIVERY_METADATA_ABORT_MESSAGE,
  GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE,
  SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
} from '../../../shared/saved-route-send';
import { PRO_REQUIRED_MESSAGE } from '../utils';

const routeDocuments = new Map<string, Record<string, unknown>>();
const storagePayloads = new Map<string, Buffer>();
const storageErrors = new Map<string, unknown>();

const utilsMocks = {
  hasProAccess: vi.fn(),
};

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: (...args: any[]) => utilsMocks.hasProAccess(...args),
  };
});

const deletionGuardMocks = {
  getUserDeletionGuardState: vi.fn(),
};

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: any[]) => deletionGuardMocks.getUserDeletionGuardState(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  },
}));

const routeProcessingMocks = {
  resolveRouteSourceExtension: vi.fn(),
  maybeDecompressPayloadForParsing: vi.fn(),
  parseRoutePayload: vi.fn(),
  assignRouteSegmentIDs: vi.fn(),
  getRouteParsingFailureMessage: vi.fn(),
};

vi.mock('./route-processing', () => ({
  assignRouteSegmentIDs: (...args: any[]) => routeProcessingMocks.assignRouteSegmentIDs(...args),
  getRouteParsingFailureMessage: (...args: any[]) => routeProcessingMocks.getRouteParsingFailureMessage(...args),
  maybeDecompressPayloadForParsing: (...args: any[]) => routeProcessingMocks.maybeDecompressPayloadForParsing(...args),
  parseRoutePayload: (...args: any[]) => routeProcessingMocks.parseRoutePayload(...args),
  resolveRouteSourceExtension: (...args: any[]) => routeProcessingMocks.resolveRouteSourceExtension(...args),
  RouteProcessingHttpStatusError: class RouteProcessingHttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
      this.name = 'RouteProcessingHttpStatusError';
    }
  },
}));

const suuntoRouteMocks = {
  createSuuntoRouteUploadContext: vi.fn(),
  uploadGPXRouteToSuuntoApp: vi.fn(),
};

vi.mock('../suunto/routes', () => ({
  createSuuntoRouteUploadContext: (...args: any[]) => suuntoRouteMocks.createSuuntoRouteUploadContext(...args),
  uploadGPXRouteToSuuntoApp: (...args: any[]) => suuntoRouteMocks.uploadGPXRouteToSuuntoApp(...args),
  SuuntoRouteUploadSkippedForDeletedUserError: class SuuntoRouteUploadSkippedForDeletedUserError extends Error {
    readonly name = 'SuuntoRouteUploadSkippedForDeletedUserError';
  },
}));

const garminRouteMocks = {
  createGarminRouteSendContext: vi.fn(),
  sendRouteToGarminConnect: vi.fn(),
};

vi.mock('../garmin/routes', () => ({
  createGarminRouteSendContext: (...args: any[]) => garminRouteMocks.createGarminRouteSendContext(...args),
  sendRouteToGarminConnect: (...args: any[]) => garminRouteMocks.sendRouteToGarminConnect(...args),
  GarminRouteSendPermissionRequiredError: class GarminRouteSendPermissionRequiredError extends Error {
    readonly name = 'GarminRouteSendPermissionRequiredError';
  },
}));

const wahooRouteMocks = {
  createWahooRouteSendContext: vi.fn(),
  sendSavedRouteToWahoo: vi.fn(),
};

vi.mock('../wahoo/routes', () => ({
  createWahooRouteSendContext: (...args: any[]) => wahooRouteMocks.createWahooRouteSendContext(...args),
  sendSavedRouteToWahoo: (...args: any[]) => wahooRouteMocks.sendSavedRouteToWahoo(...args),
  WahooRouteUploadSkippedForDeletedUserError: class WahooRouteUploadSkippedForDeletedUserError extends Error {
    readonly name = 'WahooRouteUploadSkippedForDeletedUserError';
  },
  WahooRouteWriteScopeRequiredError: class WahooRouteWriteScopeRequiredError extends Error {
    readonly name = 'WahooRouteWriteScopeRequiredError';
    readonly code = 'failed-precondition';

    constructor() {
      super('Reconnect Wahoo and allow route access before sending routes.');
    }
  },
}));

const routePersistenceMocks = {
  isRouteFromSourceService: vi.fn(),
  setRouteDeliveryMetadata: vi.fn(),
};

vi.mock('./route-persistence', () => ({
  isRouteFromSourceService: (...args: any[]) => routePersistenceMocks.isRouteFromSourceService(...args),
  setRouteDeliveryMetadata: (...args: any[]) => routePersistenceMocks.setRouteDeliveryMetadata(...args),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
  return {
    ...actual,
    RouteExporterGPX: class RouteExporterGPX {
      async getAsString(routeFile: { name?: string; getRoutes?: () => Array<{ name?: string | null }> }): Promise<string> {
        const routeNames = (routeFile.getRoutes?.() || [])
          .map(route => route.name || '')
          .join('|');
        return `<gpx><metadata><name>${routeFile.name || ''}</name></metadata><routes>${routeNames}</routes></gpx>`;
      }
    },
  };
});

vi.mock('firebase-admin', () => {
  const docMock = vi.fn((path: string) => ({
    get: vi.fn().mockImplementation(async () => {
      const data = routeDocuments.get(path);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
  }));

  const firestoreMock = {
    doc: docMock,
  };

  const bucketMock = vi.fn((_bucketName?: string) => ({
    file: (path: string) => ({
      download: vi.fn().mockImplementation(async () => {
        if (storageErrors.has(path)) {
          throw storageErrors.get(path);
        }
        const payload = storagePayloads.get(path);
        if (!payload) {
          throw new Error(`Missing storage payload for ${path}`);
        }
        return [payload];
      }),
    }),
  }));

  return {
    firestore: () => firestoreMock,
    storage: () => ({ bucket: bucketMock }),
    initializeApp: vi.fn(),
  };
});

import { sendRoutesToService } from './send-routes-to-service';

function createRequest(data: Record<string, unknown>, overrides: Partial<{ auth: { uid: string } | null; app: object | null }> = {}) {
  return {
    auth: overrides.auth !== undefined ? overrides.auth : { uid: 'user-1' },
    app: overrides.app !== undefined ? overrides.app : { appId: 'app-1' },
    data,
  };
}

function createRouteFile(routeNames: Array<string | null> = ['Original segment']) {
  let id: string | null = null;
  const routes = routeNames.map((name, index) => ({ id: `segment-${index + 1}`, name }));
  return {
    name: 'Original route file',
    getID: () => id,
    setID: vi.fn((nextID: string) => { id = nextID; }),
    hasRoutes: vi.fn(() => true),
    getRoutes: vi.fn(() => routes),
  };
}

describe('sendRoutesToService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeDocuments.clear();
    storagePayloads.clear();
    storageErrors.clear();
    utilsMocks.hasProAccess.mockResolvedValue(true);
    deletionGuardMocks.getUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    routeProcessingMocks.resolveRouteSourceExtension.mockReturnValue('gpx');
    routeProcessingMocks.maybeDecompressPayloadForParsing.mockImplementation((payload: Buffer) => payload);
    routeProcessingMocks.parseRoutePayload.mockResolvedValue(createRouteFile());
    routeProcessingMocks.getRouteParsingFailureMessage.mockReturnValue('Could not read route.');
    suuntoRouteMocks.createSuuntoRouteUploadContext.mockResolvedValue({
      tokenRefs: [{ id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' }],
      userNames: ['suunto-user-1'],
    });
    suuntoRouteMocks.uploadGPXRouteToSuuntoApp.mockResolvedValue({
      status: 'success',
      successCount: 1,
      providerRouteIds: ['suunto-route-1'],
      deliveries: [{ providerUserId: 'suunto-user-1', providerRouteId: 'suunto-route-1' }],
    });
    routePersistenceMocks.isRouteFromSourceService.mockImplementation((routeDocument: Record<string, any> | null | undefined, serviceName: string) => (
      routeDocument?.sourceSummary?.sourceServiceName === serviceName
    ));
    routePersistenceMocks.setRouteDeliveryMetadata.mockResolvedValue(true);
    garminRouteMocks.createGarminRouteSendContext.mockResolvedValue({
      tokenSnapshots: [{
        id: 'garmin-token-1',
        ref: { get: vi.fn() },
        data: () => ({ userID: 'garmin-user-1', permissions: ['COURSE_IMPORT'] }),
      }],
      preferredProviderUserId: 'garmin-user-1',
    });
    garminRouteMocks.sendRouteToGarminConnect.mockResolvedValue({
      providerRouteId: 'garmin-course-1',
      deliveries: [{ providerUserId: 'garmin-user-1', providerRouteId: 'garmin-course-1' }],
    });
    wahooRouteMocks.createWahooRouteSendContext.mockResolvedValue(undefined);
    wahooRouteMocks.sendSavedRouteToWahoo.mockResolvedValue({
      status: 'success',
      providerRouteId: 'wahoo-route-1',
      message: 'Route uploaded to Wahoo.',
    });
  });

  it('rejects unsupported destinations', async () => {
    await expect(sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.COROSAPI,
    }) as any)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects invalid and too-large route id batches', async () => {
    await expect(sendRoutesToService(createRequest({
      routeIds: [],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any)).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(sendRoutesToService(createRequest({
      routeIds: Array.from({ length: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1 }, (_value, index) => `route-${index}`),
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects non-pro users and returns in-band Suunto auth failures when no Suunto account is connected', async () => {
    utilsMocks.hasProAccess.mockResolvedValueOnce(false);
    await expect(sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any)).rejects.toMatchObject({
      code: 'permission-denied',
      message: PRO_REQUIRED_MESSAGE,
    });

    const { HttpsError } = await import('firebase-functions/v2/https');
    suuntoRouteMocks.createSuuntoRouteUploadContext.mockRejectedValueOnce(
      new HttpsError('unauthenticated', 'No connected Suunto account found'),
    );

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'No connected Suunto account found',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
  });

  it('returns Garmin auth failures in-band when no Garmin account is connected', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    garminRouteMocks.createGarminRouteSendContext.mockRejectedValueOnce(
      new HttpsError('unauthenticated', 'No connected Garmin account found.'),
    );

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'failure',
      routeCount: 2,
      successCount: 0,
      failureCount: 2,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'No connected Garmin account found.',
      }),
      expect.objectContaining({
        routeId: 'route-2',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'No connected Garmin account found.',
      }),
    ]);
  });

  it('returns Garmin permission failures in-band when Course Import permission is missing', async () => {
    const { GarminRouteSendPermissionRequiredError } = await import('../garmin/routes');
    garminRouteMocks.createGarminRouteSendContext.mockRejectedValueOnce(
      new GarminRouteSendPermissionRequiredError('Grant Garmin Course Import permission and reconnect before sending routes.'),
    );

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DESTINATION_PERMISSION_REQUIRED',
        message: 'Grant Garmin Course Import permission and reconnect before sending routes.',
      }),
    ]);
  });

  it('sends saved routes to Wahoo through the shared route-send adapter', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Wahoo Ready Route',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.WahooAPI,
    }) as any);

    expect(wahooRouteMocks.createWahooRouteSendContext).toHaveBeenCalledWith('user-1');
    expect(wahooRouteMocks.sendSavedRouteToWahoo).toHaveBeenCalledWith(
      'user-1',
      'route-1',
      expect.objectContaining({ name: 'Wahoo Ready Route' }),
    );
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.WahooAPI,
      status: 'success',
      successCount: 1,
    });
  });

  it('returns a Wahoo route-scope failure in-band', async () => {
    const { WahooRouteWriteScopeRequiredError } = await import('../wahoo/routes');
    wahooRouteMocks.createWahooRouteSendContext.mockRejectedValueOnce(
      new WahooRouteWriteScopeRequiredError(),
    );

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.WahooAPI,
    }) as any);

    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DESTINATION_PERMISSION_REQUIRED',
        message: 'Reconnect Wahoo and allow route access before sending routes.',
      }),
    ]);
  });

  it('retries Garmin delivery metadata persistence after a transient write failure and still returns success', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    routePersistenceMocks.setRouteDeliveryMetadata
      .mockRejectedValueOnce(new Error('transient Firestore failure'))
      .mockResolvedValue(true);

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'success',
      routeCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
    });
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledTimes(2);
  });

  it('returns a Garmin send failure when delivery metadata cannot be saved after upload', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    routePersistenceMocks.setRouteDeliveryMetadata.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(garminRouteMocks.sendRouteToGarminConnect).toHaveBeenCalledTimes(1);
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'failure',
        reason: 'DELIVERY_METADATA_PERSIST_FAILED',
        message: GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE,
      }),
    ]);
  });

  it('returns a Garmin send failure when delivery metadata write is explicitly skipped after upload', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    routePersistenceMocks.setRouteDeliveryMetadata.mockResolvedValue(false);

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(garminRouteMocks.sendRouteToGarminConnect).toHaveBeenCalledTimes(1);
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledTimes(3);
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'failure',
        reason: 'DELIVERY_METADATA_PERSIST_FAILED',
        message: GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE,
      }),
    ]);
  });

  it('stops the current Garmin batch after delivery metadata persistence fails', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-2/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-2' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    routePersistenceMocks.setRouteDeliveryMetadata.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(garminRouteMocks.sendRouteToGarminConnect).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'failure',
      routeCount: 2,
      successCount: 0,
      failureCount: 2,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DELIVERY_METADATA_PERSIST_FAILED',
        message: GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE,
      }),
      expect.objectContaining({
        routeId: 'route-2',
        reason: 'SEND_REQUEST_FAILED',
        message: GARMIN_DELIVERY_METADATA_ABORT_MESSAGE,
      }),
    ]);
  });

  it('stops the current Garmin chunk after an in-band Course Import permission failure', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-2/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    storagePayloads.set('users/user-1/routes/route-2/original.gpx', Buffer.from('<gpx></gpx>'));

    const { GarminRouteSendPermissionRequiredError } = await import('../garmin/routes');
    garminRouteMocks.sendRouteToGarminConnect
      .mockRejectedValueOnce(new GarminRouteSendPermissionRequiredError(
        'Grant Garmin Course Import permission and reconnect before sending routes.',
      ));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(garminRouteMocks.sendRouteToGarminConnect).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'failure',
      routeCount: 2,
      successCount: 0,
      failureCount: 2,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        reason: 'DESTINATION_PERMISSION_REQUIRED',
      }),
      expect.objectContaining({
        routeId: 'route-2',
        reason: 'DESTINATION_PERMISSION_REQUIRED',
      }),
    ]);
  });

  it('rejects when the account deletion guard is active', async () => {
    deletionGuardMocks.getUserDeletionGuardState.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('returns an in-band skipped result when account deletion starts before provider upload', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    deletionGuardMocks.getUserDeletionGuardState
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: true,
        shouldSkip: true,
      });

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result).toMatchObject({
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 0,
      skippedCount: 1,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'skipped',
        reason: 'ACCOUNT_DELETION_IN_PROGRESS',
        message: 'Account is being deleted or no longer exists.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
  });

  it('preserves earlier successes when account deletion starts mid-batch', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-2/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-2' }],
    });
    routeDocuments.set('users/user-1/routes/route-3', {
      id: 'route-3',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-3/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-3' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    deletionGuardMocks.getUserDeletionGuardState
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: true,
        shouldSkip: true,
      });

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2', 'route-3'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result).toMatchObject({
      status: 'partial_success',
      routeCount: 3,
      successCount: 1,
      failureCount: 0,
      skippedCount: 2,
    });
    expect(result.results).toEqual([
      expect.objectContaining({ routeId: 'route-1', status: 'success' }),
      expect.objectContaining({
        routeId: 'route-2',
        status: 'skipped',
        reason: 'ACCOUNT_DELETION_IN_PROGRESS',
      }),
      expect.objectContaining({
        routeId: 'route-3',
        status: 'skipped',
        reason: 'ACCOUNT_DELETION_IN_PROGRESS',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledTimes(1);
  });

  it('returns remaining routes as account-state failures when the deletion guard cannot be read mid-batch', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-2/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-2' }],
    });
    routeDocuments.set('users/user-1/routes/route-3', {
      id: 'route-3',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-3/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-3' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    deletionGuardMocks.getUserDeletionGuardState
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      })
      .mockRejectedValueOnce(new Error('guard read failed'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2', 'route-3'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result).toMatchObject({
      status: 'partial_success',
      routeCount: 3,
      successCount: 1,
      failureCount: 2,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({ routeId: 'route-1', status: 'success' }),
      expect.objectContaining({
        routeId: 'route-2',
        status: 'failure',
        reason: 'ACCOUNT_STATE_UNAVAILABLE',
        message: 'Could not verify account state. Please retry.',
      }),
      expect.objectContaining({
        routeId: 'route-3',
        status: 'failure',
        reason: 'ACCOUNT_STATE_UNAVAILABLE',
        message: 'Could not verify account state. Please retry.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledTimes(1);
  });

  it('preserves earlier successes when Suunto authentication becomes invalid mid-batch', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-2/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-2' }],
    });
    routeDocuments.set('users/user-1/routes/route-3', {
      id: 'route-3',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-3/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-3' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));
    storagePayloads.set('users/user-1/routes/route-2/original.gpx', Buffer.from('<gpx></gpx>'));
    suuntoRouteMocks.uploadGPXRouteToSuuntoApp
      .mockResolvedValueOnce({
        status: 'success',
        successCount: 1,
        providerRouteIds: ['suunto-route-1'],
      })
      .mockRejectedValueOnce(new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2', 'route-3'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result).toMatchObject({
      status: 'partial_success',
      routeCount: 3,
      successCount: 1,
      failureCount: 2,
      skippedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({ routeId: 'route-1', status: 'success' }),
      expect.objectContaining({
        routeId: 'route-2',
        status: 'failure',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'Authentication failed. Please re-connect your Suunto account.',
      }),
      expect.objectContaining({
        routeId: 'route-3',
        status: 'failure',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'Authentication failed. Please re-connect your Suunto account.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledTimes(2);
  });

  it('prepares a saved route and uploads generated GPX to Suunto with the saved route name applied to metadata and the single child route', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Evening Loop',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(routeProcessingMocks.resolveRouteSourceExtension).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1/routes/route-1/original.gpx' }),
      'gpx',
    );
    expect(routeProcessingMocks.assignRouteSegmentIDs).toHaveBeenCalledWith(expect.anything(), 'route-1', ['segment-1']);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledWith(
      'user-1',
      '<gpx><metadata><name>Evening Loop</name></metadata><routes>Evening Loop</routes></gpx>',
      {
        tokenRefs: [{ id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' }],
        userNames: ['suunto-user-1'],
      },
    );
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledWith({
      userID: 'user-1',
      routeID: 'route-1',
      deliveryMetadata: expect.objectContaining({
        serviceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
        status: 'success',
        providerRouteId: 'suunto-route-1',
      }),
    });
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'success',
      routeCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
    });
  });

  it('keeps child route names for multi-route sends', async () => {
    routeProcessingMocks.parseRoutePayload.mockResolvedValueOnce(createRouteFile(['First segment', 'Second segment']));
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Route Collection',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }, { id: 'segment-2' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledWith(
      'user-1',
      '<gpx><metadata><name>Route Collection</name></metadata><routes>First segment|Second segment</routes></gpx>',
      {
        tokenRefs: [{ id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' }],
        userNames: ['suunto-user-1'],
      },
    );
  });

  it('persists delivery metadata separately for each connected Suunto account', async () => {
    suuntoRouteMocks.createSuuntoRouteUploadContext.mockResolvedValueOnce({
      tokenRefs: [
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2' },
      ],
      userNames: ['suunto-user-1', 'suunto-user-2'],
    });
    suuntoRouteMocks.uploadGPXRouteToSuuntoApp.mockResolvedValueOnce({
      status: 'success',
      successCount: 2,
      providerRouteIds: ['suunto-route-1', 'suunto-route-2'],
      deliveries: [
        { providerUserId: 'suunto-user-1', providerRouteId: 'suunto-route-1' },
        { providerUserId: 'suunto-user-2', providerRouteId: 'suunto-route-2' },
      ],
    });
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Evening Loop',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledTimes(2);
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenNthCalledWith(1, {
      userID: 'user-1',
      routeID: 'route-1',
      deliveryMetadata: expect.objectContaining({
        serviceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
        providerRouteId: 'suunto-route-1',
      }),
    });
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenNthCalledWith(2, {
      userID: 'user-1',
      routeID: 'route-1',
      deliveryMetadata: expect.objectContaining({
        serviceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-2',
        providerRouteId: 'suunto-route-2',
      }),
    });
  });

  it('sends saved routes to Garmin Connect and persists provider-scoped delivery metadata', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Garmin Ready Route',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.GarminAPI,
    }) as any);

    expect(garminRouteMocks.createGarminRouteSendContext).toHaveBeenCalledWith('user-1');
    expect(garminRouteMocks.sendRouteToGarminConnect).toHaveBeenCalledWith(
      'user-1',
      'route-1',
      expect.objectContaining({ id: 'route-1', name: 'Garmin Ready Route' }),
      expect.objectContaining({ name: 'Garmin Ready Route' }),
      expect.objectContaining({ preferredProviderUserId: 'garmin-user-1' }),
    );
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledWith({
      userID: 'user-1',
      routeID: 'route-1',
      deliveryMetadata: expect.objectContaining({
        serviceName: ServiceNames.GarminAPI,
        providerUserId: 'garmin-user-1',
        status: 'success',
        providerRouteId: 'garmin-course-1',
      }),
    });
    expect(result).toMatchObject({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'success',
      routeCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      results: [
        expect.objectContaining({
          routeId: 'route-1',
          status: 'success',
          providerRouteId: 'garmin-course-1',
        }),
      ],
    });
  });

  it('continues after per-route failures and reports skipped source files', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    routeDocuments.set('users/user-1/routes/route-2', {
      id: 'route-2',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [],
      routes: [],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1', 'route-2'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result.status).toBe('partial_success');
    expect(result.successCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({ routeId: 'route-1', status: 'success' }),
      expect.objectContaining({ routeId: 'route-2', status: 'skipped', reason: 'NO_ORIGINAL_FILES' }),
    ]);
  });

  it('reports unsupported saved source files as parse failures', async () => {
    const { RouteProcessingHttpStatusError } = await import('./route-processing');
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'txt',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.txt', extension: 'txt' }],
      routes: [{ id: 'segment-1' }],
    });
    routeProcessingMocks.resolveRouteSourceExtension.mockImplementationOnce(() => {
      throw new RouteProcessingHttpStatusError(400, 'Saved route source file has no supported extension.');
    });

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result.status).toBe('failure');
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'failure',
        reason: 'PARSE_FAILED',
        message: 'Saved route source file has no supported extension.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
  });

  it('reports missing stored originals as source file failures', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result.status).toBe('failure');
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'failure',
        reason: 'SOURCE_FILE_UNAVAILABLE',
        message: 'Saved route source file could not be downloaded.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
  });

  it('reports transient stored original download failures as provider errors', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      srcFileType: 'gpx',
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storageErrors.set('users/user-1/routes/route-1/original.gpx', Object.assign(new Error('Storage unavailable'), {
      code: 503,
    }));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result.status).toBe('failure');
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'failure',
        reason: 'PROVIDER_ERROR',
        message: 'Saved route source file could not be downloaded.',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
  });

  it('skips Suunto-sourced routes when only the source Suunto account is connected', async () => {
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Suunto route',
      srcFileType: 'gpx',
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
      },
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(result.status).toBe('failure');
    expect(result.results).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        status: 'skipped',
        reason: 'SOURCE_SERVICE_BLOCKED',
      }),
    ]);
    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).not.toHaveBeenCalled();
    expect(routePersistenceMocks.setRouteDeliveryMetadata).not.toHaveBeenCalled();
  });

  it('sends Suunto-sourced routes to other connected Suunto accounts and skips the source account', async () => {
    suuntoRouteMocks.createSuuntoRouteUploadContext.mockResolvedValueOnce({
      tokenRefs: [
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2' },
      ],
      userNames: ['suunto-user-1', 'suunto-user-2'],
    });
    suuntoRouteMocks.uploadGPXRouteToSuuntoApp.mockResolvedValueOnce({
      status: 'success',
      successCount: 1,
      providerRouteIds: ['suunto-route-2'],
      deliveries: [
        { providerUserId: 'suunto-user-2', providerRouteId: 'suunto-route-2' },
      ],
    });
    routeDocuments.set('users/user-1/routes/route-1', {
      id: 'route-1',
      userID: 'user-1',
      name: 'Suunto route',
      srcFileType: 'gpx',
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
      },
      originalFiles: [{ path: 'users/user-1/routes/route-1/original.gpx', extension: 'gpx' }],
      routes: [{ id: 'segment-1' }],
    });
    storagePayloads.set('users/user-1/routes/route-1/original.gpx', Buffer.from('<gpx></gpx>'));

    const result = await sendRoutesToService(createRequest({
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    }) as any);

    expect(suuntoRouteMocks.uploadGPXRouteToSuuntoApp).toHaveBeenCalledWith(
      'user-1',
      '<gpx><metadata><name>Suunto route</name></metadata><routes>Suunto route</routes></gpx>',
      {
        tokenRefs: [{ id: 'token-2', ref: {}, providerUserId: 'suunto-user-2' }],
        userNames: ['suunto-user-2'],
      },
    );
    expect(routePersistenceMocks.setRouteDeliveryMetadata).toHaveBeenCalledWith({
      userID: 'user-1',
      routeID: 'route-1',
      deliveryMetadata: expect.objectContaining({
        serviceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-2',
        providerRouteId: 'suunto-route-2',
      }),
    });
    expect(result).toMatchObject({
      status: 'success',
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
    });
  });
});
