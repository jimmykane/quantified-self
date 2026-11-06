import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ConnectionHistoryRun } from '../connection-history/model';
import { isPushRegistration, isAutomaticPushOrigin, type PushRegistration } from '../../../shared/web-push';
import { buildHistoryNotificationPayload, isHistoryNotificationTarget, supportsHistoryNotification,
  type HistoryNotificationResult } from '../../../shared/history-import-notifications';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';

const DAY_MS = 86400000;
export type HistoryPushOutcome = 'accepted' | 'expired' | 'failed' | 'cancelled' | 'limited';
export interface HistoryPushDependencies {
  db: Firestore;
  now(): number;
  configuration(): Promise<{ enabled: boolean; publicKey: string }>;
  send(registration: PushRegistration, payload: string): Promise<unknown>;
  outcome(value: HistoryPushOutcome): void;
}
interface Receipt { runId: string; createdAt: number; attemptedAt: number; outcome: HistoryPushOutcome | 'claimed'; }
interface HistoryPushState { attempts: number[]; providers: Record<string, Receipt>; }

export function historyNotificationResult(run: ConnectionHistoryRun): HistoryNotificationResult | null {
  if (!run?.notification || !run.processed || run.rangePreset !== 'custom' || !supportsHistoryNotification(run.serviceName)
    || run.steps.length !== 1 || run.steps[0].id !== 'activities' || run.steps[0].resources.length !== 1
    || run.steps[0].resources[0] !== 'activities' || !run.steps[0].done) return null;
  const step = run.steps[0];
  if (step.status === 'processed' && !step.childPaths.length && !step.failedChildPaths?.length) return 'finished';
  if (!['failed', 'skipped'].includes(step.status)) return null;
  return step.nextStartMs > run.endMs && !step.childPaths.length ? 'issues' : 'attention';
}

/** One bounded receipt per provider. Older runs never displace a newer receipt, even after explicit Retry.
 * Claim before external I/O: ambiguous sends (or a crash after claiming) are intentionally not replayed.
 */
export async function sendHistoryCompletion(runId: string, expected: ConnectionHistoryRun, deps: HistoryPushDependencies): Promise<void> {
  if (expected.id !== runId || !historyNotificationResult(expected)) return;
  const { db } = deps;
  const config = await deps.configuration();
  if (!config.enabled) return;
  const runRef = db.doc(`connectionHistoryImports/${runId}`);
  const stateRef = db.doc(`users/${expected.userID}/pushState/historyCompletion`);
  const consent = expected.notification!;
  const { origin, categoryRevision, ...target } = consent;
  if (!isAutomaticPushOrigin(origin) || !isHistoryNotificationTarget(target)
    || !Number.isSafeInteger(categoryRevision) || categoryRevision < 0) return;
  const registrationRef = db.doc(`users/${expected.userID}/pushSubscriptions/${consent.installationId}`);
  const current = async (tx: Transaction) => {
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, expected.userID);
    const [snapshot, registrationSnapshot, metaSnapshot, preferenceSnapshot] = await Promise.all([
      tx.get(runRef), tx.get(registrationRef), tx.get(db.doc(`users/${expected.userID}/meta/${expected.serviceName}`)),
      tx.get(db.doc(notificationPreferencePath(expected.userID, 'history_import'))),
    ]);
    const run = snapshot.data() as ConnectionHistoryRun | undefined;
    const registration = registrationSnapshot.data(); const meta = metaSnapshot.data();
    const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
    if (guard.shouldSkip || !run || run.userID !== expected.userID || run.id !== runId
      || !preference?.enabled || preference.revision !== categoryRevision || run.notification?.categoryRevision !== categoryRevision
      || run.revision !== expected.revision || run.dateCreated !== expected.dateCreated
      || run.serviceName !== expected.serviceName || run.connectionGeneration !== expected.connectionGeneration
      || run.notification?.generation !== consent.generation || run.notification?.installationId !== consent.installationId
      || run.notification?.origin !== origin || !historyNotificationResult(run)
      || !Number.isFinite(run.updatedAtMs) || deps.now() - run.updatedAtMs > DAY_MS || run.updatedAtMs > deps.now()
      || meta?.connectionState !== 'connected' || meta.connectionStateGeneration !== run.connectionGeneration
      || meta.connectionHistoryImport?.runId !== runId || meta.connectionHistoryImport?.active !== false
      || !isPushRegistration(registration) || registration.origin !== origin
      || registration.generation !== consent.generation || registration.vapidPublicKey !== config.publicKey) return null;
    return { run, registration };
  };
  const claim = await db.runTransaction(async tx => {
    const live = await current(tx);
    const state = (await tx.get(stateRef)).data() as HistoryPushState | undefined;
    if (!live) return null;
    const previous = state?.providers?.[expected.serviceName];
    if (previous && previous.createdAt >= expected.dateCreated) return null;
    const now = deps.now();
    const attempts = (state?.attempts ?? []).filter(at => at > now - DAY_MS);
    const limited = attempts.length >= 2;
    // Store suppression too: replaying the same run after the cap expires must not send it.
    const receipt: Receipt = { runId, createdAt: expected.dateCreated, attemptedAt: now, outcome: limited ? 'limited' : 'claimed' };
    tx.set(stateRef, { attempts: limited ? attempts : [...attempts, now],
      providers: { ...state?.providers, [expected.serviceName]: receipt } });
    return { ...live, limited };
  });
  if (!claim) return;
  if (claim.limited) { deps.outcome('limited'); return; }
  let outcome: HistoryPushOutcome = 'cancelled';
  // A replacement registration, connection, run or deletion can win while the claim commits.
  const ready = await db.runTransaction(async tx => {
    const live = await current(tx);
    const state = (await tx.get(stateRef)).data() as HistoryPushState | undefined;
    return !!live && state?.providers?.[expected.serviceName]?.runId === runId
      && state.providers[expected.serviceName].outcome === 'claimed';
  });
  if (ready) {
    try {
      await deps.send(claim.registration, JSON.stringify(buildHistoryNotificationPayload(origin, expected.serviceName, historyNotificationResult(claim.run)!)));
      outcome = 'accepted';
    } catch (error: unknown) {
      const status = (error as { statusCode?: unknown } | null)?.statusCode;
      outcome = status === 404 || status === 410 ? 'expired' : 'failed';
    }
  }
  deps.outcome(outcome);
  await db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, expected.userID);
    const [stateSnapshot, registrationSnapshot] = await Promise.all([tx.get(stateRef), tx.get(registrationRef)]);
    if (guard.shouldSkip) return;
    const state = stateSnapshot.data() as HistoryPushState | undefined;
    if (state?.providers?.[expected.serviceName]?.runId === runId) {
      tx.update(stateRef, { providers: { ...state.providers, [expected.serviceName]: { ...state.providers[expected.serviceName], outcome } } });
    }
    if (outcome === 'expired' && registrationSnapshot.data()?.generation === consent.generation) {
      // Registration records are leaves; Rules prohibit descendants.
      tx.delete(registrationRef);
    }
  });
}
