import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isReconnectRequiredServiceConnection,
  ServiceConnectionMetaFields,
  SERVICE_CONNECTION_STATES,
} from '../../shared/service-connection';

function serviceMetaRef(userID: string, serviceName: ServiceNames): admin.firestore.DocumentReference {
  return admin.firestore().collection('users').doc(userID).collection('meta').doc(serviceName);
}

export async function markServiceReconnectRequired(
  userID: string,
  serviceName: ServiceNames,
  failureCode: string | null | undefined,
  failureMessage: string | null | undefined,
  nowMs = Date.now(),
): Promise<void> {
  await serviceMetaRef(userID, serviceName).set({
    connectionState: SERVICE_CONNECTION_STATES.ReconnectRequired,
    lastAuthFailureCode: failureCode || null,
    lastAuthFailureMessage: failureMessage || null,
    lastDisconnectedAt: nowMs,
  }, { merge: true });
}

export async function markServiceConnected(userID: string, serviceName: ServiceNames): Promise<void> {
  await serviceMetaRef(userID, serviceName).set({
    connectionState: SERVICE_CONNECTION_STATES.Connected,
    lastAuthFailureCode: admin.firestore.FieldValue.delete(),
    lastAuthFailureMessage: admin.firestore.FieldValue.delete(),
    lastDisconnectedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });
}

export async function clearServiceConnectionState(userID: string, serviceName: ServiceNames): Promise<void> {
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
