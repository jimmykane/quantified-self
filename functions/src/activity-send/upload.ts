import * as admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { ACTIVITY_SEND_LIMITS, ActivitySendRow } from '../../../shared/activity-send';
import { ALLOWED_CORS_ORIGINS, hasProAccess, shouldEnforceAppCheck } from '../utils';
import { decodeSendFile, sendFileHash, sendIdentifier } from './policy';
import { batchRef, describeFIT, guardedSendTransaction, operationRef, publicBatch, requireDraft, SendOperation, SendSource } from './store';
import { queueRetiredSendSourceCleanup } from './source-cleanup';

export async function stageSendFile(uid: string, batchId: string, rowId: string, filename: string, raw: Buffer) {
  sendIdentifier(batchId); sendIdentifier(rowId);
  if (!(await hasProAccess(uid))) throw new HttpsError('permission-denied', 'Sending activities requires Pro.');
  const draft = await requireDraft(uid, batchId);
  if (draft.source !== 'files') throw new HttpsError('failed-precondition', 'Choose a local-file draft.');
  const fit = decodeSendFile(raw, filename);
  const description = await describeFIT(fit, filename, draft.provider);
  const digest = sendFileHash(fit);
  const ref = operationRef(uid, batchId);
  const matching = await ref.collection('rows').where('digest', '==', digest).limit(1).get();
  if (!matching.empty) rowId = matching.docs[0].id;
  const sourceRef = ref.collection('rows').doc(rowId);
  const quotaRef = admin.firestore().doc(`users/${uid}/activitySendQuota/current`);
  const path = `users/${uid}/activitySendSources/${batchId}/${rowId}.fit`;
  const alreadyStaged = await guardedSendTransaction(uid, async tx => {
    const [currentSnapshot, sourceSnapshot, quota, duplicate] = await Promise.all([
      tx.get(ref), tx.get(sourceRef), tx.get(quotaRef), tx.get(ref.collection('rows').where('digest', '==', digest).limit(1)),
    ]);
    const current = currentSnapshot.data() as SendOperation;
    if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft expired or changed.');
    if (sourceSnapshot.data()?.removed) throw new HttpsError('failed-precondition', 'This file was removed. Start a new draft to select it again.');
    if (sourceSnapshot.exists) {
      if (sourceSnapshot.data()?.digest !== digest) throw new HttpsError('failed-precondition', 'File reference cannot be replaced.');
      return !!sourceSnapshot.data()?.originalFile;
    }
    if (!duplicate.empty) throw new HttpsError('already-exists', 'This file is already in the draft.');
    const bytes = Number(quota.data()?.bytes || 0);
    if (bytes + fit.length > ACTIVITY_SEND_LIMITS.userBytes || current.total >= ACTIVITY_SEND_LIMITS.files) throw new HttpsError('resource-exhausted', 'Temporary storage limit reached: 50 files per batch and 200 MiB per account.');
    tx.set(sourceRef, { digest, reservedBytes: fit.length, storagePath: path });
    tx.set(quotaRef, { bytes: bytes + fit.length });
    current.total++; current.revision++; current.reviewed = false; current.updatedAt = Date.now();
    tx.set(ref, current); tx.set(batchRef(uid, batchId), publicBatch(current));
    const row: ActivitySendRow = { id: rowId, ...description, size: fit.length, status: 'preparing', recovery: 'none', message: 'Staging a private temporary copy.', attempts: 0 };
    tx.set(batchRef(uid, batchId).collection('rows').doc(rowId), row);
    return false;
  });
  if (alreadyStaged) return { batchId, rowId };
  const file = admin.storage().bucket().file(path);
  let generation: string | undefined;
  try {
    try {
      await file.save(fit, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', metadata: { sendDigest: digest } } });
    } catch (error) {
      if (Number((error as { code?: unknown }).code) !== 412) throw error;
    }
    const [metadata] = await file.getMetadata().catch(error => {
      if (Number((error as { code?: unknown }).code) === 404) throw new HttpsError('failed-precondition', 'The temporary file was removed. Review this draft before continuing.');
      throw error;
    });
    if (metadata.metadata?.sendDigest !== digest) throw new HttpsError('failed-precondition', 'Temporary file identity changed.');
    const storedGeneration = `${metadata.generation}`;
    generation = storedGeneration;
    await guardedSendTransaction(uid, async tx => {
      const current = (await tx.get(ref)).data() as SendOperation | undefined;
      const reserved = await tx.get(sourceRef);
      if (!current || current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now() || reserved.data()?.digest !== digest || reserved.data()?.removed) throw new HttpsError('failed-precondition', 'Draft changed while uploading.');
      const source: SendSource = { sourceServiceName: 'manualUpload', eventID: `file_${digest}`, digest, reservedBytes: fit.length, originalFile: { path, generation: storedGeneration, extension: 'fit', originalFilename: filename.slice(0, 256) } };
      tx.set(sourceRef, { ...source, admitted: false });
      tx.update(batchRef(uid, batchId).collection('rows').doc(rowId), { status: 'ready', message: 'Ready to review.' });
      current.revision++; current.reviewed = false; current.updatedAt = Date.now();
      tx.set(ref, current); tx.set(batchRef(uid, batchId), publicBatch(current));
    });
  } catch (error) {
    await queueRetiredSendSourceCleanup(sourceRef, digest);
    // Exact-generation cleanup fences a write finishing after draft/account deletion.
    const adopted = (await sourceRef.get()).data();
    if (generation && (adopted?.originalFile?.generation !== generation || adopted?.removed)) await admin.storage().bucket().file(path, { generation }).delete({ ignoreNotFound: true });
    // A deleted account/tree cannot retain cleanup intent. This derived immutable row path has no owner left.
    if (!generation && !adopted) await file.delete({ ignoreNotFound: true });
    throw error;
  }
  return { batchId, rowId };
}

export const uploadActivitySendFile = onRequest({ region: 'europe-west2', cors: ALLOWED_CORS_ORIGINS, memory: '512MiB', timeoutSeconds: 120, concurrency: 1, maxInstances: 10 }, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    if (request.method !== 'POST') { response.status(405).json({ message: 'Use POST.' }); return; }
    const bearer = request.header('authorization');
    if (!bearer?.startsWith('Bearer ')) throw new HttpsError('unauthenticated', 'Sign in first.');
    const { uid } = await admin.auth().verifyIdToken(bearer.slice(7), true).catch(() => { throw new HttpsError('unauthenticated', 'Sign in again.'); });
    if (shouldEnforceAppCheck()) {
      const token = request.header('X-Firebase-AppCheck');
      if (!token) throw new HttpsError('unauthenticated', 'App verification is required.');
      await admin.appCheck().verifyToken(token).catch(() => { throw new HttpsError('unauthenticated', 'App verification failed. Reload this page.'); });
    }
    const result = await stageSendFile(uid, sendIdentifier(request.header('X-QS-Batch')), sendIdentifier(request.header('X-QS-File')), decodeURIComponent(request.header('X-QS-Filename') || ''), request.rawBody);
    response.status(200).json(result);
  } catch (error) {
    const known = error instanceof HttpsError;
    const code = known ? error.code : 'unavailable';
    const status = code === 'unauthenticated' ? 401 : code === 'permission-denied' ? 403 : code === 'resource-exhausted' ? 429 : code === 'already-exists' ? 409 : known ? 400 : 503;
    response.status(status).json({ code, message: known ? error.message : 'File staging is temporarily unavailable. Retry the same file.' });
  }
});
