'use strict';

import * as functions from 'firebase-functions/v1';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { verifySuuntoWebhookSignature } from './webhook-signature';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';
import { enqueueRouteSyncQueueItem } from '../routes/route-sync-queue';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { SuuntoRouteImportStateEntry } from '../../../shared/suunto-route-import-state';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
  createSuuntoRouteUploadContext,
  listSuuntoRoutes,
} from './routes';

type ExternalRecord = Record<string, unknown>;

interface SuuntoRouteCatchUpResponse {
  queuedCount: number;
  skippedCount: number;
  failureCount: number;
  failedProviderCount: number;
  totalCount: number;
}

interface SuuntoRouteImportProviderState extends Omit<SuuntoRouteImportStateEntry, 'didLastRouteImport' | 'updatedAt'> {
  queuedCount: number;
  skippedCount: number;
  failureCount: number;
  totalCount: number;
}

function asRecord(value: unknown): ExternalRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ExternalRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRequestHeader(req: functions.https.Request, headerName: string): string | null {
  const headerValue = typeof req.get === 'function' ? req.get(headerName) : req.headers[headerName.toLowerCase()];
  if (Array.isArray(headerValue)) {
    return asString(headerValue[0]);
  }
  return asString(headerValue);
}

function getJsonRouteNotification(body: unknown): {
  userName: string | null;
  routeId: string | null;
  routeName: string | null;
  routeCreatedAt: number | null;
  routeModifiedAt: number | null;
} {
  const payload = asRecord(body);
  const route = asRecord(payload.route);
  return {
    userName: asString(payload.username),
    routeId: asString(route.id),
    routeName: asString(route.description),
    routeCreatedAt: asNumber(route.created),
    routeModifiedAt: asNumber(route.modified),
  };
}

async function updateSuuntoRouteImportMeta(
  userID: string,
  summary: SuuntoRouteCatchUpResponse,
  providerStatesBySourceKey: Record<string, SuuntoRouteImportProviderState>,
): Promise<void> {
  const completedAt = Date.now();
  const routeImportStatesByProviderSourceKey = Object.values(providerStatesBySourceKey)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
    .map((providerState) => ({
      sourceKey: providerState.sourceKey,
      providerUserId: providerState.providerUserId,
      queuedCount: providerState.queuedCount,
      skippedCount: providerState.skippedCount,
      failureCount: providerState.failureCount,
      totalCount: providerState.totalCount,
      updatedAt: completedAt,
      ...(providerState.failureCount === 0
        ? { didLastRouteImport: completedAt }
        : {}),
    }));
  const completedProviderCount = routeImportStatesByProviderSourceKey
    .filter(providerState => providerState.failureCount === 0)
    .length;

  await admin.firestore().collection('users').doc(userID).collection('meta').doc(ServiceNames.SuuntoApp).set({
    queuedRoutesFromLastRouteImportCount: summary.queuedCount,
    skippedRoutesFromLastRouteImportCount: summary.skippedCount,
    failedRoutesFromLastRouteImportCount: summary.failureCount,
    failedRouteImportProviderCount: summary.failedProviderCount,
    totalRoutesFromLastRouteImportCount: summary.totalCount,
    routeImportStatesByProviderSourceKey,
    routeImportStatesByProviderUserId: admin.firestore.FieldValue.delete(),
    ...(summary.failedProviderCount === 0
      && completedProviderCount === routeImportStatesByProviderSourceKey.length
      && completedProviderCount > 0
      ? { didLastRouteImport: completedAt }
      : { didLastRouteImport: admin.firestore.FieldValue.delete() }),
  }, { merge: true });
}

export const insertSuuntoAppRouteToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  const signature = getRequestHeader(req, 'X-HMAC-SHA256-Signature');
  if (!verifySuuntoWebhookSignature(req.rawBody, signature)) {
    logger.warn('Invalid Suunto route webhook signature');
    res.status(403).send();
    return;
  }

  const { userName, routeId, routeName, routeCreatedAt, routeModifiedAt } = getJsonRouteNotification(req.body);
  if (!userName || !routeId) {
    logger.warn('Suunto route webhook missing username or route.id');
    res.status(400).send();
    return;
  }

  try {
    await enqueueRouteSyncQueueItem({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: userName,
      providerRouteId: routeId,
      providerRouteName: routeName,
      providerRouteCreatedAt: routeCreatedAt,
      providerRouteModifiedAt: routeModifiedAt,
      manual: false,
    });
    logger.info('Suunto route webhook routed', {
      notificationType: 'ROUTE_UPDATED',
      userName,
      routeId,
    });
    res.status(200).send();
  } catch (error) {
    if (isProviderQueueSkippedWithoutRetryError(error)) {
      logger.warn('Skipping Suunto route webhook because no local token/user is connected or the user is being deleted.', {
        provider: 'Suunto',
        reason: (error as { code?: string }).code,
        routeId,
      });
      res.status(200).send();
      return;
    }
    logger.error(error);
    res.status(500).send();
  }
});

export const addSuuntoAppRoutesToQueue = onCall({
  region: FUNCTIONS_MANIFEST.addSuuntoAppRoutesToQueue.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '512MiB',
  maxInstances: 10,
}, async (request): Promise<SuuntoRouteCatchUpResponse> => {
  enforceAppCheck(request);

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking route catch-up for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const context = await createSuuntoRouteUploadContext(userID);
  const routeListResult = await listSuuntoRoutes(userID, context);
  const summary: SuuntoRouteCatchUpResponse = {
    queuedCount: 0,
    skippedCount: 0,
    failureCount: 0,
    failedProviderCount: routeListResult.failedProviderSourceKeys.length,
    totalCount: routeListResult.routes.length,
  };
  const providerStatesBySourceKey = routeListResult.successfulProviderSourceKeys.reduce<Record<string, SuuntoRouteImportProviderState>>((result, sourceKey) => {
    const tokenRef = context.tokenRefs.find(item => item.sourceKey === sourceKey);
    if (!tokenRef) {
      return result;
    }

    result[sourceKey] = {
      sourceKey,
      providerUserId: tokenRef.providerUserId,
      queuedCount: 0,
      skippedCount: 0,
      failureCount: 0,
      totalCount: 0,
    };
    return result;
  }, {});

  for (const route of routeListResult.routes) {
    const providerSourceKey = route.providerSourceKey
      || context.tokenRefs.find(tokenRef => tokenRef.providerUserId === route.providerUserId)?.sourceKey
      || `${route.providerUserId}:unknown-created`;

    if (!providerStatesBySourceKey[providerSourceKey]) {
      providerStatesBySourceKey[providerSourceKey] = {
        sourceKey: providerSourceKey,
        providerUserId: route.providerUserId,
        queuedCount: 0,
        skippedCount: 0,
        failureCount: 0,
        totalCount: 0,
      };
    }
    providerStatesBySourceKey[providerSourceKey].totalCount++;

    try {
      const result = await enqueueRouteSyncQueueItem({
        sourceServiceName: ServiceNames.SuuntoApp,
        providerUserId: route.providerUserId,
        providerRouteId: route.id,
        providerRouteName: route.description || null,
        providerRouteCreatedAt: route.created ?? null,
        providerRouteModifiedAt: route.modified ?? null,
        manual: true,
        firebaseUserID: userID,
      });
      if (result.enqueued) {
        summary.queuedCount++;
        providerStatesBySourceKey[providerSourceKey].queuedCount++;
      } else {
        summary.skippedCount++;
        providerStatesBySourceKey[providerSourceKey].skippedCount++;
      }
    } catch (error) {
      if (isProviderQueueSkippedWithoutRetryError(error)) {
        summary.skippedCount++;
        providerStatesBySourceKey[providerSourceKey].skippedCount++;
        continue;
      }
      logger.error('[SuuntoRouteSync] Failed to queue route during manual catch-up', {
        userID,
        providerUserId: route.providerUserId,
        routeId: route.id,
        error,
      });
      summary.failureCount++;
      providerStatesBySourceKey[providerSourceKey].failureCount++;
    }
  }

  await updateSuuntoRouteImportMeta(userID, summary, providerStatesBySourceKey);
  return summary;
});
