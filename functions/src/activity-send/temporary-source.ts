import * as admin from 'firebase-admin';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ACTIVITY_SEND_LIMITS } from '../../../shared/activity-send';
import { HistoricalOriginalIneligibleError } from '../activity-sync/historical-manual-original';
import { sendFileHash } from './policy';

/** Direct sources never resolve through event originals or caller-supplied paths. */
export async function readTemporarySendFile(item: ActivitySyncQueueItemInterface): Promise<Buffer> {
  if (!item.sendBatchID || !item.sendRowID) throw new HistoricalOriginalIneligibleError('Temporary send reference is missing.');
  const path = `users/${item.userID}/activitySendSources/${item.sendBatchID}/${item.sendRowID}.fit`;
  const op = admin.firestore().doc(`users/${item.userID}/activitySendOperations/${item.sendBatchID}`);
  const [batch, source] = await Promise.all([op.get(), op.collection('rows').doc(item.sendRowID).get()]);
  const data = source.data();
  if (!batch.exists || !source.exists || Number(batch.data()?.expiresAt) <= Date.now() || data?.originalFile?.path !== path || item.originalFile.path !== path || data.originalFile.generation !== item.originalFile.generation) throw new HistoricalOriginalIneligibleError('Temporary source expired or changed.');
  const file = admin.storage().bucket().file(path, { generation: item.originalFile.generation });
  const [meta] = await file.getMetadata();
  if (Number(meta.size) > ACTIVITY_SEND_LIMITS.fileBytes || `${meta.generation}` !== item.originalFile.generation) throw new HistoricalOriginalIneligibleError('Temporary source exceeds the send limit.');
  const [buffer] = await file.download();
  if (buffer.length > ACTIVITY_SEND_LIMITS.fileBytes || sendFileHash(buffer) !== data.digest) throw new HistoricalOriginalIneligibleError('Temporary source identity changed.');
  return buffer;
}
