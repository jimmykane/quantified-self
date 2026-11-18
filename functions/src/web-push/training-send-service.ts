import { removeExpiredDevice } from './device-removal';
import { createHash, randomUUID } from 'node:crypto';
import { trainingResultExpiry } from './retention';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { deliverySettingsId, parseTrainingDeliveryStatusV1 } from '../../../shared/training-provider-delivery';
import { isAutomaticPushOrigin, isPushId, isPushRegistration } from '../../../shared/web-push';
import { TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID } from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ActivityPushDependencies } from './activity-service';
import { TRAINING_SEND, TRAINING_SEND_SERVICES, trainingSendId, trainingSendPayload, trainingSendTerminal,
  type TrainingSendMember, type TrainingSendState } from './training-send-policy';

const refFor = (db: Firestore, uid: string, id: string) => db.doc(`users/${uid}/pushState/${id}`);
const headers = ['schemaVersion', 'requestId', 'scope', 'scopeId', 'provider', 'settingsRevision', 'destinationKey',
  'connectionEpoch', 'categoryRevision', 'createdAt', 'remaining', 'sent', 'failed', 'unchanged', 'total', 'planId', 'finished', 'dueAt', 'readyAt'];
const ledgerFields = ['status', 'settingsRevision', 'destinationKey', 'connectionEpoch', 'contentDigest', 'acceptedContentDigest',
  'actual.ids', 'verification.missing', 'verification.state', 'lastAcceptedAtMs', 'updatedAtMs'];
function valid(state: TrainingSendState | undefined): state is TrainingSendState {
  return !!state && state.schemaVersion === 1 && ['plan', 'workout'].includes(state.scope)
    && Object.prototype.hasOwnProperty.call(TRAINING_SEND_SERVICES, state.provider)
    && /^[a-zA-Z0-9_-]{1,128}$/.test(state.scopeId) && /^[a-zA-Z0-9_-]{1,128}$/.test(state.requestId)
    && (state.planId === null || typeof state.planId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(state.planId))
    && Number.isSafeInteger(state.settingsRevision) && state.settingsRevision > 0
    && Number.isSafeInteger(state.connectionEpoch) && state.connectionEpoch >= 0
    && Number.isSafeInteger(state.categoryRevision) && state.categoryRevision >= 0
    && /^[a-f0-9]{64}$/.test(state.destinationKey)
    && Number.isSafeInteger(state.createdAt) && state.createdAt >= 0 && [state.total, state.remaining, state.sent, state.failed, state.unchanged]
      .every(value => Number.isSafeInteger(value) && value >= 0 && value <= TRAINING_SEND.memberLimit)
    && state.total > 0 && state.remaining + state.sent + state.failed + state.unchanged === state.total;
}
async function authority(db: Firestore, tx: Transaction, uid: string, state: TrainingSendState) {
  const root = `users/${uid}`, id = deliverySettingsId(state.scope, state.scopeId, state.provider);
  const [settingDoc, epochDoc, metaDoc, planDoc, planSettingDoc, scheduleDoc, locks, scopeDoc] = await Promise.all([
    tx.get(db.doc(`${root}/trainingDeliverySettings/${id}`)), tx.get(db.doc(`${root}/trainingDeliveryState/current`)),
    tx.get(db.doc(`${root}/meta/${TRAINING_SEND_SERVICES[state.provider]}`)),
    state.planId ? tx.get(db.doc(`${root}/trainingPlans/${state.planId}`)) : null,
    state.planId && state.scope === 'workout' ? tx.get(db.doc(`${root}/trainingDeliverySettings/${deliverySettingsId('plan', state.planId, state.provider)}`)) : null,
    tx.get(db.doc(`${root}/trainingPlanState/current`)),
    tx.get(db.doc(`${root}/trainingPlanState/current`).collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID).limit(1)),
    state.scope === 'workout' ? tx.get(db.doc(`${root}/trainingDeliveryScopes/${state.scopeId}`)) : null,
  ]);
  const setting = settingDoc.data(), meta = metaDoc.data(), parent = planSettingDoc?.data();
  const enabled = state.scope === 'workout' && state.planId ? parent?.enabled && !parent.suppressed
    && parent.revision <= state.settingsRevision && parent.destinationKey === state.destinationKey
    && parent.connectionEpoch === state.connectionEpoch : setting?.enabled;
  if (!locks.empty || !scheduleDoc.exists || !Number.isSafeInteger(scheduleDoc.get('revision')) || !epochDoc.exists
    || !setting || setting.revision !== state.settingsRevision || setting.suppressed || !enabled
    || setting.destinationKey !== state.destinationKey || setting.connectionEpoch !== state.connectionEpoch
    || (epochDoc.data()?.connectionEpochs?.[state.provider] ?? 0) !== state.connectionEpoch
    || state.scope === 'workout' && (setting.associationPlanId !== state.planId || setting.scopeGeneration !== (scopeDoc?.get('generation') ?? 0))
    || state.planId && planDoc?.data()?.lifecycle !== 'active'
    || !meta || !['connected', 'reconnect_required'].includes(meta.connectionState) || typeof meta.providerUserId !== 'string'
    || !Number.isSafeInteger(meta.activityNotificationConnectedAtMs ?? 0)
    || (meta.activityNotificationConnectedAtMs ?? 0) > state.createdAt
    || createHash('sha256').update(JSON.stringify([uid, state.provider, meta.providerUserId, 'account'])).digest('hex') !== state.destinationKey) return null;
  return { scheduleRevision: scheduleDoc.data()?.revision ?? 0 };
}
async function memberResult(db: Firestore, tx: Transaction, uid: string, state: TrainingSendState, id: string,
  member: TrainingSendMember) {
  const [ledger, workout, completion, override, scope] = await tx.getAll(db.doc(`users/${uid}/trainingDeliveryLedger/${id}`),
    db.doc(`users/${uid}/scheduledWorkouts/${member.workoutId}`), db.doc(`users/${uid}/trainingWorkoutCompletions/${member.workoutId}`),
    db.doc(`users/${uid}/trainingDeliverySettings/${deliverySettingsId('workout', member.workoutId, state.provider)}`),
    db.doc(`users/${uid}/trainingDeliveryScopes/${member.workoutId}`),
    { fieldMask: [...ledgerFields, 'lifecycle', 'planId', 'suppressed', 'associationPlanId', 'scopeGeneration', 'generation', 'revision'] });
  const data = ledger.data();
  if (!workout.exists || workout.get('lifecycle') !== 'planned' || workout.get('planId') !== member.planId
    || workout.get('updatedAtMs') !== member.updatedAt || completion.exists) return { result: 'cancelled' as const, observedAt: 0 };
  if (override.get('associationPlanId') === member.planId && override.get('scopeGeneration') === (scope.get('generation') ?? 0)
    && (override.get('suppressed') || override.get('revision') > state.settingsRevision)) return { result: 'cancelled' as const, observedAt: 0 };
  if (!data) return { result: 'waiting' as const, observedAt: 0 };
  if (data.settingsRevision < state.settingsRevision) return { result: 'waiting' as const, observedAt: data.updatedAtMs ?? 0 };
  if (data.settingsRevision !== state.settingsRevision || data.destinationKey !== state.destinationKey
    || data.connectionEpoch !== state.connectionEpoch || data.contentDigest !== member.contentDigest) return { result: 'cancelled' as const, observedAt: 0 };
  let result = trainingSendTerminal(data.status);
  if (result === 'sent') {
    if (!data.actual?.ids || Object.keys(data.actual.ids).length === 0 || data.verification?.missing
      || !Number.isSafeInteger(data.lastAcceptedAtMs) || data.lastAcceptedAtMs < 0 || data.lastAcceptedAtMs > data.updatedAtMs
      || data.acceptedContentDigest !== member.contentDigest) result = 'waiting';
    else if (data.lastAcceptedAtMs < state.createdAt) result = 'unchanged';
  }
  return { result, observedAt: data.updatedAtMs ?? 0 };
}

/** At most two masked lookups on existing terminal status writes; intermediate retries cost no extra reads. */
export async function observeTrainingSend(uid: string, raw: unknown,
  deps: { db: Firestore; now(): number; sendReady(id: string): Promise<void> }): Promise<boolean> {
  let status: ReturnType<typeof parseTrainingDeliveryStatusV1>;
  try { status = parseTrainingDeliveryStatusV1(raw); } catch { return false; }
  if (trainingSendTerminal(status.status) === 'waiting') return false;
  if (!/^[a-f0-9]{64}$/.test(status.id) || !/^[a-zA-Z0-9_-]{1,128}$/.test(status.workoutId)
    || status.planId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(status.planId)) return false;
  const { db } = deps, ids = [trainingSendId('workout', status.workoutId, status.provider),
    ...(status.planId ? [trainingSendId('plan', status.planId, status.provider)] : [])];
  const candidates = await db.getAll(...ids.map(id => refFor(db, uid, id)), { fieldMask: ['requestId', `members.${status.id}`] });
  let covered = false;
  for (const candidate of candidates) {
    if (!candidate.get(`members.${status.id}`)) continue;
    const observed = await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
      const [snapshot] = await tx.getAll(candidate.ref, { fieldMask: [...headers, `members.${status.id}`] });
      const state = snapshot.data() as TrainingSendState | undefined;
      if (!valid(state) || state.requestId !== candidate.get('requestId')) return false;
      const member = state.members?.[status.id]; if (!member) return false;
      if (state.finished) return status.updatedAtMs <= member.observedAt;
      const preference = readNotificationCategoryPreference((await tx.get(db.doc(notificationPreferencePath(uid, 'training_send')))).data());
      const live = preference?.enabled && preference.revision === state.categoryRevision && deps.now() - state.createdAt <= TRAINING_SEND.lifetimeMs
        ? await authority(db, tx, uid, state) : null;
      const next = live ? await memberResult(db, tx, uid, state, status.id, member) : { result: 'cancelled' as const, observedAt: 0 };
      if (next.result === 'cancelled') { tx.update(candidate.ref, {
        finished: true, dueAt: FieldValue.delete(), readyAt: FieldValue.delete(), expireAt: trainingResultExpiry(state.createdAt),
      }); return false; }
      const count = (result: TrainingSendMember['result']) => Number(next.result === result) - Number(member.result === result);
      const remaining = state.remaining + count('waiting'), sent = state.sent + count('sent'), failed = state.failed + count('failed');
      tx.update(candidate.ref, { [`members.${status.id}`]: { ...member, result: next.result, observedAt: next.observedAt },
        remaining, sent, failed, unchanged: state.unchanged + count('unchanged'),
        ...(remaining === 0 && sent + failed === 0 ? { finished: true } : {}),
        expireAt: trainingResultExpiry(state.createdAt), dueAt: FieldValue.delete(),
        readyAt: remaining === 0 && sent + failed > 0 ? state.readyAt ?? state.dueAt ?? deps.now() : FieldValue.delete() });
      return remaining === 0 && sent + failed > 0 ? 'ready' : true;
    });
    if (observed === 'ready') await deps.sendReady(candidate.id);
    covered = !!observed || covered;
  }
  return covered;
}

/** One claim per explicit mutation, before bounded device fan-out. No daily cap is applied to user-requested results. */
export async function sendTrainingSendResult(uid: string, id: string, deps: ActivityPushDependencies): Promise<void> {
  const config = await deps.configuration(), { db } = deps, ref = refFor(db, uid, id);
  const claim = await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) { const snap = await tx.get(ref); if (snap.exists) tx.delete(ref); return null; }
    const snapshot = await tx.get(ref), state = snapshot.data() as TrainingSendState | undefined;
    if (!valid(state)) { if (snapshot.exists) tx.update(ref, { finished: true, dueAt: FieldValue.delete() }); return null; }
    const readyAt = state.readyAt ?? state.dueAt;
    if (state.finished || state.remaining !== 0 || readyAt === undefined || readyAt > deps.now()) return null;
    state.readyAt = readyAt;
    const preference = readNotificationCategoryPreference((await tx.get(db.doc(notificationPreferencePath(uid, 'training_send')))).data());
    const targetsValid = Array.isArray(state.targets) && state.targets.length > 0 && state.targets.length <= TRAINING_SEND.deviceLimit
      && state.targets.every(target => target && isPushId(target.id) && isPushId(target.generation) && isAutomaticPushOrigin(target.origin));
    const live = config.enabled && targetsValid && preference?.enabled && preference.revision === state.categoryRevision
      && state.createdAt <= deps.now() && deps.now() - state.createdAt <= TRAINING_SEND.lifetimeMs && deps.now() - readyAt <= TRAINING_SEND.expiryMs
      ? await authority(db, tx, uid, state) : null;
    const entries = Object.entries(state.members ?? {});
    const results = live && entries.length === state.total
      ? await Promise.all(entries.map(([key, member]) => memberResult(db, tx, uid, state, key, member))) : [];
    if (!results.some(row => row.result === 'cancelled') && results.some(row => row.result === 'waiting')) {
      // A provider retry reopened the result. Start the delivery window at its next terminal status.
      tx.update(ref, { dueAt: FieldValue.delete(), readyAt: FieldValue.delete() }); return null;
    }
    const sent = results.filter(row => row.result === 'sent').length, failed = results.filter(row => row.result === 'failed').length;
    const claimId = randomUUID();
    tx.update(ref, { finished: true, claimId, dueAt: FieldValue.delete(), readyAt: FieldValue.delete(), expireAt: trainingResultExpiry(state.createdAt),
      ...(results.length ? { members: Object.fromEntries(entries.map(([key, member], index) => [key,
        { ...member, ...results[index] }])) } : {}) });
    if (!live || results.some(row => row.result === 'cancelled') || sent + failed === 0) return { cancelled: true as const };
    return { cancelled: false as const, state, sent, failed, claimId, scheduleRevision: live.scheduleRevision };
  });
  if (!claim) return;
  if (claim.cancelled) { deps.outcome('cancelled'); return; }
  const endpoints = new Set<string>(); let failure = false;
  for (let offset = 0; offset < claim.state.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.state.targets.slice(offset, offset + 5).map(async target => {
      const deviceRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return null;
        const [snapshot, pref, device] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'training_send'))), tx.get(deviceRef)]);
        const preference = readNotificationCategoryPreference(pref.data()), registration = device.data();
        if (snapshot.get('claimId') !== claim.claimId || snapshot.get('requestId') !== claim.state.requestId
          || !preference?.enabled || preference.revision !== claim.state.categoryRevision || deps.now() - claim.state.createdAt > TRAINING_SEND.lifetimeMs
          || deps.now() - claim.state.readyAt! > TRAINING_SEND.expiryMs || !isPushRegistration(registration) || registration.origin !== target.origin
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey || !isAutomaticPushOrigin(registration.origin)) return null;
        const live = await authority(db, tx, uid, claim.state);
        return live?.scheduleRevision === claim.scheduleRevision ? registration : null;
      });
      if (!ready || endpoints.has(ready.endpoint)) { deps.outcome('cancelled'); return; }
      endpoints.add(ready.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready, JSON.stringify(trainingSendPayload(ready.origin, claim.state, claim.sent, claim.failed))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await removeExpiredDevice(db, uid, target.id, target.generation, 'training_send', deps.now());
    }));
    if (results.some(result => result.status === 'rejected')) failure = true;
  }
  if (failure) throw new Error('Training send notification device processing failed.');
}
