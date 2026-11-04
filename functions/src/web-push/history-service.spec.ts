import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun, historyProjection, type ConnectionHistoryRun } from '../connection-history/model';
import { sendHistoryCompletion, historyNotificationResult, type HistoryPushDependencies } from './history-service';
import { readHistoryNotificationConsent, validateHistoryNotificationConsent, historyPushConfiguration } from './history-consent';
import { readNotificationCategoryPreference, isNotificationCategory } from '../../../shared/notification-categories';
import { buildHistoryNotificationPayload, isHistoryNotificationTarget } from '../../../shared/history-import-notifications';

const config = vi.hoisted(() => ({ template: vi.fn() }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: config.template }) }));
const id = '00000000-0000-4000-8000-000000000001';
const generation = '00000000-0000-4000-8000-000000000002';
const runId = '00000000-0000-4000-8000-000000000003';
const publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io', now = Date.UTC(2026, 10, 3, 12);
function harness() {
  const run = createHistoryRun('owner', ServiceNames.SuuntoApp, { requested: true, rangePreset: '30_days', runId,
    providerUserId: 'account', tokenPath: 'tokens/owner/tokens/account', rootPath: 'tokens/owner', credentialGeneration: 'credential' }, 'connection', now - 1000);
  Object.assign(run, { rangePreset: 'custom', processed: true, updatedAtMs: now, revision: 1,
    notification: { installationId: id, generation, origin, categoryRevision: 0 } });
  run.steps = run.steps.filter(step => step.id === 'activities');
  Object.assign(run.steps[0], { done: true, status: 'processed', nextStartMs: run.endMs + 1, count: 2000 });
  const registration = { schemaVersion: 1, generation, origin, vapidPublicKey: publicKey,
    endpoint: 'https://web.push.apple.com/private-canary', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } };
  const rows = new Map<string, any>([['users/owner', {}], [`users/owner/pushSubscriptions/${id}`, registration]]);
  const seed = (value: ConnectionHistoryRun) => {
    rows.set(`connectionHistoryImports/${value.id}`, value);
    rows.set(`users/owner/meta/${value.serviceName}`, { connectionState: 'connected', connectionStateGeneration: value.connectionGeneration,
      connectionHistoryImport: historyProjection(value) });
  };
  seed(run);
  let lock = Promise.resolve(); let commits = 0;
  const hooks: { afterCommit(count: number): void } = { afterCommit: () => undefined };
  const db = { doc: (path: string) => ({ path }), collection: (path: string) => ({ doc: (uid: string) => ({ path: `${path}/${uid}` }) }),
    runTransaction: (fn: (tx: any) => Promise<unknown>) => {
      const operation = lock.then(async () => {
        const writes: (() => void)[] = [];
        const tx = { get: async ({ path }: { path: string }) => {
          if (writes.length) throw new Error('Read after write');
          return { exists: rows.has(path), data: () => structuredClone(rows.get(path)) };
        }, set: ({ path }: { path: string }, value: unknown) => writes.push(() => rows.set(path, structuredClone(value))),
        update: ({ path }: { path: string }, value: unknown) => writes.push(() => rows.set(path, { ...rows.get(path), ...structuredClone(value) })),
        delete: ({ path }: { path: string }) => writes.push(() => rows.delete(path)) };
        const result = await fn(tx); writes.forEach(write => write()); hooks.afterCommit(++commits); return result;
      });
      lock = operation.then(() => undefined, () => undefined); return operation;
    } } as unknown as Firestore;
  const deps: HistoryPushDependencies = { db, now: () => now, configuration: vi.fn(async () => ({ enabled: true, publicKey })),
    send: vi.fn(async () => ({})), outcome: vi.fn() };
  return { run, registration, rows, deps, hooks, seed, send: () => sendHistoryCompletion(run.id, structuredClone(run), deps) };
}
describe('history completion notification policy', () => {
  it.each([1, 3])('does not replay an ambiguous transaction acknowledgement after commit %s', async commit => {
    const h = harness();
    h.hooks.afterCommit = count => { if (count === commit) throw new Error('Commit acknowledgement lost'); };
    await expect(h.send()).rejects.toThrow('Commit acknowledgement lost');
    h.hooks.afterCommit = () => {};
    await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(commit === 1 ? 0 : 1);
  });
  it('sends one generic declarative/worker-compatible result for 2,000 records, including concurrent redelivery', async () => {
    const h = harness(); await Promise.all([h.send(), h.send(), h.send()]);
    expect(h.deps.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]);
    expect(payload.web_push).toBe(8030);
    expect(payload.notification).toMatchObject({ body: expect.stringContaining('has finished'), tag: 'qs-history-import', renotify: false,
      icon: `${origin}/assets/favicons/android-chrome-192x192.png` });
    expect(payload.notification.navigate).toBe(origin + payload.notification.data.onActionClick.default.url);
    expect(payload.notification.navigate).toContain('tool=history');
    expect(JSON.stringify(payload)).not.toMatch(/2000|private-canary|account|credential/);
  });
  it('distinguishes a completed scan with failures from an import that stopped early', async () => {
    const h = harness(); Object.assign(h.run.steps[0], { status: 'failed', failedChildPaths: ['failed/one'] });
    expect(historyNotificationResult(h.run)).toBe('issues');
    h.run.steps[0].childPaths = ['queued/one']; expect(historyNotificationResult(h.run)).toBe('attention');
    h.run.steps[0].childPaths = []; h.run.steps[0].nextStartMs = h.run.startMs;
    expect(historyNotificationResult(h.run)).toBe('attention');
    await h.send(); expect(vi.mocked(h.deps.send).mock.calls[0][1]).toContain('needs attention');
  });
  it.each(['unconsented', 'active', 'pending child', 'automatic history', 'Garmin', 'stale event', 'deleted run', 'deleted user', 'missing user',
    'revoked', 'rotated', 'beta', 'wrong key', 'disconnected', 'reconnected', 'newer run', 'expired', 'future'])('suppresses %s', async reason => {
    const h = harness(); const expected = structuredClone(h.run);
    if (reason === 'unconsented') { delete h.run.notification; delete expected.notification; }
    if (reason === 'active') h.run.processed = false;
    if (reason === 'pending child') h.run.steps[0].childPaths = ['pending/child'];
    if (reason === 'automatic history') h.run.rangePreset = '30_days';
    if (reason === 'Garmin') h.run.serviceName = ServiceNames.GarminAPI;
    if (reason === 'stale event') h.run.revision++;
    if (reason === 'deleted run') h.rows.delete(`connectionHistoryImports/${runId}`);
    if (reason === 'deleted user') h.rows.set('userDeletionTombstones/owner', {});
    if (reason === 'missing user') h.rows.delete('users/owner');
    if (reason === 'revoked') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    if (reason === 'rotated') h.registration.generation = runId;
    if (reason === 'beta') h.registration.origin = 'https://beta.quantified-self.io';
    if (reason === 'wrong key') h.registration.vapidPublicKey = 'B' + 'Z'.repeat(86);
    const meta = h.rows.get(`users/owner/meta/${ServiceNames.SuuntoApp}`);
    if (reason === 'disconnected') meta.connectionState = 'disconnect-pending';
    if (reason === 'reconnected') meta.connectionStateGeneration = 'replacement';
    if (reason === 'newer run') meta.connectionHistoryImport.runId = 'newer';
    if (reason === 'expired') h.run.updatedAtMs = now - 86400001;
    if (reason === 'future') h.run.updatedAtMs = now + 1;
    await sendHistoryCompletion(runId, expected, h.deps); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it.each(['off', 'off then on', 'malformed', 'missing consent revision'])('suppresses category preference: %s', async reason => {
    const h = harness();
    if (reason === 'missing consent revision') delete (h.run.notification as Partial<typeof h.run.notification>).categoryRevision;
    else h.rows.set('users/owner/notificationPreferences/history_import', reason === 'malformed' ? {} : {
      schemaVersion: 1, enabled: reason !== 'off', revision: reason === 'off' ? 1 : 2,
    });
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('allows a newly consented import after the category is re-enabled', async () => {
    const h = harness(); h.run.notification!.categoryRevision = 2;
    h.rows.set('users/owner/notificationPreferences/history_import', { schemaVersion: 1, enabled: true, revision: 2 });
    await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('rechecks category preference after the claim commits', async () => {
    const h = harness(); h.hooks.afterCommit = count => {
      if (count === 1) h.rows.set('users/owner/notificationPreferences/history_import', { schemaVersion: 1, enabled: false, revision: 1 });
    };
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect(h.deps.outcome).toHaveBeenCalledWith('cancelled');
  });
  it('does not repeat a notification after an explicit retry changes the terminal result', async () => {
    const h = harness(); h.run.steps[0].status = 'failed'; await h.send();
    h.run.steps[0].status = 'processed'; h.run.revision++; await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(1);
  });
  it('caps all three providers together and retains the suppression beyond the rolling window', async () => {
    const h = harness(); await h.send();
    h.run.serviceName = ServiceNames.COROSAPI; h.run.id = generation; h.seed(h.run); await h.send();
    h.run.serviceName = ServiceNames.WahooAPI; h.run.id = id; h.seed(h.run); await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2); expect(h.deps.outcome).toHaveBeenCalledWith('limited');
    h.deps.now = () => now + 86400001; h.run.updatedAtMs = h.deps.now(); h.run.revision++; await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2);
    expect(Object.keys(h.rows.get('users/owner/pushState/historyCompletion').providers)).toHaveLength(3);
  });
  it('never replays an uncertain external send', async () => {
    const h = harness(); h.deps.send = vi.fn().mockRejectedValue(new Error('private-canary'));
    await h.send(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(1);
    expect(h.deps.outcome).toHaveBeenCalledWith('failed');
    expect(JSON.stringify(h.rows.get('users/owner/pushState/historyCompletion'))).not.toContain('private-canary');
  });
  it.each(['revoked', 'deleted', 'run resumed'])('rechecks %s after claiming and before sending', async reason => {
    const h = harness(); h.hooks.afterCommit = count => {
      if (count !== 1) return;
      if (reason === 'revoked') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
      if (reason === 'deleted') h.rows.set('userDeletionTombstones/owner', {});
      if (reason === 'run resumed') h.run.processed = false;
    };
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it.each([404, 410])('cleans only the expired registration generation on %s', async statusCode => {
    const h = harness(); h.deps.send = vi.fn().mockRejectedValue({ statusCode }); await h.send();
    expect(h.rows.has(`users/owner/pushSubscriptions/${id}`)).toBe(false);
    const replacement = harness(); replacement.deps.send = vi.fn(async () => {
      replacement.rows.set(`users/owner/pushSubscriptions/${id}`, { ...replacement.registration, generation: runId }); throw { statusCode };
    });
    await replacement.send(); expect(replacement.rows.get(`users/owner/pushSubscriptions/${id}`).generation).toBe(runId);
  });
  it('does not read or send when completion has no consent; the switch blocks sending before claiming', async () => {
    const h = harness(); delete h.run.notification; await h.send(); expect(h.deps.configuration).not.toHaveBeenCalled();
    const disabled = harness(); disabled.deps.configuration = async () => ({ enabled: false, publicKey });
    await disabled.send(); expect(disabled.deps.send).not.toHaveBeenCalled(); expect(disabled.rows.has('users/owner/pushState/historyCompletion')).toBe(false);
  });
});
describe('one-import consent boundary', () => {
  it('accepts only an exact target from a production owner request', async () => {
    const h = harness(); const target = { installationId: id, generation };
    expect(readHistoryNotificationConsent(target, origin, undefined)).toEqual({ ...target, origin });
    expect(readHistoryNotificationConsent(undefined, undefined, 'admin')).toBeUndefined();
    for (const value of [null, false, {}, { ...target, uid: 'other' }, { ...target, endpoint: 'injected' }]) {
      expect(isHistoryNotificationTarget(value)).toBe(false);
      expect(() => readHistoryNotificationConsent(value, origin, undefined)).toThrow();
    }
    expect(() => readHistoryNotificationConsent(target, 'https://beta.quantified-self.io', undefined)).toThrow();
    expect(() => readHistoryNotificationConsent(target, origin, 'admin')).toThrow();
    await h.deps.db.runTransaction(tx => validateHistoryNotificationConsent(h.deps.db, tx, 'owner', h.run.serviceName, { ...target, origin }, publicKey));
    await expect(h.deps.db.runTransaction(tx => validateHistoryNotificationConsent(h.deps.db, tx, 'other', h.run.serviceName, { ...target, origin }, publicKey))).rejects.toThrow();
    await expect(h.deps.db.runTransaction(tx => validateHistoryNotificationConsent(h.deps.db, tx, 'owner', ServiceNames.GarminAPI, { ...target, origin }, publicKey))).rejects.toThrow();
    expect(() => buildHistoryNotificationPayload('https://beta.quantified-self.io', h.run.serviceName, 'finished')).toThrow();
  });
  it('requires both unconditional switches; absent or targeted configuration stays off', async () => {
    const parameters = { web_push_enabled: { defaultValue: { value: 'true' } }, web_push_history_import_enabled: { defaultValue: { value: 'true' } },
      web_push_vapid_public_key: { defaultValue: { value: publicKey } } };
    config.template.mockResolvedValue({ parameters }); expect(await historyPushConfiguration()).toEqual({ enabled: true, publicKey });
    config.template.mockResolvedValue({ parameters: { ...parameters, web_push_history_import_enabled: undefined } });
    expect((await historyPushConfiguration()).enabled).toBe(false);
    config.template.mockResolvedValue({ parameters: { ...parameters, web_push_history_import_enabled: { ...parameters.web_push_history_import_enabled, conditionalValues: { beta: { value: 'true' } } } } });
    expect((await historyPushConfiguration()).enabled).toBe(false);
  });
});

describe('notification category defaults', () => {
  it('defaults new categories on but rejects malformed stored preferences', () => {
    expect(isNotificationCategory('history_import')).toBe(true);
    expect(isNotificationCategory('unknown')).toBe(false);
    expect(readNotificationCategoryPreference(undefined)).toEqual({ enabled: true, revision: 0 });
    expect(readNotificationCategoryPreference({ schemaVersion: 1, enabled: false, revision: 1 })).toEqual({ enabled: false, revision: 1 });
    for (const value of [null, {}, [], { schemaVersion: 1, enabled: 'true', revision: 1 },
      { schemaVersion: 1, enabled: true, revision: 0 }, { schemaVersion: 1, enabled: true, revision: 1.5 },
      { schemaVersion: 2, enabled: true, revision: 1 }, { schemaVersion: 1, enabled: true, revision: 1, other: true }]) {
      expect(readNotificationCategoryPreference(value)).toBeNull();
    }
  });
});
