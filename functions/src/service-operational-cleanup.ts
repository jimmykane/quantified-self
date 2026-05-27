import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { type Auth2ServiceTokenInterface, ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../shared/sleep';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from './coros/constants';
import { GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from './garmin/constants';
import {
  markQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from './queue/cleanup-tombstone';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './sleep/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from './suunto/constants';

type ProviderIdentifierField = 'userName' | 'openId' | 'userID';

interface ProviderOperationalCleanupConfig {
  serviceName: ServiceNames;
  providerUserIdField: ProviderIdentifierField;
  providerUserId: string;
  workoutQueueCollection: string;
  sleepProvider: string;
}

interface OperationalCleanupQuery {
  collectionName: string;
  fieldName: string;
  sourceCollectionName: string | ((data: Record<string, unknown>) => string | null);
  matches: (data: Record<string, unknown>) => boolean;
}

const CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS = new Set([
  ACTIVITY_SYNC_QUEUE_COLLECTION_NAME,
  SLEEP_SYNC_QUEUE_COLLECTION_NAME,
  SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
  COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
  GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
]);

export interface ProviderOperationalCleanupResult {
  providerUserId: string | null;
  deletedDocCount: number;
  skippedForActiveConnection: boolean;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = `${value || ''}`.trim();
  return normalized.length > 0 ? normalized : null;
}

function providerUserIdFromTokenData(
  serviceName: ServiceNames,
  tokenData: Record<string, unknown>,
): string | null {
  switch (serviceName) {
    case ServiceNames.SuuntoApp:
      return asNonEmptyString(tokenData.userName);
    case ServiceNames.COROSAPI:
      return asNonEmptyString(tokenData.openId);
    case ServiceNames.GarminAPI:
      return asNonEmptyString(tokenData.userID);
    default:
      return null;
  }
}

function getProviderOperationalCleanupConfig(
  serviceName: ServiceNames,
  tokenData: Record<string, unknown>,
): ProviderOperationalCleanupConfig | null {
  const providerUserId = providerUserIdFromTokenData(serviceName, tokenData);
  if (!providerUserId) {
    return null;
  }

  switch (serviceName) {
    case ServiceNames.SuuntoApp:
      return {
        serviceName,
        providerUserId,
        providerUserIdField: 'userName',
        workoutQueueCollection: SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
        sleepProvider: SLEEP_PROVIDERS.SuuntoApp,
      };
    case ServiceNames.COROSAPI:
      return {
        serviceName,
        providerUserId,
        providerUserIdField: 'openId',
        workoutQueueCollection: COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
        sleepProvider: SLEEP_PROVIDERS.COROSAPI,
      };
    case ServiceNames.GarminAPI:
      return {
        serviceName,
        providerUserId,
        providerUserIdField: 'userID',
        workoutQueueCollection: GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
        sleepProvider: SLEEP_PROVIDERS.GarminAPI,
      };
    default:
      return null;
  }
}

function serviceNameFromSleepProvider(provider: unknown): ServiceNames | null {
  const providerValue = asNonEmptyString(provider);
  switch (providerValue) {
    case SLEEP_PROVIDERS.SuuntoApp:
    case ServiceNames.SuuntoApp:
      return ServiceNames.SuuntoApp;
    case SLEEP_PROVIDERS.COROSAPI:
    case ServiceNames.COROSAPI:
      return ServiceNames.COROSAPI;
    case SLEEP_PROVIDERS.GarminAPI:
    case ServiceNames.GarminAPI:
      return ServiceNames.GarminAPI;
    default:
      return null;
  }
}

function looksLikeLegacyGarminWorkoutQueueData(data: Record<string, unknown>): boolean {
  return !!(
    asNonEmptyString(data.userID)
    && (
      asNonEmptyString(data.activityFileID)
      || asNonEmptyString(data.activityFileType)
      || asNonEmptyString(data.callbackURL)
      || asNonEmptyString(data.userAccessToken)
    )
  );
}

function getExplicitFirebaseUidAssociation(
  collectionName: string,
  data: Record<string, unknown>,
): string | null {
  const firebaseUserID = asNonEmptyString(data.firebaseUserID);
  if (firebaseUserID) {
    return firebaseUserID;
  }

  const uid = asNonEmptyString(data.uid);
  if (uid) {
    return uid;
  }

  if (collectionName === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME || collectionName === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
    return asNonEmptyString(data.userID);
  }

  if (collectionName !== 'failed_jobs') {
    return null;
  }

  const originalCollection = asNonEmptyString(data.originalCollection);
  if (originalCollection === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME || originalCollection === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
    return asNonEmptyString(data.userID);
  }

  return null;
}

function failedJobSourceCollection(data: Record<string, unknown>): string | null {
  const originalCollection = asNonEmptyString(data.originalCollection);
  if (originalCollection && CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS.has(originalCollection)) {
    return originalCollection;
  }

  if (serviceNameFromSleepProvider(data.provider) && asNonEmptyString(data.providerUserId)) {
    return SLEEP_SYNC_QUEUE_COLLECTION_NAME;
  }
  if (asNonEmptyString(data.userName)) {
    return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
  }
  if (asNonEmptyString(data.openId)) {
    return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
  }
  if (looksLikeLegacyGarminWorkoutQueueData(data)) {
    return GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME;
  }

  return null;
}

function tokenSnapshotHasServiceName(doc: admin.firestore.QueryDocumentSnapshot, serviceName: ServiceNames): boolean {
  const data = doc.data() as Record<string, unknown>;
  return asNonEmptyString(data.serviceName) === serviceName;
}

async function hasConnectedTokenForProviderUser(
  db: admin.firestore.Firestore,
  config: ProviderOperationalCleanupConfig,
): Promise<boolean> {
  const snapshot = await db.collectionGroup('tokens')
    .where(config.providerUserIdField, '==', config.providerUserId)
    .get();

  return snapshot.docs.some((doc) => tokenSnapshotHasServiceName(doc, config.serviceName));
}

function shouldDeleteOperationalDoc(
  userID: string,
  collectionName: string,
  data: Record<string, unknown>,
  hasActiveConnection: boolean,
): boolean {
  const explicitUid = getExplicitFirebaseUidAssociation(collectionName, data);
  if (explicitUid) {
    return explicitUid === userID;
  }

  return !hasActiveConnection;
}

function buildOperationalCleanupQueries(config: ProviderOperationalCleanupConfig): OperationalCleanupQuery[] {
  const isSleepDocForProvider = (data: Record<string, unknown>) =>
    serviceNameFromSleepProvider(data.provider) === config.serviceName;
  const isWorkoutDocForProvider = (data: Record<string, unknown>) =>
    asNonEmptyString(data[config.providerUserIdField]) === config.providerUserId;

  return [
    {
      collectionName: config.workoutQueueCollection,
      fieldName: config.providerUserIdField,
      sourceCollectionName: config.workoutQueueCollection,
      matches: isWorkoutDocForProvider,
    },
    {
      collectionName: SLEEP_SYNC_QUEUE_COLLECTION_NAME,
      fieldName: 'providerUserId',
      sourceCollectionName: SLEEP_SYNC_QUEUE_COLLECTION_NAME,
      matches: isSleepDocForProvider,
    },
    {
      collectionName: 'failed_jobs',
      fieldName: config.providerUserIdField,
      sourceCollectionName: failedJobSourceCollection,
      matches: isWorkoutDocForProvider,
    },
    {
      collectionName: 'failed_jobs',
      fieldName: 'providerUserId',
      sourceCollectionName: failedJobSourceCollection,
      matches: isSleepDocForProvider,
    },
  ];
}

async function deleteProviderOperationalDocsForQuery(
  db: admin.firestore.Firestore,
  userID: string,
  providerUserId: string,
  query: OperationalCleanupQuery,
  hasActiveConnection: boolean,
  deletedRefKeys: Set<string>,
): Promise<number> {
  const snapshot = await db.collection(query.collectionName)
    .where(query.fieldName, '==', providerUserId)
    .get();
  let deletedDocCount = 0;

  for (const doc of snapshot.docs) {
    const refKey = `${doc.ref.path || doc.id}`;
    if (deletedRefKeys.has(refKey)) {
      continue;
    }

    const data = doc.data() as Record<string, unknown>;
    if (!query.matches(data) || !shouldDeleteOperationalDoc(userID, query.collectionName, data, hasActiveConnection)) {
      continue;
    }

    const sourceCollectionName = typeof query.sourceCollectionName === 'function'
      ? query.sourceCollectionName(data)
      : query.sourceCollectionName;
    if (query.collectionName === 'failed_jobs' && !sourceCollectionName) {
      continue;
    }
    if (sourceCollectionName) {
      const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
        sourceCollectionName,
        doc.id,
        QUEUE_CLEANUP_TOMBSTONE_REASONS.ServiceDisconnectCleanup,
      );
      if (!tombstoneWritten) {
        logger.error(
          `[ServiceOperationalCleanup] Failed to write cleanup tombstone for ${query.collectionName}/${doc.id}; preserving document to avoid missing-doc Cloud Task retries.`,
        );
        continue;
      }
    }
    await db.recursiveDelete(doc.ref);
    deletedRefKeys.add(refKey);
    deletedDocCount += 1;
  }

  return deletedDocCount;
}

export async function cleanupProviderOperationalDocsForServiceToken(
  userID: string,
  serviceName: ServiceNames,
  tokenData: Auth2ServiceTokenInterface | Record<string, unknown>,
): Promise<ProviderOperationalCleanupResult> {
  const config = getProviderOperationalCleanupConfig(serviceName, tokenData as Record<string, unknown>);
  if (!config) {
    return {
      providerUserId: null,
      deletedDocCount: 0,
      skippedForActiveConnection: false,
    };
  }

  const db = admin.firestore();
  let hasActiveConnection = false;
  try {
    hasActiveConnection = await hasConnectedTokenForProviderUser(db, config);
  } catch (error) {
    logger.error(
      `[ServiceOperationalCleanup] Failed to check active ${serviceName} connections for provider user ${config.providerUserId}; preserving provider-only queue docs.`,
      error,
    );
    hasActiveConnection = true;
  }

  let deletedDocCount = 0;
  const deletedRefKeys = new Set<string>();
  for (const query of buildOperationalCleanupQueries(config)) {
    try {
      deletedDocCount += await deleteProviderOperationalDocsForQuery(
        db,
        userID,
        config.providerUserId,
        query,
        hasActiveConnection,
        deletedRefKeys,
      );
    } catch (error) {
      logger.error(
        `[ServiceOperationalCleanup] Failed to clean ${query.collectionName} for ${serviceName} provider user ${config.providerUserId}`,
        error,
      );
    }
  }

  if (deletedDocCount > 0) {
    logger.info(
      `[ServiceOperationalCleanup] Deleted ${deletedDocCount} provider-keyed operational docs for ${serviceName} user ${userID} provider user ${config.providerUserId}`,
    );
  }

  return {
    providerUserId: config.providerUserId,
    deletedDocCount,
    skippedForActiveConnection: hasActiveConnection,
  };
}
