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
  getMissingGarminPermissionsForTokenLike,
  selectPreferredGarminTokenLike,
} from '../../../shared/garmin-service-token';
import { getRouteDeliveryMetadataRef } from '../routes/route-persistence';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';
import { GarminAPIAuth2ServiceTokenInterface } from './auth/adapter';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';

const GARMIN_COURSES_API_BASE_URL = 'https://apis.garmin.com/training-api/courses/v1/course';

export interface GarminRouteSendContext {
  tokenSnapshots: admin.firestore.QueryDocumentSnapshot[];
  preferredProviderUserId: string;
}

interface GarminRouteSendTokenSnapshot {
  snapshot: admin.firestore.QueryDocumentSnapshot;
  tokenRef: admin.firestore.DocumentReference;
  tokenID: string;
  providerUserId: string;
  missingPermissions: string[];
}

interface GarminRouteDeliveryTarget {
  providerUserId: string;
  providerRouteId: string;
  updatedAtMs: number;
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

function toTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  }

  if (typeof (value as { toDate?: unknown } | null)?.toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }

  if (
    typeof (value as { seconds?: unknown } | null)?.seconds === 'number'
    && typeof (value as { nanoseconds?: unknown } | null)?.nanoseconds === 'number'
  ) {
    const timestamp = value as { seconds: number; nanoseconds: number };
    return (timestamp.seconds * 1000) + Math.round(timestamp.nanoseconds / 1000000);
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }

  return 0;
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
    if (candidate.includes('hiking') || candidate.includes('trekking') || candidate.includes('walking')) {
      return 'HIKING';
    }
    if (candidate.includes('trail running') || candidate.includes('trail_running') || candidate.includes('trail')) {
      return 'TRAIL_RUNNING';
    }
    if (candidate.includes('running')) {
      return 'RUNNING';
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
  tokenSnapshotRef: GarminRouteSendTokenSnapshot,
): Promise<admin.firestore.DocumentSnapshot> {
  const snapshot = await tokenSnapshotRef.tokenRef.get();
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
  tokenSnapshotRef: GarminRouteSendTokenSnapshot,
  requestFactory: (accessToken: string) => Promise<T>,
): Promise<T> {
  const latestTokenSnapshot = await getLatestGarminTokenSnapshot(tokenSnapshotRef);

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
  tokenSnapshotRef: GarminRouteSendTokenSnapshot,
  payload: GarminCoursePayload,
): Promise<string> {
  try {
    const response = await executeGarminCourseRequest(tokenSnapshotRef, async (accessToken) => requestPromise.post({
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
  tokenSnapshotRef: GarminRouteSendTokenSnapshot,
  courseId: string,
  payload: GarminCoursePayload,
): Promise<'updated' | 'missing'> {
  try {
    await executeGarminCourseRequest(tokenSnapshotRef, async (accessToken) => requestPromise.put({
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

function getGarminRouteSendTokenSnapshot(
  context: GarminRouteSendContext,
  providerUserId: string,
): GarminRouteSendTokenSnapshot | null {
  const tokenCandidates = context.tokenSnapshots
    .map(snapshot => ({
      snapshot,
      ...snapshot.data(),
    }))
    .filter(tokenCandidate => normalizeNonEmptyString(tokenCandidate.userID) === providerUserId);
  const tokenCandidate = selectPreferredGarminTokenLike(
    tokenCandidates,
    GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS,
  ) as ({ snapshot?: admin.firestore.QueryDocumentSnapshot } & Record<string, unknown>) | null;
  const snapshot = tokenCandidate?.snapshot;
  if (!snapshot) {
    return null;
  }

  return {
    snapshot,
    tokenRef: snapshot.ref,
    tokenID: snapshot.id,
    providerUserId,
    missingPermissions: getMissingGarminPermissionsForTokenLike(
      tokenCandidate,
      GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS,
    ),
  };
}

function getPreferredGarminRouteSendTokenSnapshot(
  context: GarminRouteSendContext,
): GarminRouteSendTokenSnapshot | null {
  return getGarminRouteSendTokenSnapshot(context, context.preferredProviderUserId);
}

function hasRouteBeenSentToGarmin(routeDocument: FirestoreRouteJSON): boolean {
  return Array.isArray(routeDocument.syncedDestinationServiceNames)
    && routeDocument.syncedDestinationServiceNames.includes(ServiceNames.GarminAPI);
}

async function getExistingGarminDeliveryTarget(
  userID: string,
  routeID: string,
  context: GarminRouteSendContext,
): Promise<GarminRouteDeliveryTarget | null> {
  const deliveries = await Promise.all(
    Array.from(new Set(context.tokenSnapshots
      .map(snapshot => normalizeNonEmptyString(snapshot.data()?.userID))
      .filter((providerUserId): providerUserId is string => providerUserId !== null)))
      .map(async (providerUserId) => {
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

        const data = deliverySnapshot.data() as {
          providerRouteId?: unknown;
          updatedAt?: unknown;
          deliveredAt?: unknown;
          lastAttemptAt?: unknown;
        } | null;
        const providerRouteId = normalizeNonEmptyString(data?.providerRouteId);
        if (!providerRouteId) {
          return null;
        }

        return {
          providerUserId,
          providerRouteId,
          updatedAtMs: toTimestampMs(data?.updatedAt)
            || toTimestampMs(data?.deliveredAt)
            || toTimestampMs(data?.lastAttemptAt),
        } satisfies GarminRouteDeliveryTarget;
      }),
  );

  const matchingDeliveries = deliveries
    .filter((delivery): delivery is GarminRouteDeliveryTarget => delivery !== null)
    .sort((left, right) => (
      right.updatedAtMs - left.updatedAtMs
      || Number(right.providerUserId === context.preferredProviderUserId) - Number(left.providerUserId === context.preferredProviderUserId)
      || left.providerUserId.localeCompare(right.providerUserId)
    ));

  return matchingDeliveries[0] || null;
}

async function resolveGarminRouteDeliveryTarget(
  userID: string,
  routeID: string,
  routeDocument: FirestoreRouteJSON,
  context: GarminRouteSendContext,
): Promise<{
  tokenSnapshotRef: GarminRouteSendTokenSnapshot;
  existingCourseId: string | null;
}> {
  const existingDelivery = await getExistingGarminDeliveryTarget(userID, routeID, context);
  if (existingDelivery) {
    const tokenSnapshotRef = getGarminRouteSendTokenSnapshot(context, existingDelivery.providerUserId);
    if (!tokenSnapshotRef) {
      throw buildGarminAuthRequiredError('Reconnect the Garmin account previously used for this route before sending it again.');
    }
    if (tokenSnapshotRef.missingPermissions.length > 0) {
      throw new GarminRouteSendPermissionRequiredError(
        'Grant Garmin Course Import permission for the Garmin account previously used for this route, then reconnect before sending routes.',
      );
    }

    return {
      tokenSnapshotRef,
      existingCourseId: existingDelivery.providerRouteId,
    };
  }

  if (hasRouteBeenSentToGarmin(routeDocument)) {
    throw buildGarminAuthRequiredError('Reconnect the Garmin account previously used for this route before sending it again.');
  }

  const preferredTokenSnapshotRef = getPreferredGarminRouteSendTokenSnapshot(context);
  if (!preferredTokenSnapshotRef) {
    throw buildGarminAuthRequiredError('No connected Garmin account found.');
  }
  if (preferredTokenSnapshotRef.missingPermissions.length > 0) {
    throw new GarminRouteSendPermissionRequiredError('Grant Garmin Course Import permission and reconnect before sending routes.');
  }

  return {
    tokenSnapshotRef: preferredTokenSnapshotRef,
    existingCourseId: null,
  };
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
  const preferredProviderUserId = normalizeNonEmptyString((preferredTokenCandidate as { userID?: unknown } | null)?.userID);
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
    tokenSnapshots: tokenQuerySnapshot.docs,
    preferredProviderUserId,
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
  const {
    tokenSnapshotRef,
    existingCourseId,
  } = await resolveGarminRouteDeliveryTarget(userID, routeID, routeDocument, context);

  let providerRouteId = existingCourseId;
  if (existingCourseId) {
    const updateResult = await updateGarminCourse(tokenSnapshotRef, existingCourseId, payload);
    if (updateResult === 'missing') {
      providerRouteId = await createGarminCourse(tokenSnapshotRef, payload);
    }
  } else {
    providerRouteId = await createGarminCourse(tokenSnapshotRef, payload);
  }

  return {
    providerRouteId,
    deliveries: [{
      providerUserId: tokenSnapshotRef.providerUserId,
      providerRouteId,
    }],
  };
}
