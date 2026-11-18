import { removeExpiredDevice } from './device-removal';
import { notificationExpiry } from './retention';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isAutomaticPushOrigin, isPushId, isPushRegistration, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { SLEEP_SESSIONS_COLLECTION_ID, SLEEP_SYNC_STATE_COLLECTION_ID } from '../../../shared/sleep';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ActivityPushDependencies } from './activity-service';
import { liveSleepQueue, sleepNotificationPayload, SLEEP_PUSH, SLEEP_SERVICE_NAMES, type SleepPushCandidate } from './sleep-policy';

export type SleepPushDependencies = ActivityPushDependencies;
interface Batch {
  id: string; candidate: SleepPushCandidate; connectionGeneration: string; categoryRevision: number;
  dueAt: number; targets: { id: string; generation: string }[];
}
interface State { sleepDate: string; endMs: number; admittedAt: number; pending?: Batch; dueAt?: number; lastClaimId?: string; }
const statePath = (uid: string) => `users/${uid}/pushState/sleepReady`;
const documentId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 256 && !id.includes('/');
function readState(value: State | undefined): State | undefined {
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value.sleepDate) || !Number.isFinite(value.endMs)
    || !Number.isFinite(value.admittedAt))) throw new Error('Invalid sleep notification state.');
  return value;
}

async function currentSleep(db: Firestore, tx: Transaction, uid: string, candidate: SleepPushCandidate, now: number,
  expectedGeneration?: string): Promise<string | null> {
  const [metaSnapshot, sessions] = await Promise.all([
    tx.get(db.doc(`users/${uid}/meta/${SLEEP_SERVICE_NAMES[candidate.provider]}`)),
    // No overnight samples, stages, scores or other health metrics are needed to send an alert.
    tx.getAll(db.doc(`users/${uid}/${SLEEP_SESSIONS_COLLECTION_ID}/${candidate.sessionId}`),
      db.doc(`users/${uid}/${SLEEP_SYNC_STATE_COLLECTION_ID}/${candidate.provider}`), {
      fieldMask: ['startTimeMs', 'endTimeMs', 'isNap', 'createdAtMs', 'source.provider', 'source.providerUserId', 'lastBackfillEndMs'],
    }),
  ]);
  const meta = metaSnapshot.data(); const session = sessions[0].data();
  const connectedAt = meta?.activityNotificationConnectedAtMs ?? 0, historyEnd = meta?.connectionHistoryImport?.endMs ?? 0;
  // Direct Garmin backfills return through ordinary webhooks without a history-run queue marker.
  // The existing Sleep state is claimed before those provider requests and fences delayed callbacks too.
  const backfillEnd = sessions[1].data()?.lastBackfillEndMs ?? 0;
  if (!meta || meta.connectionState !== 'connected' || typeof meta.connectionStateGeneration !== 'string'
    || !meta.connectionStateGeneration || expectedGeneration !== undefined && meta.connectionStateGeneration !== expectedGeneration
    || meta.providerUserId !== candidate.providerUserId || meta.connectionHistoryImport?.active === true
    || ![connectedAt, historyEnd, backfillEnd].every(Number.isFinite) || candidate.startMs <= Math.max(connectedAt, historyEnd, backfillEnd)
    || !session || session.isNap !== false || session.source?.provider !== candidate.provider
    || session.source?.providerUserId !== candidate.providerUserId || session.startTimeMs !== candidate.startMs
    || session.endTimeMs !== candidate.endMs || session.createdAtMs !== candidate.createdAtMs
    || candidate.endMs > now || candidate.endMs < now - SLEEP_PUSH.recentMs) return null;
  return meta.connectionStateGeneration;
}

/** First canonical saves only. A single bounded account receipt suppresses other providers and replays. */
export async function admitSleepNotification(uid: string, candidate: SleepPushCandidate, queue: SleepSyncQueueItemInterface,
  deps: Pick<SleepPushDependencies, 'db' | 'now' | 'configuration'>): Promise<string | undefined> {
  if (![uid, candidate.sessionId, queue.id].every(documentId) || queue.sleepNotificationOrigin !== 'live' || !liveSleepQueue(queue)) return;
  const config = await deps.configuration();
  if (!config.enabled) return;
  const { db } = deps; const now = deps.now(); const ref = db.doc(statePath(uid));
  if (!Number.isFinite(queue.dateCreated) || queue.dateCreated > now || queue.dateCreated < now - SLEEP_PUSH.recentMs
    || !Number.isFinite(candidate.createdAtMs) || candidate.createdAtMs > now || candidate.createdAtMs < now - SLEEP_PUSH.expiryMs) return;
  return db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    if (guard.shouldSkip) return;
    const [snapshot, preferenceSnapshot] = await Promise.all([
      tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'sleep_sync'))),
    ]);
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    if (!preference?.enabled) return;
    const state = readState(snapshot.data() as State | undefined);
    // Check the bounded receipt before loading devices or provider/session metadata for duplicate saves.
    if (state && (candidate.sleepDate <= state.sleepDate || candidate.startMs <= state.endMs
      || now - state.admittedAt < SLEEP_PUSH.cooldownMs)) return;
    const [registrations, source, generation] = await Promise.all([
      tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(SLEEP_PUSH.deviceLimit)),
      tx.get(db.doc(`${SLEEP_SYNC_QUEUE_COLLECTION_NAME}/${queue.id}`)), currentSleep(db, tx, uid, candidate, now),
    ]);
    const liveQueue = source.data() as SleepSyncQueueItemInterface | undefined;
    if (!generation || !liveQueue || !liveSleepQueue(liveQueue)
      || liveQueue.sleepNotificationOrigin !== 'live' || liveQueue.provider !== candidate.provider
      || liveQueue.providerUserId !== candidate.providerUserId || liveQueue.userID !== undefined && liveQueue.userID !== uid
      || liveQueue.dateCreated !== queue.dateCreated || (liveQueue.queueRevision ?? null) !== (queue.queueRevision ?? null)) return;
    const targets = registrations.docs.filter(doc => isPushId(doc.id) && isPushRegistration(doc.data())
      && doc.data().vapidPublicKey === config.publicKey).map(doc => ({ id: doc.id, generation: doc.data().generation as string }));
    if (!targets.length) return;
    const pending: Batch = { id: randomUUID(), candidate, connectionGeneration: generation,
      categoryRevision: preference.revision, dueAt: now, targets };
    tx.set(ref, { sleepDate: candidate.sleepDate, endMs: candidate.endMs, admittedAt: now, pending, expireAt: notificationExpiry(now) });
    return pending.id;
  });
}

/** Sends in the import handler after persistence. Claims before transport are never replayed. */
export async function sendSleepNotification(uid: string, deps: SleepPushDependencies, admittedId?: string): Promise<void> {
  const config = await deps.configuration(); const { db } = deps; const ref = db.doc(statePath(uid));
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [snapshot, preferenceSnapshot] = await Promise.all([
      tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'sleep_sync'))),
    ]);
    const state = readState(snapshot.data() as State | undefined); const batch = state?.pending;
    if (guard.shouldSkip) { if (snapshot.exists) tx.delete(ref); return null; }
    if (!state || !batch || batch.dueAt > now || (admittedId !== undefined && batch.id !== admittedId)) return null;
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    const valid = config.enabled && preference?.enabled && preference.revision === batch.categoryRevision
      && now <= batch.dueAt + SLEEP_PUSH.expiryMs
      && await currentSleep(db, tx, uid, batch.candidate, now, batch.connectionGeneration);
    delete state.pending; delete state.dueAt;
    if (valid) state.lastClaimId = batch.id;
    tx.set(ref, { ...state, expireAt: notificationExpiry(deps.now()) });
    return { batch, valid: !!valid };
  });
  if (!claim) return;
  if (!claim.valid) { deps.outcome('cancelled'); return; }
  const attemptedEndpoints = new Set<string>(); let failed = false;
  for (let offset = 0; offset < claim.batch.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.batch.targets.slice(offset, offset + 5).map(async target => {
      const registrationRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now());
        const [snapshot, preferenceSnapshot, registrationSnapshot, generation] = await Promise.all([
          tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'sleep_sync'))), tx.get(registrationRef),
          currentSleep(db, tx, uid, claim.batch.candidate, deps.now(), claim.batch.connectionGeneration),
        ]);
        const preference = readNotificationCategoryPreference(preferenceSnapshot.data()); const registration = registrationSnapshot.data();
        if (guard.shouldSkip || !preference?.enabled || preference.revision !== claim.batch.categoryRevision
          || snapshot.data()?.lastClaimId !== claim.batch.id || !generation || deps.now() > claim.batch.dueAt + SLEEP_PUSH.expiryMs
          || !isPushRegistration(registration) || !isAutomaticPushOrigin(registration.origin)
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey) return null;
        return registration;
      });
      if (!ready || attemptedEndpoints.has(ready.endpoint)) { deps.outcome('cancelled'); return; }
      attemptedEndpoints.add(ready.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready, JSON.stringify(sleepNotificationPayload(ready.origin))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await removeExpiredDevice(db, uid, target.id, target.generation, 'sleep_sync', deps.now());
    }));
    if (results.some(result => result.status === 'rejected')) failed = true;
  }
  if (failed) throw new Error('Sleep notification device processing failed.');
}
