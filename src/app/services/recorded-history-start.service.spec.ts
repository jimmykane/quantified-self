import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore } from 'app/firebase/firestore';
import { AppUserService } from './app.user.service';
import { RecordedHistoryStartService } from './recorded-history-start.service';

const sdk = vi.hoisted(() => ({ getDocs: vi.fn(), getDoc: vi.fn(), query: vi.fn((...parts) => parts),
  collection: vi.fn((...parts) => parts), doc: vi.fn((...parts) => parts), where: vi.fn((...parts) => parts),
  orderBy: vi.fn((...parts) => parts), limit: vi.fn(value => ['limit', value]) }));
vi.mock('app/firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('app/firebase/firestore')>(),
  collection: sdk.collection, doc: sdk.doc, query: sdk.query, where: sdk.where, orderBy: sdk.orderBy,
  limit: sdk.limit, documentId: () => '__name__', getDocsFromServer: sdk.getDocs, getDocFromServer: sdk.getDoc }));

describe('first stored history reads', () => {
  const owner = signal<{ uid: string } | null>({ uid: 'owner' });
  const snapshot = (data: object | null) => ({ empty: !data, docs: data ? [{ data: () => data }] : [] });
  beforeEach(() => {
    vi.clearAllMocks(); owner.set({ uid: 'owner' });
    sdk.getDocs.mockResolvedValue(snapshot(null)); sdk.getDoc.mockResolvedValue({ data: () => undefined });
    TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} },
      { provide: AppUserService, useValue: { user: owner } }] });
  });
  it('reads at most one owner record, keeping provider filters and recorded calendar dates', async () => {
    sdk.getDocs.mockResolvedValueOnce(snapshot({ sleepDate: '2026-09-12' }))
      .mockResolvedValueOnce(snapshot({ calendarDate: '2026-09-13' }));
    const service = TestBed.inject(RecordedHistoryStartService);
    expect(await service.firstSleepDate('owner', 'GarminAPI')).toBe('2026-09-12');
    expect(await service.firstHealthDate('owner', 'SuuntoApp')).toBe('2026-09-13');
    expect(sdk.collection.mock.calls.map(call => call.slice(1))).toEqual([
      ['users', 'owner', 'sleepSessions'], ['users', 'owner', 'healthSourceRecords'],
    ]);
    expect(sdk.where.mock.calls).toEqual([['source.provider', '==', 'GarminAPI'], ['source.provider', '==', 'SuuntoApp']]);
    expect(sdk.orderBy.mock.calls).toEqual([['sleepDate', 'asc'], ['__name__', 'asc'], ['calendarDate', 'asc'], ['__name__', 'asc']]);
    expect(sdk.limit.mock.calls).toEqual([[1], [1]]);
  });
  it('supports all-source diagnostics without silently adding a preferred provider', async () => {
    const service = TestBed.inject(RecordedHistoryStartService);
    expect(await service.firstSleepDate('owner')).toBeNull();
    expect(await service.firstHealthDate('owner')).toBeNull();
    expect(sdk.where).not.toHaveBeenCalled();
  });
  it('does not turn failed or malformed reads into no stored data', async () => {
    const service = TestBed.inject(RecordedHistoryStartService);
    sdk.getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(service.firstHealthDate('owner')).rejects.toThrow('offline');
    sdk.getDocs.mockResolvedValueOnce(snapshot({ sleepDate: '2026-02-30' }));
    await expect(service.firstSleepDate('owner')).rejects.toThrow('date unavailable');
  });
  it('rejects other, missing and cancelled owners before making a private read', async () => {
    const service = TestBed.inject(RecordedHistoryStartService), controller = new AbortController();
    await expect(service.firstSleepDate('other')).rejects.toThrow('account or view changed');
    controller.abort(); await expect(service.firstHealthDate('owner', undefined, controller.signal)).rejects.toThrow();
    owner.set(null);
    await expect(service.lastReportedGarminSleepCutoff('owner')).rejects.toThrow();
    expect(sdk.getDocs).not.toHaveBeenCalled(); expect(sdk.getDoc).not.toHaveBeenCalled();
  });
  it.each(['owner', 'other', null])('rejects late results across account replacement (%s)', async uid => {
    let finish!: (value: unknown) => void;
    sdk.getDocs.mockReturnValue(new Promise(done => finish = done));
    const pending = TestBed.inject(RecordedHistoryStartService).firstSleepDate('owner');
    owner.set(uid ? { uid } : null); finish(snapshot({ sleepDate: '2026-09-12' }));
    await expect(pending).rejects.toThrow('account or view changed');
  });
  it('reads only the existing last-reported Sleep cutoff without projecting account identity or inferring Health limits', async () => {
    const service = TestBed.inject(RecordedHistoryStartService), cutoff = Date.parse('2026-09-12T05:00:00Z');
    sdk.getDoc.mockResolvedValue({ data: () => ({ providerMinBackfillStartMs: cutoff, providerMinBackfillStartProviderUserId: 'private' }) });
    expect(await service.lastReportedGarminSleepCutoff('owner')).toBe(cutoff);
    expect(sdk.doc.mock.calls[0].slice(1)).toEqual(['users', 'owner', 'sleepSyncState', 'GarminAPI']);
    sdk.getDoc.mockResolvedValue({ data: () => ({ providerMinBackfillStartMs: 'invalid' }) });
    expect(await service.lastReportedGarminSleepCutoff('owner')).toBeNull();
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });
});
