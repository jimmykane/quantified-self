'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const garminTokenDocsByUser = new Map<string, any[]>();
const routeDeliveryMetadataByKey = new Map<string, Record<string, unknown>>();

const requestHelperMocks = {
  post: vi.fn(),
  put: vi.fn(),
};

vi.mock('../request-helper', () => ({
  post: (...args: any[]) => requestHelperMocks.post(...args),
  put: (...args: any[]) => requestHelperMocks.put(...args),
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
  return {
    ...actual,
  };
});

const tokenMocks = {
  getTokenData: vi.fn(),
};

vi.mock('../tokens', () => ({
  getTokenData: (...args: any[]) => tokenMocks.getTokenData(...args),
  TerminalServiceAuthError: class TerminalServiceAuthError extends Error {
    readonly name = 'TerminalServiceAuthError';
  },
  TokenRefreshSkippedForDeletedUserError: class TokenRefreshSkippedForDeletedUserError extends Error {
    readonly name = 'TokenRefreshSkippedForDeletedUserError';
  },
}));

vi.mock('../routes/route-persistence', () => ({
  getRouteDeliveryMetadataRef: (_db: unknown, userID: string, routeID: string, serviceName: string, providerUserId?: string | null) => ({
    get: vi.fn().mockImplementation(async () => {
      const key = `${userID}:${routeID}:${serviceName}:${providerUserId || ''}`;
      const data = routeDeliveryMetadataByKey.get(key);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
  }),
}));

vi.mock('firebase-admin', () => {
  const firestoreMock = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((userID: string) => ({
        collection: vi.fn(() => ({
          get: vi.fn().mockImplementation(async () => {
            const docs = garminTokenDocsByUser.get(`${collectionName}:${userID}`) || [];
            return {
              empty: docs.length === 0,
              docs,
            };
          }),
        })),
      })),
    })),
  };

  return {
    firestore: () => firestoreMock,
    initializeApp: vi.fn(),
  };
});

import {
  createGarminRouteSendContext,
  GarminRouteSendPermissionRequiredError,
  sendRouteToGarminConnect,
} from './routes';

function createTokenSnapshot(id: string, userID: string, permissions: string[] = ['COURSE_IMPORT'], dateCreated = 1000) {
  const snapshot = {
    id,
    data: vi.fn(() => ({
      userID,
      permissions,
      dateCreated,
    })),
    ref: {
      get: vi.fn(),
    },
  } as any;

  snapshot.ref.get.mockResolvedValue({
    exists: true,
    id,
    ref: snapshot.ref,
    data: () => ({
      userID,
      permissions,
      accessToken: `access-${id}`,
      refreshToken: `refresh-${id}`,
      expiresAt: Date.now() + 60_000,
      serviceName: ServiceNames.GarminAPI,
    }),
  });

  return snapshot;
}

function createRouteFile(activityType = 'Cycling') {
  return {
    name: 'QS Route Name',
    getStats: () => new Map([
      ['Distance', { getValue: () => 12345.6 }],
      ['Ascent', { getValue: () => 456.7 }],
      ['Descent', { getValue: () => 321.4 }],
    ]),
    getRoutes: () => [{
      activityType,
      getPointData: () => [
        { latitudeDegrees: 37.1, longitudeDegrees: 23.7, altitude: 120, name: 'Start' },
        { latitudeDegrees: 37.2, longitudeDegrees: 23.8, altitude: 135 },
      ],
    }],
  } as any;
}

describe('garmin route sending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    garminTokenDocsByUser.clear();
    routeDeliveryMetadataByKey.clear();
    tokenMocks.getTokenData.mockResolvedValue({
      accessToken: 'garmin-access-token',
    });
  });

  it('rejects context creation when no Garmin token is connected', async () => {
    await expect(createGarminRouteSendContext('user-1')).rejects.toMatchObject({
      code: 'unauthenticated',
      message: 'No connected Garmin account found.',
    });
  });

  it('rejects context creation when Course Import permission is missing', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1', ['ACTIVITY_EXPORT']),
    ]);

    await expect(createGarminRouteSendContext('user-1')).rejects.toBeInstanceOf(GarminRouteSendPermissionRequiredError);
  });

  it('creates a Garmin course on first send', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1'),
    ]);
    requestHelperMocks.post.mockResolvedValueOnce({ courseId: 9001 });

    const context = await createGarminRouteSendContext('user-1');
    const result = await sendRouteToGarminConnect(
      'user-1',
      'route-1',
      { id: 'route-1', name: 'QS Route Name', activityTypes: ['Cycling'] } as any,
      createRouteFile(),
      context,
    );

    expect(requestHelperMocks.post).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://apis.garmin.com/training-api/courses/v1/course',
      body: expect.objectContaining({
        courseName: 'QS Route Name',
        distance: 12345.6,
        elevationGain: 456.7,
        elevationLoss: 321.4,
        activityType: 'ROAD_CYCLING',
        coordinateSystem: 'WGS84',
        geoPoints: [
          expect.objectContaining({
            latitude: 37.1,
            longitude: 23.7,
            elevation: 120,
            information: expect.objectContaining({
              name: 'Start',
              coursePointType: 'INFO',
            }),
          }),
          expect.objectContaining({
            latitude: 37.2,
            longitude: 23.8,
            elevation: 135,
          }),
        ],
      }),
    }));
    expect(result).toEqual({
      providerRouteId: '9001',
      deliveries: [{ providerUserId: 'garmin-user-1', providerRouteId: '9001' }],
    });
  });

  it('updates an existing Garmin course when delivery metadata already has a provider route id', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1'),
    ]);
    routeDeliveryMetadataByKey.set(`user-1:route-1:${ServiceNames.GarminAPI}:garmin-user-1`, {
      providerRouteId: 'course-42',
    });
    requestHelperMocks.put.mockResolvedValueOnce('');

    const context = await createGarminRouteSendContext('user-1');
    const result = await sendRouteToGarminConnect(
      'user-1',
      'route-1',
      { id: 'route-1', name: 'QS Route Name', activityTypes: ['Cycling'] } as any,
      createRouteFile(),
      context,
    );

    expect(requestHelperMocks.put).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://apis.garmin.com/training-api/courses/v1/course/course-42',
    }));
    expect(requestHelperMocks.post).not.toHaveBeenCalled();
    expect(result.providerRouteId).toBe('course-42');
  });

  it('keeps resends pinned to the Garmin account that already owns the delivered course', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-older', 'garmin-user-1', ['COURSE_IMPORT'], 1000),
      createTokenSnapshot('token-newer', 'garmin-user-2', ['COURSE_IMPORT'], 2000),
    ]);
    routeDeliveryMetadataByKey.set(`user-1:route-1:${ServiceNames.GarminAPI}:garmin-user-1`, {
      providerRouteId: 'course-42',
      updatedAt: 3000,
    });
    requestHelperMocks.put.mockResolvedValueOnce('');

    const context = await createGarminRouteSendContext('user-1');
    const result = await sendRouteToGarminConnect(
      'user-1',
      'route-1',
      {
        id: 'route-1',
        name: 'QS Route Name',
        activityTypes: ['Cycling'],
        syncedDestinationServiceNames: [ServiceNames.GarminAPI],
      } as any,
      createRouteFile(),
      context,
    );

    expect(requestHelperMocks.put).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://apis.garmin.com/training-api/courses/v1/course/course-42',
      headers: expect.objectContaining({
        Authorization: 'Bearer garmin-access-token',
      }),
    }));
    expect(requestHelperMocks.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      providerRouteId: 'course-42',
      deliveries: [{ providerUserId: 'garmin-user-1', providerRouteId: 'course-42' }],
    });
  });

  it('does not fall back to a different Garmin account when the existing delivery account lost Course Import permission', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-older', 'garmin-user-1', ['ACTIVITY_EXPORT'], 1000),
      createTokenSnapshot('token-newer', 'garmin-user-2', ['COURSE_IMPORT'], 2000),
    ]);
    routeDeliveryMetadataByKey.set(`user-1:route-1:${ServiceNames.GarminAPI}:garmin-user-1`, {
      providerRouteId: 'course-42',
      updatedAt: 3000,
    });

    const context = await createGarminRouteSendContext('user-1');

    await expect(sendRouteToGarminConnect(
      'user-1',
      'route-1',
      {
        id: 'route-1',
        name: 'QS Route Name',
        activityTypes: ['Cycling'],
        syncedDestinationServiceNames: [ServiceNames.GarminAPI],
      } as any,
      createRouteFile(),
      context,
    )).rejects.toBeInstanceOf(GarminRouteSendPermissionRequiredError);

    expect(requestHelperMocks.put).not.toHaveBeenCalled();
    expect(requestHelperMocks.post).not.toHaveBeenCalled();
  });

  it('does not fall back to a different Garmin account when the original delivery account is no longer connected', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-newer', 'garmin-user-2', ['COURSE_IMPORT'], 2000),
    ]);

    const context = await createGarminRouteSendContext('user-1');

    await expect(sendRouteToGarminConnect(
      'user-1',
      'route-1',
      {
        id: 'route-1',
        name: 'QS Route Name',
        activityTypes: ['Cycling'],
        syncedDestinationServiceNames: [ServiceNames.GarminAPI],
      } as any,
      createRouteFile(),
      context,
    )).rejects.toMatchObject({
      code: 'unauthenticated',
    });

    expect(requestHelperMocks.put).not.toHaveBeenCalled();
    expect(requestHelperMocks.post).not.toHaveBeenCalled();
  });

  it('falls back to create when the stored Garmin course id no longer exists remotely', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1'),
    ]);
    routeDeliveryMetadataByKey.set(`user-1:route-1:${ServiceNames.GarminAPI}:garmin-user-1`, {
      providerRouteId: 'course-42',
    });
    requestHelperMocks.put.mockRejectedValueOnce({ statusCode: 404 });
    requestHelperMocks.post.mockResolvedValueOnce({ courseId: 'course-84' });

    const context = await createGarminRouteSendContext('user-1');
    const result = await sendRouteToGarminConnect(
      'user-1',
      'route-1',
      { id: 'route-1', name: 'QS Route Name', activityTypes: ['Cycling'] } as any,
      createRouteFile(),
      context,
    );

    expect(requestHelperMocks.put).toHaveBeenCalledTimes(1);
    expect(requestHelperMocks.post).toHaveBeenCalledTimes(1);
    expect(result.providerRouteId).toBe('course-84');
  });

  it('maps Garmin 412 permission failures to a stable route-send permission error', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1'),
    ]);
    requestHelperMocks.post.mockRejectedValueOnce({ statusCode: 412 });

    const context = await createGarminRouteSendContext('user-1');

    await expect(sendRouteToGarminConnect(
      'user-1',
      'route-1',
      { id: 'route-1', name: 'QS Route Name', activityTypes: ['Cycling'] } as any,
      createRouteFile(),
      context,
    )).rejects.toBeInstanceOf(GarminRouteSendPermissionRequiredError);
  });

  it('maps hiking trail route types to HIKING before generic trail matching', async () => {
    garminTokenDocsByUser.set('garminAPITokens:user-1', [
      createTokenSnapshot('token-1', 'garmin-user-1'),
    ]);
    requestHelperMocks.post.mockResolvedValueOnce({ courseId: 9001 });

    const context = await createGarminRouteSendContext('user-1');
    await sendRouteToGarminConnect(
      'user-1',
      'route-1',
      { id: 'route-1', name: 'QS Route Name', activityTypes: ['hiking_trail'] } as any,
      createRouteFile('hiking_trail'),
      context,
    );

    expect(requestHelperMocks.post).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        activityType: 'HIKING',
      }),
    }));
  });
});
