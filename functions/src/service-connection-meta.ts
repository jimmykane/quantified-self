import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isReconnectRequiredServiceConnection,
  ServiceConnectionMetaFields,
  SERVICE_CONNECTION_STATES,
} from '../../shared/service-connection';
import { getUserDeletionGuardState } from './shared/user-deletion-guard';

function serviceMetaRef(userID: string, serviceName: ServiceNames): admin.firestore.DocumentReference {
  return admin.firestore().collection('users').doc(userID).collection('meta').doc(serviceName);
}

async function shouldSkipServiceMetaWrite(userID: string, serviceName: ServiceNames): Promise<boolean> {
  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  if (!deletionGuard.shouldSkip) {
    return false;
  }

  logger.warn(
    `[ServiceConnectionMeta] Skipping ${serviceName} meta write for user ${userID} because the user is missing or deletion is in progress.`,
  );
  return true;
}

export async function markServiceReconnectRequired(
  userID: string,
  serviceName: ServiceNames,
  failureCode: string | null | undefined,
  failureMessage: string | null | undefined,
  nowMs = Date.now(),
): Promise<void> {
  if (await shouldSkipServiceMetaWrite(userID, serviceName)) {
    return;
  }
  await serviceMetaRef(userID, serviceName).set({
    connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
    lastAuthFailureCode: failureCode || null,
    lastAuthFailureMessage: failureMessage || null,
    lastDisconnectedAt: nowMs,
  }, { merge: true });
}

export async function markServiceConnected(userID: string, serviceName: ServiceNames): Promise<void> {
  if (await shouldSkipServiceMetaWrite(userID, serviceName)) {
    return;
  }
  await serviceMetaRef(userID, serviceName).set({
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    lastAuthFailureCode: admin.firestore.FieldValue.delete(),
    lastAuthFailureMessage: admin.firestore.FieldValue.delete(),
    lastDisconnectedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });
}

export async function clearServiceConnectionState(userID: string, serviceName: ServiceNames): Promise<void> {
  if (await shouldSkipServiceMetaWrite(userID, serviceName)) {
    return;
  }
  await serviceMetaRef(userID, serviceName).set({
    connectionState: admin.firestore.FieldValue.delete(),
    lastAuthFailureCode: admin.firestore.FieldValue.delete(),
    lastAuthFailureMessage: admin.firestore.FieldValue.delete(),
    lastDisconnectedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });
}

export async function getServiceConnectionMeta(
  userID: string,
  serviceName: ServiceNames,
): Promise<ServiceConnectionMetaFields | null> {
  const snapshot = await serviceMetaRef(userID, serviceName).get();
  return snapshot.exists ? snapshot.data() as ServiceConnectionMetaFields : null;
}

export async function isServiceReconnectRequiredForUser(
  userID: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  return isReconnectRequiredServiceConnection(await getServiceConnectionMeta(userID, serviceName));
}
