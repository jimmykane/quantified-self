import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySendPageComponent } from './activity-send-page.component';
import { ActivitySendService } from '../../services/activity-send.service';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { ActivitySendBatch, ActivitySendRow } from '@shared/activity-send';

describe('activity sending workspace', () => {
  const batchValue: ActivitySendBatch = { id: 'batch-1', provider: 'suunto', source: 'files', state: 'draft', revision: 2, accountLabel: 'Connected Suunto account', createdAt: 1, updatedAt: 1, reviewed: true, total: 1, finished: 0 };
  const row: ActivitySendRow = { id: 'row-1', name: 'Morning.fit', sport: 'Running', startDate: 1, size: 500, warnings: [], status: 'ready', recovery: 'none', message: 'Ready', attempts: 0 };
  let sends: Record<string, any>;
  let users: Record<string, any>;
  let haptics: Record<string, any>;
  beforeEach(() => {
    sends = { batch: signal(null), requestedBatchId: signal(null), loadingBatch: signal(false), loadingRows: signal(false), batchReadError: signal(null), rowReadError: signal(null), rows: signal([]), recent: signal([]), readError: signal(null), selection: signal([]), watchBatch: vi.fn(), closeBatch: vi.fn(), loadMoreRows: vi.fn(), setSelection: vi.fn(), command: vi.fn().mockResolvedValue({ batchId: 'batch-1', revision: 2 }), upload: vi.fn().mockResolvedValue(undefined) };
    users = { user: signal({ uid: 'owner' }), hasProAccessSignal: signal(true) };
    haptics = { selection: vi.fn(), error: vi.fn(), success: vi.fn(), trigger: vi.fn() };
    TestBed.configureTestingModule({ imports: [ActivitySendPageComponent, NoopAnimationsModule], providers: [provideRouter([]), { provide: ActivitySendService, useValue: sends }, { provide: AppUserService, useValue: users }, { provide: AppHapticsService, useValue: haptics }, { provide: BrowserCompatibilityService, useValue: { createRandomUUID: () => 'batch-1' } }] });
  });
  function render() {
    const fixture = TestBed.createComponent(ActivitySendPageComponent);
    fixture.componentInstance.provider.set('suunto'); fixture.detectChanges();
    return fixture;
  }
  it('renders a viewable Pro upsell without a file picker or mutation', () => {
    users.hasProAccessSignal.set(false);
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('previous results remain available');
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(sends.command).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation of the reviewed revision', async () => {
    const fixture = render(); sends.batch.set(batchValue); sends.rows.set([row]); fixture.detectChanges();
    expect(sends.command).not.toHaveBeenCalled();
    await fixture.componentInstance.confirm();
    expect(sends.command).toHaveBeenCalledWith({ version: 1, action: 'confirm', batchId: 'batch-1', revision: 2 }, 'owner');
  });
  it.each([false, null])('does not send an unreviewed selection: %s', async reviewed => {
    const fixture = render(); sends.batch.set({ ...batchValue, reviewed }); sends.rows.set([row]);
    await fixture.componentInstance.confirm(); expect(sends.command).not.toHaveBeenCalled();
  });
  it('invalidates confirmation when dates change', async () => {
    const fixture = render(); sends.batch.set(batchValue); sends.rows.set([row]);
    fixture.componentInstance.invalidateSaved();
    await fixture.componentInstance.confirm(); expect(sends.command).not.toHaveBeenCalled();
  });
  it('cannot send after Pro access expires', async () => {
    const fixture = render(); sends.batch.set(batchValue); sends.rows.set([row]); users.hasProAccessSignal.set(false);
    await fixture.componentInstance.confirm(); expect(sends.command).not.toHaveBeenCalled();
  });
  it('offers status recovery rather than resend for accepted uploads', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, state: 'confirmed' }); sends.rows.set([{ ...row, status: 'needs_action', recovery: 'check_status' }]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Check status');
    expect(fixture.nativeElement.textContent).not.toContain('Retry sending');
  });
  it('keeps ambiguous acceptance out of retry actions', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, state: 'complete' }); sends.rows.set([{ ...row, status: 'needs_action', recovery: 'review_provider' }]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('before sending another copy');
    expect(fixture.nativeElement.textContent).not.toContain('Retry sending');
  });
  it('reports additional drops during staging instead of silently discarding them', async () => {
    const fixture = render(); fixture.componentInstance.busy.set(true);
    await fixture.componentInstance.addFiles({ preventDefault: vi.fn(), dataTransfer: { files: [new File(['x'], 'one.fit')] } } as unknown as DragEvent);
    expect(fixture.componentInstance.error()).toContain('Wait for file preparation');
    expect(sends.upload).not.toHaveBeenCalled();
  });
  it('rejects oversized and unsupported files before staging', async () => {
    const fixture = render();
    await fixture.componentInstance.addFiles({ preventDefault: vi.fn(), dataTransfer: { files: [new File(['x'], 'route.gpx')] } } as unknown as DragEvent);
    expect(sends.upload).not.toHaveBeenCalled(); expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('teardown closes only the local subscription, never the background batch', () => {
    const fixture = render(); fixture.destroy();
    expect(sends.closeBatch).toHaveBeenCalled(); expect(sends.command).not.toHaveBeenCalled();
  });
  it('repeated destination selection is silent', async () => {
    const fixture = render(); const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fixture.componentInstance.chooseProvider('suunto');
    expect(navigate).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('stops selecting more files if the account changes after a transfer', async () => {
    const fixture = render(); sends.batch.set(batchValue);
    sends.upload.mockImplementation(async () => { users.user.set({ uid: 'other-owner' }); });
    const files = [new File(['a'], 'one.fit'), new File(['b'], 'two.fit')];
    await fixture.componentInstance.addFiles({ preventDefault: vi.fn(), dataTransfer: { files } } as unknown as DragEvent);
    expect(sends.upload).toHaveBeenCalledOnce();
    expect(sends.command).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
  });
  it('keeps typing and unchanged source selection silent', () => {
    const fixture = render();
    fixture.componentInstance.invalidateSaved(); fixture.componentInstance.changeSavedSources([]);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('offers removal and review after a partial file preparation', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, reviewed: false }); sends.rows.set([{ ...row, status: 'preparing' }]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Remove');
    expect(fixture.nativeElement.textContent).toContain('Review prepared activities');
  });
  it.each([{ stopped: true }, { expiresAt: 1 }])('closes sending and retries while keeping accepted status checks: %j', async window => {
    const fixture = render(); sends.batch.set({ ...batchValue, ...window });
    sends.rows.set([{ ...row, recovery: 'retry_send' }, { ...row, id: 'accepted', recovery: 'check_status' }]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Retry sending');
    expect(fixture.nativeElement.textContent).toContain('Check status');
    expect(fixture.nativeElement.textContent).toContain('Remove');
    expect(fixture.nativeElement.textContent).toContain('Start a new send');
    await fixture.componentInstance.confirm(); await fixture.componentInstance.rowAction(row, 'retry');
    expect(sends.command).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    await fixture.componentInstance.rowAction({ ...row, recovery: 'check_status' }, 'check');
    expect(sends.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'check' }), 'owner');
  });
  it('updates sending eligibility when an open view reaches its deadline', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, expiresAt: Date.now() + 60_000 }); sends.rows.set([row]); fixture.detectChanges();
    expect(fixture.componentInstance.canConfirm()).toBe(true);
    fixture.componentInstance.nowMs.set(Date.now() + 60_001); fixture.detectChanges();
    expect(fixture.componentInstance.canConfirm()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('The sending window expired');
  });
  it('uses an accessible, initially closed Material disclosure with one feedback owner', () => {
    const fixture = render(); sends.batch.set(batchValue); sends.rows.set([row]); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[aria-controls="activity-send-details"]') as HTMLButtonElement;
    const details = fixture.nativeElement.querySelector('#activity-send-details') as HTMLElement;
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(details.hidden).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true'); expect(details.hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('applies the chosen source filter to explicit saved-activity selections', async () => {
    const fixture = render(); sends.batch.set({ ...batchValue, source: 'saved' }); sends.selection.set(['event-one']);
    fixture.componentInstance.source.set('saved'); fixture.componentInstance.savedSources = ['COROS API'];
    await fixture.componentInstance.previewSaved();
    expect(sends.command).toHaveBeenCalledWith({ version: 1, action: 'prepare', batchId: 'batch-1', eventIds: ['event-one'], sources: ['COROS API'] }, 'owner');
  });
  it('restores the batch destination and source from a mismatched deep link without sending or feedback', () => {
    const fixture = render(); const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    sends.batch.set({ ...batchValue, provider: 'wahoo', source: 'saved' }); fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/send-activities', 'wahoo'], { queryParams: { batch: 'batch-1', source: 'saved' }, replaceUrl: true });
    expect(sends.command).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('continues a saved preview after reload even when its first page only contains exclusions', async () => {
    const fixture = render(); fixture.componentInstance.source.set('saved');
    sends.batch.set({ ...batchValue, source: 'saved', reviewed: false, total: 50, finished: 50 }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Continue saved-activity preview');
    expect(fixture.nativeElement.querySelector('input[type=date]')).toBeNull();
    sends.command.mockResolvedValueOnce({ batchId: 'batch-1', revision: 51, nextCursor: 'private-cursor' }).mockResolvedValueOnce({ batchId: 'batch-1', revision: 52, nextCursor: null });
    await fixture.componentInstance.reviewFiles();
    expect(sends.command).toHaveBeenCalledTimes(2);
    expect(sends.command).toHaveBeenNthCalledWith(1, { version: 1, action: 'prepare', batchId: 'batch-1' }, 'owner');
    expect(sends.command).toHaveBeenNthCalledWith(2, { version: 1, action: 'prepare', batchId: 'batch-1' }, 'owner');
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('reports a fully excluded selection without offering confirmation', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, total: 1, finished: 1 }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No eligible activities');
    expect(fixture.componentInstance.canConfirm()).toBe(false);
  });
  it('clears selection invalidation when a new sending context is successfully opened', async () => {
    const fixture = render(); const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance.selectionChanged.set(true); await fixture.componentInstance.newDraft();
    expect(fixture.componentInstance.selectionChanged()).toBe(false);
    fixture.componentInstance.selectionChanged.set(true); navigate.mockResolvedValueOnce(false); await fixture.componentInstance.chooseSource('saved');
    expect(fixture.componentInstance.selectionChanged()).toBe(true);
  });
  it('clears stale selection invalidation only after a recent send successfully opens', async () => {
    const fixture = render(); const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    sends.batch.set(batchValue); sends.rows.set([row]); fixture.componentInstance.selectionChanged.set(true);
    await fixture.componentInstance.openBatch(batchValue.id, 'suunto');
    expect(fixture.componentInstance.selectionChanged()).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    navigate.mockResolvedValueOnce(true); await fixture.componentInstance.openBatch(batchValue.id, 'suunto');
    expect(fixture.componentInstance.selectionChanged()).toBe(false);
    expect(fixture.componentInstance.canConfirm()).toBe(true); expect(sends.command).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('resets selection invalidation on browser-history context changes while preserving it for the same draft', () => {
    const queryParams = new BehaviorSubject(convertToParamMap({ batch: 'old-draft', source: 'saved' }));
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: of(convertToParamMap({ provider: 'suunto' })), queryParamMap: queryParams.asObservable() } });
    const fixture = render(); fixture.componentInstance.selectionChanged.set(true);
    queryParams.next(convertToParamMap({ batch: 'old-draft', source: 'saved', details: 'true' }));
    expect(fixture.componentInstance.selectionChanged()).toBe(true);
    queryParams.next(convertToParamMap({ batch: 'reviewed-draft', source: 'saved' }));
    expect(fixture.componentInstance.selectionChanged()).toBe(false);
    expect(sends.command).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('does not create a replacement draft while a requested batch is loading or unavailable', async () => {
    const fixture = render(); sends.requestedBatchId.set('existing-batch'); sends.loadingBatch.set(true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Loading this send');
    await fixture.componentInstance.addFiles({ preventDefault: vi.fn(), dataTransfer: { files: [new File(['a'], 'one.fit')] } } as unknown as DragEvent);
    expect(sends.command).not.toHaveBeenCalled(); expect(sends.upload).not.toHaveBeenCalled();
    sends.loadingBatch.set(false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Start a new send');
  });
  it.each(['loadingRows', 'rowReadError'])('blocks confirmation until the reviewed rows are readable: %s', async state => {
    const fixture = render(); sends.batch.set(batchValue); sends.rows.set([row]); sends[state].set(state === 'loadingRows' ? true : 'Offline');
    await fixture.componentInstance.confirm(); expect(sends.command).not.toHaveBeenCalled();
  });
  it('explains pending rows and disables further paging until the read finishes', () => {
    const fixture = render(); sends.batch.set({ ...batchValue, total: 51 }); sends.rows.set([row]); sends.loadingRows.set(true); fixture.detectChanges();
    const more = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(button => button.textContent?.includes('Show more activities'))!;
    expect(fixture.nativeElement.textContent).toContain('Loading activities'); expect(more.disabled).toBe(true);
    more.click(); expect(sends.loadMoreRows).not.toHaveBeenCalled(); expect(haptics.trigger).not.toHaveBeenCalled();
    sends.loadingRows.set(false); fixture.detectChanges(); expect(more.disabled).toBe(false);
    more.click(); expect(sends.loadMoreRows).toHaveBeenCalledOnce();
  });
  it('allows first-time selection in a saved draft whose initial preview never started', () => {
    const fixture = render(); fixture.componentInstance.source.set('saved'); sends.batch.set({ ...batchValue, source: 'saved', total: 0, finished: 0, savedSelectionReady: false }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=date]')).not.toBeNull();
    fixture.componentInstance.invalidateSaved(); expect(fixture.componentInstance.selectionChanged()).toBe(false);
  });
  it.each([0, 1])('keeps continuation available after saved checking fails with %s reviewed rows', async total => {
    const fixture = render(); fixture.componentInstance.source.set('saved');
    sends.batch.set({ ...batchValue, source: 'saved', total, reviewed: false, savedSelectionReady: true }); sends.rows.set(total ? [row] : []);
    sends.command.mockRejectedValueOnce(new Error('Saved activity checking is temporarily unavailable. Reopen this draft and choose Continue saved-activity preview.'));
    await fixture.componentInstance.reviewFiles(); fixture.detectChanges();
    expect(fixture.componentInstance.busy()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain('temporarily unavailable');
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    expect(buttons.find(button => button.textContent?.includes('Continue saved-activity preview'))?.disabled).toBe(false);
    expect(buttons.find(button => button.textContent?.trim().startsWith('Send '))?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('input[type=date]')).toBeNull();
    expect(haptics.error).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
    await fixture.componentInstance.reviewFiles();
    expect(sends.command).toHaveBeenNthCalledWith(2, { version: 1, action: 'prepare', batchId: 'batch-1' }, 'owner');
    expect(haptics.success).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledTimes(2);
    sends.batch.set({ ...batchValue, source: 'saved', savedSelectionReady: true }); sends.rows.set([row]); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBeNull(); expect(fixture.componentInstance.canConfirm()).toBe(true);
    expect(sends.command.mock.calls.every(([request]) => request.action === 'prepare')).toBe(true);
  });

});
