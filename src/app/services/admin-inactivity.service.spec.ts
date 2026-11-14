import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { AdminInactivityService } from './admin-inactivity.service';
import type { InactivitySettings } from '@shared/admin-inactivity';
const { write, reference } = vi.hoisted(() => ({ write: vi.fn(), reference: vi.fn() }));
vi.mock('app/firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('app/firebase/firestore')>(), setDoc: write,
  doc: reference, serverTimestamp: () => 'synthetic-server-time',
}));
describe('AdminInactivityService', () => {
  const auth = { currentUser: { uid: 'admin' } as { uid: string } | null };
  const functions = { call: vi.fn() };
  const settings: InactivitySettings = { mode: 'warnings-only', warningDailyLimit: 10, deletionDailyLimit: 0, revision: 2 };
  let service: AdminInactivityService;
  beforeEach(() => {
    auth.currentUser = { uid: 'admin' }; write.mockReset().mockResolvedValue(undefined); reference.mockReset().mockReturnValue('settings-ref');
    functions.call.mockReset().mockResolvedValue({ data: { accounts: [] } });
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} },
      { provide: AppFunctionsService, useValue: functions }] });
    service = TestBed.inject(AdminInactivityService);
  });
  it('reads through the bounded admin projection', async () => {
    expect(await service.read({ view: 'warned', afterUid: 'synthetic' })).toEqual({ accounts: [] });
    expect(functions.call).toHaveBeenCalledWith('getInactivityAdmin', { view: 'warned', afterUid: 'synthetic' }, { canExecute: expect.any(Function) });
  });
  it('writes only validated settings, revision and attribution', async () => {
    await service.save(settings, 'admin');
    expect(reference).toHaveBeenCalledWith({}, 'configuration/inactiveAccounts');
    expect(write).toHaveBeenCalledExactlyOnceWith('settings-ref', { mode: 'warnings-only', warningDailyLimit: 10, deletionDailyLimit: 0,
      settingsRevision: 3, settingsUpdatedAt: 'synthetic-server-time', settingsUpdatedBy: 'admin' }, { merge: true });
  });
  it.each([{ warningDailyLimit: 101 }, { warningDailyLimit: -1 }, { deletionDailyLimit: 26 }, { deletionDailyLimit: 0.5 },
    { revision: Number.MAX_SAFE_INTEGER }, { revision: -1 }])('rejects invalid settings %j', async patch => {
    await expect(service.save({ ...settings, ...patch }, 'admin')).rejects.toThrow('Invalid retention settings');
    expect(write).not.toHaveBeenCalled();
  });
  it('does not read or save after logout or with another owner', async () => {
    await expect(service.save(settings, 'other-admin')).rejects.toThrow('account changed');
    auth.currentUser = null;
    await expect(service.read({ view: 'queued' })).rejects.toThrow();
    await expect(service.save(settings, 'admin')).rejects.toThrow();
    expect(write).not.toHaveBeenCalled(); expect(functions.call).not.toHaveBeenCalled();
  });
  it('discards a response when the account changes during the read', async () => {
    let finish!: (value: unknown) => void;
    functions.call.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = service.read({ view: 'queued' });
    auth.currentUser = { uid: 'other' }; finish({ data: { accounts: [] } });
    await expect(pending).rejects.toThrow('account changed');
  });
});
