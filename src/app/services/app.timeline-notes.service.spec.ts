import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTimelineNotesService, loadTimelineNotePages } from './app.timeline-notes.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { Firestore, getDocsFromServer, where, orderBy } from 'app/firebase/firestore';

vi.mock('app/firebase/firestore', () => ({ Firestore: class {}, collection: vi.fn(), query: vi.fn((...args) => args),
  where: vi.fn(), orderBy: vi.fn(), documentId: () => '__name__', limit: vi.fn(), startAfter: vi.fn(), getDocsFromServer: vi.fn() }));
const range = { startDate: '2026-09-01', endDate: '2026-09-30' };
const data = { category: 'vacation', title: 'Away', startDate: '2026-08-01', endDate: '2026-09-03', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const row = (i: number) => ({ id: i.toString(16).padStart(64, '0'), data });
describe('bounded timeline pages', () => {
  it('retains hidden records for the manager and counts them toward the same bounded load', async () => {
    const hidden = { ...row(1), data: { ...data, showOnCharts: false } };
    const result = await loadTimelineNotePages(range, async ongoing => ({ rows: ongoing ? [] : [hidden, row(2)], cursor: null }), () => true);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toMatchObject({ showOnCharts: false });
  });
  it('merges closed and ongoing pages and preserves earlier overlap', async () => {
    const read = vi.fn(async (ongoing, cursor) => ({ rows: ongoing ? [] : cursor ? [row(65)] : Array.from({ length: 65 }, (_, i) => row(i)), cursor: 64 }));
    const result = await loadTimelineNotePages(range, read, () => true);
    expect(result.notes).toHaveLength(65);
    expect(result.incomplete).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('caps records even when every page is full', async () => {
    let page = 0;
    const read = vi.fn(async () => ({ rows: Array.from({ length: 65 }, (_, i) => row(page * 64 + i)), cursor: ++page }));
    const result = await loadTimelineNotePages(range, read, () => true);
    expect(result.notes).toHaveLength(512);
    expect(result.incomplete).toBe('records');
    expect(read).toHaveBeenCalledTimes(8);
  });
  it('caps UTF-8 bytes before decoding malformed oversized data', async () => {
    const result = await loadTimelineNotePages(range, async () => ({ rows: [{ id: row(1).id, data: { ...data, details: 'é'.repeat(1_100_000) } }], cursor: null }), () => true);
    expect(result.incomplete).toBe('bytes');
    expect(result.notes).toEqual([]);
  });
  it('rejects cancellation after a page returns', async () => {
    let active = true;
    await expect(loadTimelineNotePages(range, async () => { active = false; return { rows: [row(1)], cursor: null }; }, () => active)).rejects.toThrow('cancelled');
  });
});
describe('AppTimelineNotesService', () => {
  let service: AppTimelineNotesService;
  const user$ = new BehaviorSubject({ uid: 'owner', settings: { appSettings: {} } });
  const auth = { user$, currentUser: { uid: 'owner' } };
  const functions = { call: vi.fn() };
  const users = { updateUserProperties: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); user$.next({ uid: 'owner', settings: { appSettings: {} } }); auth.currentUser = { uid: 'owner' };
    TestBed.configureTestingModule({ providers: [AppTimelineNotesService, { provide: Firestore, useValue: {} },
      { provide: AppAuthService, useValue: auth }, { provide: AppFunctionsService, useValue: functions }, { provide: AppUserService, useValue: users }] });
    service = TestBed.inject(AppTimelineNotesService);
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [], size: 0 } as never);
  });
  it('uses owner-scoped closed and ongoing indexed queries and shares overlapping loads', async () => {
    await Promise.all([service.loadRange('owner', range), service.loadRange('owner', { startDate: '2026-09-02', endDate: '2026-09-03' })]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledWith('endDate', '==', null);
    expect(where).toHaveBeenCalledWith('endDate', '>=', range.startDate);
    expect(orderBy).toHaveBeenCalledWith('endDate', 'asc');
    expect(service.showOnCharts()).toBe(true);
  });
  it('clears cached notes and refuses old ownership after an account switch', async () => {
    await service.loadRange('owner', range);
    auth.currentUser = { uid: 'other' }; user$.next({ uid: 'other', settings: { appSettings: {} } });
    expect(() => service.loadRange('owner', range)).toThrow('account changed');
    await service.loadRange('other', range);
    expect(getDocsFromServer).toHaveBeenCalledTimes(4);
  });
  it('stores only the visibility preference and invalidates after a mutation', async () => {
    await service.setShowOnCharts('owner', false);
    expect(users.updateUserProperties).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner' }), { settings: { appSettings: { timelineNotes: { showOnCharts: false } } } });
    const spy = vi.fn(); service.changes$.subscribe(spy);
    functions.call.mockResolvedValueOnce({ data: { ...data, id: row(1).id } });
    await service.save('owner', { ...data, category: 'vacation', mode: 'create', clientMutationId: 'id' });
    expect(spy).toHaveBeenCalledOnce();
  });
  it('keeps hidden notes in paginated management and forwards per-note visibility through the existing save', async () => {
    const hidden = { ...data, showOnCharts: false };
    vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs: [{ id: row(1).id, data: () => hidden }], size: 1 } as never);
    expect((await service.list('owner')).notes[0]).toMatchObject({ showOnCharts: false });
    functions.call.mockResolvedValueOnce({ data: { ...hidden, id: row(1).id } });
    const request = { ...hidden, category: 'vacation' as const, mode: 'update' as const, noteId: row(1).id, expectedRevision: 1 };
    expect(await service.save('owner', request)).toMatchObject({ showOnCharts: false });
    expect(functions.call).toHaveBeenCalledWith('saveTimelineNote', { ...request, expectedUserID: 'owner' });
    expect(users.updateUserProperties).not.toHaveBeenCalled();
  });
});
