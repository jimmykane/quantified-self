import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { FirebaseApp } from 'app/firebase/app';
import { Firestore } from 'app/firebase/firestore';
import { ActivitySendService } from './activity-send.service';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppProcessingService } from './app.processing.service';

const streams = vi.hoisted(() => ({ reads: [] as Array<Subject<unknown>>, data: vi.fn() }));
vi.mock('app/firebase/firestore', () => ({ Firestore: class {}, collection: vi.fn(), doc: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), where: vi.fn(), query: vi.fn(), collectionData: streams.data, docData: streams.data }));

class FakeXHR {
  static latest: FakeXHR;
  status = 200; responseText = '{}'; timeout = 0;
  headers: Record<string, string> = {};
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void;
  open = vi.fn(); send = vi.fn();
  constructor() { FakeXHR.latest = this; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
}
describe('ActivitySendService owner and upload boundaries', () => {
  let service: ActivitySendService;
  const user = { user: signal<{ uid: string } | null>(null) };
  const auth = { currentUser: { uid: 'owner', getIdToken: vi.fn(async () => 'synthetic-id-token') } };
  const functions = { call: vi.fn() };
  const appCheck = { getToken: vi.fn(async () => 'synthetic-app-check') };
  const processing = { addJob: vi.fn(() => 'job'), updateJob: vi.fn(), removeJob: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); streams.reads = []; FakeXHR.latest = undefined!;
    streams.data.mockImplementation(() => { const subject = new Subject<unknown>(); streams.reads.push(subject); return subject; });
    auth.currentUser.uid = 'owner'; user.user.set({ uid: 'owner' });
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    TestBed.configureTestingModule({ providers: [ActivitySendService, { provide: Auth, useValue: auth }, { provide: FirebaseApp, useValue: { options: { projectId: 'demo-send' } } }, { provide: Firestore, useValue: {} }, { provide: AppUserService, useValue: user }, { provide: AppFunctionsService, useValue: functions }, { provide: AppCheckReadinessService, useValue: appCheck }, { provide: AppProcessingService, useValue: processing }] });
    service = TestBed.inject(ActivitySendService); TestBed.flushEffects();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('reconciles global jobs from active batches separately from recent history', () => {
    streams.reads[1].next([{ id: 'batch', provider: 'suunto', state: 'confirmed', total: 2, finished: 1 }]);
    expect(processing.updateJob).toHaveBeenCalledWith('job', expect.objectContaining({ progress: undefined }));
    service.closeBatch(); expect(processing.removeJob).not.toHaveBeenCalled();
    streams.reads[1].next([]); expect(processing.removeJob).toHaveBeenCalledWith('job');
  });
  it('clears account-scoped selections, results and notifications on owner change', () => {
    service.setSelection(['event']); streams.reads[1].next([{ id: 'batch', provider: 'suunto', state: 'confirmed', total: 1, finished: 0 }]);
    user.user.set({ uid: 'another' }); auth.currentUser.uid = 'another'; TestBed.flushEffects();
    expect(service.selection()).toEqual([]); expect(service.rows()).toEqual([]); expect(processing.removeJob).toHaveBeenCalledWith('job');
    expect(streams.reads[0].observed).toBe(false);
  });
  it('fences a command whose owner changes while AppCheck or the callable waits', async () => {
    let resolve!: (value: unknown) => void;
    functions.call.mockImplementation((_name, _request, options) => new Promise(res => { resolve = res; expect(options.canExecute()).toBe(true); }));
    const call = service.command({ version: 1, action: 'stop', batchId: 'batch' });
    auth.currentUser.uid = 'another'; resolve({ data: { batchId: 'batch', revision: 1 } });
    await expect(call).rejects.toThrow('account changed');
  });
  it('ignores old-owner snapshots and read errors as soon as Auth changes, before metadata updates', () => {
    service.watchBatch('old-batch');
    auth.currentUser.uid = 'another';
    streams.reads[0].next([{ id: 'old-batch' }]);
    streams.reads[1].next([{ id: 'old-batch', provider: 'suunto', state: 'confirmed', total: 1, finished: 0 }]);
    streams.reads[2].next({ id: 'old-batch' }); streams.reads[3].next([{ id: 'old-row' }]);
    for (const stream of streams.reads) stream.error(new Error('Old owner is no longer authorized'));
    expect(service.recent()).toEqual([]); expect(service.batch()).toBeNull(); expect(service.rows()).toEqual([]);
    expect(service.readError()).toBeNull(); expect(processing.addJob).not.toHaveBeenCalled();
  });
  it('still exposes a current-owner read failure', () => {
    service.watchBatch('batch'); streams.reads[3].error(new Error('Offline'));
    expect(service.readError()).toContain('Could not load delivery results');
  });
  it('rejects an old view owner immediately when Auth changes before user metadata updates', async () => {
    auth.currentUser.uid = 'another';
    await expect(service.command({ version: 1, action: 'stop', batchId: 'batch' }, 'owner')).rejects.toThrow('account changed');
    await expect(service.upload('batch', 'row', new File(['x'], 'one.fit'), vi.fn(), 'owner')).rejects.toThrow('account changed');
    expect(functions.call).not.toHaveBeenCalled();
    expect(appCheck.getToken).not.toHaveBeenCalled();
  });
  it('uses authenticated binary staging and reports measured transfer progress', async () => {
    const progress = vi.fn(); const file = new File(['synthetic'], 'Workout.fit.gz');
    const upload = service.upload('batch', 'row', file, progress);
    await vi.waitFor(() => expect(FakeXHR.latest.send).toHaveBeenCalledWith(file));
    expect(FakeXHR.latest.headers).toMatchObject({ Authorization: 'Bearer synthetic-id-token', 'X-Firebase-AppCheck': 'synthetic-app-check', 'X-QS-Batch': 'batch', 'X-QS-File': 'row', 'X-QS-Filename': 'Workout.fit.gz' });
    FakeXHR.latest.upload.onprogress!({ lengthComputable: true, loaded: 4, total: 10 }); expect(progress).toHaveBeenCalledWith(40);
    FakeXHR.latest.onload!(); await upload;
  });
  it('retains a recoverable timeout message without sending to the provider', async () => {
    const upload = service.upload('batch', 'row', new File(['x'], 'one.fit'), vi.fn());
    const assertion = expect(upload).rejects.toThrow('Reselect the same file');
    await vi.waitFor(() => expect(FakeXHR.latest.timeout).toBe(150_000)); FakeXHR.latest.ontimeout!(); await assertion;
    expect(functions.call).not.toHaveBeenCalled();
  });
  it('rejects an aborted transfer with recoverable guidance rather than leaving it pending', async () => {
    const upload = service.upload('batch', 'row', new File(['x'], 'one.fit'), vi.fn());
    const assertion = expect(upload).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(FakeXHR.latest.onabort).toBeDefined()); FakeXHR.latest.onabort!(); await assertion;
  });
  it('keeps a requested batch distinct from a new draft until its first snapshot arrives', () => {
    service.watchBatch('existing');
    expect(service.requestedBatchId()).toBe('existing'); expect(service.loadingBatch()).toBe(true); expect(service.loadingRows()).toBe(true);
    streams.reads[2].next(undefined); streams.reads[3].next([]);
    expect(service.loadingBatch()).toBe(false); expect(service.loadingRows()).toBe(false); expect(service.requestedBatchId()).toBe('existing');
    expect(service.batchReadError()).toContain('unavailable');
    streams.reads[2].next({ id: 'existing' }); expect(service.batchReadError()).toBeNull();
    service.closeBatch(); expect(service.requestedBatchId()).toBeNull();
  });
  it('preserves background history errors when closing a batch and clears them on owner change', () => {
    streams.reads[0].error(new Error('Offline')); service.closeBatch();
    expect(service.readError()).toContain('recent sends');
    user.user.set(null); TestBed.flushEffects(); expect(service.readError()).toBeNull();
  });
});
