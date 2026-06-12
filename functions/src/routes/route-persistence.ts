import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import {
  FirestoreRouteJSON,
  OriginalRouteFileMetaData,
} from '../../../shared/app-route.interface';
import {
  getRouteDeliveryMetadataDocId,
  ROUTE_SOURCE_METADATA_DOC_ID,
  ROUTE_SOURCE_TYPES,
  RouteDeliveryMetadata,
  RouteSourceMetadata,
  RouteSourceSummary,
} from '../../../shared/route-provenance';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

export const ROUTE_SERVER_OWNED_FIELDS = [
  'id',
  'userID',
  'originalFile',
  'originalFiles',
  'srcFileType',
  'sourceFileType',
  'creator',
  'createdAt',
  'importedAt',
  'updatedAt',
  'stats',
  'routes',
  'routeCount',
  'waypointCount',
  'pointCount',
  'activityTypes',
  'streamTypes',
  'bounds',
  'sourceSummary',
  'syncedDestinationServiceNames',
] as const;

interface BuildRouteDocumentForWriteParams {
  routeId: string;
  userID: string;
  parsedPayload: FirestoreRouteJSON;
  existingRouteDocument?: FirestoreRouteJSON | null;
  originalFiles?: OriginalRouteFileMetaData[];
  sourceMetadata?: RouteSourceMetadata | null;
  syncedDestinationServiceNames?: string[];
  preserveImportedAt?: boolean;
}

interface SetRouteDeliveryMetadataParams {
  userID: string;
  routeID: string;
  deliveryMetadata: RouteDeliveryMetadata;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeRouteSourceSummary(value: unknown): RouteSourceSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const sourceSummary = value as RouteSourceSummary;
  if (!normalizeNonEmptyString(sourceSummary.sourceType)) {
    return null;
  }

  return sourceSummary;
}

export function toRouteSourceMetadata(summary: RouteSourceSummary | null | undefined): RouteSourceMetadata | null {
  if (!summary) {
    return null;
  }

  return {
    sourceType: summary.sourceType,
    sourceServiceName: summary.sourceServiceName || null,
    providerUserId: summary.providerUserId || null,
    providerRouteId: summary.providerRouteId || null,
    providerRouteName: summary.providerRouteName || null,
    originalFilename: summary.originalFilename || null,
    importedAt: summary.importedAt || null,
    modifiedAt: summary.modifiedAt || null,
    updatedAt: new Date(),
  };
}

function getExistingOriginalFiles(routeDocument?: FirestoreRouteJSON | null): OriginalRouteFileMetaData[] {
  if (Array.isArray(routeDocument?.originalFiles) && routeDocument.originalFiles.length > 0) {
    return routeDocument.originalFiles.filter(file => normalizeNonEmptyString(file?.path) !== null);
  }

  return routeDocument?.originalFile && normalizeNonEmptyString(routeDocument.originalFile.path) !== null
    ? [routeDocument.originalFile]
    : [];
}

function resolveCurrentProviderRouteName(routeDocument?: FirestoreRouteJSON | null): string | null {
  return normalizeNonEmptyString(normalizeRouteSourceSummary(routeDocument?.sourceSummary)?.providerRouteName);
}

function resolveNextProviderRouteName(sourceMetadata?: RouteSourceMetadata | null): string | null {
  return normalizeNonEmptyString(sourceMetadata?.providerRouteName);
}

function resolvePersistedRouteName(params: BuildRouteDocumentForWriteParams): string {
  const parsedName = normalizeNonEmptyString(params.parsedPayload.name);
  const existingName = normalizeNonEmptyString(params.existingRouteDocument?.name);
  const currentProviderRouteName = resolveCurrentProviderRouteName(params.existingRouteDocument);
  const nextProviderRouteName = resolveNextProviderRouteName(params.sourceMetadata);

  if (!existingName) {
    return parsedName || 'Untitled route';
  }

  if (!params.existingRouteDocument) {
    return existingName;
  }

  if (params.sourceMetadata?.sourceType !== ROUTE_SOURCE_TYPES.ServiceSync) {
    return existingName || parsedName || 'Untitled route';
  }

  if (currentProviderRouteName && existingName !== currentProviderRouteName) {
    return existingName;
  }

  if (!currentProviderRouteName && !nextProviderRouteName) {
    return existingName;
  }

  return nextProviderRouteName || parsedName || existingName || 'Untitled route';
}

function normalizeSyncedDestinationServiceNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map(item => normalizeNonEmptyString(item))
      .filter((item): item is string => item !== null),
  )).sort();
}

export function getUserOwnedRouteFields(routeDocument?: FirestoreRouteJSON | null): Record<string, unknown> {
  const userOwnedFields: Record<string, unknown> = { ...(routeDocument || {}) };
  for (const field of ROUTE_SERVER_OWNED_FIELDS) {
    delete userOwnedFields[field];
  }
  return userOwnedFields;
}

export function buildManualRouteSourceMetadata(params: {
  routeName?: string | null;
  originalFile?: OriginalRouteFileMetaData | null;
  importedAt?: Date | number | null;
  modifiedAt?: Date | number | null;
}): RouteSourceMetadata {
  return {
    sourceType: ROUTE_SOURCE_TYPES.ManualUpload,
    originalFilename: normalizeNonEmptyString(params.originalFile?.originalFilename),
    providerRouteName: normalizeNonEmptyString(params.routeName),
    importedAt: params.importedAt || null,
    modifiedAt: params.modifiedAt || null,
    updatedAt: new Date(),
  };
}

export function buildServiceRouteSourceMetadata(params: {
  sourceServiceName: string;
  providerUserId?: string | null;
  providerRouteId: string;
  providerRouteName?: string | null;
  originalFilename?: string | null;
  importedAt?: Date | number | null;
  modifiedAt?: Date | number | null;
}): RouteSourceMetadata {
  return {
    sourceType: ROUTE_SOURCE_TYPES.ServiceSync,
    sourceServiceName: params.sourceServiceName,
    providerUserId: normalizeNonEmptyString(params.providerUserId),
    providerRouteId: params.providerRouteId,
    providerRouteName: normalizeNonEmptyString(params.providerRouteName),
    originalFilename: normalizeNonEmptyString(params.originalFilename),
    importedAt: params.importedAt || null,
    modifiedAt: params.modifiedAt || null,
    updatedAt: new Date(),
  };
}

export function toRouteSourceSummary(sourceMetadata: RouteSourceMetadata | null | undefined): RouteSourceSummary | null {
  if (!sourceMetadata) {
    return null;
  }

  return {
    sourceType: sourceMetadata.sourceType,
    sourceServiceName: sourceMetadata.sourceServiceName || null,
    providerUserId: sourceMetadata.providerUserId || null,
    providerRouteId: sourceMetadata.providerRouteId || null,
    providerRouteName: sourceMetadata.providerRouteName || null,
    originalFilename: sourceMetadata.originalFilename || null,
    importedAt: sourceMetadata.importedAt || null,
    modifiedAt: sourceMetadata.modifiedAt || null,
  };
}

export function buildRouteDocumentForWrite(params: BuildRouteDocumentForWriteParams): FirestoreRouteJSON {
  const existingRouteDocument = params.existingRouteDocument || null;
  const resolvedOriginalFiles = params.originalFiles && params.originalFiles.length > 0
    ? params.originalFiles
    : getExistingOriginalFiles(existingRouteDocument);
  const originalFile = resolvedOriginalFiles[0] || null;
  const sourceSummary = params.sourceMetadata
    ? toRouteSourceSummary(params.sourceMetadata)
    : normalizeRouteSourceSummary(existingRouteDocument?.sourceSummary);

  return {
    ...getUserOwnedRouteFields(existingRouteDocument),
    ...params.parsedPayload,
    id: params.routeId,
    userID: params.userID,
    name: resolvePersistedRouteName(params),
    originalFile: originalFile || undefined,
    originalFiles: resolvedOriginalFiles,
    importedAt: params.preserveImportedAt === false
      ? params.parsedPayload.importedAt
      : existingRouteDocument?.importedAt || params.parsedPayload.importedAt,
    updatedAt: new Date(),
    sourceSummary,
    syncedDestinationServiceNames: normalizeSyncedDestinationServiceNames(
      params.syncedDestinationServiceNames ?? existingRouteDocument?.syncedDestinationServiceNames,
    ),
  };
}

export function getRouteSourceMetadataRef(
  db: admin.firestore.Firestore,
  userID: string,
  routeID: string,
): admin.firestore.DocumentReference {
  return db.doc(`users/${userID}/routes/${routeID}/metaData/${ROUTE_SOURCE_METADATA_DOC_ID}`);
}

export function getRouteDeliveryMetadataRef(
  db: admin.firestore.Firestore,
  userID: string,
  routeID: string,
  serviceName: string,
  providerUserId?: string | null,
): admin.firestore.DocumentReference {
  return db.doc(
    `users/${userID}/routes/${routeID}/metaData/${getRouteDeliveryMetadataDocId(serviceName, providerUserId)}`,
  );
}

export function mergeSyncedDestinationServiceNames(
  existingValues: unknown,
  nextServiceName: string,
): string[] {
  return Array.from(new Set([
    ...normalizeSyncedDestinationServiceNames(existingValues),
    nextServiceName,
  ])).sort();
}

export function isRouteFromSourceService(
  routeDocument: FirestoreRouteJSON | null | undefined,
  serviceName: string,
  providerUserId?: string | null,
): boolean {
  const sourceSummary = normalizeRouteSourceSummary(routeDocument?.sourceSummary);
  if (sourceSummary?.sourceServiceName !== serviceName) {
    return false;
  }

  const normalizedProviderUserId = normalizeNonEmptyString(providerUserId);
  if (!normalizedProviderUserId) {
    return true;
  }

  const currentProviderUserId = normalizeNonEmptyString(sourceSummary?.providerUserId);
  return currentProviderUserId ? currentProviderUserId === normalizedProviderUserId : true;
}

export async function setRouteDeliveryMetadata(
  params: SetRouteDeliveryMetadataParams,
): Promise<void> {
  const db = admin.firestore();
  const routeRef = db.collection('users').doc(params.userID).collection('routes').doc(params.routeID);
  const deliveryRef = getRouteDeliveryMetadataRef(
    db,
    params.userID,
    params.routeID,
    params.deliveryMetadata.serviceName,
    params.deliveryMetadata.providerUserId,
  );

  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(params.userID, 'route_delivery_metadata', error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn('[RouteDelivery] Skipping delivery metadata update because user is missing or deletion is in progress.', {
        userID: params.userID,
        routeID: params.routeID,
        serviceName: params.deliveryMetadata.serviceName,
        providerUserId: params.deliveryMetadata.providerUserId || null,
      });
      return;
    }

    const routeSnapshot = await transaction.get(routeRef);
    if (!routeSnapshot.exists) {
      return;
    }

    const routeDocument = routeSnapshot.data() as FirestoreRouteJSON;
    const syncedDestinationServiceNames = mergeSyncedDestinationServiceNames(
      routeDocument.syncedDestinationServiceNames,
      `${params.deliveryMetadata.serviceName}`,
    );

    transaction.set(deliveryRef, {
      ...params.deliveryMetadata,
      updatedAt: new Date(),
    }, { merge: true });
    transaction.set(routeRef, {
      syncedDestinationServiceNames,
      updatedAt: new Date(),
    }, { merge: true });
  });
}
