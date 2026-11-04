import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isPushId, isPushRegistration, isAutomaticPushOrigin, WEB_PUSH_ORIGINS, type PushRegistration } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';

import { DELIVERY_PUSH, currentDeliveryEntry, type DeliveryCandidate, type DeliveryEntry } from './delivery-policy';
import { deliveryNotificationPayload } from '../../../shared/activity-delivery-notifications';

export type DeliveryPushOutcome = 'accepted' | 'expired' | 'failed' | 'cancelled' | 'limited';
export interface DeliveryPushDependencies {
  db: Firestore; now(): number;
  configuration(): Promise<{ enabled: boolean; publicKey: string }>;
  send(registration: PushRegistration, payload: string): Promise<unknown>;
  outcome(value: DeliveryPushOutcome): void;
}
interface Target { id: string; generation: string; }
interface Batch { id: string; deliveryDueAt: number; categoryRevision: number; entries: DeliveryEntry[]; targets: Target[]; }
interface State { attempts: number[]; seen: { id: string; expiresAt: number }[]; pending?: Batch; deliveryDueAt?: number; lastClaimId?: string; }
const statePath = (uid: string) => `users/${uid}/pushState/activityDelivery`;
const documentId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('/');
const currentAttempts = (state: State, now: number) => state.attempts.filter(at => at > now - DELIVERY_PUSH.dayMs);
const limited = (attempts: number[], now: number) => attempts.length >= DELIVERY_PUSH.dailyLimit
  || attempts.some(at => at > now - DELIVERY_PUSH.cooldownMs);

function readState(value: State | undefined): State {
  if (!value) return { attempts: [], seen: [] };
  if (!Array.isArray(value.attempts) || value.attempts.length > DELIVERY_PUSH.dailyLimit || !value.attempts.every(Number.isFinite)
    || !Array.isArray(value.seen) || value.seen.length > DELIVERY_PUSH.seenLimit
    || value.seen.some(row => !documentId(row.id) || !Number.isFinite(row.expiresAt))) throw new Error('Invalid activity delivery notification state.');
  return value;
}

/** Enqueue only a committed batch result or automatic dead letter; provider transport is untouched. */
export async function admitDeliveryNotification(uid: string, candidate: DeliveryCandidate,
  deps: Pick<DeliveryPushDependencies, 'db' | 'now' | 'configuration'>): Promise<void> {
  if (![uid, candidate.id].every(documentId)) return;
  const config = await deps.configuration();
  if (!config.enabled) return;
  const { db } = deps; const now = deps.now(); const ref = db.doc(statePath(uid));
  await db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [preferenceSnapshot, stateSnapshot, entry] = await Promise.all([
      tx.get(db.doc(notificationPreferencePath(uid, 'activity_delivery'))), tx.get(ref),
      currentDeliveryEntry(db, tx, uid, candidate, now),
    ]);
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    if (guard.shouldSkip || !preference?.enabled || !entry) return;
    // An explicitly chosen device must not be hidden behind the automatic fan-out limit.
    const registrations = entry.target
      ? [await tx.get(db.doc(`users/${uid}/pushSubscriptions/${entry.target.installationId}`))]
      : (await tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(DELIVERY_PUSH.deviceLimit))).docs;
    const targets = registrations.flatMap(doc => {
      const registration = doc.data();
      if (!isPushId(doc.id) || !isPushRegistration(registration)
        || !isAutomaticPushOrigin(registration.origin) || registration.vapidPublicKey !== config.publicKey
        || entry.target && (entry.target.installationId !== doc.id || entry.target.generation !== registration.generation
          || entry.target.origin !== registration.origin)) return [];
      return [{ id: doc.id, generation: registration.generation }];
    });
    if (!targets.length || entry.categoryRevision !== undefined && entry.categoryRevision !== preference.revision) return;
    const state = readState(stateSnapshot.data() as State | undefined);
    state.attempts = currentAttempts(state, now);
    state.seen = state.seen.filter(row => row.expiresAt >= now);
    if (state.seen.some(row => row.id === `${entry.kind}:${entry.id}`) || state.seen.length >= DELIVERY_PUSH.seenLimit) return;
    // Manual batch retries keep one receipt for the result-retention window. Automatic failures
    // cease eligibility after one day, so keeping every failed file for a month would crowd out new results.
    state.seen.push({ id: `${entry.kind}:${entry.id}`, expiresAt: entry.kind === 'manual'
      ? now + DELIVERY_PUSH.receiptMs : entry.completedAt + DELIVERY_PUSH.dayMs });
    if (state.pending && (state.pending.categoryRevision !== preference.revision || now > state.pending.deliveryDueAt + DELIVERY_PUSH.batchExpiryMs)) {
      delete state.pending; delete state.deliveryDueAt;
    }
    if (!limited(state.attempts, now)) {
      if (!state.pending) state.pending = { id: randomUUID(), deliveryDueAt: now + DELIVERY_PUSH.groupMs,
        categoryRevision: preference.revision, entries: [], targets: [] };
      if (state.pending.entries.length < DELIVERY_PUSH.batchLimit) {
        const acceptedTargets = targets.filter(target => {
          if (state.pending!.targets.some(saved => saved.id === target.id && saved.generation === target.generation)) return true;
          if (state.pending!.targets.length >= DELIVERY_PUSH.deviceLimit) return false;
          state.pending!.targets.push(target); return true;
        });
        if (acceptedTargets.length) state.pending.entries.push({ ...entry, targets: acceptedTargets });
      }
      state.deliveryDueAt = state.pending.deliveryDueAt;
    }
    tx.set(ref, state);
  });
}

/** Claim and clear before network I/O. Overlapping schedules, retries and lost acknowledgements cannot replay a batch. */
export async function sendDeliveryNotification(uid: string, deps: DeliveryPushDependencies): Promise<void> {
  const config = await deps.configuration();
  const { db } = deps; const ref = db.doc(statePath(uid));
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, now);
    const [snapshot, preferenceSnapshot] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'activity_delivery')))]);
    const state = readState(snapshot.data() as State | undefined); const batch = state.pending;
    // This server-owned state is a leaf by design; Rules deny all client writes, including descendants.
    if (guard.shouldSkip) { if (snapshot.exists) tx.delete(ref); return null; }
    if (!batch || batch.deliveryDueAt > now) return null;
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    const entries = config.enabled && preference?.enabled && preference.revision === batch.categoryRevision
      && now <= batch.deliveryDueAt + DELIVERY_PUSH.batchExpiryMs
      ? (await Promise.all(batch.entries.map(entry => currentDeliveryEntry(db, tx, uid, entry, now)))).filter((entry): entry is DeliveryEntry => !!entry) : [];
    state.attempts = currentAttempts(state, now);
    const outcome: DeliveryPushOutcome | null = !entries.length ? 'cancelled' : limited(state.attempts, now) ? 'limited' : null;
    delete state.pending; delete state.deliveryDueAt;
    if (!outcome) { state.attempts.push(now); state.lastClaimId = batch.id; }
    tx.set(ref, state);
    return { batch: { ...batch, entries }, outcome };
  });
  if (!claim) return;
  if (claim.outcome) { deps.outcome(claim.outcome); return; }
  // Bounded device fan-out. A newer registration never inherits a previously queued batch.
  const attemptedEndpoints = new Set<string>();
  let failed = false;
  for (let offset = 0; offset < claim.batch.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.batch.targets.slice(offset, offset + 5).map(async target => {
      const registrationRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now());
        const [snapshot, preferenceSnapshot, registrationSnapshot, entries] = await Promise.all([
          tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'activity_delivery'))), tx.get(registrationRef),
          Promise.all(claim.batch.entries.map(entry => currentDeliveryEntry(db, tx, uid, entry, deps.now()))),
        ]);
        const preference = readNotificationCategoryPreference(preferenceSnapshot.data()); const registration = registrationSnapshot.data();
        const liveEntries = entries.filter((entry): entry is DeliveryEntry => !!entry
          && (!entry.target || entry.target.origin === registration?.origin)
          && entry.targets.some(saved => saved.id === target.id && saved.generation === target.generation));
        if (guard.shouldSkip || !preference?.enabled || preference.revision !== claim.batch.categoryRevision
          || snapshot.data()?.lastClaimId !== claim.batch.id || !liveEntries.length
          || !isPushRegistration(registration) || !isAutomaticPushOrigin(registration.origin)
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey) return null;
        return { registration, entries: liveEntries };
      });
      if (!ready || attemptedEndpoints.has(ready.registration.endpoint)) { deps.outcome('cancelled'); return; }
      // Multiple installation records can share a browser subscription. Reserve its endpoint before
      // awaiting transport, including ambiguous failures, so aliases cannot duplicate this batch.
      attemptedEndpoints.add(ready.registration.endpoint);
      let outcome: DeliveryPushOutcome;
      try { await deps.send(ready.registration, JSON.stringify(deliveryNotificationPayload(ready.registration.origin,
        ready.entries.length === 1 ? ready.entries[0].path : ready.entries.some(entry => entry.kind === 'automatic') ? '/services' : '/send-activities',
        ready.entries.some(entry => entry.attention)))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await db.runTransaction(async tx => {
        const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now());
        const registration = await tx.get(registrationRef);
        // Registration records are leaves; Rules prohibit descendants.
        if (!guard.shouldSkip && registration.data()?.generation === target.generation) tx.delete(registrationRef);
      });
    }));
    if (results.some(result => result.status === 'rejected')) failed = true;
  }
  // Preparation or expired-registration cleanup must not strand other devices or leave sends unawaited.
  // Preserve sweep failure monitoring without exposing the underlying database error or replaying the claim.
  if (failed) throw new Error('Activity delivery notification device processing failed.');
}
