import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isPushId, isPushRegistration, isAutomaticPushOrigin, WEB_PUSH_ORIGINS, type PushRegistration } from '../../../shared/web-push';
import { trainingSyncNotificationPayload } from '../../../shared/training-sync-notifications';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { TRAINING_PUSH, trainingAttention, trainingRecovered, trainingIssuePath, currentTrainingEntry,
  type TrainingCandidate, type TrainingEntry } from './training-policy';

export interface TrainingPushDependencies {
  db: Firestore; now(): number; configuration(): Promise<{ enabled: boolean; publicKey: string }>;
  send(registration: PushRegistration, payload: string): Promise<unknown>;
  outcome(value: 'accepted' | 'expired' | 'failed' | 'cancelled' | 'limited'): void;
}
interface Target { id: string; generation: string; origin: string; }
interface Batch { id: string; dueAt: number; categoryRevision: number; entries: TrainingEntry[]; targets: Target[]; }
interface State { attempts: number[]; pending?: Batch; trainingDueAt?: number; lastClaimId?: string; }
const statePath = (uid: string) => `users/${uid}/pushState/trainingSync`;
function readState(value: State | undefined): State {
  if (!value) return { attempts: [] };
  if (!Array.isArray(value.attempts) || value.attempts.length > TRAINING_PUSH.dailyLimit
    || !value.attempts.every(Number.isFinite) || value.pending && (!Array.isArray(value.pending.entries)
      || value.pending.entries.length > TRAINING_PUSH.batchLimit || !Array.isArray(value.pending.targets)
      || value.pending.targets.length > TRAINING_PUSH.deviceLimit)) throw new Error('Invalid training notification state.');
  return value;
}
function budget(state: State, now: number): boolean {
  state.attempts = state.attempts.filter(at => at > now - TRAINING_PUSH.dayMs);
  return state.attempts.length < TRAINING_PUSH.dailyLimit && !state.attempts.some(at => at > now - TRAINING_PUSH.cooldownMs);
}

/** Observe a status transition independently of provider processing; failures cannot change delivery retries. */
export async function observeTrainingNotification(uid: string, candidate: TrainingCandidate,
  deps: Pick<TrainingPushDependencies, 'db' | 'now' | 'configuration'>): Promise<void> {
  if (!uid || uid.includes('/') || !/^[a-f0-9]{64}$/.test(candidate.id)
    || !Number.isSafeInteger(candidate.observedAt) || candidate.observedAt <= 0 || candidate.observedAt > deps.now()
    || deps.now() - candidate.observedAt > TRAINING_PUSH.dayMs) return;
  const recovered = trainingRecovered(candidate.status);
  if (!recovered && !trainingAttention(candidate.status)) return;
  const config = recovered ? null : await deps.configuration();
  if (!recovered && !config?.enabled) return;
  const { db } = deps, ref = db.doc(statePath(uid));
  await db.runTransaction(async tx => {
    const now = deps.now();
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return;
    if (recovered) {
      const issueRef = db.doc(trainingIssuePath(uid, candidate.id)), issue = await tx.get(issueRef);
      if (!issue.data()?.open) return;
      const status = (await tx.get(db.doc(`users/${uid}/trainingDeliveryStatuses/${candidate.id}`))).data();
      // A delayed success event cannot close a newer unresolved problem.
      if (status?.status === 'delivered' && status.hasRemoteCopy === true && status.differsFromQS === false
        && Number.isSafeInteger(status.lastAcceptedAtMs) && status.lastAcceptedAtMs >= 0 && status.updatedAtMs >= candidate.observedAt
        && status.updatedAtMs >= issue.data()!.observedAt) tx.update(issueRef, { open: false });
      return;
    }
    const [preferenceDoc, stateDoc, entry, registrations] = await Promise.all([
      tx.get(db.doc(notificationPreferencePath(uid, 'training_sync'))), tx.get(ref),
      currentTrainingEntry(db, tx, uid, candidate, now),
      tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(TRAINING_PUSH.deviceLimit)),
    ]);
    const preference = readNotificationCategoryPreference(preferenceDoc.data());
    if (!preference?.enabled || !entry) return;
    const issueRef = db.doc(trainingIssuePath(uid, entry.issueId)), issue = await tx.get(issueRef);
    const state = readState(stateDoc.data() as State | undefined);
    if (issue.data()?.open) {
      // One connection incident can affect many workouts, including newly scheduled ones.
      // Retain alternatives only inside its original pending batch; never start a new batch for that incident.
      const pending = state.pending;
      if (pending && pending.categoryRevision === preference.revision && now <= pending.dueAt + TRAINING_PUSH.batchExpiryMs
        && pending.entries.some(row => row.issueId === entry.issueId && row.episode === issue.data()!.episode)
        && !pending.entries.some(row => row.id === entry.id) && pending.entries.length < TRAINING_PUSH.batchLimit) {
        pending.entries.push({ ...entry, episode: issue.data()!.episode }); tx.set(ref, state);
      }
      return;
    }
    const targets = registrations.docs.flatMap(doc => {
      const registration = doc.data();
      return isPushId(doc.id) && isPushRegistration(registration) && isAutomaticPushOrigin(registration.origin)
        && registration.vapidPublicKey === config!.publicKey
        ? [{ id: doc.id, generation: registration.generation, origin: registration.origin }] : [];
    });
    if (!targets.length) return;
    const episode = randomUUID();
    if (state.pending && (state.pending.categoryRevision !== preference.revision || now > state.pending.dueAt + TRAINING_PUSH.batchExpiryMs)) {
      delete state.pending; delete state.trainingDueAt;
    }
    if (budget(state, now)) {
      if (!state.pending) state.pending = { id: randomUUID(), dueAt: now + TRAINING_PUSH.groupMs,
        categoryRevision: preference.revision, entries: [], targets };
      if (state.pending.entries.length < TRAINING_PUSH.batchLimit) state.pending.entries.push({ ...entry, episode });
      state.trainingDueAt = state.pending.dueAt;
    }
    // Even capped/overflowed problems receive a receipt. They cannot become a later backlog of alerts.
    tx.set(issueRef, { schemaVersion: 1, open: true, episode, observedAt: candidate.observedAt });
    tx.set(ref, state);
  });
}

/** One account-wide durable attempt before I/O, shared by beta and production. */
export async function sendTrainingNotification(uid: string, deps: TrainingPushDependencies): Promise<void> {
  const config = await deps.configuration(), { db } = deps, ref = db.doc(statePath(uid));
  const current = async (tx: FirebaseFirestore.Transaction, entry: TrainingEntry, now: number) => {
    const [issue, source] = await Promise.all([tx.get(db.doc(trainingIssuePath(uid, entry.issueId))), currentTrainingEntry(db, tx, uid, entry, now)]);
    return issue.data()?.open && issue.data()?.episode === entry.episode && source ? entry : null;
  };
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    // The recursive account cleanup owns the state and its receipt descendants. Never recreate or leaf-delete this root.
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return null;
    const [snapshot, pref] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'training_sync')))]);
    const state = readState(snapshot.data() as State | undefined), batch = state.pending;
    if (!batch || batch.dueAt > now) return null;
    const preference = readNotificationCategoryPreference(pref.data());
    const entries = config.enabled && preference?.enabled && preference.revision === batch.categoryRevision
      && now <= batch.dueAt + TRAINING_PUSH.batchExpiryMs
      ? (await Promise.all(batch.entries.map(entry => current(tx, entry, now)))).filter((entry): entry is TrainingEntry => !!entry) : [];
    const outcome = !entries.length ? 'cancelled' as const : !budget(state, now) ? 'limited' as const : null;
    delete state.pending; delete state.trainingDueAt;
    if (!outcome) { state.attempts.push(now); state.lastClaimId = batch.id; }
    tx.set(ref, state);
    return { batch: { ...batch, entries }, outcome };
  });
  if (!claim) return;
  if (claim.outcome) { deps.outcome(claim.outcome); return; }
  const endpoints = new Set<string>(); let failed = false;
  for (let offset = 0; offset < claim.batch.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.batch.targets.slice(offset, offset + 5).map(async target => {
      const registrationRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const now = deps.now();
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return null;
        const [snapshot, pref, registrationDoc, entries] = await Promise.all([
          tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'training_sync'))), tx.get(registrationRef),
          Promise.all(claim.batch.entries.map(entry => current(tx, entry, now))),
        ]);
        const preference = readNotificationCategoryPreference(pref.data()), registration = registrationDoc.data();
        if (!preference?.enabled || preference.revision !== claim.batch.categoryRevision || !entries.some(Boolean)
          || snapshot.data()?.lastClaimId !== claim.batch.id || now > claim.batch.dueAt + TRAINING_PUSH.batchExpiryMs
          || !isPushRegistration(registration) || registration.origin !== target.origin
          || !isAutomaticPushOrigin(registration.origin) || registration.generation !== target.generation
          || registration.vapidPublicKey !== config.publicKey) return null;
        return registration;
      });
      if (!ready || endpoints.has(ready.endpoint)) { deps.outcome('cancelled'); return; }
      endpoints.add(ready.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready, JSON.stringify(trainingSyncNotificationPayload(ready.origin))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, deps.now())).shouldSkip) return;
        const registration = await tx.get(registrationRef);
        // Registrations are leaves; Rules deny descendants. Preserve a replacement generation.
        if (registration.data()?.generation === target.generation) tx.delete(registrationRef);
      });
    }));
    if (results.some(result => result.status === 'rejected')) failed = true;
  }
  if (failed) throw new Error('Training notification device processing failed.');
}
