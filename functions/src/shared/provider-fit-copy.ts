import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { GarminAPIActivityQueueItemInterface } from '../queue/queue-item.interface';
import { QueueResult } from '../queue-utils';
import { updateQueueItemIfUserActive, QueueItemUserGuardedUpdateResult } from '../queue/dispatch-marker';
import { recordImportCompletion } from '../queue/import-monitoring';
import { retainedSourceReferences } from './retained-activity-source';
import { isSameProviderRecording } from './provider-recording-identity';
import { readActivitySourceIdentity } from '../../../shared/activity-source-identity';
import { getActivitySourceWindow } from './activity-identity-matcher';
import { savedActivityIdentity } from './activity-source-binding';

const MAX_COPY_BYTES = 8 * 1024 * 1024;
type Fields = Record<string, unknown>;
interface Recording { file_ids: Fields[]; sessions: Fields[]; records: Fields[] }
const time = (value: unknown): number => value instanceof Date ? value.getTime()
  : typeof value === 'number' ? value : value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis() : Number.NaN;

/** Compare source evidence, never saved/user-edited activity fields or guessed binary repairs. */
export async function isRetainedHikeFITCopy(retained: Buffer, incoming: Buffer, expectedStart?: number,
  expectedWindows?: ReadonlyArray<{ startMs: number; endMs: number }>): Promise<boolean> {
  if (!retained.length || !incoming.length || retained.length > MAX_COPY_BYTES || incoming.length > MAX_COPY_BYTES) return false;
  let a: Recording, b: Recording;
  try {
    const { default: FitParser } = await import('fit-file-parser');
    const parser = () => new FitParser({ force: false, strict: true, mode: 'list' });
    [a, b] = await Promise.all([parser().parseAsync(Buffer.from(retained)), parser().parseAsync(Buffer.from(incoming))]) as unknown as [Recording, Recording];
  } catch { return false; }
  const first = a.file_ids?.[0], second = b.file_ids?.[0];
  if (a.file_ids?.length !== 1 || b.file_ids?.length !== 1 || !first || !second
    || first.type !== 'activity' || first.manufacturer !== 'suunto' || typeof first.product !== 'number'
    || !Number.isFinite(time(first.time_created)) || time(first.time_created) !== time(second.time_created)
    || ['type', 'manufacturer', 'product', 'product_name', 'serial_number', 'number'].some(key => first[key] !== second[key])) return false;
  const sessions = a.sessions, next = b.sessions?.[0];
  if (!sessions?.length || sessions.length > 2 || b.sessions?.length !== 1 || !next
    || sessions.some(s => s.sport !== 'hiking' || s.sub_sport !== 'trail')
    || next.sport !== 'hiking' || next.sub_sport !== 'generic') return false;
  if (expectedWindows && (expectedWindows.length !== sessions.length || sessions.some(s =>
    !expectedWindows.some(w => w.startMs === time(s.start_time) && w.endMs === time(s.timestamp))))) return false;
  const start = time(sessions[0].start_time), end = time(sessions[sessions.length - 1].timestamp), incomingEnd = time(next.timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(incomingEnd) || end <= start || time(next.start_time) !== start
    || expectedStart !== undefined && start !== expectedStart
    || end - incomingEnd < 0 || end - incomingEnd > 1000
    || sessions.some((s, i) => i > 0 && time(s.start_time) !== time(sessions[i - 1].timestamp))) return false;
  for (const [field, tolerance] of [['total_timer_time', 1], ['total_distance', 5]] as const) {
    const values = sessions.map(s => s[field]), value = next[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
    // Some Suunto multi-session originals omit distances; exact GPS evidence below is still mandatory.
    if (field === 'total_distance' && values.some(v => v == null)) {
      if (values.some(v => v != null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0))) return false;
      continue;
    }
    if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
      || Math.abs(values.reduce<number>((sum, v) => sum + Number(v), 0) - value) > tolerance) return false;
  }
  const records = a.records, copies = b.records;
  if (!records?.length || !copies?.length || records.length > 100_000 || copies.length > 100_000) return false;
  if ([0, -1].some(index => {
    const x = time(records[index === 0 ? 0 : records.length - 1].timestamp);
    const y = time(copies[index === 0 ? 0 : copies.length - 1].timestamp);
    return !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 1000;
  })) return false;
  const gps = (samples: Fields[]): Map<number, string> | null => {
    const points = new Map<number, string>();
    for (const r of samples) {
      if (r.position_lat == null && r.position_long == null) continue;
      const t = time(r.timestamp), lat = r.position_lat, lon = r.position_long;
      if (!Number.isFinite(t) || t < start || t > end || typeof lat !== 'number' || !Number.isFinite(lat)
        || typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const point = `${lat}:${lon}`;
      if (points.has(t) && points.get(t) !== point) return null;
      points.set(t, point);
    }
    return points;
  };
  const originalGPS = gps(records), incomingGPS = gps(copies);
  return !!originalGPS && !!incomingGPS && incomingGPS.size >= 2
    && new Set(incomingGPS.values()).size >= 2 && incomingGPS.size >= originalGPS.size - 1
    && [...incomingGPS].every(([t, point]) => originalGPS.get(t) === point);
}

/** Called only after Garmin source preparation aborted with an identity conflict, before any source write. */
export async function skipVerifiedProviderFITCopy(queue: GarminAPIActivityQueueItemInterface,
  uid: string, eventID: string, incoming: unknown): Promise<QueueResult.Processed | QueueResult.Failed | null> {
  if (queue.activityFileType !== 'FIT' || !queue.ref || queue.ref.parent.id !== 'garminAPIActivityQueue'
    || queue.firebaseUserID !== uid || !Buffer.isBuffer(incoming) || !incoming.length || incoming.length > MAX_COPY_BYTES) return null;
  const db = admin.firestore(), path = `users/${uid}/events/${eventID}`;
  const refs = [db.doc(path), db.doc(`${path}/metaData/trainingLoad`), ...[
    ServiceNames.SuuntoApp, ServiceNames.GarminAPI, ServiceNames.COROSAPI, ServiceNames.WahooAPI,
  ].map(service => db.doc(`${path}/metaData/${service}`)), db.doc(`users/${uid}/meta/${ServiceNames.GarminAPI}`),
  db.doc(`garminAPITokens/${uid}`)];
  const activities = db.collection(`users/${uid}/activities`).where('eventID', '==', eventID)
    .select('type', 'sourceIdentity', 'startDate', 'endDate').limit(3);
  const [snapshots, children] = await Promise.all([db.getAll(...refs), activities.get()]);
  const [parent, load, suunto, ...others] = snapshots;
  const windows = children.docs.map(s => getActivitySourceWindow(savedActivityIdentity(s)));
  const data = parent.data(), source = data && retainedSourceReferences(data);
  const original = source?.length === 1 ? source[0] : null;
  const bucket = admin.storage().bucket();
  if (!parent.exists || data?.isMerge || data?.benchmarkSourceWritePending || load.data()?.sourceWritePending
    || load.data()?.sourceFirstImport || !isSameProviderRecording(suunto.data(), { ...suunto.data(), serviceName: ServiceNames.SuuntoApp })
    || others.slice(0, 3).some(s => s.exists) || !children.docs.length || children.docs.length > 2 || windows.some(w => !w)
    || children.docs.some(s => (readActivitySourceIdentity(s.data().sourceIdentity, s.id)?.importedType ?? s.data().type) !== 'Hiking')
    || typeof original?.path !== 'string' || !original.path.startsWith(`${path}/`) || !/\.fit$/i.test(original.path)
    || typeof original.generation !== 'string' || !/^\d+$/.test(original.generation)
    || original.bucket && original.bucket !== bucket.name) return null;
  const connection = snapshots[6].data(), root = snapshots[7].data();
  if (connection?.connectionState && connection.connectionState !== 'connected'
    || connection?.providerUserId && connection.providerUserId !== queue.userID
    || Array.isArray(connection?.connectionAccounts) && !connection.connectionAccounts.some(a => a.providerUserId === queue.userID)
    || root?.disconnectState === 'disconnect_pending') return null;
  let retained: Buffer;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of bucket.file(original.path, { generation: original.generation })
      .createReadStream({ start: 0, end: MAX_COPY_BYTES })) {
      size += chunk.length;
      if (size > MAX_COPY_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    retained = Buffer.concat(chunks);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 404) return null;
    throw new Error('Could not read the retained FIT for copy verification.');
  }
  if (!(await isRetainedHikeFITCopy(retained, incoming, time(data?.startDate), windows as Array<{ startMs: number; endMs: number }>))) return null;
  const completion = { resultStatus: 'skipped', skippedReason: 'cross_provider_duplicate', duplicateEventID: eventID };
  const result = await updateQueueItemIfUserActive({
    queueItemDocument: queue.ref, queueItemId: queue.id, userID: uid,
    phase: 'verified_fit_copy', logPrefix: 'ProviderFITCopy', actionDescription: 'verified copy completion', cleanupOnDeletedUser: false,
    updateData: { processed: true, processedAt: Date.now(), ...completion, callbackURL: FieldValue.delete(), token: FieldValue.delete() },
    isCurrent: current => current.processed !== true && current.dateCreated === queue.dateCreated
      && current.firebaseUserID === uid && current.userID === queue.userID && current.activityFileID === queue.activityFileID
      && current.activityFileType === queue.activityFileType && current.callbackURL === queue.callbackURL
      && current.queueRevision === queue.queueRevision && current.startTimeInSeconds === queue.startTimeInSeconds
      && current.token === queue.token && current.userAccessToken === queue.userAccessToken,
    isAuthorizedInTransaction: async (_db, tx) => {
      const [fresh, legs] = await Promise.all([tx.getAll(...refs), tx.get(activities)]);
      const unchanged = (a: admin.firestore.DocumentSnapshot, b: admin.firestore.DocumentSnapshot) => a.exists === b.exists
        && (!a.exists || !!a.updateTime?.isEqual(b.updateTime!));
      return fresh.every((s, i) => unchanged(snapshots[i], s)) && legs.docs.length === children.docs.length
        && children.docs.every(old => legs.docs.some(current => old.id === current.id && unchanged(old, current)));
    },
  });
  if (result === QueueItemUserGuardedUpdateResult.Updated) recordImportCompletion(queue.ref.parent.id, completion);
  return result === QueueItemUserGuardedUpdateResult.NotCurrent ? QueueResult.Failed : QueueResult.Processed;
}
