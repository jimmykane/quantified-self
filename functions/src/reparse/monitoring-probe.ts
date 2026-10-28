import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { valid as validVersion } from 'semver';
import { emitReparseMonitoring, type ReparseTier } from './monitoring';

export const REPARSE_PROBE_LIMIT = 10;
export const REPARSE_PROBE_TIMEOUT_MS = 5_000;
export const REPARSE_STALL_MS: Record<ReparseTier, number> = { normal: 3_600_000, route: 3_600_000, heavy: 21_600_000 };
const FIELDS = ['uid', 'eventId', 'routeId', 'eventPath', 'routePath', 'targetSportsLibVersion', 'processingTier',
  'status', 'attemptCount', 'updatedAt', 'enqueuedAt', 'terminalFailure', 'failureReason', 'lastError'];
type Data = FirebaseFirestore.DocumentData;
export interface ReparseProbeProfile {
  collection: 'sportsLibReparseJobs' | 'sportsLibRouteReparseJobs';
  target: string;
  terminal: (message: string) => boolean;
  hasSource: (data: Data) => boolean;
}
const millis = (value: unknown): number | null => {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== 'function') return null;
  const n = (value as { toMillis(): number }).toMillis();
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function reparseCandidate(data: Data, profile: ReparseProbeProfile, now: number): 'eligible' | 'excluded' | 'unknown' {
  if (typeof data.targetSportsLibVersion !== 'string' || !validVersion(data.targetSportsLibVersion)) return 'unknown';
  if (data.targetSportsLibVersion !== profile.target || data.terminalFailure === true
    || data.failureReason === 'TOO_HEAVY_FOR_AUTO_REPARSE'
    || typeof data.lastError === 'string' && profile.terminal(data.lastError)) return 'excluded';
  if (!['pending', 'processing', 'failed'].includes(data.status)) return 'excluded';
  const updated = millis(data.updatedAt);
  if (updated === null || !Number.isSafeInteger(data.attemptCount) || data.attemptCount < 0) return 'unknown';
  // attemptCount belongs to the job, not one native task. It survives manual
  // retries/re-enqueues, so it cannot establish exhaustion of the current task.
  // Only explicit terminal/manual-review state excludes an unresolved failure.
  const enqueued = millis(data.enqueuedAt);
  if (data.status === 'pending' && enqueued === null) return 'unknown';
  // No saved nextAttemptAt exists: conservatively wait out the maximum native backoff,
  // plus the longest worker deadline for an interrupted processing attempt.
  const grace = data.status === 'pending' ? 300_000
    : CLOUD_TASK_RETRY_CONFIG.maxBackoffSeconds * 1000 + (data.status === 'processing' ? 1_800_000 : 0);
  return Math.max(updated, enqueued ?? 0) + grace <= now ? 'eligible' : 'excluded';
}

/** Existing scanners call this hourly even when discovery is off: queued tasks still run.
 * Two bounded root collections, masked read-only transactions, no parser/provider/task APIs or writes.
 */
export async function observeReparseQueue(db: FirebaseFirestore.Firestore, profile: ReparseProbeProfile, now = Date.now()): Promise<void> {
  const route = profile.collection === 'sportsLibRouteReparseJobs';
  const tiers: ReparseTier[] = route ? ['route'] : ['normal', 'heavy'];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sample = async () => {
    // limitToLast reverses the wire ordering: this requires the additive status ASC /
    // updatedAt ASC index, not the admin history's DESC index. Sample the oldest prefix.
    const snapshot = await db.collection(profile.collection).where('status', 'in', ['pending', 'processing', 'failed'])
      .orderBy('updatedAt', 'desc').select(...FIELDS).limitToLast(REPARSE_PROBE_LIMIT + 1).get();
    if (stopped) return;
    const groups = tiers.map(tier => ({ tier, pending: 0, age: 0, unknown: 0, progress: null as number | null }));
    for (const doc of snapshot.docs.slice(-REPARSE_PROBE_LIMIT)) {
      if (stopped) return;
      const data = doc.data();
      const group = groups.find(group => group.tier === (route ? 'route' : data.processingTier ?? 'normal'));
      if (!group) { groups.forEach(g => g.unknown++); continue; }
      const candidate = reparseCandidate(data, profile, now);
      if (candidate === 'excluded') continue;
      const uid = data.uid;
      const source = route ? data.routeId : data.eventId;
      const path = route ? data.routePath : data.eventPath;
      if (candidate === 'unknown' || typeof uid !== 'string' || !uid || uid.includes('/')
        || typeof source !== 'string' || !source || source.includes('/')
        || path !== `users/${uid}/${route ? 'routes' : 'events'}/${source}`) { group.unknown++; continue; }
      const valid = await db.runTransaction(async tx => {
        const [current, owner, tombstone, parent] = await tx.getAll(doc.ref, db.doc(`users/${uid}`),
          db.doc(`userDeletionTombstones/${uid}`), db.doc(path),
          { fieldMask: [...FIELDS, 'expireAt', 'originalFile', 'originalFiles'] });
        if (stopped || !current.exists || !owner.exists || !parent.exists
          || isUserDeletionTombstoneActive(tombstone.data(), now)) return 'excluded';
        if (!current.updateTime?.isEqual(doc.updateTime!)) return 'unknown';
        return profile.hasSource(parent.data()!) ? 'eligible' : 'excluded';
      }, { readOnly: true });
      if (stopped) return;
      if (valid === 'unknown') { group.unknown++; continue; }
      if (valid === 'excluded') continue;
      group.pending++;
      group.age = Math.max(group.age, now - Math.max(millis(data.updatedAt)!, millis(data.enqueuedAt) ?? 0));
    }
    // Empty/excluded queues need no progress reads. Each tier with proven pending work
    // gets independent progress so busy normal jobs cannot hide a stalled heavy batch.
    for (const group of groups) {
      if (stopped) return;
      if (group.pending === 0) continue;
      let query = db.collection(profile.collection).where('targetSportsLibVersion', '==', profile.target)
        .where('status', 'in', ['completed', 'skipped']);
      if (!route) query = query.where('processingTier', '==', group.tier);
      const last = await query.orderBy('updatedAt', 'desc').select('updatedAt').limit(1).get();
      if (stopped) return;
      // No completion for this target/tier is known: compare against epoch. Unknown
      // metadata instead withholds a stall, never fabricates a positive progress read.
      group.progress = last.empty ? 0 : millis(last.docs[0].get('updatedAt'));
      // A real completion can commit between probe start and this read. Only a
      // timestamp beyond the bounded observation window is unexplained future data.
      if (group.progress === null || group.progress > now + REPARSE_PROBE_TIMEOUT_MS) { group.progress = null; group.unknown++; }
    }
    if (stopped) return;
    const truncated = snapshot.size > REPARSE_PROBE_LIMIT;
    for (const group of groups) emitReparseMonitoring({ event: 'queue_sample', tier: group.tier,
      unknownSample: group.unknown, truncated,
      // A capped/unknown sample can establish positive work, but not healthy zero.
      ...(group.pending > 0 || !truncated && group.unknown === 0 ? { pendingSample: group.pending, ageLowerBoundMs: group.age } : {}),
      stalled: group.pending > 0 && group.age >= REPARSE_STALL_MS[group.tier]
        && group.progress !== null && now - group.progress >= REPARSE_STALL_MS[group.tier],
    });
  };
  try {
    await Promise.race([sample(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, REPARSE_PROBE_TIMEOUT_MS);
    })]);
  } catch {
    stopped = true;
    tiers.forEach(tier => emitReparseMonitoring({ event: 'queue_sample_unavailable', tier }));
  } finally { if (timer) clearTimeout(timer); }
}

/** Observe the scheduled tick in the first ten minutes of each hour, not wall-clock start time.
 * Interval schedulers can have a non-zero minute phase; delivery can also be late.
 * Run the existing five-second-bounded observation before discovery can consume the
 * request budget. Observation failures never suppress discovery or replace its error.
 * No additional timer/cursor or change to hourly read limits or schedule.
 */
export async function beforeReparseScan(operation: () => Promise<void>, observe: () => Promise<void>,
  tiers: ReparseTier[], scheduleTime: string | undefined): Promise<void> {
  const scheduledAt = typeof scheduleTime === 'string' ? Date.parse(scheduleTime) : NaN;
  if (!Number.isFinite(scheduledAt)) tiers.forEach(tier => emitReparseMonitoring({ event: 'queue_sample_unavailable', tier }));
  else if (new Date(scheduledAt).getUTCMinutes() < 10) {
    try { await observe(); } catch { tiers.forEach(tier => emitReparseMonitoring({ event: 'queue_sample_unavailable', tier })); }
  }
  await operation();
}
