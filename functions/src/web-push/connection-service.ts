import { removeExpiredDevice } from './device-removal';
import { notificationExpiry } from './retention';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isPushId, isPushRegistration, isAutomaticPushOrigin, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ActivityPushDependencies } from './activity-service';
import { connectionIncident, connectionNotificationPayload, connectionStatePath, CONNECTION_PUSH, isConnectionService,
  type ConnectionIncident, type ConnectionReceipt, type ConnectionService } from './connection-policy';

export type ConnectionPushDependencies = ActivityPushDependencies;
interface Target { id: string; generation: string; origin: string; }
interface Batch { id: string; dueAt: number; categoryRevision: number; entries: ConnectionIncident[]; targets: Target[]; }
interface State { attempts: number[]; incidents: Partial<Record<ConnectionService, ConnectionReceipt>>;
  pending?: Batch; dueAt?: number; lastClaimId?: string; }
function readState(value: Partial<State> | undefined): State {
  const state = { attempts: [], incidents: {}, ...value } as State;
  if (!Array.isArray(state.attempts) || state.attempts.length > CONNECTION_PUSH.dailyLimit || !state.attempts.every(Number.isFinite)
    || !state.incidents || typeof state.incidents !== 'object' || Object.entries(state.incidents).some(([key, receipt]) =>
      !isConnectionService(key) || !receipt || !isPushId(receipt.id) || !Number.isSafeInteger(receipt.observedAt)
      || !['connection', 'training'].includes(receipt.owner))
    || state.pending && (!Array.isArray(state.pending.entries) || state.pending.entries.length > 4
      || !Array.isArray(state.pending.targets) || state.pending.targets.length > CONNECTION_PUSH.deviceLimit)) {
    throw new Error('Invalid connection notification state.');
  }
  return state;
}
function budget(state: State, now: number) {
  state.attempts = state.attempts.filter(at => at > now - CONNECTION_PUSH.dayMs);
  return state.attempts.length < CONNECTION_PUSH.dailyLimit && !state.attempts.some(at => at > now - CONNECTION_PUSH.cooldownMs);
}
async function currentIncident(db: Firestore, tx: Transaction, uid: string, expected: ConnectionIncident, now: number) {
  const live = connectionIncident(expected.service, (await tx.get(db.doc(`users/${uid}/meta/${expected.service}`))).data());
  return live && live.id === expected.id && live.observedAt === expected.observedAt && live.providerUserId === expected.providerUserId
    && live.observedAt <= now && now - live.observedAt <= CONNECTION_PUSH.dayMs ? live : null;
}

/** Called only for a new committed reconnect episode. A shared receipt lets Training win the same race. */
export async function admitConnectionNotification(uid: string, incident: ConnectionIncident,
  deps: Pick<ConnectionPushDependencies, 'db' | 'now' | 'configuration'>): Promise<void> {
  if (!uid || uid.includes('/') || !isConnectionService(incident.service) || !isPushId(incident.id)) return;
  const config = await deps.configuration(); if (!config.enabled) return;
  const { db } = deps, now = deps.now(), ref = db.doc(connectionStatePath(uid));
  if (!Number.isSafeInteger(incident.observedAt) || incident.observedAt > now || now - incident.observedAt > CONNECTION_PUSH.expiryMs) return;
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return;
    const [snapshot, pref] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'connection_attention')))]);
    const preference = readNotificationCategoryPreference(pref.data()); if (!preference?.enabled) return;
    const state = readState(snapshot.data() as Partial<State> | undefined), previous = state.incidents[incident.service];
    if (previous && (previous.id === incident.id || previous.observedAt > incident.observedAt)) return;
    const [live, registrations] = await Promise.all([
      currentIncident(db, tx, uid, incident, now),
      tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(CONNECTION_PUSH.deviceLimit)),
    ]);
    if (!live) return;
    const targets = registrations.docs.flatMap(doc => {
      const registration = doc.data();
      return isPushId(doc.id) && isPushRegistration(registration) && isAutomaticPushOrigin(registration.origin)
        && registration.vapidPublicKey === config.publicKey ? [{ id: doc.id, generation: registration.generation, origin: registration.origin }] : [];
    });
    if (!targets.length) return;
    if (state.pending && (state.pending.categoryRevision !== preference.revision || now > state.pending.dueAt + CONNECTION_PUSH.expiryMs)) {
      delete state.pending; delete state.dueAt;
    }
    if (budget(state, now)) {
      if (!state.pending) state.pending = { id: randomUUID(), dueAt: now + CONNECTION_PUSH.groupMs,
        categoryRevision: preference.revision, entries: [], targets };
      state.pending.entries = state.pending.entries.filter(entry => entry.service !== incident.service);
      state.pending.entries.push(live); state.dueAt = state.pending.dueAt;
    }
    // Capped/cancelled incidents cannot become a later backlog or a duplicate Training warning.
    state.incidents[incident.service] = { id: live.id, observedAt: live.observedAt, owner: 'connection' };
    tx.set(ref, { ...state, expireAt: notificationExpiry(deps.now()) });
  });
}

export async function sendConnectionNotification(uid: string, deps: ConnectionPushDependencies): Promise<void> {
  const config = await deps.configuration(), { db } = deps, ref = db.doc(connectionStatePath(uid));
  const entries = async (tx: Transaction, state: State, batch: Batch, now: number) => (
    await Promise.all(batch.entries.map(async expected => {
      const receipt = state.incidents[expected.service];
      if (receipt?.id !== expected.id || receipt.owner !== 'connection') return null;
      return currentIncident(db, tx, uid, expected, now);
    }))
  ).filter((entry): entry is ConnectionIncident => !!entry);
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) {
      const snapshot = await tx.get(ref);
      // This shared receipt is a leaf. Dropping orphaned due work cannot leave descendants behind.
      if (snapshot.exists) tx.delete(ref);
      return null;
    }
    const [snapshot, pref] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'connection_attention')))]);
    const state = readState(snapshot.data() as Partial<State> | undefined), batch = state.pending;
    if (!batch || batch.dueAt > now) return null;
    const preference = readNotificationCategoryPreference(pref.data());
    const live = config.enabled && preference?.enabled && preference.revision === batch.categoryRevision && now <= batch.dueAt + CONNECTION_PUSH.expiryMs
      ? await entries(tx, state, batch, now) : [];
    const outcome = !live.length ? 'cancelled' as const : !budget(state, now) ? 'limited' as const : null;
    delete state.pending; delete state.dueAt;
    if (!outcome) { state.attempts.push(now); state.lastClaimId = batch.id; }
    tx.set(ref, { ...state, expireAt: notificationExpiry(deps.now()) }); return { batch: { ...batch, entries: live }, outcome };
  });
  if (!claim) return;
  if (claim.outcome) { deps.outcome(claim.outcome); return; }
  const endpoints = new Set<string>(); let failed = false;
  for (let offset = 0; offset < claim.batch.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.batch.targets.slice(offset, offset + 5).map(async target => {
      const registrationRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const now = deps.now(); if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return null;
        const [snapshot, pref, device] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'connection_attention'))), tx.get(registrationRef)]);
        const state = readState(snapshot.data() as Partial<State> | undefined), preference = readNotificationCategoryPreference(pref.data()), registration = device.data();
        if (state.lastClaimId !== claim.batch.id || !preference?.enabled || preference.revision !== claim.batch.categoryRevision
          || now > claim.batch.dueAt + CONNECTION_PUSH.expiryMs || !isPushRegistration(registration) || registration.origin !== target.origin
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey || !isAutomaticPushOrigin(registration.origin)) return null;
        const live = await entries(tx, state, claim.batch, now); return live.length ? { registration, live } : null;
      });
      if (!ready || endpoints.has(ready.registration.endpoint)) { deps.outcome('cancelled'); return; }
      endpoints.add(ready.registration.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready.registration, JSON.stringify(connectionNotificationPayload(ready.registration.origin, ready.live.map(entry => entry.service)))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await removeExpiredDevice(db, uid, target.id, target.generation, 'connection_attention', deps.now());
    }));
    if (results.some(result => result.status === 'rejected')) failed = true;
  }
  if (failed) throw new Error('Connection notification device processing failed.');
}
