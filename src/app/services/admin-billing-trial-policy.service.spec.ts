import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { AdminBillingTrialPolicyService } from './admin-billing-trial-policy.service';
const { get, set, transaction, read } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), transaction: vi.fn(), read: vi.fn() }));
vi.mock('app/firebase/firestore', async original => ({ ...await original<typeof import('app/firebase/firestore')>(),
  doc: (_db: unknown, path: string) => path, getDocFromServer: read, runTransaction: transaction, serverTimestamp: () => 'server-time',
}));
describe('AdminBillingTrialPolicyService', () => {
  const auth = { currentUser: { uid: 'admin' } as { uid: string } | null };
  let service: AdminBillingTrialPolicyService;
  beforeEach(() => {
    vi.clearAllMocks(); auth.currentUser = { uid: 'admin' };
    get.mockResolvedValue({ data: () => undefined }); read.mockResolvedValue({ data: () => undefined });
    transaction.mockImplementation((_db, callback) => callback({ get, set }));
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: auth }, { provide: Firestore, useValue: {} }] });
    service = TestBed.inject(AdminBillingTrialPolicyService);
  });
  it('preserves price offers when no policy has been configured', async () => {
    expect(await service.read()).toEqual({ policy: { revision: 0, basicTrialDays: null, proTrialDays: null }, updatedAt: null, updatedBy: null });
  });
  it('atomically records validated settings, the previous terms and administrator', async () => {
    await service.save({ revision: 0, basicTrialDays: 0, proTrialDays: 14 }, 'admin');
    expect(set.mock.calls).toEqual([
      ['configuration/billingTrials', { revision: 1, basicTrialDays: 0, proTrialDays: 14, updatedAt: 'server-time' }],
      ['configuration/billingTrials/history/1', { revision: 1, basicTrialDays: 0, proTrialDays: 14, updatedAt: 'server-time', updatedBy: 'admin', previous: { revision: 0, basicTrialDays: null, proTrialDays: null } }],
    ]);
  });
  it('rejects stale editors and does not write unchanged settings', async () => {
    await expect(service.save({ revision: 1, basicTrialDays: 0, proTrialDays: 7 }, 'admin')).rejects.toThrow('Refresh');
    await service.save({ revision: 0, basicTrialDays: null, proTrialDays: null }, 'admin');
    expect(set).not.toHaveBeenCalled();
  });
  it.each([{ basicTrialDays: 45 }, { proTrialDays: '14' }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER }])('rejects invalid settings %j', async patch => {
    await expect(service.save({ revision: 0, basicTrialDays: 0, proTrialDays: 14, ...patch } as never, 'admin')).rejects.toThrow('Invalid');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects account changes before a transaction commits', async () => {
    get.mockImplementation(async () => { auth.currentUser = { uid: 'other' }; return { data: () => undefined }; });
    await expect(service.save({ revision: 0, basicTrialDays: 0, proTrialDays: 14 }, 'admin')).rejects.toThrow('account changed');
    expect(set).not.toHaveBeenCalled();
  });
  it('does not read or write when signed out or for another administrator', async () => {
    await expect(service.save({ revision: 0, basicTrialDays: 0, proTrialDays: 0 }, 'other')).rejects.toThrow();
    auth.currentUser = null;
    await expect(service.read()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  });
});
