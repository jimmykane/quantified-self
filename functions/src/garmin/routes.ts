'use strict';

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  DataAscent,
  DataDescent,
  DataDistance,
  RouteFileInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';

import * as requestPromise from '../request-helper';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';
import {
  GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS,
  getGarminProviderUserIdFromTokenLike,
  getMissingGarminPermissionsForTokenLike,
  selectPreferredGarminTokenLike,
} from '../../../shared/garmin-service-token';
import { getRouteDeliveryMetadataRef } from '../routes/route-persistence';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';
import { GarminAPIAuth2ServiceTokenInterface } from './auth/adapter';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';

const GARMIN_COURSES_API_BASE_URL = 'https://apis.garmin.com/training-api/courses/v1/course';

export interface GarminRouteSendContext {
  tokenRef: admin.firestore.DocumentReference;
  tokenID: string;
  providerUserId: string;
}

interface GarminCourseGeoPointInformation {
  name?: string;
  coursePointType?: string;
}

interface GarminCourseGeoPoint {
  latitude: number;
  longitude: number;
  elevation: number;
  information?: GarminCourseGeoPointInformation;
}

interface GarminCoursePayload {
  courseName: string;
  distance: number;
  elevationGain: number;
  elevationLoss: number;
  geoPoints: GarminCourseGeoPoint[];
  activityType: string;
  coordinateSystem: 'WGS84';
  description?: string;
}

interface GarminCreateCourseResponse {
  courseId?: number | string | null;
}

export class GarminRouteSendPermissionRequiredError extends Error {
  readonly name = 'GarminRouteSendPermissionRequiredError';
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getGarminStatusCode(error: unknown): number | null {
  const directStatusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof directStatusCode === 'number') {
    return directStatusCode;
  }

  const responseStatusCode = (error as { response?: { statusCode?: unknown } } | null)?.response?.statusCode;
  return typeof responseStatusCode === 'number' ? responseStatusCode : null;
}

function buildGarminAuthRequiredError(message = 'Reconnect Garmin before sending routes.'): HttpsError {
  return new HttpsError('unauthenticated', message);
}

function getGarminCourseId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const courseId = (value as GarminCreateCourseResponse).courseId;
  if (typeof courseId === 'number' && Number.isFinite(courseId)) {
    return `${courseId}`;
  }

  return normalizeNonEmptyString(courseId);
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRouteStatsValue(routeFile: RouteFileInterface, statType: string): number | null {
  const stat = routeFile.getStats().get(statType);
  const value = typeof stat?.getValue === 'function' ? stat.getValue() : null;
  return normalizeFiniteNumber(value);
}

function getRoutePointName(point: { name?: unknown; type?: unknown; symbol?: unknown }): string | null {
  return normalizeNonEmptyString(point.name)
    || normalizeNonEmptyString(point.type)
    || normalizeNonEmptyString(point.symbol);
}

function buildGarminCourseGeoPoints(routeFile: RouteFileInterface): GarminCourseGeoPoint[] {
  const geoPoints: GarminCourseGeoPoint[] = [];

  routeFile.getRoutes().forEach((route) => {
    route.getPointData().forEach((point) => {
      if (!Number.isFinite(point.latitudeDegrees) || !Number.isFinite(point.longitudeDegrees)) {
        return;
      }

      const informationName = getRoutePointName(point);
      geoPoints.push({
        latitude: point.latitudeDegrees,
        longitude: point.longitudeDegrees,
        elevation: Number.isFinite(point.altitude as number) ? Number(point.altitude) : 0,
        ...(informationName ? {
          information: {
            name: informationName,
            coursePointType: 'INFO',
          },
        } : {}),
      });
    });
  });

  return geoPoints;
}

function resolveGarminCourseActivityType(routeFile: RouteFileInterface, routeDocument: FirestoreRouteJSON): string {
  const normalizedCandidates = [
    ...routeFile.getRoutes().map(route => route.activityType),
    ...(Array.isArray(routeDocument.activityTypes) ? routeDocument.activityTypes : []),
  ].map(candidate => `${candidate || ''}`.trim().toLowerCase()).filter(Boolean);

  for (const candidate of normalizedCandidates) {
    if (candidate.includes('gravel')) {
      return 'GRAVEL_CYCLING';
    }
    if (candidate.includes('mountain') || candidate.includes('mtb') || candidate.includes('downhill') || candidate.includes('enduro')) {
      return 'MOUNTAIN_BIKING';
    }
    if (candidate.includes('trail running') || candidate.includes('trail_running') || candidate.includes('trail')) {
      return 'TRAIL_RUNNING';
    }
    if (candidate.includes('running')) {
      return 'RUNNING';
    }
    if (candidate.includes('hiking') || candidate.includes('trekking') || candidate.includes('walking')) {
      return 'HIKING';
    }
    if (candidate.includes('cycling') || candidate.includes('biking') || candidate.includes('road')) {
      return 'ROAD_CYCLING';
    }
  }

  return 'OTHER';
}

function buildGarminCoursePayload(routeFile: RouteFileInterface, routeDocument: FirestoreRouteJSON): GarminCoursePayload {
  const routeName = normalizeNonEmptyString(routeFile.name)
    || normalizeNonEmptyString(routeDocument.name)
    || 'Saved route';
  const distance = getRouteStatsValue(routeFile, DataDistance.type);
  if (distance === null || distance <= 0) {
    throw new Error('Saved route is missing distance data required by Garmin Connect.');
  }

  const geoPoints = buildGarminCourseGeoPoints(routeFile);
  if (geoPoints.length === 0) {
    throw new Error('Saved route is missing geometry data required by Garmin Connect.');
  }

  return {
    courseName: routeName,
    distance,
    elevationGain: getRouteStatsValue(routeFile, DataAscent.type) ?? 0,
    elevationLoss: getRouteStatsValue(routeFile, DataDescent.type) ?? 0,
    geoPoints,
    activityType: resolveGarminCourseActivityType(routeFile, routeDocument),
    coordinateSystem: 'WGS84',
  };
}

async function getLatestGarminTokenSnapshot(
  context: GarminRouteSendContext,
): Promise<admin.firestore.DocumentSnapshot> {
  const snapshot = await context.tokenRef.get();
  if (!snapshot.exists) {
    throw buildGarminAuthRequiredError();
  }

  return snapshot;
}

async function getGarminAccessToken(
  tokenSnapshot: admin.firestore.DocumentSnapshot,
  forceRefresh: boolean,
): Promise<string> {
  try {
    const token = await getTokenData(
      tokenSnapshot,
      ServiceNames.GarminAPI,
      forceRefresh,
    ) as GarminAPIAuth2ServiceTokenInterface;
    return token.accessToken;
  } catch (error) {
    if (error instanceof TokenRefreshSkippedForDeletedUserError) {
      throw error;
    }

    if (error instanceof TerminalServiceAuthError) {
      throw buildGarminAuthRequiredError();
    }

    throw error;
  }
}

async function executeGarminCourseRequest<T>(
  context: GarminRouteSendContext,
  requestFactory: (accessToken: string) => Promise<T>,
): Promise<T> {
  const latestTokenSnapshot = await getLatestGarminTokenSnapshot(context);

  try {
    const accessToken = await getGarminAccessToken(latestTokenSnapshot, false);
    return await requestFactory(accessToken);
  } catch (error) {
    if (error instanceof TokenRefreshSkippedForDeletedUserError) {
      throw error;
    }

    if (error instanceof HttpsError && error.code === 'unauthenticated') {
      throw error;
    }

    if (getGarminStatusCode(error) === 401) {
      const accessToken = await getGarminAccessToken(latestTokenSnapshot, true);
      return requestFactory(accessToken);
    }

    throw error;
  }
}

async function createGarminCourse(
  context: GarminRouteSendContext,
  payload: GarminCoursePayload,
): Promise<string> {
  try {
    const response = await executeGarminCourseRequest(context, async (accessToken) => requestPromise.post({
      url: GARMIN_COURSES_API_BASE_URL,
      json: true,
      body: payload,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
    const courseId = getGarminCourseId(response);
    if (!courseId) {
      throw new Error('Garmin course create response did not include a course id.');
    }
    return courseId;
  } catch (error) {
    const statusCode = getGarminStatusCode(error);
    if (statusCode === 401) {
      throw buildGarminAuthRequiredError();
    }
    if (statusCode === 412) {
      throw new GarminRouteSendPermissionRequiredError('Grant Garmin Course Import permission and reconnect before sending routes.');
    }
    if (statusCode === 429) {
      throw new Error('Garmin Connect rate limit reached. Please retry later.');
    }
    throw error;
  }
}

async function updateGarminCourse(
  context: GarminRouteSendContext,
  courseId: string,
  payload: GarminCoursePayload,
): Promise<'updated' | 'missing'> {
  try {
    await executeGarminCourseRequest(context, async (accessToken) => requestPromise.put({
      url: `${GARMIN_COURSES_API_BASE_URL}/${encodeURIComponent(courseId)}`,
      body: payload,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
    return 'updated';
  } catch (error) {
    const statusCode = getGarminStatusCode(error);
    if (statusCode === 404) {
      return 'missing';
    }
    if (statusCode === 401) {
      throw buildGarminAuthRequiredError();
    }
    if (statusCode === 412) {
      throw new GarminRouteSendPermissionRequiredError('Grant Garmin Course Import permission and reconnect before sending routes.');
    }
    if (statusCode === 429) {
      throw new Error('Garmin Connect rate limit reached. Please retry later.');
    }
    throw error;
  }
}

async function getExistingGarminCourseId(
  userID: string,
  routeID: string,
  providerUserId: string,
): Promise<string | null> {
  const deliverySnapshot = await getRouteDeliveryMetadataRef(
    admin.firestore(),
    userID,
    routeID,
    ServiceNames.GarminAPI,
    providerUserId,
  ).get();

  if (!deliverySnapshot.exists) {
    return null;
  }

  return normalizeNonEmptyString((deliverySnapshot.data() as { providerRouteId?: unknown } | null)?.providerRouteId);
}

export async function createGarminRouteSendContext(userID: string): Promise<GarminRouteSendContext> {
  const tokenQuerySnapshot = await admin.firestore()
    .collection(GARMIN_API_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens')
    .get();

  if (tokenQuerySnapshot.empty) {
    throw buildGarminAuthRequiredError('No connected Garmin account found.');
  }

  const preferredTokenCandidate = selectPreferredGarminTokenLike(
    tokenQuerySnapshot.docs.map(tokenSnapshot => ({
      snapshot: tokenSnapshot,
      ...tokenSnapshot.data(),
    })),
    GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS,
  );
  const preferredProviderUserId = getGarminProviderUserIdFromTokenLike(preferredTokenCandidate);
  if (!preferredTokenCandidate || !preferredProviderUserId) {
    throw buildGarminAuthRequiredError('No connected Garmin account found.');
  }

  const missingPermissions = getMissingGarminPermissionsForTokenLike(
    preferredTokenCandidate,
    GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS,
  );
  if (missingPermissions.length > 0) {
    throw new GarminRouteSendPermissionRequiredError('Grant Garmin Course Import permission and reconnect before sending routes.');
  }

  const preferredTokenSnapshot = (preferredTokenCandidate as { snapshot?: admin.firestore.QueryDocumentSnapshot }).snapshot;
  if (!preferredTokenSnapshot) {
    logger.error('[GarminRoutes] Preferred Garmin route-send token could not be resolved back to a Firestore document.', {
      userID,
      providerUserId: preferredProviderUserId,
    });
    throw buildGarminAuthRequiredError('No connected Garmin account found.');
  }

  return {
    tokenRef: preferredTokenSnapshot.ref,
    tokenID: preferredTokenSnapshot.id,
    providerUserId: preferredProviderUserId,
  };
}

export async function sendRouteToGarminConnect(
  userID: string,
  routeID: string,
  routeDocument: FirestoreRouteJSON,
  routeFile: RouteFileInterface,
  context: GarminRouteSendContext,
): Promise<{
  providerRouteId: string;
  deliveries: Array<{ providerUserId: string; providerRouteId: string }>;
}> {
  const payload = buildGarminCoursePayload(routeFile, routeDocument);
  const existingCourseId = await getExistingGarminCourseId(userID, routeID, context.providerUserId);

  let providerRouteId = existingCourseId;
  if (existingCourseId) {
    const updateResult = await updateGarminCourse(context, existingCourseId, payload);
    if (updateResult === 'missing') {
      providerRouteId = await createGarminCourse(context, payload);
    }
  } else {
    providerRouteId = await createGarminCourse(context, payload);
  }

  return {
    providerRouteId,
    deliveries: [{
      providerUserId: context.providerUserId,
      providerRouteId,
    }],
  };
}
