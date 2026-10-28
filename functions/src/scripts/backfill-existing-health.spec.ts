import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { BackfillDependencies, runExistingHealthBackfill } from './backfill-existing-health';
import { BackfillOptions, buildHealthBackfillJobs, CHECKPOINT_COLLECTION, digest, parseBackfillOptions, PROVIDERS } from './health-backfill-plan';

vi.mock('firebase-admin', () => ({ firestore: { FieldPath: { documentId: () => '__name__' } } }));
const hooks = vi.hoisted(() => ({ bindingAllowed: true }));
vi.mock('../suunto/health-webhook-binding-lifecycle', () => ({
  captureCurrentSuuntoWebhookWriteLifecycleGuards: async (db: MemoryDB, uid: string) => hooks.bindingAllowed ? {
    requiredDocumentFieldValues: { documentRef: db.ref(`users/${uid}`), expectedFields: { active: true } },
    additionalRequiredDocumentFieldValues: [],
  } : null,
}));

type Row = Record<string, unknown>;
interface MemorySnapshot {
  exists: boolean; id: string; ref: MemoryRef; data(): Row | undefined;
}
interface MemoryRef {
  path: string; id: string; parent: MemoryQuery;
  collection(name: string): MemoryQuery;
  get(): Promise<MemorySnapshot>;
}
interface MemoryQuery {
  id: string; path: string; parent?: MemoryRef | null;
  doc(id: string): MemoryRef;
  where(key: string, op: string, value: unknown): MemoryQuery;
  limit(n: number): MemoryQuery;
  orderBy(): MemoryQuery;
  startAfter(doc: MemorySnapshot): MemoryQuery;
  select(...mask: string[]): MemoryQuery;
  count(): { get(): Promise<{ data(): { count: number } }> };
  get(): Promise<{ docs: MemorySnapshot[]; size: number; empty: boolean }>;
}
interface MemoryTransaction {
  get(ref: MemoryRef): Promise<MemorySnapshot>;
  set(ref: MemoryRef, data: Row, options?: { merge?: boolean }): void;
  create(ref: MemoryRef, data: Row): void;
  update(ref: MemoryRef, data: Row): void;
}
class MemoryDB {
  rows = new Map<string, Row>();
  writes: Array<{ path: string; data: Row }> = [];
  projections: string[][] = [];
  beforeTransaction?: () => void;
  beforeGet?: (path: string) => void;
  failCheckpointAfterEnqueue = false;
  ref(path: string): MemoryRef {
    return {
      path, id: path.split('/').at(-1)!, parent: this.collection(path.split('/').slice(0, -1).join('/')),
      collection: (name: string) => this.collection(`${path}/${name}`),
      get: async () => {
        this.beforeGet?.(path);
        const data = this.rows.get(path);
        return { exists: !!data, id: path.split('/').at(-1)!, ref: this.ref(path), data: () => data && { ...data } };
      },
    };
  }
  collection(path: string): MemoryQuery { return this.query(path); }
  collectionGroup(name: string): MemoryQuery { return this.query(name, true); }
  private query(path: string, group = false, filters: Array<[string, unknown]> = [], cap = Infinity, after = '', fields?: string[]): MemoryQuery {
    const query: MemoryQuery = {
      id: path.split('/').at(-1)!, path,
      doc: (id: string) => this.ref(`${path}/${id}`),
      where: (key: string, op: string, value: unknown) => {
        if (op !== '==') throw new Error('Unsupported operator in test');
        return this.query(path, group, [...filters, [key, value]], cap, after, fields);
      },
      limit: (n: number) => this.query(path, group, filters, n, after, fields),
      orderBy: () => query,
      startAfter: (doc: MemorySnapshot) => this.query(path, group, filters, cap, doc.ref.path, fields),
      select: (...mask: string[]) => { this.projections.push(mask); return this.query(path, group, filters, cap, after, mask); },
      count: () => ({ get: async () => { const count = (await query.get()).size; return { data: () => ({ count }) }; } }),
      get: async () => {
        const rows = [...this.rows].filter(([p, data]) => {
          const parent = p.split('/').slice(0, -1).join('/');
          return (group ? parent.split('/').at(-1) === path : parent === path)
            && p > after && filters.every(([key, value]) => data[key] === value);
        }).sort(([a], [b]) => a.localeCompare(b)).slice(0, cap);
        const docs = rows.map(([p, data]) => ({
          exists: true, id: p.split('/').at(-1)!, ref: this.ref(p),
          data: () => fields ? Object.fromEntries(fields.filter(f => data[f] !== undefined).map(f => [f, data[f]])) : { ...data },
        }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
    Object.defineProperty(query, 'parent', { get: () => path.includes('/') ? this.ref(path.split('/').slice(0, -1).join('/')) : null });
    return query;
  }
  getAll(...refs: Array<MemoryRef | { fieldMask: string[] }>) {
    const options = refs.find(ref => 'fieldMask' in ref);
    if (options && 'fieldMask' in options) this.projections.push(options.fieldMask);
    return Promise.all(refs.filter((ref): ref is MemoryRef => 'get' in ref).map(ref => ref.get()));
  }
  async runTransaction<T>(fn: (tx: MemoryTransaction) => Promise<T>) {
    this.beforeTransaction?.();
    const staged: Array<{ path: string; data: Row; merge: boolean; create?: boolean }> = [];
    const tx: MemoryTransaction = {
      get: ref => { if (staged.length) throw new Error('Read after write'); return ref.get(); },
      set: (ref, data, options) => { staged.push({ path: ref.path, data, merge: options?.merge === true }); },
      create: (ref, data) => { staged.push({ path: ref.path, data, merge: false, create: true }); },
      update: (ref, data) => { staged.push({ path: ref.path, data, merge: true }); },
    };
    const result = await fn(tx);
    if (this.failCheckpointAfterEnqueue && staged.some(row => row.data.submittedAtMs)) throw new Error('ambiguous checkpoint failure');
    for (const row of staged) {
      if (row.create && this.rows.has(row.path)) throw new Error('already exists');
      this.rows.set(row.path, row.merge ? { ...this.rows.get(row.path), ...row.data } : row.data);
      this.writes.push(row);
    }
    return result;
  }
}

const now = Date.parse('2026-09-07T10:00:00Z');
const ROOTS = { garmin: 'garminAPITokens', suunto: 'suuntoAppAccessTokens', coros: 'COROSAPIAccessTokens' };
const SERVICES = { garmin: ServiceNames.GarminAPI, suunto: ServiceNames.SuuntoApp, coros: ServiceNames.COROSAPI };
let db: MemoryDB;
let deps: BackfillDependencies;
let enqueue: ReturnType<typeof vi.fn>;
let roles: Record<string, Row>;
let options: BackfillOptions;
function connect(name: keyof typeof ROOTS, uid = 'owner', account = 'provider-account') {
  db.rows.set(`users/${uid}`, { active: true });
  db.rows.set(`${ROOTS[name]}/${uid}`, { activeOAuthCredentialGeneration: 'generation' });
  db.rows.set(`users/${uid}/meta/${SERVICES[name]}`, {
    connectionState: 'connected', connectionStateGeneration: 'connection',
    ...(name !== 'suunto' ? { providerUserId: account } : {}),
  });
  db.rows.set(`${ROOTS[name]}/${uid}/tokens/${account}`, {
    serviceName: SERVICES[name], tokenCredentialGeneration: 'generation',
    [name === 'garmin' ? 'userID' : name === 'suunto' ? 'userName' : 'openId']: account,
    permissions: ['HEALTH_EXPORT', 'HISTORICAL_DATA_EXPORT'],
    accessToken: 'secret-access', refreshToken: 'secret-refresh',
  });
}
function execute(extra: Partial<BackfillOptions> = {}) { return runExistingHealthBackfill({ ...options, execute: true, ...extra }, deps); }
function queueRows() { return [...db.rows].filter(([path]) => path.startsWith('sleepSyncQueue/')); }
function checkpointRows() { return [...db.rows].filter(([path]) => path.includes(`/${CHECKPOINT_COLLECTION}/`) && path.includes('/jobs/')); }

beforeEach(() => {
  db = new MemoryDB(); roles = {}; hooks.bindingAllowed = true;
  options = parseBackfillOptions(['--project=test-project', '--provider=all', '--start=2026-07-01', '--end=2026-09-06'], now);
  enqueue = vi.fn(async input => {
    const { createHash } = await import('node:crypto');
    const queueId = createHash('sha256').update([input.provider, input.type, input.providerUserId, input.dedupeKey].join(':')).digest('hex');
    for (const g of input.requiredDocumentFieldValues) {
      const snapshot = await g.documentRef.get();
      if (!snapshot.exists || Object.entries(g.expectedFields).some(([key, value]) => snapshot.data()[key] !== value)) throw new Error('stale admission');
    }
    if (!db.rows.has(`sleepSyncQueue/${queueId}`)) {
      const payload = { ...input };
      delete payload.requiredDocumentFieldValues;
      db.rows.set(`sleepSyncQueue/${queueId}`, { ...payload, processed: false });
    }
    return db.ref(`sleepSyncQueue/${queueId}`);
  });
  deps = {
    db: db as unknown as admin.firestore.Firestore, now: () => now, enqueue,
    auth: { getUser: vi.fn(async uid => ({ disabled: false, customClaims: roles[uid] || { stripeRole: 'pro' } }) as admin.auth.UserRecord) },
  };
});

describe('existing-user Health backfill runner', () => {
  it('makes a metadata-only dry run for all providers with no writes or enqueues', async () => {
    connect('garmin'); connect('suunto'); connect('coros');
    const result = await runExistingHealthBackfill(options, deps);
    expect(result).toMatchObject({ eligibleAccounts: 3, jobsPlanned: 7, jobsSubmitted: 0, failed: 0 });
    expect(db.writes).toEqual([]); expect(enqueue).not.toHaveBeenCalled();
    expect(db.projections.flat()).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toMatch(/owner|provider-account|secret-access|secret-refresh/);
  });
  it('submits to the existing workers and keeps control-only fields out of queue payloads', async () => {
    connect('garmin'); connect('suunto'); connect('coros');
    expect(await execute()).toMatchObject({ jobsSubmitted: 7, failed: 0 });
    expect(new Set(enqueue.mock.calls.map(([job]) => job.type))).toEqual(new Set(['garmin_health_backfill', 'suunto_health_poll', 'coros_poll']));
    for (const [input] of enqueue.mock.calls) {
      expect(input).toMatchObject({ preserveExisting: true, dispatchImmediately: false });
      expect(input.healthTrigger).toBe(input.type === 'coros_poll' ? undefined : 'backfill');
      expect(input.requiredDocumentFieldValues.length).toBeGreaterThan(3);
    }
    expect(JSON.stringify(db.writes)).not.toMatch(/secret-access|secret-refresh|provider-account/);
  });
  it('resumes a bounded run without overwriting an existing cursor', async () => {
    connect('suunto');
    expect(await execute({ maxJobs: 1 })).toMatchObject({ jobsSubmitted: 1, incomplete: true });
    const [path, row] = queueRows()[0]; row.retryCount = 4;
    expect(await execute()).toMatchObject({ jobsSubmitted: 2, failed: 0 });
    expect(db.rows.get(path)?.retryCount).toBe(4);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, observed: { pending: 3 } });
  });
  it('recovers an ambiguous accepted enqueue without re-enqueueing', async () => {
    connect('garmin'); db.failCheckpointAfterEnqueue = true;
    expect(await execute()).toMatchObject({ failed: 1 });
    expect(queueRows()).toHaveLength(1);
    db.failCheckpointAfterEnqueue = false;
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, observed: { pending: 1 } });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('retains success (including empty responses) after queue expiry', async () => {
    connect('garmin'); await execute();
    const [path, row] = queueRows()[0]; row.processed = true; row.resultStatus = 'success';
    expect(await execute()).toMatchObject({ observed: { success: 1 }, jobsSubmitted: 0 });
    db.rows.delete(path);
    expect(await execute()).toMatchObject({ observed: { success: 1 }, jobsSubmitted: 0 });
  });
  it('reports expired unobserved jobs as unknown, never new', async () => {
    connect('garmin'); await execute(); db.rows.delete(queueRows()[0][0]);
    expect(await execute()).toMatchObject({ observed: { unknown: 1 }, jobsSubmitted: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('reports DLQ failures without resetting retries', async () => {
    connect('garmin'); await execute();
    const [path] = queueRows()[0]; db.rows.delete(path); db.rows.set(path.replace('sleepSyncQueue', 'failed_jobs'), { failure: true });
    expect(await execute()).toMatchObject({ observed: { failed: 1 }, jobsSubmitted: 0 });
  });
  it('does not overwrite earlier Sleep import markers', async () => {
    connect('suunto');
    db.rows.set('users/owner/sleepSyncState/SuuntoApp', { lastBackfillQueuedAtMs: 123, lastSyncedAtMs: 456, status: 'ready' });
    await execute();
    expect(db.rows.get('users/owner/sleepSyncState/SuuntoApp')).toMatchObject({ lastBackfillQueuedAtMs: 123, lastSyncedAtMs: 456, status: 'ready' });
  });
  it('publishes Garmin progress with the exact worker ownership fields before submission', async () => {
    connect('garmin');
    const actual = enqueue.getMockImplementation()!;
    enqueue.mockImplementation(async input => {
      expect(db.rows.get('users/owner/sleepSyncState/GarminAPI')).toMatchObject({
        provider: 'GarminAPI', healthBackfillStatus: 'queued',
        lastBackfillEndMs: options.endMs, lastBackfillQueuedAtMs: options.endMs,
        healthBackfillWindowsTotal: input.garminHealthBackfillWindowsTotal,
      });
      return actual(input);
    });
    expect(await execute()).toMatchObject({ jobsSubmitted: 1, failed: 0 });
  });
  it('clips the oldest COROS window as retention advances instead of losing its whole month', async () => {
    connect('coros');
    options.startMs = Date.parse('2016-01-01');
    expect(await execute({ maxJobs: 1 })).toMatchObject({ jobsSubmitted: 1 });
    deps.now = () => now + 86_400_000;
    expect(await execute()).toMatchObject({ jobsSubmitted: 3, failed: 0 });
    expect(enqueue.mock.calls.at(-1)![0].rangeStartMs).toBe(Date.parse('2026-06-08T10:00:00Z'));
  });
  it('clips Garmin history to five years and keeps its cursor and progress aligned on reservation retry', async () => {
    connect('garmin');
    options.startMs = Date.parse('2000-01-01');
    const policyStart = Date.parse('2021-09-07T10:00:00Z');
    // Inclusive endpoint: moving the start by two seconds drops a whole request window.
    options.endMs = policyStart + 90 * 86_400_000;
    enqueue.mockRejectedValueOnce(new Error('queue temporarily unavailable'));
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, failed: 1 });
    const firstInput = enqueue.mock.calls[0][0];
    expect(firstInput).toMatchObject({
      rangeStartMs: policyStart, garminHealthBackfillNextStartMs: policyStart,
      garminHealthBackfillWindowsTotal: 20,
    });
    deps.now = () => now + 2000;
    expect(await execute()).toMatchObject({ jobsSubmitted: 1, failed: 0 });
    const retryInput = enqueue.mock.calls[1][0];
    expect(retryInput).toMatchObject({
      rangeStartMs: policyStart + 2000, garminHealthBackfillNextStartMs: policyStart + 2000,
      garminHealthBackfillWindowsTotal: 10,
    });
    expect(retryInput.dedupeKey).toBe(firstInput.dedupeKey);
    expect(db.rows.get(`users/owner/sleepSyncState/${PROVIDERS.garmin}`)).toMatchObject({
      lastBackfillStartMs: policyStart + 2000, healthBackfillWindowsTotal: 10,
    });
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, failed: 0 });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
  it.each(['pending', 'success', 'failed'])('preserves Garmin %s work that appears after the preview', async observation => {
    connect('garmin');
    // An ambiguous submission left a reservation. Its queue/worker result becomes
    // visible after the retry's preview, but before the retry reserves again.
    enqueue.mockRejectedValueOnce(new Error('ambiguous queue submission'));
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, failed: 1 });
    enqueue.mockClear();
    const statePath = `users/owner/sleepSyncState/${PROVIDERS.garmin}`;
    const campaign = digest(['test-project', PROVIDERS.garmin, options.startMs, options.endMs]);
    const job = buildHealthBackfillJobs(PROVIDERS.garmin, 'owner', 'provider-account', options.startMs, options.endMs, campaign)[0];
    const progress = {
      healthBackfillStatus: observation === 'pending' ? 'running' : observation === 'success' ? 'complete' : 'failed',
      healthBackfillWindowsCompleted: observation === 'success' ? 10 : 9,
      healthBackfillWindowsTotal: 10,
    };
    let injected = false;
    db.beforeTransaction = () => {
      if (injected) return;
      injected = true;
      db.rows.set(statePath, { ...db.rows.get(statePath), ...progress });
      db.rows.set(`${observation === 'failed' ? 'failed_jobs' : 'sleepSyncQueue'}/${job.queueId}`, {
        ...job.input, processed: observation !== 'pending', resultStatus: observation,
      });
    };
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { queue_already_submitted_or_terminal: 1 } });
    expect(enqueue).not.toHaveBeenCalled();
    expect(db.rows.get(statePath)).toMatchObject(progress);
    expect(checkpointRows()).toHaveLength(1);
    expect(checkpointRows()[0][1].observation).toBe('reserved');
  });
  it('respects Pro, missing permissions, inactive accounts, and verified Suunto bindings', async () => {
    connect('garmin', 'free'); roles.free = { stripeRole: 'free' };
    connect('garmin', 'missing-permission'); db.rows.get('garminAPITokens/missing-permission/tokens/provider-account')!.permissions = ['HEALTH_EXPORT'];
    connect('coros', 'inactive'); db.rows.get(`users/inactive/meta/${ServiceNames.COROSAPI}`)!.providerUserId = 'other';
    connect('suunto'); hooks.bindingAllowed = false;
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { pro_required: 1, health_history_permission_missing: 1, inactive_account: 1, provider_verified_binding_missing: 1 } });
    expect(db.writes).toEqual([]);
  });
  it('supports Pro grace periods but rejects disabled Auth users', async () => {
    connect('garmin'); roles.owner = { stripeRole: 'free', gracePeriodUntil: now + 1000 };
    expect(await execute()).toMatchObject({ jobsSubmitted: 1 });
    vi.mocked(deps.auth.getUser).mockResolvedValue({ disabled: true, customClaims: { stripeRole: 'pro' } } as admin.auth.UserRecord);
    expect(await execute()).toMatchObject({ skipped: { auth_disabled: 1 } });
  });
  it.each(['reconnect_required', 'disconnect_pending'])('rejects %s connections', async state => {
    connect('garmin'); db.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`)!.connectionState = state;
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { connection_unavailable: 1 } });
  });
  it('rejects even expired explicit disconnect fences', async () => {
    connect('garmin'); db.rows.get('garminAPITokens/owner')!.disconnectOperationGeneration = 'old-operation';
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { connection_unavailable: 1 } });
  });
  it('does not create any state for missing/deleting owners', async () => {
    connect('garmin'); db.rows.delete('users/owner');
    expect(await execute()).toMatchObject({ skipped: { deleted_or_missing_owner: 1 } });
    db.rows.set('users/owner', {}); db.rows.set('userDeletionTombstones/owner', {});
    expect(await execute()).toMatchObject({ skipped: { deleted_or_missing_owner: 1 } });
    expect(db.writes).toEqual([]);
  });
  it('rechecks deletion inside the claim transaction and rolls back', async () => {
    connect('garmin'); db.beforeTransaction = () => db.rows.set('userDeletionTombstones/owner', {});
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { connection_changed: 1 } });
    expect(db.writes).toEqual([]);
  });
  it('does not checkpoint or recreate state if deletion wins after enqueue', async () => {
    connect('garmin');
    enqueue.mockImplementationOnce(async input => {
      db.rows.set('userDeletionTombstones/owner', {});
      for (const path of db.rows.keys()) if (path.startsWith('users/owner/')) db.rows.delete(path);
      return db.ref(`sleepSyncQueue/${input.dedupeKey}`);
    });
    const result = await execute();
    expect(result.skipped.connection_changed).toBe(1);
    expect([...db.rows.keys()].filter(p => p.startsWith('users/owner/'))).toEqual([]);
  });
  it('does not adopt a reconnected lifecycle on resume', async () => {
    connect('garmin'); await execute();
    db.rows.get('garminAPITokens/owner')!.activeOAuthCredentialGeneration = 'replacement';
    db.rows.get('garminAPITokens/owner/tokens/provider-account')!.tokenCredentialGeneration = 'replacement';
    expect(await execute()).toMatchObject({ skipped: { checkpoint_connection_changed: 1 }, jobsSubmitted: 0 });
  });
  it('does not restart a run on access-token refresh', async () => {
    connect('garmin'); await execute();
    db.rows.get('garminAPITokens/owner/tokens/provider-account')!.accessToken = 'rotated';
    expect(await execute()).toMatchObject({ observed: { pending: 1 }, failed: 0 });
  });
  it('supports Garmin legacy token document names without changing provider identity', async () => {
    connect('garmin');
    const token = db.rows.get('garminAPITokens/owner/tokens/provider-account')!;
    db.rows.delete('garminAPITokens/owner/tokens/provider-account');
    db.rows.set('garminAPITokens/owner/tokens/legacy-document', token);
    expect(await execute()).toMatchObject({ jobsSubmitted: 1, failed: 0 });
    expect(enqueue.mock.calls[0][0].providerUserId).toBe('provider-account');
  });
  it('cannot overwrite a receipt submitted between preview and lease acquisition', async () => {
    connect('garmin');
    // The preview observed no receipt. Another invocation finished before our claim.
    let injected = false;
    db.beforeTransaction = () => {
      if (injected) return;
      injected = true;
      const campaign = digest(['test-project', PROVIDERS.garmin, options.startMs, options.endMs]);
      const run = digest([campaign, 'provider-account']);
      const key = digest([campaign, 'owner', 'provider-account', options.startMs, options.endMs]);
      db.rows.set(`users/owner/sleepSyncState/GarminAPI/${CHECKPOINT_COLLECTION}/${run}/jobs/${key}`, {
        submittedAtMs: now - 1000, observation: 'success',
      });
    };
    expect(await execute()).toMatchObject({ jobsSubmitted: 0, skipped: { checkpoint_already_submitted_or_unknown: 1 } });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('honors other history requests and cooldowns', async () => {
    connect('garmin');
    db.rows.set('sleepSyncQueue/other', { userID: 'owner', provider: PROVIDERS.garmin, type: 'garmin_health_backfill', processed: false });
    expect(await execute()).toMatchObject({ skipped: { other_history_work_pending: 1 } });
    db.rows.delete('sleepSyncQueue/other');
    db.rows.set('users/owner/sleepSyncState/GarminAPI', { nextBackfillAllowedAtMs: now + 1000 });
    expect(await execute()).toMatchObject({ skipped: { history_cooldown: 1 } });
  });
  it('stops on shared queue backpressure without reserving work', async () => {
    connect('garmin'); db.rows.set('sleepSyncQueue/unrelated', { processed: false });
    expect(await execute({ maxPending: 1 })).toMatchObject({ jobsSubmitted: 0, incomplete: true, skipped: { queue_backpressure: 1 } });
    expect(db.writes).toEqual([]);
  });
  it('overrides only the approved cooldown, preserving it and deterministic resume', async () => {
    connect('garmin');
    const until = now + 60 * 86_400_000;
    const statePath = 'users/owner/sleepSyncState/GarminAPI';
    db.rows.set(statePath, { nextBackfillAllowedAtMs: until, lastSuccessfulSyncAtMs: 123 });
    const scoped: BackfillOptions = { ...options, uid: 'owner', providers: ['garmin'], overrideCooldownUntilMs: until };
    expect(await runExistingHealthBackfill(scoped, deps)).toMatchObject({ jobsPlanned: 1, jobsSubmitted: 0 });
    expect(db.writes).toEqual([]);
    expect(await execute({ ...scoped, execute: true })).toMatchObject({ jobsSubmitted: 1, failed: 0 });
    expect(db.rows.get(statePath)).toMatchObject({ nextBackfillAllowedAtMs: until, lastSuccessfulSyncAtMs: 123 });
    expect([...db.rows.values()].some(row => row.overriddenCooldownUntilMs === until)).toBe(true);
    expect(await execute({ ...scoped, execute: true })).toMatchObject({ jobsSubmitted: 0, observed: { pending: 1 } });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('rejects bulk or malformed programmatic cooldown exceptions before reading', async () => {
    await expect(execute({ overrideCooldownUntilMs: now + 1000 })).rejects.toThrow();
    await expect(execute({ uid: 'owner', overrideCooldownUntilMs: now + 1000 })).rejects.toThrow();
    await expect(execute({ uid: 'owner', providers: ['garmin'], overrideCooldownUntilMs: NaN })).rejects.toThrow();
    expect(db.projections).toEqual([]);
  });
  it.each(['mismatch', 'changed', 'pending', 'lease', 'deletion', 'disconnect', 'pro', 'permissions', 'backpressure'])('keeps %s safeguards with a cooldown exception', async scenario => {
    connect('garmin');
    const until = now + 1000;
    const statePath = 'users/owner/sleepSyncState/GarminAPI';
    db.rows.set(statePath, { nextBackfillAllowedAtMs: scenario === 'mismatch' ? until + 1 : until });
    if (scenario === 'changed') db.beforeTransaction = () => { db.rows.get(statePath)!.nextBackfillAllowedAtMs = until + 1; };
    if (scenario === 'pending') db.rows.set('sleepSyncQueue/other', { userID: 'owner', provider: PROVIDERS.garmin, type: 'garmin_health_backfill', processed: false });
    if (scenario === 'lease') db.rows.set(`${statePath}/${CHECKPOINT_COLLECTION}/control`, { leaseUntilMs: now + 1000 });
    if (scenario === 'deletion') db.beforeTransaction = () => { db.rows.set('userDeletionTombstones/owner', {}); };
    if (scenario === 'disconnect') db.beforeTransaction = () => { db.rows.get('garminAPITokens/owner')!.disconnectState = 'disconnecting'; };
    if (scenario === 'pro') roles.owner = {};
    if (scenario === 'permissions') db.rows.get('garminAPITokens/owner/tokens/provider-account')!.permissions = [];
    if (scenario === 'backpressure') db.rows.set('sleepSyncQueue/unrelated', { processed: false });
    const reason = ({ mismatch: 'history_cooldown', changed: 'history_cooldown', pending: 'other_history_work_pending',
      lease: 'another_script_running', deletion: 'connection_changed', disconnect: 'connection_changed', pro: 'pro_required',
      permissions: 'health_history_permission_missing', backpressure: 'queue_backpressure' })[scenario];
    expect(await execute({ uid: 'owner', providers: ['garmin'], overrideCooldownUntilMs: until, maxPending: 1 }))
      .toMatchObject({ jobsSubmitted: 0, skipped: { [reason!]: 1 } });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('bounds owners and only queries the selected owner when requested', async () => {
    connect('garmin', 'one'); connect('garmin', 'two');
    expect(await execute({ maxUsers: 1 })).toMatchObject({ jobsSubmitted: 1, incomplete: true });
    expect(await execute({ uid: 'two' })).toMatchObject({ tokenRecordsScanned: 1, jobsSubmitted: 1 });
  });
  it('paginates token discovery and explicitly reports a scan cap', async () => {
    for (let i = 0; i < 101; i++) connect('garmin', `owner-${i.toString().padStart(3, '0')}`);
    expect(await runExistingHealthBackfill(options, deps)).toMatchObject({ tokenRecordsScanned: 101, eligibleAccounts: 101 });
    expect(await runExistingHealthBackfill({ ...options, scanLimit: 100 }, deps)).toMatchObject({ tokenRecordsScanned: 100, incomplete: true });
  });
  it('serializes overlapping script runs and never releases another owner lease', async () => {
    connect('garmin');
    const controlPath = `users/owner/sleepSyncState/GarminAPI/${CHECKPOINT_COLLECTION}/control`;
    db.rows.set(controlPath, { owner: 'other', leaseUntilMs: now + 1000 });
    expect(await execute()).toMatchObject({ skipped: { another_script_running: 1 } });
    expect(db.rows.get(controlPath)?.owner).toBe('other');
  });
  it('does not leak runtime errors into its aggregate report', async () => {
    connect('garmin'); enqueue.mockRejectedValue(new Error('secret-access provider-account owner'));
    const result = await execute();
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/secret-access|provider-account|owner/);
    expect(checkpointRows()).toHaveLength(1);
  });
  it('counts ambiguous enqueue failures against both job and owner caps', async () => {
    connect('garmin', 'one'); connect('garmin', 'two');
    enqueue.mockRejectedValue(new Error('write outcome unknown'));
    expect(await execute({ maxJobs: 1 })).toMatchObject({ jobsAttempted: 1, jobsSubmitted: 0, failed: 1, incomplete: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    // The same bound must also hold with a larger job budget and a one-owner cap.
    enqueue.mockClear();
    expect(await execute({ maxJobs: 25, maxUsers: 1 })).toMatchObject({ jobsAttempted: 1, failed: 1, incomplete: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
