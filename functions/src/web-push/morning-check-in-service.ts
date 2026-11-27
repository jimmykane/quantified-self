import { removeExpiredDevice } from './device-removal';
import { notificationExpiry } from './retention';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { MORNING_CHECK_IN_CATEGORY, notificationPreferencePath, readNotificationCategoryPreference, type NotificationCategoryPreference } from '../../../shared/notification-categories';
import { isAutomaticPushOrigin, isPushId, isPushRegistration, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { SLEEP_SESSIONS_COLLECTION_ID, SLEEP_SYNC_STATE_COLLECTION_ID } from '../../../shared/sleep';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ActivityPushDependencies } from './activity-service';
import { liveSleepQueue, morningCheckInPayload, morningCheckInWindow, MORNING_CHECK_IN, SLEEP_SERVICE_NAMES, type MorningCheckInCandidate } from './morning-check-in-policy';

export type MorningCheckInDependencies = ActivityPushDependencies;
interface Batch {
  id: string; candidate: MorningCheckInCandidate; connectionGeneration: string; categoryRevision: number;
  timeZone: string; localDate: string; dueAt: number; targets: { id: string; generation: string }[];
}
interface State { sleepDate: string; endMs: number; admittedAt: number; pending?: Batch; dueAt?: number; lastClaimId?: string; }
// Preserve the receipt across sender upgrades, including legacy records with a scheduled deadline.
const statePath = (uid: string) => `users/${uid}/pushState/sleepReady`;
const documentId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 256 && !id.includes('/');
function readState(value: State | undefined): State | undefined {
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value.sleepDate) || !Number.isFinite(value.endMs)
    || !Number.isFinite(value.admittedAt))) throw new Error('Invalid Morning check-in state.');
  return value;
}

function currentWindow(batch: Batch, preference: NotificationCategoryPreference | null, now: number) {
  if (!batch.timeZone || !preference?.enabled || preference.timeZone !== batch.timeZone
    || preference.revision !== batch.categoryRevision || now < batch.dueAt || now >= batch.dueAt + MORNING_CHECK_IN.expiryMs) return null;
  const window = morningCheckInWindow(batch.candidate.endMs, now, batch.timeZone);
  return window?.localDate === batch.localDate ? window : null;
}

async function currentSleep(db: Firestore, tx: Transaction, uid: string, candidate: MorningCheckInCandidate, now: number,
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
    || candidate.endMs > now || candidate.endMs < now - MORNING_CHECK_IN.recentMs) return null;
  return meta.connectionStateGeneration;
}

/** First canonical saves only. A single bounded account receipt suppresses other providers and replays. */
export async function admitMorningCheckIn(uid: string, candidate: MorningCheckInCandidate, queue: SleepSyncQueueItemInterface,
  deps: Pick<MorningCheckInDependencies, 'db' | 'now' | 'configuration'>): Promise<string | undefined> {
  if (![uid, candidate.sessionId, queue.id].every(documentId) || queue.morningCheckInOrigin !== 'live' || !liveSleepQueue(queue)) return;
  const config = await deps.configuration();
  if (!config.enabled) return;
  const { db } = deps; const ref = db.doc(statePath(uid));
  return db.runTransaction(async tx => {
    const now = deps.now();
    if (!Number.isFinite(queue.dateCreated) || queue.dateCreated > now || queue.dateCreated < now - MORNING_CHECK_IN.recentMs
      || !Number.isFinite(candidate.createdAtMs) || candidate.createdAtMs > now || candidate.createdAtMs < now - MORNING_CHECK_IN.expiryMs) return;
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    if (guard.shouldSkip) return;
    const [snapshot, preferenceSnapshot] = await Promise.all([
      tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, MORNING_CHECK_IN_CATEGORY))),
    ]);
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data(), MORNING_CHECK_IN_CATEGORY);
    if (!preference?.enabled || !preference.timeZone) return;
    const window = morningCheckInWindow(candidate.endMs, now, preference.timeZone);
    if (!window) return;
    const state = readState(snapshot.data() as State | undefined);
    // Check the bounded receipt before loading devices or provider/session metadata for duplicate saves.
    if (state && (window.localDate <= state.sleepDate || candidate.startMs <= state.endMs
      || now - state.admittedAt < MORNING_CHECK_IN.cooldownMs)) return;
    const [registrations, source, generation] = await Promise.all([
      tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(MORNING_CHECK_IN.deviceLimit)),
      tx.get(db.doc(`${SLEEP_SYNC_QUEUE_COLLECTION_NAME}/${queue.id}`)), currentSleep(db, tx, uid, candidate, now),
    ]);
    const liveQueue = source.data() as SleepSyncQueueItemInterface | undefined;
    if (!generation || !liveQueue || !liveSleepQueue(liveQueue)
      || liveQueue.morningCheckInOrigin !== 'live' || liveQueue.provider !== candidate.provider
      || liveQueue.providerUserId !== candidate.providerUserId || liveQueue.userID !== undefined && liveQueue.userID !== uid
      || liveQueue.dateCreated !== queue.dateCreated || (liveQueue.queueRevision ?? null) !== (queue.queueRevision ?? null)) return;
    const targets = registrations.docs.filter(doc => isPushId(doc.id) && isPushRegistration(doc.data())
      && doc.data().vapidPublicKey === config.publicKey).map(doc => ({ id: doc.id, generation: doc.data().generation as string }));
    if (!targets.length) return;
    // Slow reads can cross noon. Check before using up the account's daily slot and cooldown.
    const admittedAt = deps.now();
    if (admittedAt - queue.dateCreated > MORNING_CHECK_IN.recentMs
      || admittedAt - candidate.createdAtMs > MORNING_CHECK_IN.expiryMs
      || !morningCheckInWindow(candidate.endMs, admittedAt, preference.timeZone)) return;
    const pending: Batch = { id: randomUUID(), candidate, connectionGeneration: generation,
      categoryRevision: preference.revision, timeZone: preference.timeZone, localDate: window.localDate, dueAt: admittedAt, targets };
    tx.set(ref, { sleepDate: window.localDate, endMs: candidate.endMs, admittedAt, pending, expireAt: notificationExpiry(admittedAt) });
    return pending.id;
  });
}

/** Sends in the import handler after persistence. Claims before transport are never replayed. */
export async function sendMorningCheckIn(uid: string, deps: MorningCheckInDependencies, admittedId?: string): Promise<void> {
  const config = await deps.configuration(); const { db } = deps; const ref = db.doc(statePath(uid));
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [snapshot, preferenceSnapshot] = await Promise.all([
      tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, MORNING_CHECK_IN_CATEGORY))),
    ]);
    const state = readState(snapshot.data() as State | undefined); const batch = state?.pending;
    if (guard.shouldSkip) { if (snapshot.exists) tx.delete(ref); return null; }
    if (!state || !batch || batch.dueAt > now || (admittedId !== undefined && batch.id !== admittedId)) return null;
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data(), MORNING_CHECK_IN_CATEGORY);
    const valid = config.enabled && currentWindow(batch, preference, now)
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
          tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, MORNING_CHECK_IN_CATEGORY))), tx.get(registrationRef),
          currentSleep(db, tx, uid, claim.batch.candidate, deps.now(), claim.batch.connectionGeneration),
        ]);
        const preference = readNotificationCategoryPreference(preferenceSnapshot.data(), MORNING_CHECK_IN_CATEGORY); const registration = registrationSnapshot.data();
        if (guard.shouldSkip || !currentWindow(claim.batch, preference, deps.now())
          || snapshot.data()?.lastClaimId !== claim.batch.id || !generation
          || !isPushRegistration(registration) || !isAutomaticPushOrigin(registration.origin)
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey) return null;
        return registration;
      });
      const now = deps.now();
      const window = morningCheckInWindow(claim.batch.candidate.endMs, now, claim.batch.timeZone);
      const ttlSeconds = Math.min(window?.ttlSeconds ?? 0, Math.floor((claim.batch.dueAt + MORNING_CHECK_IN.expiryMs - now) / 1000));
      if (!ready || ttlSeconds < 1 || attemptedEndpoints.has(ready.endpoint)) { deps.outcome('cancelled'); return; }
      attemptedEndpoints.add(ready.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready, JSON.stringify(morningCheckInPayload(ready.origin)), ttlSeconds); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await removeExpiredDevice(db, uid, target.id, target.generation, MORNING_CHECK_IN_CATEGORY, deps.now());
    }));
    if (results.some(result => result.status === 'rejected')) failed = true;
  }
  if (failed) throw new Error('Morning check-in device processing failed.');
}
