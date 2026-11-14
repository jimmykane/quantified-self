import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { FirebaseApp } from 'app/firebase/app';
import { Firestore } from 'app/firebase/firestore';
import { ActivitySendService, ACTIVITY_SEND_SUMMARY_TIMEOUT_MS } from './activity-send.service';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppProcessingService } from './app.processing.service';
import { ACTIVITY_SEND_LIMITS } from '@shared/activity-send';

const streams = vi.hoisted(() => ({ reads: [] as Array<Subject<unknown>>, data: vi.fn(), count: vi.fn(), doc: vi.fn() }));
vi.mock('app/firebase/firestore', () => ({ Firestore: class {}, collection: vi.fn(), doc: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), where: vi.fn(), query: vi.fn(), collectionData: streams.data, docData: streams.data, getCountFromServer: streams.count, getDocFromServer: streams.doc }));

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
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}
describe('ActivitySendService owner and upload boundaries', () => {
  let service: ActivitySendService;
  const user = { user: signal<{ uid: string } | null>(null) };
  const auth = { currentUser: { uid: 'owner', getIdToken: vi.fn(async () => 'synthetic-id-token') } };
  const functions = { call: vi.fn() };
  const appCheck = { getToken: vi.fn(async () => 'synthetic-app-check') };
  const processing = { addJob: vi.fn(() => 'job'), updateJob: vi.fn(), removeJob: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); streams.count.mockReset(); streams.doc.mockReset(); streams.reads = []; FakeXHR.latest = undefined!;
    streams.data.mockImplementation(() => { const subject = new Subject<unknown>(); streams.reads.push(subject); return subject; });
    auth.currentUser.uid = 'owner'; user.user.set({ uid: 'owner' });
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    TestBed.configureTestingModule({ providers: [ActivitySendService, { provide: Auth, useValue: auth }, { provide: FirebaseApp, useValue: { options: { projectId: 'demo-send' } } }, { provide: Firestore, useValue: {} }, { provide: AppUserService, useValue: user }, { provide: AppFunctionsService, useValue: functions }, { provide: AppCheckReadinessService, useValue: appCheck }, { provide: AppProcessingService, useValue: processing }] });
    service = TestBed.inject(ActivitySendService); TestBed.flushEffects();
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function summaryBatch() {
    const batch = { id: 'batch', state: 'complete', total: 100, finished: 100, updatedAt: 10 };
    streams.doc.mockResolvedValue({ data: () => batch });
    [95, 3, 2, 0, 0].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    service.watchBatch('batch'); streams.reads[2].next(batch); streams.reads[3].next([{ id: 'visible-only' }]);
    return batch;
  }
  it('reads full-batch server counts independently of pagination and fences a stable batch version', async () => {
    vi.useFakeTimers(); summaryBatch(); await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()).toMatchObject({ delivered: 95, duplicate: 3, needs_action: 2, pending: 0 });
    expect(streams.count).toHaveBeenCalledTimes(5); expect(streams.doc).toHaveBeenCalledTimes(2);
    service.loadMoreRows(); expect(streams.count).toHaveBeenCalledTimes(5);
  });
  it('does not poll unchanged active batches and coalesces outcome changes into one totals read', async () => {
    vi.useFakeTimers(); const batch = summaryBatch();
    batch.state = 'confirmed'; batch.finished = 99;
    streams.count.mockReset();
    [95, 3, 1, 0, 1].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    await vi.advanceTimersByTimeAsync(0);
    const checkedAt = service.summary()!.checkedAt;
    streams.reads[2].next({ ...batch });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(streams.count).toHaveBeenCalledTimes(5); expect(streams.doc).toHaveBeenCalledTimes(2);
    expect(service.summary()!.checkedAt).toBe(checkedAt);
    for (const updatedAt of [11, 12, 13]) { batch.updatedAt = updatedAt; streams.reads[2].next({ ...batch }); }
    [95, 3, 1, 0, 1].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()?.updatedAt).toBe(13); expect(streams.count).toHaveBeenCalledTimes(10);
    batch.updatedAt = 14; batch.finished = 100; batch.state = 'complete'; streams.reads[2].next({ ...batch });
    [96, 3, 1, 0, 0].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    await vi.advanceTimersByTimeAsync(29_999); expect(streams.count).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(1); expect(service.summary()).toMatchObject({ delivered: 96, pending: 0, updatedAt: 14 });
    await vi.advanceTimersByTimeAsync(3_600_000); expect(streams.count).toHaveBeenCalledTimes(15);
  });
  it('defers initial and changed totals while hidden and refreshes once when the tab returns', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const batch = summaryBatch(); await vi.advanceTimersByTimeAsync(60_000);
    expect(streams.doc).not.toHaveBeenCalled(); expect(streams.count).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0); expect(streams.count).toHaveBeenCalledTimes(5);
    batch.updatedAt = 11; streams.reads[2].next({ ...batch });
    visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000); expect(streams.count).toHaveBeenCalledTimes(5);
    [96, 3, 1, 0, 0].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0); expect(service.summary()).toMatchObject({ delivered: 96, updatedAt: 11 });
    expect(streams.count).toHaveBeenCalledTimes(10);
    service.closeBatch(); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000); expect(streams.count).toHaveBeenCalledTimes(10);
  });
  it('does not start aggregate reads if the tab becomes hidden during the first server read', async () => {
    vi.useFakeTimers(); const batch = summaryBatch();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let resolve!: (value: unknown) => void;
    streams.doc.mockImplementationOnce(() => new Promise(res => { resolve = res; }));
    await vi.advanceTimersByTimeAsync(0);
    visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    resolve({ data: () => batch }); await vi.advanceTimersByTimeAsync(60_000);
    expect(streams.count).not.toHaveBeenCalled(); expect(service.loadingSummary()).toBe(false);
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0); expect(service.summary()?.delivered).toBe(95);
  });
  it('rejects counts if delivery changes while the aggregates are read', async () => {
    vi.useFakeTimers(); const batch = summaryBatch();
    streams.doc.mockResolvedValueOnce({ data: () => batch }).mockResolvedValueOnce({ data: () => ({ ...batch, updatedAt: 11 }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()).toBeNull(); expect(service.summaryError()).toContain('updating');
    await vi.advanceTimersByTimeAsync(29_000); expect(streams.count).toHaveBeenCalledTimes(5);
  });
  it('does not turn an unavailable count into a successful zero', async () => {
    vi.useFakeTimers(); summaryBatch(); streams.count.mockReset().mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()).toBeNull(); expect(service.summaryError()).toContain('unavailable');
  });
  it('releases a stalled totals read, preserves the last result and ignores late replies after refresh', async () => {
    vi.useFakeTimers(); summaryBatch(); await vi.advanceTimersByTimeAsync(0);
    const previous = service.summary();
    const late: Array<(value: unknown) => void> = [];
    streams.count.mockReset().mockImplementation(() => new Promise(resolve => { late.push(resolve); }));
    service.refreshSummary(); await vi.advanceTimersByTimeAsync(0);
    expect(service.loadingSummary()).toBe(true);
    await vi.advanceTimersByTimeAsync(ACTIVITY_SEND_SUMMARY_TIMEOUT_MS);
    expect(service.loadingSummary()).toBe(false); expect(service.summary()).toEqual(previous);
    expect(service.summaryError()).toContain('unavailable');
    streams.count.mockReset();
    [96, 3, 1, 0, 0].forEach(count => streams.count.mockResolvedValueOnce({ data: () => ({ count }) }));
    service.refreshSummary(); await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()?.delivered).toBe(96);
    late.forEach(resolve => resolve({ data: () => ({ count: 0 }) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()?.delivered).toBe(96); expect(streams.doc).toHaveBeenCalledTimes(5);
    expect(service.summaryError()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not keep polling a send that disappeared or returned to a draft', async () => {
    vi.useFakeTimers(); summaryBatch(); streams.doc.mockResolvedValue({ data: () => undefined });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(streams.doc).toHaveBeenCalledTimes(1); expect(streams.count).not.toHaveBeenCalled();
    expect(service.summaryError()).toContain('not available'); expect(service.loadingSummary()).toBe(false);
  });
  it('discards an in-flight summary after navigation or an account change', async () => {
    vi.useFakeTimers(); summaryBatch(); const resolvers: Array<(value: unknown) => void> = [];
    streams.count.mockReset().mockImplementation(() => new Promise(res => { resolvers.push(res); }));
    await vi.advanceTimersByTimeAsync(0); service.closeBatch(); auth.currentUser.uid = 'another';
    resolvers.forEach(resolve => resolve({ data: () => ({ count: 0 }) })); await vi.advanceTimersByTimeAsync(0);
    expect(service.summary()).toBeNull(); expect(service.loadingSummary()).toBe(false);
  });
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
    const expected = new Uint8Array([0, 1, 31, 139, 128, 255]);
    const progress = vi.fn(); const file = new File([expected], 'Workout.fit.gz');
    const upload = service.upload('batch', 'row', file, progress);
    await vi.waitFor(() => expect(FakeXHR.latest?.send).toHaveBeenCalledOnce());
    const body = FakeXHR.latest.send.mock.calls[0][0] as Blob;
    expect(body).toBeInstanceOf(Blob); expect(body).not.toBeInstanceOf(File);
    expect(body.type).toBe('application/octet-stream'); expect(body.size).toBe(file.size);
    expect(await blobBytes(body)).toEqual(expected);
    expect(FakeXHR.latest.headers).toMatchObject({ Authorization: 'Bearer synthetic-id-token', 'X-Firebase-AppCheck': 'synthetic-app-check', 'X-QS-Batch': 'batch', 'X-QS-File': 'row', 'X-QS-Filename': 'Workout.fit.gz' });
    FakeXHR.latest.upload.onprogress!({ lengthComputable: true, loaded: 4, total: 10 }); expect(progress).toHaveBeenCalledWith(40);
    FakeXHR.latest.onload!(); await upload;
  });
  it('rejects an empty file before reading or requesting upload credentials', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    await expect(service.upload('batch', 'row', new File([], 'empty.fit'), vi.fn())).rejects.toThrow('Download it to this device');
    expect(read).not.toHaveBeenCalled(); expect(auth.currentUser.getIdToken).not.toHaveBeenCalled();
    expect(appCheck.getToken).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
  });
  it('checks the size limit before allocating file bytes', async () => {
    const file = new File(['x'], 'large.fit');
    Object.defineProperty(file, 'size', { value: ACTIVITY_SEND_LIMITS.fileBytes + 1 });
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    await expect(service.upload('batch', 'row', file, vi.fn())).rejects.toThrow('20 MiB');
    expect(read).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
  });
  it.each(['error', 'abort'])('gives recoverable guidance when reading the selected file emits %s', async event => {
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      const handler = event === 'error' ? this.onerror : this.onabort;
      queueMicrotask(() => handler?.call(this, new ProgressEvent(event) as ProgressEvent<FileReader>));
    });
    await expect(service.upload('batch', 'row', new File(['x'], 'private-name.fit'), vi.fn()))
      .rejects.toThrow('The file could not be read. Download it to this device and select it again.');
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
  });
  it.each([0, 3, 12])('does not upload a %s-byte read that differs from the selected file size', async size => {
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: new ArrayBuffer(size) });
      this.dispatchEvent(new ProgressEvent('load'));
    });
    await expect(service.upload('batch', 'row', new File(['synthetic'], 'private-name.fit'), vi.fn())).rejects.toThrow('The file could not be read');
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
  });
  it('does not expose a synchronous native file-read exception', async () => {
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementationOnce(() => { throw new Error('private-path-canary'); });
    await expect(service.upload('batch', 'row', new File(['x'], 'one.fit'), vi.fn()))
      .rejects.toThrow('The file could not be read. Download it to this device and select it again.');
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
  });
  it('rechecks account ownership after the asynchronous file read', async () => {
    let finishRead!: () => void;
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      finishRead = () => {
        Object.defineProperty(this, 'result', { value: new ArrayBuffer(1) });
        this.dispatchEvent(new ProgressEvent('load'));
      };
    });
    const upload = service.upload('batch', 'row', new File(['x'], 'one.fit'), vi.fn(), 'owner');
    const assertion = expect(upload).rejects.toThrow('account changed');
    auth.currentUser.uid = 'another'; finishRead(); await assertion;
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled(); expect(FakeXHR.latest).toBeUndefined();
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
  it('keeps one paging request active and ignores paging after the selected batch closes', () => {
    service.watchBatch('existing'); service.loadMoreRows();
    expect(streams.reads).toHaveLength(4);
    streams.reads[3].next([]); service.loadMoreRows(); service.loadMoreRows();
    expect(streams.reads).toHaveLength(5); expect(streams.reads[3].observed).toBe(false);
    service.closeBatch(); service.loadMoreRows(); expect(streams.reads).toHaveLength(5);
  });
  it('preserves background history errors when closing a batch and clears them on owner change', () => {
    streams.reads[0].error(new Error('Offline')); service.closeBatch();
    expect(service.readError()).toContain('recent sends');
    user.user.set(null); TestBed.flushEffects(); expect(service.readError()).toBeNull();
  });
});
