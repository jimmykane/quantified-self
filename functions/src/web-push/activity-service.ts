import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isPushId, isPushRegistration, WEB_PUSH_ORIGINS, type PushRegistration } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { ACTIVITY_PUSH, activityNotificationPayload, liveActivitySource, timestampMs,
  type ActivityPushCandidate, type ActivityPushEntry } from './activity-policy';

export type ActivityPushOutcome = 'accepted' | 'expired' | 'failed' | 'cancelled' | 'limited';
export interface ActivityPushDependencies {
  db: Firestore; now(): number;
  configuration(): Promise<{ enabled: boolean; publicKey: string }>;
  send(registration: PushRegistration, payload: string): Promise<unknown>;
  outcome(value: ActivityPushOutcome): void;
}
interface Target { id: string; generation: string; }
interface Batch { id: string; dueAt: number; categoryRevision: number; entries: ActivityPushEntry[]; targets: Target[]; }
interface State { attempts: number[]; seen: { id: string; expiresAt: number }[]; pending?: Batch; dueAt?: number; lastClaimId?: string; }
const statePath = (uid: string) => `users/${uid}/pushState/activitySync`;
const documentId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('/');
const currentAttempts = (state: State, now: number) => state.attempts.filter(at => at > now - ACTIVITY_PUSH.dayMs);
const limited = (attempts: number[], now: number) => attempts.length >= ACTIVITY_PUSH.dailyLimit
  || attempts.some(at => at > now - ACTIVITY_PUSH.cooldownMs);

function readState(value: State | undefined): State {
  if (!value) return { attempts: [], seen: [] };
  if (!Array.isArray(value.attempts) || value.attempts.length > ACTIVITY_PUSH.dailyLimit || !value.attempts.every(Number.isFinite)
    || !Array.isArray(value.seen) || value.seen.length > ACTIVITY_PUSH.seenLimit
    || value.seen.some(row => !documentId(row.id) || !Number.isFinite(row.expiresAt))) throw new Error('Invalid activity notification state.');
  return value;
}

async function currentEntry(db: Firestore, tx: Transaction, uid: string, candidate: ActivityPushCandidate, now: number): Promise<ActivityPushEntry | null> {
  const [queue, meta, events] = await Promise.all([
    tx.get(db.doc(`${getServiceWorkoutQueueName(candidate.service)}/${candidate.queueId}`)),
    tx.get(db.doc(`users/${uid}/meta/${candidate.service}`)),
    // Metadata only: no event/activity hydration, metrics, streams or provider file reads.
    tx.getAll(db.doc(`users/${uid}/events/${candidate.eventID}`), { fieldMask: ['startDate', 'endDate'] }),
  ]);
  const event = events[0].data();
  if (!liveActivitySource(uid, candidate, queue.data(), meta.data(), now) || !event
    || timestampMs(event.startDate) !== candidate.startMs || timestampMs(event.endDate) !== candidate.endMs) return null;
  const connectionGeneration = meta.data()!.connectionStateGeneration as string;
  if ('connectionGeneration' in candidate && candidate.connectionGeneration !== connectionGeneration) return null;
  return { ...candidate, connectionGeneration };
}

/** Called only after a confirmed first canonical save. Failure must never retry a successful provider import. */
export async function admitActivityNotification(uid: string, candidate: ActivityPushCandidate,
  deps: Pick<ActivityPushDependencies, 'db' | 'now' | 'configuration'>): Promise<void> {
  if (![uid, candidate.eventID, candidate.queueId].every(documentId)) return;
  const config = await deps.configuration();
  if (!config.enabled) return;
  const { db } = deps; const now = deps.now(); const ref = db.doc(statePath(uid));
  await db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [preferenceSnapshot, stateSnapshot, registrations, entry] = await Promise.all([
      tx.get(db.doc(notificationPreferencePath(uid, 'activity_sync'))), tx.get(ref),
      tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', '==', WEB_PUSH_ORIGINS[0]).limit(ACTIVITY_PUSH.deviceLimit)),
      currentEntry(db, tx, uid, candidate, now),
    ]);
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    if (guard.shouldSkip || !preference?.enabled || !entry) return;
    const targets = registrations.docs.filter(doc => isPushId(doc.id) && isPushRegistration(doc.data())
      && doc.data().vapidPublicKey === config.publicKey).map(doc => ({ id: doc.id, generation: doc.data().generation as string }));
    if (!targets.length) return;
    const state = readState(stateSnapshot.data() as State | undefined);
    state.attempts = currentAttempts(state, now);
    state.seen = state.seen.filter(row => row.expiresAt >= now);
    if (state.seen.some(row => row.id === entry.eventID) || state.seen.length >= ACTIVITY_PUSH.seenLimit) return;
    state.seen.push({ id: entry.eventID, expiresAt: entry.endMs + ACTIVITY_PUSH.recentMs });
    if (state.pending && (state.pending.categoryRevision !== preference.revision || now > state.pending.dueAt + ACTIVITY_PUSH.batchExpiryMs)) {
      delete state.pending; delete state.dueAt;
    }
    if (!limited(state.attempts, now)) {
      if (!state.pending) state.pending = { id: randomUUID(), dueAt: now + ACTIVITY_PUSH.groupMs,
        categoryRevision: preference.revision, entries: [], targets };
      if (state.pending.entries.length < ACTIVITY_PUSH.batchLimit) state.pending.entries.push(entry);
      state.dueAt = state.pending.dueAt;
    }
    tx.set(ref, state);
  });
}

/** Claim and clear before network I/O. Overlapping schedules, retries and lost acknowledgements cannot replay a batch. */
export async function sendActivityNotification(uid: string, deps: ActivityPushDependencies): Promise<void> {
  const config = await deps.configuration();
  const { db } = deps; const ref = db.doc(statePath(uid));
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [snapshot, preferenceSnapshot] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'activity_sync')))]);
    const state = readState(snapshot.data() as State | undefined); const batch = state.pending;
    if (guard.shouldSkip) { if (snapshot.exists) tx.delete(ref); return null; }
    if (!batch || batch.dueAt > now) return null;
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    const entries = config.enabled && preference?.enabled && preference.revision === batch.categoryRevision
      && now <= batch.dueAt + ACTIVITY_PUSH.batchExpiryMs
      ? (await Promise.all(batch.entries.map(entry => currentEntry(db, tx, uid, entry, now)))).filter((entry): entry is ActivityPushEntry => !!entry) : [];
    state.attempts = currentAttempts(state, now);
    const outcome: ActivityPushOutcome | null = !entries.length ? 'cancelled' : limited(state.attempts, now) ? 'limited' : null;
    delete state.pending; delete state.dueAt;
    if (!outcome) { state.attempts.push(now); state.lastClaimId = batch.id; }
    tx.set(ref, state);
    return { batch: { ...batch, entries }, outcome };
  });
  if (!claim) return;
  if (claim.outcome) { deps.outcome(claim.outcome); return; }
  // Bounded device fan-out. A newer registration never inherits a previously queued batch.
  for (let offset = 0; offset < claim.batch.targets.length; offset += 5) {
    await Promise.all(claim.batch.targets.slice(offset, offset + 5).map(async target => {
      const registrationRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now());
        const [snapshot, preferenceSnapshot, registrationSnapshot, entries] = await Promise.all([
          tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'activity_sync'))), tx.get(registrationRef),
          Promise.all(claim.batch.entries.map(entry => currentEntry(db, tx, uid, entry, deps.now()))),
        ]);
        const preference = readNotificationCategoryPreference(preferenceSnapshot.data()); const registration = registrationSnapshot.data();
        const liveEntries = entries.filter((entry): entry is ActivityPushEntry => !!entry);
        if (guard.shouldSkip || !preference?.enabled || preference.revision !== claim.batch.categoryRevision
          || snapshot.data()?.lastClaimId !== claim.batch.id || !liveEntries.length
          || !isPushRegistration(registration) || registration.origin !== WEB_PUSH_ORIGINS[0]
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey) return null;
        return { registration, entries: liveEntries };
      });
      if (!ready) { deps.outcome('cancelled'); return; }
      let outcome: ActivityPushOutcome;
      try { await deps.send(ready.registration, JSON.stringify(activityNotificationPayload(ready.registration.origin, uid, ready.entries))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await db.runTransaction(async tx => {
        const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now());
        const registration = await tx.get(registrationRef);
        if (!guard.shouldSkip && registration.data()?.generation === target.generation) tx.delete(registrationRef);
      });
    }));
  }
}
