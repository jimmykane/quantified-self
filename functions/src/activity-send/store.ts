import * as admin from 'firebase-admin';
import { readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames, EventImporterFIT } from '@sports-alliance/sports-lib';
import { ActivitySendBatch, ActivitySendRow, ACTIVITY_SEND_PROVIDERS, ACTIVITY_SEND_LIMITS, ActivitySendProvider } from '../../../shared/activity-send';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { getActiveCOROSTokenSnapshot } from '../coros/account';
import { getActiveWahooTokenSnapshot } from '../wahoo/account';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getDestinationConnectionStatus } from '../activity-sync/process-queue-item';
import { createParsingOptions } from '../../../shared/parsing-options';
import { decodeSendFile } from './policy';
import { resolveWahooWorkoutType } from '../../../shared/wahoo-activity-types';

export interface SendOperation extends ActivitySendBatch {
  providerAccount: string;
  expiresAt: number;
  cleanupAfter: Timestamp;
  stopped?: boolean;
  selectionKey?: string;
  nextCursor?: string | null;
  previousCursor?: string | null;
  lastStartDate?: number;
  lastEventId?: string;
  savedSelection?: { eventIds?: string[]; startDate?: string; endDate?: string; sources: string[] };
  stopCursor?: string;
  stopComplete?: boolean;
}
export interface SendSource {
  sourceServiceName: ServiceNames | 'manualUpload';
  eventID: string;
  originalFile: { path: string; generation: string; extension: string; bucket?: string; originalFilename?: string };
  digest?: string;
  reservedBytes?: number;
  queueId?: string;
}
export const operationRef = (uid: string, id: string) => admin.firestore().doc(`users/${uid}/activitySendOperations/${id}`);
export const batchRef = (uid: string, id: string) => admin.firestore().doc(`users/${uid}/activitySends/${id}`);
export function publicBatch(operation: SendOperation): ActivitySendBatch {
  const { id, provider, source, state, revision, accountLabel, createdAt, updatedAt, reviewed, total, finished, expiresAt } = operation;
  return { id, provider, source, state, revision, accountLabel, createdAt, updatedAt, reviewed, total, finished, expiresAt, stopped: operation.stopped === true, savedSelectionReady: !!operation.savedSelection };
}
export async function guardedSendTransaction<T>(uid: string, action: (tx: admin.firestore.Transaction) => Promise<T>): Promise<T> {
  return admin.firestore().runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)).shouldSkip) throw new HttpsError('failed-precondition', 'Account is unavailable.');
    return action(tx);
  });
}
/** Background triggers silently retire work if account deletion wins a transaction retry. */
export async function guardedBackgroundSendTransaction<T>(uid: string, action: (tx: admin.firestore.Transaction) => Promise<T>): Promise<T | undefined> {
  return admin.firestore().runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(admin.firestore(), tx, uid)).shouldSkip) return;
    return action(tx);
  });
}
export async function providerAccount(uid: string, provider: ActivitySendProvider): Promise<string> {
  const service = ACTIVITY_SEND_PROVIDERS[provider];
  if (await getDestinationConnectionStatus(uid, service) !== 'connected') throw new HttpsError('failed-precondition', 'Connect or reconnect the destination in Connections.');
  if (provider === 'coros') return (await getActiveCOROSTokenSnapshot(uid)).id;
  if (provider === 'wahoo') return (await getActiveWahooTokenSnapshot(uid)).id;
  const tokens = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(uid).collection('tokens').limit(2).get();
  if (tokens.size !== 1) throw new HttpsError('failed-precondition', 'Connect exactly one Suunto account before sending.');
  return tokens.docs[0].id;
}
export async function requireDraft(uid: string, batchId: string, allowClosed = false): Promise<SendOperation> {
  const data = (await operationRef(uid, batchId).get()).data() as SendOperation | undefined;
  if (!data) throw new HttpsError('not-found', 'Send was not found.');
  if (data.state !== 'draft' || !allowClosed && (data.stopped || data.expiresAt <= Date.now())) throw new HttpsError('failed-precondition', 'Create a new send draft.');
  return data;
}
export async function describeFIT(fit: Buffer, name: string, provider: ActivitySendProvider): Promise<Pick<ActivitySendRow, 'name' | 'sport' | 'startDate' | 'warnings'>> {
  try {
    const parsed = readFitMessages(fit, { messageNumbers: [0], maxInputBytes: ACTIVITY_SEND_LIMITS.fileBytes });
    const fileIds = parsed.messages.filter(message => message.globalMessageNumber === 0);
    if (parsed.issues.length || fileIds.length !== 1 || readFitUnsignedField(fileIds[0].fields.find(field => field.fieldNumber === 0), 0, 1, fileIds[0].littleEndian) !== 4) throw new Error('Recording required.');
  } catch { throw new HttpsError('invalid-argument', 'Choose a recorded activity FIT. Send course files from Routes.'); }
  let event;
  try { event = await EventImporterFIT.getFromArrayBuffer(fit.buffer.slice(fit.byteOffset, fit.byteOffset + fit.length) as ArrayBuffer, createParsingOptions()); }
  catch { throw new HttpsError('invalid-argument', 'This FIT cannot be read as a recorded activity.'); }
  if (!event.getActivities().length) throw new HttpsError('invalid-argument', 'This is not a recorded activity. Send course files from Routes.');
  const types = event.getActivityTypesAsArray();
  const warnings: string[] = [];
  if (provider === 'coros') {
    if (types.some(type => /snorkel/i.test(type))) warnings.push('COROS receives Snorkeling as Open Water Swim.');
    if (types.some(type => /sailing/i.test(type))) warnings.push('COROS receives eligible GPS Sailing as GPS Cardio.');
  }
  if (provider === 'wahoo') {
    const mapped = resolveWahooWorkoutType(types);
    if (mapped) warnings.push(`Wahoo activity category: ${mapped.name}.`);
  }
  return { name: name.slice(0, 256), sport: types.join(', ') || null, startDate: event.startDate?.getTime() || null, warnings };
}

export async function describeSavedFIT(original: SendSource['originalFile'], name: string, provider: ActivitySendProvider) {
  const file = admin.storage().bucket(original.bucket).file(original.path, { generation: original.generation });
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > ACTIVITY_SEND_LIMITS.fileBytes || `${metadata.generation}` !== original.generation) throw new HttpsError('failed-precondition', 'The original is unavailable or exceeds 20 MiB.');
  const [raw] = await file.download();
  const fit = decodeSendFile(raw, original.path.endsWith('.gz') ? 'saved.fit.gz' : 'saved.fit');
  return { ...await describeFIT(fit, name, provider), size: fit.length };
}
