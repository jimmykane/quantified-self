import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';
import { ConnectionHistoryOptionComponent, ConnectionHistoryStatusComponent } from './connection-history.component';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
const users = { retryConnectionHistoryImport: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); TestBed.configureTestingModule({ imports: [ConnectionHistoryOptionComponent, ConnectionHistoryStatusComponent],
  providers: [{ provide: AppHapticsService, useValue: haptics }, { provide: AppUserService, useValue: users }] }); });
describe('recent history option', () => {
  it('is selected by default, uses supported data types and stays silent on hydration', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').checked).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('activities, Sleep, and Health');
    expect(fixture.componentInstance.range()).toBe('30_days');
    fixture.componentRef.setInput('service', ServiceNames.WahooAPI); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Includes activities where supported');
    expect(fixture.nativeElement.textContent).not.toContain('Sleep'); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('offers provider-specific maximums and emits an accessible range choice', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent); const changed = vi.fn();
    fixture.componentInstance.rangeChange.subscribe(changed); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().at(-1)?.label).toBe('Maximum available (5 years)');
    fixture.componentInstance.changeRange('maximum');
    expect(changed).toHaveBeenCalledWith('maximum');
    fixture.componentRef.setInput('service', ServiceNames.COROSAPI); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().map(option => option.label)).toEqual([
      '30 days', '60 days', 'Maximum available (3 months)',
    ]);
    fixture.componentRef.setInput('service', ServiceNames.WahooAPI); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().at(-1)?.label).toBe('All available history');
  });
  it('emits a choice once and preserves it while pending', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent); const changed = vi.fn();
    fixture.componentInstance.checkedChange.subscribe(changed); fixture.detectChanges();
    fixture.nativeElement.querySelector('input').click();
    expect(changed).toHaveBeenCalledWith(false); expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('checked', false); fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentInstance.change(true);
    expect(changed).toHaveBeenCalledTimes(1); expect(fixture.nativeElement.querySelector('input').checked).toBe(false);
  });
});
describe('recent history status', () => {
  const status = { runId: 'opaque', rangePreset: '30_days' as const, startMs: 1, endMs: 2, updatedAtMs: 3, active: false, canRetry: true,
    steps: [{ id: 'activities', resources: ['activities'], status: 'failed', count: 1 }] };
  it('restores durable status and never equates Garmin submission with delivery', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', { ...status, canRetry: false, steps: [{ ...status.steps[0], status: 'requested' }] }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('History requested; data may take hours or days to arrive.');
    expect(fixture.nativeElement.textContent).not.toContain('has been processed'); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('describes a completed maximum-range run as selected history', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', { ...status, rangePreset: 'maximum', canRetry: false,
      steps: [{ ...status.steps[0], status: 'processed' }] }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Selected history has been processed.');
    expect(fixture.nativeElement.textContent).not.toContain('Recent history');
  });
  it('retries the opaque run once and gives feedback only after acceptance', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent); fixture.componentRef.setInput('status', status);
    let finish!: () => void; users.retryConnectionHistoryImport.mockReturnValue(new Promise<void>(resolve => finish = resolve));
    const pending = fixture.componentInstance.retry(); await fixture.componentInstance.retry();
    expect(users.retryConnectionHistoryImport).toHaveBeenCalledExactlyOnceWith('opaque', expect.any(Function)); expect(haptics.success).not.toHaveBeenCalled();
    finish(); await pending; expect(haptics.success).toHaveBeenCalledTimes(1);
  });
  it('keeps connection-independent failures visible and recoverable', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent); fixture.componentRef.setInput('status', status);
    users.retryConnectionHistoryImport.mockRejectedValue(new Error()); await fixture.componentInstance.retry(); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toContain('Could not retry'); expect(haptics.error).toHaveBeenCalledTimes(1);
  });
  it.each(['success', 'failure'])('suppresses late retry %s feedback after teardown', async outcome => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', status);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    users.retryConnectionHistoryImport.mockReturnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    const pending = fixture.componentInstance.retry();
    fixture.destroy();
    if (outcome === 'success') resolve(); else reject(new Error('Delayed failure'));
    await pending;
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toBe('');
  });
  it('keeps replacement-run controls independent of an earlier pending retry', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', status);
    let rejectOld!: (error: Error) => void;
    let resolveNew!: () => void;
    users.retryConnectionHistoryImport
      .mockReturnValueOnce(new Promise<void>((_, reject) => rejectOld = reject))
      .mockReturnValueOnce(new Promise<void>(resolve => resolveNew = resolve));
    const oldPending = fixture.componentInstance.retry();
    fixture.componentRef.setInput('status', { ...status, runId: 'replacement' });
    expect(users.retryConnectionHistoryImport.mock.calls[0][1]()).toBe(false);
    expect(fixture.componentInstance.retrying()).toBe(false);
    const newPending = fixture.componentInstance.retry();
    expect(users.retryConnectionHistoryImport).toHaveBeenCalledTimes(2);
    rejectOld(new Error('Old run failed')); await oldPending;
    expect(fixture.componentInstance.retrying()).toBe(true);
    expect(fixture.componentInstance.error()).toBe('');
    expect(haptics.error).not.toHaveBeenCalled();
    resolveNew(); await newPending;
    expect(fixture.componentInstance.retrying()).toBe(false);
    expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('does not project an earlier run’s retry error onto replacement status', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', status);
    users.retryConnectionHistoryImport.mockRejectedValueOnce(new Error('Retry failed'));
    await fixture.componentInstance.retry();
    expect(fixture.componentInstance.error()).toContain('Could not retry');
    fixture.componentRef.setInput('status', { ...status, runId: 'replacement' });
    expect(fixture.componentInstance.error()).toBe('');
  });
  it('treats account-bound cancellation as silent rather than an import failure', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', status);
    users.retryConnectionHistoryImport.mockRejectedValue(new Error('Operation cancelled because its account or view changed.'));
    await fixture.componentInstance.retry();
    expect(fixture.componentInstance.error()).toBe('');
    expect(haptics.error).not.toHaveBeenCalled();
  });
});
