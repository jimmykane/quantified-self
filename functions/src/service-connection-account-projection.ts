import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  ServiceConnectionAccountProjection,
  ServiceConnectionMetaFields,
} from '../../shared/service-connection';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';

const MAX_PROJECTED_ACCOUNTS = 32;
const MAX_PROVIDER_USER_ID_LENGTH = 512;
const MAX_PROJECTED_PERMISSIONS = 64;
const MAX_PERMISSION_LENGTH = 128;

export type ProjectedServiceName =
  | ServiceNames.GarminAPI
  | ServiceNames.SuuntoApp
  | ServiceNames.COROSAPI;

export interface ProjectionConfig {
  tokenCollectionName: string;
  providerUserIdField: 'userID' | 'userName' | 'openId';
  includePermissions: boolean;
}

const PROJECTION_CONFIGS: Record<ProjectedServiceName, ProjectionConfig> = {
  [ServiceNames.GarminAPI]: {
    tokenCollectionName: 'garminAPITokens',
    providerUserIdField: 'userID',
    includePermissions: true,
  },
  [ServiceNames.SuuntoApp]: {
    tokenCollectionName: 'suuntoAppAccessTokens',
    providerUserIdField: 'userName',
    includePermissions: false,
  },
  [ServiceNames.COROSAPI]: {
    tokenCollectionName: 'COROSAPIAccessTokens',
    providerUserIdField: 'openId',
    includePermissions: false,
  },
};

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time >= 0 ? time : null;
  }
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const time = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(time) && time >= 0 ? Math.floor(time) : null;
  }
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return toTimestampMs((value as { toDate: () => Date }).toDate());
  }
  return null;
}

function toProviderEventTimestampMs(value: unknown): number | null {
  const timestamp = toTimestampMs(value);
  if (timestamp === null) return null;
  // Garmin currently stores permissionsLastChangedAt as epoch seconds, while
  // older records and Firestore timestamps can already be milliseconds.
  return timestamp > 0 && timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
}

function normalizePermissions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const permissions = new Set<string>();
  let inspected = 0;
  for (const valueEntry of value) {
    inspected++;
    if (inspected > MAX_PROJECTED_PERMISSIONS * 4) break;
    const permission = normalizeBoundedString(valueEntry, MAX_PERMISSION_LENGTH);
    if (permission) permissions.add(permission);
    if (permissions.size >= MAX_PROJECTED_PERMISSIONS) break;
  }
  return [...permissions].sort((left, right) => left.localeCompare(right));
}

export function buildServiceConnectionAccountProjection(
  serviceName: ProjectedServiceName,
  tokenSnapshots: readonly Pick<admin.firestore.QueryDocumentSnapshot, 'id' | 'data'>[],
): ServiceConnectionAccountProjection[] {
  const config = PROJECTION_CONFIGS[serviceName];
  const accountsByProviderUserId = new Map<string, ServiceConnectionAccountProjection>();

  [...tokenSnapshots]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach(snapshot => {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      const providerUserId = normalizeBoundedString(
        data?.[config.providerUserIdField],
        MAX_PROVIDER_USER_ID_LENGTH,
      );
      if (!providerUserId) return;

      const connectedAtMs = toTimestampMs(data?.dateCreated);
      const permissions = config.includePermissions ? normalizePermissions(data?.permissions) : null;
      const permissionsUpdatedAtMs = config.includePermissions
        ? toProviderEventTimestampMs(data?.permissionsLastChangedAt)
        : null;
      const projection: ServiceConnectionAccountProjection = {
        providerUserId,
        ...(connectedAtMs === null ? {} : { connectedAtMs }),
        ...(permissions === null ? {} : { permissions }),
        ...(permissionsUpdatedAtMs === null ? {} : { permissionsUpdatedAtMs }),
      };
      const current = accountsByProviderUserId.get(providerUserId);
      if (!current || (projection.connectedAtMs || 0) >= (current.connectedAtMs || 0)) {
        accountsByProviderUserId.set(providerUserId, projection);
      }
    });

  return [...accountsByProviderUserId.values()]
    .sort((left, right) => `${left.providerUserId || ''}`.localeCompare(`${right.providerUserId || ''}`))
    .slice(0, MAX_PROJECTED_ACCOUNTS);
}

export function getServiceConnectionProjectionConfig(serviceName: ProjectedServiceName): ProjectionConfig {
  return PROJECTION_CONFIGS[serviceName];
}

export async function readServiceConnectionAccountProjection(options: {
  db?: admin.firestore.Firestore;
  userID: string;
  serviceName: ProjectedServiceName;
}): Promise<ServiceConnectionAccountProjection[]> {
  const db = options.db || admin.firestore();
  const config = PROJECTION_CONFIGS[options.serviceName];
  const normalizedUserID = normalizeBoundedString(options.userID, 256);
  if (!normalizedUserID) throw new Error('A valid user ID is required for connection projection read.');

  const tokenRootRef = db.collection(config.tokenCollectionName).doc(normalizedUserID);
  const [tokenRootSnapshot, tokenSnapshots] = await Promise.all([
    tokenRootRef.get(),
    tokenRootRef.collection('tokens').limit(MAX_PROJECTED_ACCOUNTS + 1).get(),
  ]);
  if (tokenSnapshots.docs.length > MAX_PROJECTED_ACCOUNTS) {
    throw new Error(`Connection projection exceeds the ${MAX_PROJECTED_ACCOUNTS}-account bound.`);
  }
  return tokenRootSnapshot.exists
    ? buildServiceConnectionAccountProjection(options.serviceName, tokenSnapshots.docs)
    : [];
}

export async function refreshServiceConnectionAccountProjection(options: {
  db?: admin.firestore.Firestore;
  userID: string;
  serviceName: ProjectedServiceName;
  revisionKey: string;
}): Promise<'updated' | 'stale' | 'deleted-user'> {
  const db = options.db || admin.firestore();
  const normalizedUserID = normalizeBoundedString(options.userID, 256);
  if (!normalizedUserID) throw new Error('A valid user ID is required for connection projection refresh.');
  if (!/^\d{12}:\d{9}$/.test(options.revisionKey)) {
    throw new Error('A valid projection revision key is required.');
  }

  const accounts = await readServiceConnectionAccountProjection({
    db,
    userID: normalizedUserID,
    serviceName: options.serviceName,
  });
  const metaRef = db.collection('users').doc(normalizedUserID).collection('meta').doc(options.serviceName);

  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        normalizedUserID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(
        normalizedUserID,
        `service_connection_projection:${options.serviceName}`,
        error,
      );
    }
    if (deletionGuard.shouldSkip) return 'deleted-user';

    const metaSnapshot = await transaction.get(metaRef);
    const currentRevision = `${
      (metaSnapshot.data() as ServiceConnectionMetaFields | undefined)?.connectionAccountsRevisionKey || ''
    }`;
    if (/^\d{12}:\d{9}$/.test(currentRevision) && currentRevision > options.revisionKey) {
      return 'stale';
    }

    transaction.set(metaRef, {
      connectionAccounts: accounts,
      connectionAccountsRevisionKey: options.revisionKey,
    }, { merge: true });
    return 'updated';
  });
}

export function projectionRevisionKeyFromMs(timestampMs: number): string {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new Error('A valid projection revision time is required.');
  }
  const seconds = Math.floor(timestampMs / 1000);
  const nanos = (timestampMs % 1000) * 1_000_000;
  return `${`${seconds}`.padStart(12, '0')}:${`${nanos}`.padStart(9, '0')}`;
}

export function projectionRevisionKeyFromEventTime(eventTime: string | undefined): string {
  const match = `${eventTime || ''}`.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/,
  );
  if (!match) throw new Error('A valid Firestore event time is required.');
  const secondsMs = Date.parse(`${match[1]}Z`);
  if (!Number.isSafeInteger(secondsMs) || secondsMs < 0) {
    throw new Error('A valid Firestore event time is required.');
  }
  const seconds = Math.floor(secondsMs / 1000);
  const nanos = `${match[2] || ''}`.padEnd(9, '0');
  return `${`${seconds}`.padStart(12, '0')}:${nanos}`;
}

function tokenProjectionTrigger(
  serviceName: ProjectedServiceName,
  document: string,
) {
  return onDocumentWritten({
    document,
    region: 'europe-west2',
    memory: '256MiB',
    maxInstances: 20,
    concurrency: 10,
    retry: true,
  }, async event => {
    await refreshServiceConnectionAccountProjection({
      userID: `${event.params.userID || ''}`,
      serviceName,
      revisionKey: projectionRevisionKeyFromEventTime(event.time),
    });
  });
}

export const projectGarminConnectionOnTokenWrite = tokenProjectionTrigger(
  ServiceNames.GarminAPI,
  'garminAPITokens/{userID}/tokens/{tokenID}',
);

export const projectSuuntoConnectionOnTokenWrite = tokenProjectionTrigger(
  ServiceNames.SuuntoApp,
  'suuntoAppAccessTokens/{userID}/tokens/{tokenID}',
);

export const projectCOROSConnectionOnTokenWrite = tokenProjectionTrigger(
  ServiceNames.COROSAPI,
  'COROSAPIAccessTokens/{userID}/tokens/{tokenID}',
);
