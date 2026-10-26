import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ rows: new Map<string, Record<string, any>>(), rejectCommit: false, retryTransaction: false }));
vi.mock('../token-refresh-coordinator', () => ({ ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD: 'activeOAuthCredentialGeneration' }));
vi.mock('firebase-admin', () => {
  const doc = (path: string): any => ({ path, collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`) });
  return { firestore: () => ({ doc, collection, runTransaction: async (operation: any) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const writes: (() => void)[] = [];
      const tx = {
        get: async (ref: { path: string }) => {
          if (writes.length) throw new Error('Read after write');
          return { exists: mocks.rows.has(ref.path), data: () => structuredClone(mocks.rows.get(ref.path)) };
        },
        create: (ref: { path: string }, data: any) => writes.push(() => {
          if (mocks.rows.has(ref.path)) throw new Error('Already exists');
          mocks.rows.set(ref.path, structuredClone(data));
        }),
        set: (ref: { path: string }, data: any) => writes.push(() => mocks.rows.set(ref.path, { ...mocks.rows.get(ref.path), ...structuredClone(data) })),
      };
      const result = await operation(tx);
      if (mocks.rejectCommit) throw new Error('commit unavailable');
      if (mocks.retryTransaction) { mocks.retryTransaction = false; continue; }
      writes.forEach(write => write()); return result;
    }
  } }) };
});
import { ServiceNames } from '@sports-alliance/sports-lib';
import { startManualActivityHistory } from './manual-activity';
import type { ConnectionHistoryRun } from './model';

const now = Date.parse('2026-10-21T12:00:00Z');
const start = new Date('2026-09-01T21:00:00.000Z'), end = new Date('2026-10-20T20:59:59.999Z');
const metaPath = (service: ServiceNames) => `users/owner/meta/${service}`;
function seed(service: ServiceNames) {
  const roots = { [ServiceNames.GarminAPI]: 'garminAPITokens', [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens', [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens', [ServiceNames.WahooAPI]: 'wahooAPIAccessTokens' };
  const rootPath = `${roots[service as keyof typeof roots]}/owner`;
  mocks.rows.set('users/owner', { uid: 'owner' });
  mocks.rows.set(rootPath, { activeOAuthCredentialGeneration: 'credential' });
  mocks.rows.set(`${rootPath}/tokens/account`, { tokenCredentialGeneration: 'credential', accessToken: 'PRIVATE_TOKEN' });
  mocks.rows.set(metaPath(service), { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' });
  return rootPath;
}
const runs = () => [...mocks.rows.entries()].filter(([path]) => path.startsWith('connectionHistoryImports/'));
beforeEach(() => {
  vi.restoreAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now);
  mocks.rows.clear(); mocks.rejectCommit = false; mocks.retryTransaction = false;
});

describe.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('manual activity admission for %s', service => {
  it('atomically accepts exact dates and only activities without changing the connection or credentials', async () => {
    const root = seed(service);
    const originalRoot = structuredClone(mocks.rows.get(root));
    const originalToken = structuredClone(mocks.rows.get(`${root}/tokens/account`));
    const result = await startManualActivityHistory('owner', service, start, end);
    expect(result).toMatchObject({ active: true, canRetry: false, rangePreset: 'custom', startMs: start.getTime(), endMs: end.getTime(),
      steps: [{ id: 'activities', resources: ['activities'], status: 'queued', count: 0 }] });
    expect(runs()).toHaveLength(1);
    const run = runs()[0][1] as ConnectionHistoryRun;
    expect(run).toMatchObject({ id: result!.runId, tokenPath: `${root}/tokens/account`, credentialGeneration: 'credential', connectionGeneration: 'connection',
      processed: false, revision: 0, nextAttemptAt: now, steps: [{ nextStartMs: start.getTime(), childPaths: [], done: false }] });
    expect(mocks.rows.get(metaPath(service))).toMatchObject({ connectionHistoryImport: result, connectionHistoryReservation: run.id, connectionStateGeneration: 'connection' });
    expect(mocks.rows.get(root)).toEqual(originalRoot);
    expect(mocks.rows.get(`${root}/tokens/account`)).toEqual(originalToken);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|credential|tokenPath|providerUserId|connectionGeneration/);
    expect(mocks.rows.get(metaPath(service))).not.toHaveProperty('didLastHistoryImport');
  });
  it.each(['automatic', 'manual lease', 'reservation', 'cooldown', 'deleted', 'missing user', 'disconnect', 'token replaced', 'token missing'])('rejects %s before writing a run', async reason => {
    const root = seed(service), meta = mocks.rows.get(metaPath(service))!;
    if (reason === 'automatic') meta.connectionHistoryImport = { active: true, runId: 'existing-run' };
    if (reason === 'manual lease') meta.historyImportLeaseExpiresAt = now + 60000;
    if (reason === 'reservation') Object.assign(meta, { connectionHistoryReservation: 'another', connectionHistoryReservationExpiresAt: now + 60000 });
    if (reason === 'cooldown') Object.assign(meta, { didLastHistoryImport: now - 1000, processedActivitiesFromLastHistoryImportCount: 500 });
    if (reason === 'deleted') mocks.rows.set('userDeletionTombstones/owner', {});
    if (reason === 'missing user') mocks.rows.delete('users/owner');
    if (reason === 'disconnect') mocks.rows.get(root)!.disconnectOperationGeneration = 'disconnect';
    if (reason === 'token replaced') mocks.rows.get(`${root}/tokens/account`)!.tokenCredentialGeneration = 'replacement';
    if (reason === 'token missing') mocks.rows.delete(`${root}/tokens/account`);
    await expect(startManualActivityHistory('owner', service, start, end)).rejects.toThrow();
    expect(runs()).toHaveLength(0);
    expect(meta.connectionHistoryImport).toEqual(reason === 'automatic' ? { active: true, runId: 'existing-run' } : undefined);
  });
  it('keeps the existing import path for unversioned legacy connections', async () => {
    const root = seed(service);
    delete mocks.rows.get(root)!.activeOAuthCredentialGeneration;
    await expect(startManualActivityHistory('owner', service, start, end)).resolves.toBeNull();
    expect(runs()).toHaveLength(0);
    expect(mocks.rows.get(metaPath(service))).not.toHaveProperty('connectionHistoryReservation');
  });
  it('does not duplicate an accepted request or falsely acknowledge a failed commit', async () => {
    seed(service); mocks.rejectCommit = true;
    await expect(startManualActivityHistory('owner', service, start, end)).rejects.toThrow('commit unavailable');
    expect(runs()).toHaveLength(0);
    mocks.rejectCommit = false; mocks.retryTransaction = true;
    await startManualActivityHistory('owner', service, start, end);
    await expect(startManualActivityHistory('owner', service, start, end)).rejects.toMatchObject({ code: 'already-exists' });
    expect(runs()).toHaveLength(1);
  });
});

it.each([undefined, 0, 500, 100000])('keeps Garmin admission on its fixed 30-day cooldown with activity count %s', async count => {
  seed(ServiceNames.GarminAPI);
  const meta = mocks.rows.get(metaPath(ServiceNames.GarminAPI))!;
  Object.assign(meta, { didLastHistoryImport: now - 86400000, processedActivitiesFromLastHistoryImportCount: count });
  await expect(startManualActivityHistory('owner', ServiceNames.GarminAPI, start, end)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(runs()).toHaveLength(0);
  meta.didLastHistoryImport = now - 30 * 86400000;
  await expect(startManualActivityHistory('owner', ServiceNames.GarminAPI, start, end)).resolves.toMatchObject({ active: true });
  expect(runs()).toHaveLength(1);
});
