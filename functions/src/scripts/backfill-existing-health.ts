import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SleepProvider } from '../../../shared/sleep';
import { getSleepBackfillCooldownMs, GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS } from '../../../shared/sleep-backfill';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { doesOAuthCredentialGenerationAuthorizeToken } from '../token-refresh-coordinator';
import { selectActiveCOROSTokenSnapshot, normalizeCOROSOpenId } from '../coros/account';
import { containsASCIIControlCharacter } from '../coros/input-validation';
import { countGarminHealthBackfillRequests } from '../garmin/health-backfill-range';
import { captureCurrentSuuntoWebhookWriteLifecycleGuards } from '../suunto/health-webhook-binding-lifecycle';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from '../sleep/provider-flags';
import { isGarminHealthSyncEnabled } from '../garmin/health-flags';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import {
  BackfillJob, BackfillOptions, buildHealthBackfillJobs, CHECKPOINT_COLLECTION,
  digest, earliestBackfillStart, JobObservation, observeBackfillJob,
  parseBackfillOptions, PROVIDERS, ProviderName, QueueInput,
} from './health-backfill-plan';

const SERVICES: Record<ProviderName, ServiceNames> = {
  garmin: ServiceNames.GarminAPI, suunto: ServiceNames.SuuntoApp, coros: ServiceNames.COROSAPI,
};
const ROOTS: Record<ProviderName, string> = {
  garmin: 'garminAPITokens', suunto: 'suuntoAppAccessTokens', coros: 'COROSAPIAccessTokens',
};
const ID_FIELDS: Record<ProviderName, string> = { garmin: 'userID', suunto: 'userName', coros: 'openId' };
const TOKEN_FIELDS = ['serviceName', 'userID', 'userName', 'openId', 'permissions', 'tokenCredentialGeneration', 'dateCreated', 'dateRefreshed'];
const LEASE_MS = 15 * 60_000;
const USER_QUEUE_SCAN_LIMIT = 1000;

type Guard = NonNullable<QueueInput['requiredDocumentFieldValues']>[number];
interface Connection {
  name: ProviderName;
  provider: SleepProvider;
  uid: string;
  account: string;
  root: admin.firestore.DocumentReference;
  state: admin.firestore.DocumentReference;
  guards: Guard[];
  lifecycle: string;
  queueFields: Partial<QueueInput>;
}
interface Plan {
  connection: Connection;
  campaign: string;
  run: admin.firestore.DocumentReference;
  control: admin.firestore.DocumentReference;
  startMs: number;
  endMs: number;
  jobs: BackfillJob[];
  overrideCooldownUntilMs?: number;
}
export interface BackfillSummary {
  dryRun: boolean;
  project: string;
  start: string;
  end: string;
  tokenRecordsScanned: number;
  eligibleAccounts: number;
  accountsSubmitted: number;
  jobsPlanned: number;
  jobsAttempted: number;
  jobsSubmitted: number;
  observed: Record<JobObservation, number>;
  skipped: Record<string, number>;
  failed: number;
  incomplete: boolean;
}
export interface BackfillDependencies {
  db: admin.firestore.Firestore;
  auth: Pick<admin.auth.Auth, 'getUser'>;
  now: () => number;
  enqueue: (input: QueueInput) => Promise<admin.firestore.DocumentReference>;
}

class Skip extends Error { constructor(readonly reason: string) { super(reason); } }
function increment(map: Record<string, number>, key: string): void { map[key] = (map[key] || 0) + 1; }
function normalized(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function guard(snapshot: admin.firestore.DocumentSnapshot, fields: string[]): Guard {
  const data = snapshot.data() || {};
  return { documentRef: snapshot.ref, expectedFields: Object.fromEntries(fields.map(key => [key, data[key]])) };
}
function rootPermits(root: Record<string, unknown>): boolean {
  return !root.disconnectState && !normalized(root.disconnectOperationGeneration);
}
function providerEnabled(name: ProviderName): boolean {
  return isSleepProviderEnabled(PROVIDERS[name])
    && (name !== 'garmin' || isGarminHealthSyncEnabled())
    && (name !== 'suunto' || isSuuntoHealthSyncEnabled());
}

/** Reads claims directly to avoid the existing hasProAccess helper's UID-bearing denial log. */
async function requirePro(deps: BackfillDependencies, uid: string): Promise<void> {
  const user = await deps.auth.getUser(uid);
  if (user.disabled) throw new Skip('auth_disabled');
  const claims = user.customClaims || {};
  if (claims.stripeRole !== 'pro'
    && !(typeof claims.gracePeriodUntil === 'number' && claims.gracePeriodUntil > deps.now())) {
    throw new Skip('pro_required');
  }
}

async function resolveConnection(
  deps: BackfillDependencies, name: ProviderName, token: admin.firestore.QueryDocumentSnapshot,
): Promise<Connection> {
  const root = token.ref.parent.parent!;
  const uid = root.id;
  if (root.parent.id !== ROOTS[name] || !isSleepSyncUserAllowed(uid)) throw new Skip('invalid_or_unallowed_owner');
  if ((await getUserDeletionGuardState(deps.db, uid, deps.now())).shouldSkip) throw new Skip('deleted_or_missing_owner');
  await requirePro(deps, uid);
  const state = deps.db.collection('users').doc(uid).collection('sleepSyncState').doc(PROVIDERS[name]);
  const metaRef = deps.db.collection('users').doc(uid).collection('meta').doc(SERVICES[name]);
  const [rootSnapshot, meta] = await Promise.all([root.get(), metaRef.get()]);
  const rootData = rootSnapshot.data() || {};
  const metaData = meta.data() || {};
  if (!rootSnapshot.exists || !rootPermits(rootData) || isServiceUnavailableForSyncConnection(metaData)) {
    throw new Skip('connection_unavailable');
  }
  const data = token.data();
  const account = normalized(data[ID_FIELDS[name]]);
  if (!account || account !== data[ID_FIELDS[name]] || (name !== 'garmin' && account !== token.id)
    || account.length > 512 || account.includes('/') || containsASCIIControlCharacter(account)) throw new Skip('invalid_account');
  if (name !== 'suunto' && metaData.providerUserId && metaData.providerUserId !== account) throw new Skip('inactive_account');
  if (name !== 'suunto' && !doesOAuthCredentialGenerationAuthorizeToken(rootData, data.tokenCredentialGeneration)) {
    throw new Skip('inactive_credential');
  }
  if (name === 'garmin' && (!Array.isArray(data.permissions)
    || GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS.some(permission => !data.permissions.includes(permission)))) {
    throw new Skip('health_history_permission_missing');
  }
  if (name === 'coros') {
    if (!normalizeCOROSOpenId(account)) throw new Skip('invalid_account');
    if (!metaData.providerUserId) {
      // Unlike getActiveCOROSTokenSnapshot, this does not pin metadata during a dry run.
      const all = await root.collection('tokens').select(...TOKEN_FIELDS).limit(101).get();
      if (all.size > 100) throw new Skip('account_scan_limit');
      if (selectActiveCOROSTokenSnapshot(all.docs)?.id !== account) throw new Skip('inactive_account');
    }
  }
  const guards = [
    guard(token, ['serviceName', ID_FIELDS[name], 'tokenCredentialGeneration']),
    guard(rootSnapshot, ['activeOAuthCredentialGeneration', 'disconnectState', 'disconnectOperationGeneration']),
    ...(meta.exists ? [guard(meta, ['connectionState', 'connectionStateGeneration', 'providerUserId'])] : []),
  ];
  if (name === 'suunto') {
    const binding = await captureCurrentSuuntoWebhookWriteLifecycleGuards(deps.db, uid, account, deps.now());
    if (!binding) throw new Skip('provider_verified_binding_missing');
    guards.push(binding.requiredDocumentFieldValues, ...binding.additionalRequiredDocumentFieldValues);
  }
  const prefix = name === 'suunto' ? 'suuntoHealth' : 'garminHealth';
  const queueFields = name === 'coros' ? {} : {
    [`${prefix}TokenCredentialGeneration`]: normalized(data.tokenCredentialGeneration),
    [`${prefix}RootOAuthCredentialGeneration`]: normalized(rootData.activeOAuthCredentialGeneration),
    [`${prefix}ConnectionStateGeneration`]: normalized(metaData.connectionStateGeneration),
  };
  return {
    name, provider: PROVIDERS[name], uid, account, root, state, guards,
    lifecycle: digest(guards.map(item => [item.documentRef.path, item.expectedFields])), queueFields,
  };
}

async function makePlan(deps: BackfillDependencies, options: BackfillOptions, connection: Connection): Promise<Plan> {
  const campaign = digest([options.project, connection.provider, options.startMs, options.endMs]);
  // Inert import receipts belong to the retained user history, not credentials.
  // Account deletion recursively removes them with users/{uid}; no top-level cleanup query is needed.
  const run = connection.state.collection(CHECKPOINT_COLLECTION).doc(digest([campaign, connection.account]));
  const control = connection.state.collection(CHECKPOINT_COLLECTION).doc('control');
  const existing = (await run.get()).data();
  if (existing && existing.lifecycle !== connection.lifecycle) throw new Skip('checkpoint_connection_changed');
  let startMs = existing?.startMs ?? earliestBackfillStart(connection.provider, options.startMs, deps.now());
  if (connection.name === 'garmin' && !existing) {
    const state = (await connection.state.get()).data();
    if (state?.providerMinBackfillStartProviderUserId === connection.account
      && typeof state.providerMinBackfillStartMs === 'number' && Number.isFinite(state.providerMinBackfillStartMs)) {
      startMs = Math.max(startMs, Math.ceil(state.providerMinBackfillStartMs / 1000) * 1000);
    }
  }
  if (!Number.isSafeInteger(startMs) || startMs < options.startMs) throw new Skip('invalid_checkpoint');
  const jobs = buildHealthBackfillJobs(connection.provider, connection.uid, connection.account, startMs, options.endMs, campaign);
  if (!jobs.length) throw new Skip('outside_provider_history');
  return { connection, campaign, run, control, startMs, endMs: options.endMs, jobs,
    overrideCooldownUntilMs: options.overrideCooldownUntilMs };
}

function cooldownOverrideMatches(plan: Plan, state: Record<string, unknown>): boolean {
  return plan.overrideCooldownUntilMs !== undefined
    && plan.overrideCooldownUntilMs === state.nextBackfillAllowedAtMs;
}

async function checkExistingWork(deps: BackfillDependencies, plan: Plan): Promise<void> {
  const [stateSnapshot, controlSnapshot, queue] = await Promise.all([
    plan.connection.state.get(), plan.control.get(),
    deps.db.collection('sleepSyncQueue').where('userID', '==', plan.connection.uid)
      .select('provider', 'type', 'processed', 'healthTrigger', 'rangeStartMs', 'rangeEndMs')
      .limit(USER_QUEUE_SCAN_LIMIT + 1).get(),
  ]);
  if (queue.size > USER_QUEUE_SCAN_LIMIT) throw new Skip('user_queue_scan_limit');
  const control = controlSnapshot.data() || {};
  const state = stateSnapshot.data() || {};
  const ownsCooldown = control.campaign === plan.campaign && control.cooldownUntilMs === state.nextBackfillAllowedAtMs;
  if (Number(state.nextBackfillAllowedAtMs) > deps.now() && !ownsCooldown
    && !cooldownOverrideMatches(plan, state)) throw new Skip('history_cooldown');
  if (Number(control.leaseUntilMs) > deps.now()) throw new Skip('another_script_running');
  const ownIds = new Set(plan.jobs.map(job => job.queueId));
  if (queue.docs.some(doc => {
    const row = doc.data();
    const history = row.healthTrigger === 'backfill' || row.type === 'garmin_health_backfill'
      || ((row.type === 'suunto_poll' || row.type === 'coros_poll')
        && Number(row.rangeEndMs) - Number(row.rangeStartMs) > 7 * 86_400_000);
    return row.provider === plan.connection.provider && row.processed !== true && history && !ownIds.has(doc.id);
  })) throw new Skip('other_history_work_pending');
}

async function guardsMatch(deps: BackfillDependencies, tx: admin.firestore.Transaction, connection: Connection): Promise<boolean> {
  if ((await getUserDeletionGuardStateInTransaction(deps.db, tx, connection.uid, deps.now())).shouldSkip) return false;
  const snapshots = await Promise.all(connection.guards.map(item => tx.get(item.documentRef)));
  return snapshots.every((snapshot, index) => snapshot.exists && Object.entries(connection.guards[index].expectedFields)
    .every(([field, expected]) => snapshot.data()?.[field] === expected));
}

/** A per-provider owner lease serializes scripts, including different ranges/accounts. */
export async function claimPlan(deps: BackfillDependencies, plan: Plan, owner: string): Promise<void> {
  await requirePro(deps, plan.connection.uid);
  await deps.db.runTransaction(async tx => {
    if (!(await guardsMatch(deps, tx, plan.connection))) throw new Skip('connection_changed');
    const [controlSnapshot, stateSnapshot, runSnapshot] = await Promise.all([
      tx.get(plan.control), tx.get(plan.connection.state), tx.get(plan.run),
    ]);
    const control = controlSnapshot.data() || {};
    const state = stateSnapshot.data() || {};
    if (Number(control.leaseUntilMs) > deps.now()) throw new Skip('another_script_running');
    if (Number(state.nextBackfillAllowedAtMs) > deps.now()
      && !(control.campaign === plan.campaign && control.cooldownUntilMs === state.nextBackfillAllowedAtMs)
      && !cooldownOverrideMatches(plan, state)) throw new Skip('history_cooldown');
    if (runSnapshot.exists && runSnapshot.data()?.lifecycle !== plan.connection.lifecycle) throw new Skip('checkpoint_connection_changed');
    const cooldownUntilMs = Math.max(Number(state.nextBackfillAllowedAtMs) || 0,
      deps.now() + getSleepBackfillCooldownMs(plan.connection.provider)!);
    tx.set(plan.control, { campaign: plan.campaign, owner, leaseUntilMs: deps.now() + LEASE_MS, cooldownUntilMs });
    if (!runSnapshot.exists) tx.create(plan.run, {
      campaign: plan.campaign, lifecycle: plan.connection.lifecycle, startMs: plan.startMs, endMs: plan.endMs,
      jobsTotal: plan.jobs.length, createdAtMs: deps.now(),
      ...(cooldownOverrideMatches(plan, state) ? { overriddenCooldownUntilMs: plan.overrideCooldownUntilMs } : {}),
    });
    // Preserve existing success/error timestamps and do not claim historical coverage.
    tx.set(plan.connection.state, { nextBackfillAllowedAtMs: cooldownUntilMs }, { merge: true });
  });
}

async function checkpointWrite(
  deps: BackfillDependencies, plan: Plan, owner: string, job: BackfillJob, fields: Record<string, unknown>,
): Promise<void> {
  await deps.db.runTransaction(async tx => {
    if (!(await guardsMatch(deps, tx, plan.connection))) throw new Skip('connection_changed');
    const control = (await tx.get(plan.control)).data();
    if (control?.owner !== owner || control.campaign !== plan.campaign || Number(control.leaseUntilMs) <= deps.now()) throw new Skip('lease_lost');
    const state = (await tx.get(plan.connection.state)).data();
    if (state?.nextBackfillAllowedAtMs !== control.cooldownUntilMs) throw new Skip('history_cooldown_changed');
    const checkpointRef = plan.run.collection('jobs').doc(job.key);
    const checkpoint = await tx.get(checkpointRef);
    if (fields.observation === 'reserved' && checkpoint.exists) {
      const observation = observeBackfillJob(checkpoint.data(), undefined, false, deps.now());
      if (observation !== 'reserved') throw new Skip('checkpoint_already_submitted_or_unknown');
      // Keep the original ambiguity deadline if an older owner created a reservation
      // between our preview and this transaction. A retry cannot extend it forever.
      fields = { ...fields, reservedAtMs: checkpoint.data()!.reservedAtMs };
    }
    if (fields.observation === 'reserved' && plan.connection.name === 'garmin'
      && !(await tx.get(deps.db.collection('sleepSyncQueue').doc(job.queueId))).exists) {
      // Match the existing worker's terminal-progress ownership contract. Publish
      // before queue creation so a fast worker cannot have progress overwritten.
      tx.set(plan.connection.state, {
        provider: plan.connection.provider,
        lastBackfillQueuedAtMs: plan.endMs,
        lastBackfillStartMs: job.input.rangeStartMs,
        lastBackfillEndMs: plan.endMs,
        lastBackfillQueueItems: 1,
        healthBackfillStatus: 'queued',
        healthBackfillWindowsCompleted: 0,
        healthBackfillWindowsTotal: job.input.garminHealthBackfillWindowsTotal,
        healthBackfillSummaryType: 'dailies',
        updatedAtMs: deps.now(),
      }, { merge: true });
    }
    tx.set(checkpointRef, { queueId: job.queueId, ...fields }, { merge: true });
  });
}

async function releasePlan(deps: BackfillDependencies, plan: Plan, owner: string): Promise<void> {
  await deps.db.runTransaction(async tx => {
    if (!(await guardsMatch(deps, tx, plan.connection))) return;
    const control = await tx.get(plan.control);
    if (control.data()?.owner === owner) tx.update(plan.control, { owner: null, leaseUntilMs: 0 });
  });
}

async function observePlan(deps: BackfillDependencies, plan: Plan) {
  const results = new Map<string, { checkpoint: admin.firestore.DocumentData | undefined; observation: JobObservation }>();
  // Ninety projected document reads per RPC. Never retrieve provider response bodies,
  // callback URLs, or credentials from live/DLQ jobs just to inspect their state.
  for (let offset = 0; offset < plan.jobs.length; offset += 30) {
    const jobs = plan.jobs.slice(offset, offset + 30);
    const refs = jobs.flatMap(job => [
      plan.run.collection('jobs').doc(job.key),
      deps.db.collection('sleepSyncQueue').doc(job.queueId),
      deps.db.collection('failed_jobs').doc(job.queueId),
    ]);
    const snapshots = await deps.db.getAll(...refs, {
      fieldMask: ['reservedAtMs', 'submittedAtMs', 'observation', 'processed', 'resultStatus'],
    });
    jobs.forEach((job, index) => {
      const [checkpoint, queue, failed] = snapshots.slice(index * 3, index * 3 + 3);
      results.set(job.key, {
        checkpoint: checkpoint.data(),
        observation: observeBackfillJob(checkpoint.data(), queue.data(), failed.exists, deps.now()),
      });
    });
  }
  return results;
}

async function pendingCount(deps: BackfillDependencies): Promise<number> {
  return (await deps.db.collection('sleepSyncQueue').where('processed', '==', false).count().get()).data().count;
}

export async function runExistingHealthBackfill(options: BackfillOptions, deps: BackfillDependencies): Promise<BackfillSummary> {
  // Enforce the same narrow scope for imported callers, not only CLI parsing.
  if (options.overrideCooldownUntilMs !== undefined && (!options.uid || options.providers.length !== 1
    || !Number.isSafeInteger(options.overrideCooldownUntilMs) || options.overrideCooldownUntilMs <= 0)) {
    throw new Error('A cooldown override requires one owner, one provider, and an exact observed timestamp.');
  }
  const summary: BackfillSummary = {
    dryRun: !options.execute, project: options.project,
    start: new Date(options.startMs).toISOString(), end: new Date(options.endMs).toISOString(),
    tokenRecordsScanned: 0, eligibleAccounts: 0, accountsSubmitted: 0, jobsPlanned: 0, jobsAttempted: 0, jobsSubmitted: 0,
    observed: { new: 0, reserved: 0, pending: 0, success: 0, skipped: 0, failed: 0, unknown: 0 },
    skipped: {}, failed: 0, incomplete: false,
  };
  const changedUsers = new Set<string>();
  for (const name of options.providers) {
    if (!providerEnabled(name)) { increment(summary.skipped, 'provider_disabled'); continue; }
    // Discover only credential metadata. No provider call, refresh, pin, or credential export.
    let query: admin.firestore.Query = options.uid
      ? deps.db.collection(ROOTS[name]).doc(options.uid).collection('tokens').where('serviceName', '==', SERVICES[name])
      : deps.db.collectionGroup('tokens').where('serviceName', '==', SERVICES[name]);
    query = query.select(...TOKEN_FIELDS).orderBy(admin.firestore.FieldPath.documentId());
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    let scanned = 0;
    while (scanned < options.scanLimit) {
      const page = await (cursor ? query.startAfter(cursor) : query).limit(Math.min(100, options.scanLimit - scanned)).get();
      if (page.empty) break;
      scanned += page.size;
      summary.tokenRecordsScanned += page.size;
      for (const token of page.docs) {
        let plan: Plan | undefined;
        let owner: string | undefined;
        try {
          const connection = await resolveConnection(deps, name, token);
          plan = await makePlan(deps, options, connection);
          await checkExistingWork(deps, plan);
          summary.eligibleAccounts++;
          summary.jobsPlanned += plan.jobs.length;
          const before = summary.jobsSubmitted;
          const observations = await observePlan(deps, plan);
          for (const job of plan.jobs) {
            const result = observations.get(job.key)!;
            summary.observed[result.observation]++;
            const needsSubmission = result.observation === 'new' || result.observation === 'reserved';
            if (!options.execute) continue;
            if (!needsSubmission) {
              // Save observed terminal results beyond the queue TTL, without resetting the queue.
              if (result.checkpoint && ['success', 'skipped', 'failed'].includes(result.observation)
                && result.checkpoint.observation !== result.observation) {
                if (!owner) { owner = randomUUID(); await claimPlan(deps, plan, owner); }
                await checkpointWrite(deps, plan, owner, job, { observation: result.observation, observedAtMs: deps.now() });
              }
              continue;
            }
            if (summary.jobsAttempted >= options.maxJobs
              || (!changedUsers.has(connection.uid) && changedUsers.size >= options.maxUsers)) {
              summary.incomplete = true;
              continue;
            }
            const effectiveStartMs = earliestBackfillStart(connection.provider, job.input.rangeStartMs!, deps.now());
            if (effectiveStartMs > job.input.rangeEndMs!) {
              increment(summary.skipped, 'reserved_range_outside_retention');
              continue;
            }
            if (await pendingCount(deps) >= options.maxPending) {
              increment(summary.skipped, 'queue_backpressure'); summary.incomplete = true; break;
            }
            await requirePro(deps, connection.uid);
            if (!owner) { owner = randomUUID(); await claimPlan(deps, plan, owner); }
            const reservedAtMs = result.checkpoint?.reservedAtMs ?? deps.now();
            const effectiveJob = { ...job, input: {
              ...job.input, rangeStartMs: effectiveStartMs,
              ...(connection.name === 'garmin' ? {
                garminHealthBackfillNextStartMs: effectiveStartMs,
                garminHealthBackfillWindowsTotal: countGarminHealthBackfillRequests(effectiveStartMs, job.input.rangeEndMs!),
              } : {}),
            } };
            await checkpointWrite(deps, plan, owner, effectiveJob, { reservedAtMs, effectiveStartMs, observation: 'reserved' });
            const cooldown = (await plan.control.get()).data()?.cooldownUntilMs;
            // Count ambiguous writes against admission limits too. A rejected call
            // may already have committed and must not allow an unbounded batch.
            summary.jobsAttempted++;
            changedUsers.add(connection.uid);
            await deps.enqueue({
              ...effectiveJob.input, ...connection.queueFields, preserveExisting: true,
              requiredDocumentFieldValues: [
                ...connection.guards,
                { documentRef: plan.control, expectedFields: { campaign: plan.campaign, owner } },
                { documentRef: connection.state, expectedFields: { nextBackfillAllowedAtMs: cooldown } },
              ],
            });
            await checkpointWrite(deps, plan, owner, job, { submittedAtMs: deps.now(), observation: 'pending' });
            summary.jobsSubmitted++;
          }
          if (summary.jobsSubmitted > before) summary.accountsSubmitted++;
        } catch (error) {
          if (error instanceof Skip) increment(summary.skipped, error.reason);
          else summary.failed++; // Provider/Admin errors may contain credentials or identity. Never stringify them.
        } finally {
          if (plan && owner) {
            try { await releasePlan(deps, plan, owner); } catch { summary.failed++; }
          }
        }
      }
      cursor = page.docs[page.docs.length - 1];
      if (page.size < Math.min(100, options.scanLimit - scanned + page.size)) break;
      if (scanned >= options.scanLimit && !(await query.startAfter(cursor).limit(1).get()).empty) summary.incomplete = true;
    }
  }
  return summary;
}

const HELP = `Usage: npm --prefix functions run backfill-existing-health -- --project PROJECT --provider garmin|suunto|coros|all --end YYYY-MM-DD [options]
Dry run by default. --end is an inclusive, completed UTC day; repeat exactly the same range to resume.
--start YYYY-MM-DD     Defaults to 2000-01-01; Garmin is clamped to five years, COROS to three months.
--uid UID             Restrict to one owner.
--execute             Write checkpoints and enqueue jobs. No direct provider calls or Cloud Tasks dispatch.
--confirm-all-users   Required with --execute unless --uid is supplied.
--max-users N         At most N owners receive new jobs per invocation (default 5, max 100).
--max-jobs N          At most N new queue jobs per invocation (default 25, max 250).
--max-pending N       Pause admission at this shared queue depth (default 100, max 1000).
--scan-limit N        Token metadata records per provider (default 1000, max 10000).
--override-cooldown-until ISO  Explicit operator approval for one --uid/provider's exact observed cooldown.
Preserves Pro checks. Workers validate credentials and permissions; dry runs never refresh tokens.
Garmin success means requests finished, NOT all callbacks received. Expired/unobserved jobs remain unknown.
Read docs/health-backfill-operations.md before execution. No automatic connection backfill is installed.`;

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(`${HELP}\n`); return; }
  const options = parseBackfillOptions(argv);
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Use the isolated automated tests for emulator checks; this operator CLI refuses mixed emulator/production configuration.');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: options.project });
  if (admin.app().options.projectId !== options.project) throw new Error('Initialized Firebase project does not match --project.');
  const summary = await runExistingHealthBackfill(options, {
    db: admin.firestore(), auth: admin.auth(), now: Date.now,
    enqueue: async input => {
      const queue = await import('../sleep/queue');
      const malformed = queue.getMalformedSleepQueueItemReason({
        ...input, id: 'admin-admission', dateCreated: Date.now(), processed: false,
        retryCount: 0, dispatchedToCloudTask: null,
      });
      if (malformed) throw new Error('Invalid admin backfill queue shape.');
      return queue.addSleepSyncQueueItem(input);
    },
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed || summary.observed.failed || summary.observed.unknown) process.exitCode = 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    // Only parser errors are actionable text; runtime SDK errors can disclose paths/tokens.
    process.stderr.write('Health backfill stopped. Verify CLI options, ADC/project access, and the aggregate dry-run report. No raw error was logged.\n');
    process.exitCode = 1;
  });
}
