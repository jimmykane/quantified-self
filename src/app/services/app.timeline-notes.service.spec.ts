import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('starts both first-page reads before either network request completes', async () => {
    const finish: Array<(page: { rows: ReturnType<typeof row>[]; cursor: null }) => void> = [];
    const read = vi.fn(() => new Promise<{ rows: ReturnType<typeof row>[]; cursor: null }>(resolve => finish.push(resolve)));
    const loading = loadTimelineNotePages(range, read, () => true);
    expect(read).toHaveBeenCalledTimes(2);
    finish[1]({ rows: [row(2)], cursor: null });
    finish[0]({ rows: [row(1)], cursor: null });
    expect((await loading).notes.map(note => note.id)).toEqual([row(1).id, row(2).id]);
  });
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
    expect(read).toHaveBeenCalledTimes(9);
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
  let clock: ReturnType<typeof vi.spyOn>;
  afterEach(() => clock?.mockRestore());
  it('reuses a recent snapshot across route returns and refreshes expired data without clearing it', async () => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 12));
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [{ id: row(1).id, data: () => data }], size: 1 } as never);
    await service.loadRange('owner', range);
    const cached = service.cachedRange('owner', range);
    await service.loadRange('owner', range);
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(Date.UTC(2026, 8, 12) + 60_001);
    const finish: Array<(value: unknown) => void> = [];
    vi.mocked(getDocsFromServer).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }) as never);
    const loading = service.loadRange('owner', range);
    const duplicate = service.loadRange('owner', range);
    expect(getDocsFromServer).toHaveBeenCalledTimes(4);
    expect(service.cachedRange('owner', range)).toEqual(cached);
    finish.forEach(resolve => resolve({ docs: [], size: 0 }));
    expect((await loading).notes).toEqual([]);
    expect((await duplicate).notes).toEqual([]);
    expect(service.cachedRange('owner', range)?.notes).toEqual([]);
  });
  it('shares forced refreshes, retains the snapshot on failure, and retries immediately', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [{ id: row(1).id, data: () => data }], size: 1 } as never);
    await service.loadRange('owner', range);
    const known = service.cachedRange('owner', range);
    const finish: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
    vi.mocked(getDocsFromServer).mockImplementation(() => new Promise((resolve, reject) => { finish.push({ resolve, reject }); }) as never);
    const first = service.loadRange('owner', range, true);
    const second = service.loadRange('owner', range, true);
    expect(getDocsFromServer).toHaveBeenCalledTimes(4);
    const failure = Promise.allSettled([first, second]);
    finish[0].reject(new Error('offline')); finish[1].resolve({ docs: [], size: 0 });
    expect((await failure).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(service.cachedRange('owner', range)).toEqual(known);
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [], size: 0 } as never);
    expect((await service.loadRange('owner', range, true)).notes).toEqual([]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(6);
  });
  it('does not let a slow older window overwrite a newer completed snapshot', async () => {
    const finish: Array<(value: unknown) => void> = [];
    vi.mocked(getDocsFromServer).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }) as never);
    const older = service.loadRange('owner', range);
    const expanded = { startDate: '2026-08-01', endDate: range.endDate };
    const newer = service.loadRange('owner', expanded);
    const updated = { ...data, title: 'Updated', revision: 2 };
    finish.slice(2).forEach(resolve => resolve({ docs: [{ id: row(1).id, data: () => updated }], size: 1 }));
    await newer;
    const returning = service.loadRange('owner', range);
    finish.slice(0, 2).forEach(resolve => resolve({ docs: [{ id: row(1).id, data: () => data }], size: 1 }));
    await older;
    expect((await returning).notes[0].revision).toBe(2);
    expect((await service.loadRange('owner', range)).notes[0].revision).toBe(2);
    expect(getDocsFromServer).toHaveBeenCalledTimes(4);
  });
  it('requeries a narrower window when the covering in-flight request is incomplete', async () => {
    let reads = 0;
    vi.mocked(getDocsFromServer).mockImplementation(async () => ++reads <= 9
      ? { docs: Array.from({ length: 65 }, (_, i) => ({ id: row(i).id, data: () => data })), size: 65 } as never
      : { docs: [], size: 0 } as never);
    const broad = service.loadRange('owner', range);
    const narrowRange = { startDate: '2026-09-02', endDate: '2026-09-03' };
    const narrow = service.loadRange('owner', narrowRange);
    expect((await broad).incomplete).toBe('records');
    expect(await narrow).toEqual({ notes: [], incomplete: null });
    expect(getDocsFromServer).toHaveBeenCalledTimes(11);
    expect(service.cachedRange('owner', range)).toBeNull();
  });
  it('fences cached and pending results immediately after invalidation or an account change', async () => {
    await service.loadRange('owner', range);
    const cached = service.loadRange('owner', range);
    service.invalidate();
    await expect(cached).rejects.toThrow('cancelled');
    expect(service.cachedRange('owner', range)).toBeNull();
    const finish: Array<(value: unknown) => void> = [];
    vi.mocked(getDocsFromServer).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }) as never);
    const pending = service.loadRange('owner', range);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    auth.currentUser = { uid: 'other' }; user$.next({ uid: 'other', settings: { appSettings: {} } });
    finish.forEach(resolve => resolve({ docs: [{ id: row(1).id, data: () => data }], size: 1 }));
    await rejected;
    expect(service.cachedRange('other', range)).toBeNull();
    expect(() => service.cachedRange('owner', range)).toThrow('account changed');
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
