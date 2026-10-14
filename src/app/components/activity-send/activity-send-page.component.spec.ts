import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
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
    sends = { batch: signal(null), rows: signal([]), recent: signal([]), readError: signal(null), selection: signal([]), watchBatch: vi.fn(), closeBatch: vi.fn(), loadMoreRows: vi.fn(), setSelection: vi.fn(), command: vi.fn().mockResolvedValue({ batchId: 'batch-1', revision: 2 }), upload: vi.fn().mockResolvedValue(undefined) };
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

});
