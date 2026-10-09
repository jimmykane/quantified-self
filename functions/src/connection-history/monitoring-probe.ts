import { ServiceNames } from '@sports-alliance/sports-lib';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { MAX_PENDING_TASKS } from '../shared/queue-config';
import { historyAdmissionQueue, historyCooldownUntil, historySleepProvider, getHistoryAdapter } from './adapters';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from '../sleep/provider-flags';
import { isGarminHealthSyncEnabled } from '../garmin/health-flags';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import { CONNECTION_HISTORY_COLLECTION, type ConnectionHistoryRun } from './model';
import { emitHistoryMonitoring, historyMonitoringProvider, HISTORY_PROVIDERS } from './monitoring';

export const HISTORY_PROBE_LIMIT = 20;
export const HISTORY_PROBE_TIMEOUT_MS = 5_000;
const ROOTS: Record<ServiceNames, string> = {
  [ServiceNames.GarminAPI]: GARMIN_API_TOKENS_COLLECTION_NAME, [ServiceNames.SuuntoApp]: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
  [ServiceNames.COROSAPI]: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, [ServiceNames.WahooAPI]: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
};
const RUN_FIELDS = ['userID', 'serviceName', 'rootPath', 'tokenPath', 'credentialGeneration', 'connectionGeneration',
  'revision', 'processed', 'nextAttemptAt', 'leaseExpiresAt', 'dateCreated', 'updatedAtMs', 'endMs', 'steps'];
const STATE_FIELDS = [...RUN_FIELDS, 'expireAt', 'activeOAuthCredentialGeneration', 'tokenCredentialGeneration', 'permissions',
  'disconnectOperationGeneration', 'disconnectGeneration', 'connectionState', 'connectionStateGeneration',
  'connectionHistoryReservation', 'connectionHistoryReservationExpiresAt', 'historyImportLeaseExpiresAt',
  'didLastHistoryImport', 'processedActivitiesFromLastHistoryImportCount', 'nextBackfillAllowedAtMs'];
type Candidate = 'eligible' | 'excluded' | 'unknown';
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('/');
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function historyProbeDue(scheduledTime: string | undefined): boolean {
  const time = Date.parse(scheduledTime ?? '');
  return Number.isFinite(time) && new Date(time).getUTCMinutes() % 15 === 0;
}
export function historyProbeCandidate(run: ConnectionHistoryRun, now: number): Candidate {
  if (run.processed !== false) return 'excluded';
  if (!timestamp(run.nextAttemptAt) || !timestamp(run.dateCreated) || !timestamp(run.revision)
    || run.leaseExpiresAt != null && !timestamp(run.leaseExpiresAt)
    || !Array.isArray(run.steps) || !run.steps.length || run.steps.length > 10) return 'unknown';
  if (run.nextAttemptAt > now || Number(run.leaseExpiresAt) > now) return 'excluded';
  const step = run.steps.find(step => !step.done);
  if (!step) return 'eligible'; // Due finalization is coordinator work, not provider delivery.
  if (!step.capability || !Array.isArray(step.childPaths) || step.childPaths.length > 100) return 'unknown';
  if (!['queued', 'requesting', 'retrying', 'processed', 'requested', 'skipped'].includes(step.status)) return 'unknown';
  return 'eligible';
}
export function recordHistoryProbeUnavailable(): void {
  HISTORY_PROVIDERS.forEach(provider => emitHistoryMonitoring({ event: 'queue_sample_unavailable', provider }));
}

/** Observations only: bounded masked reads, no credentials, providers, queue writes or dispatch decisions. */
export async function observeConnectionHistory(db: FirebaseFirestore.Firestore, proAccess: (uid: string) => Promise<boolean>,
  queueDepth: (queue: string) => Promise<number>, now = Date.now()): Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let childBudget = 100;
  const capacity = new Map<string, Promise<boolean>>();
  const entitlements = new Map<string, Promise<boolean>>();
  const sample = async () => {
    const snapshot = await db.collection(CONNECTION_HISTORY_COLLECTION).where('processed', '==', false)
      .where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').select(...RUN_FIELDS).limit(HISTORY_PROBE_LIMIT + 1).get();
    if (stopped) return;
    const groups = HISTORY_PROVIDERS.map(provider => ({ provider, dueSample: 0, ageLowerBoundMs: 0, unknownSample: 0 }));
    for (const doc of snapshot.docs.slice(0, HISTORY_PROBE_LIMIT)) {
      if (stopped) return;
      const run = doc.data() as ConnectionHistoryRun;
      const group = groups.find(group => group.provider === historyMonitoringProvider(run.serviceName));
      if (!group) { groups.forEach(group => group.unknownSample++); continue; }
      const candidate = historyProbeCandidate(run, now);
      if (candidate === 'excluded') continue;
      if (candidate === 'unknown' || !id(run.userID) || !id(run.credentialGeneration) || !id(run.connectionGeneration)
        || run.rootPath !== `${ROOTS[run.serviceName]}/${run.userID}`
        || !run.tokenPath?.startsWith(`${run.rootPath}/tokens/`) || run.tokenPath.split('/').length !== 4) {
        group.unknownSample++; continue;
      }
      const eligible = await db.runTransaction(async tx => {
        const user = db.doc(`users/${run.userID}`);
        const [current, owner, tombstone, root, token, meta] = await tx.getAll(doc.ref, user,
          db.doc(`userDeletionTombstones/${run.userID}`), db.doc(run.rootPath), db.doc(run.tokenPath),
          user.collection('meta').doc(run.serviceName), { fieldMask: STATE_FIELDS });
        if (stopped || !current.exists || !owner.exists || isUserDeletionTombstoneActive(tombstone.data(), now)) return 'excluded';
        if (!current.updateTime?.isEqual(doc.updateTime!)) return 'unknown';
        if (!root.exists || !token.exists || !meta.exists
          || root.get('activeOAuthCredentialGeneration') !== run.credentialGeneration
          || token.get('tokenCredentialGeneration') !== run.credentialGeneration
          || root.get('disconnectOperationGeneration') || root.get('disconnectGeneration')
          || meta.get('connectionState') !== 'connected' || meta.get('connectionStateGeneration') !== run.connectionGeneration) return 'excluded';
        const step = run.steps.find(step => !step.done);
        if (!step) return 'eligible';
        if (step.childPaths.length) {
          if (stopped) return 'excluded';
          if (step.childPaths.length > childBudget) return 'unknown';
          childBudget -= step.childPaths.length;
          if (step.childPaths.some(path => typeof path !== 'string' || path.split('/').length !== 2)) return 'unknown';
          const children = await tx.getAll(...step.childPaths.map(path => db.doc(path)), { fieldMask: ['processed', 'resultStatus', 'skippedReason'] });
          if (stopped) return 'excluded';
          // Waiting children belong to downstream monitoring. Terminal failures
          // or missing children require coordinator finalization, not admission.
          if (children.some(child => child.exists && child.get('processed') === false)) return 'excluded';
          if (children.some(child => child.exists && child.get('processed') !== true)) return 'unknown';
          if (children.some(child => !child.exists || child.get('skippedReason')
            || child.get('resultStatus') && child.get('resultStatus') !== 'success')) return 'eligible';
        }
        if (!timestamp(step.nextStartMs) || !timestamp(run.endMs)) return 'unknown';
        if (step.nextStartMs > run.endMs) return 'eligible';
        try { getHistoryAdapter(run, step); } catch { return 'excluded'; }
        if (step.capability.cooldownGroup === 'activities') {
          if (meta.get('connectionHistoryReservation') !== doc.id
            && (historyCooldownUntil(run.serviceName, meta.data()) > now || Number(meta.get('connectionHistoryReservationExpiresAt')) > now)) return 'excluded';
          if (Number(meta.get('historyImportLeaseExpiresAt')) > now) return 'excluded';
        } else {
          const provider = historySleepProvider(run.serviceName);
          if (!isSleepProviderEnabled(provider) || !isSleepSyncUserAllowed(run.userID)
            || step.id === 'health' && (run.serviceName === ServiceNames.GarminAPI && !isGarminHealthSyncEnabled()
              || run.serviceName === ServiceNames.SuuntoApp && !isSuuntoHealthSyncEnabled())) return 'excluded';
          const [sleep] = await tx.getAll(user.collection('sleepSyncState').doc(provider), { fieldMask: ['connectionHistoryReservation', 'nextBackfillAllowedAtMs'] });
          if (stopped) return 'excluded';
          if (sleep.get('connectionHistoryReservation') !== doc.id && Number(sleep.get('nextBackfillAllowedAtMs')) > now) return 'excluded';
        }
        if (run.serviceName === ServiceNames.GarminAPI) {
          const permissions = token.get('permissions');
          if (!Array.isArray(permissions) || !['HISTORICAL_DATA_EXPORT', step.id === 'activities' ? 'ACTIVITY_EXPORT' : 'HEALTH_EXPORT'].every(p => permissions.includes(p))) return 'excluded';
        }
        return 'admission';
      }, { readOnly: true });
      if (stopped) return;
      if (eligible === 'excluded') continue;
      if (eligible === 'unknown') { group.unknownSample++; continue; }
      if (!entitlements.has(run.userID)) entitlements.set(run.userID, proAccess(run.userID));
      if (!await entitlements.get(run.userID)) continue;
      if (stopped) return;
      const step = run.steps.find(step => !step.done);
      if (step && eligible === 'admission') {
        const downstream = historyAdmissionQueue(run, step);
        const key = `${downstream.taskQueue}/${downstream.collection}`;
        // Settle both started reads before returning an early error. The shared
        // deadline still bounds the probe; do not abandon an ordinary sibling read.
        if (!capacity.has(key)) capacity.set(key, Promise.allSettled([queueDepth(downstream.taskQueue),
          db.collection(downstream.collection).where('processed', '==', false).count().get()]).then(results => {
            if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') throw new Error('Unknown capacity');
            const depth = results[0].value; const backlog = results[1].value;
            if (!Number.isFinite(depth) || depth < 0 || !Number.isFinite(backlog.data().count)) throw new Error('Unknown capacity');
            return Math.max(depth, backlog.data().count) < MAX_PENDING_TASKS / 2;
          }));
        if (!await capacity.get(key)) continue;
      }
      if (stopped) return;
      // Age since this revision became due, not lifetime age of a multi-year import.
      group.dueSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, now - run.nextAttemptAt);
    }
    if (stopped) return;
    const truncated = snapshot.size > HISTORY_PROBE_LIMIT;
    for (const group of groups) emitHistoryMonitoring({ event: 'queue_sample', provider: group.provider,
      unknownSample: group.unknownSample, truncated,
      ...(group.dueSample > 0 || !truncated && group.unknownSample === 0 ? { dueSample: group.dueSample, ageLowerBoundMs: group.ageLowerBoundMs } : {}) });
  };
  try {
    await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, HISTORY_PROBE_TIMEOUT_MS);
    })]);
  } catch { recordHistoryProbeUnavailable(); }
  finally { stopped = true; if (timer) clearTimeout(timer); }
}
