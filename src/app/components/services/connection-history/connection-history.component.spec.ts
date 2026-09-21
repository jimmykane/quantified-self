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
    fixture.componentRef.setInput('service', ServiceNames.WahooAPI); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Includes activities where supported');
    expect(fixture.nativeElement.textContent).not.toContain('Sleep'); expect(haptics.selection).not.toHaveBeenCalled();
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
  const status = { runId: 'opaque', startMs: 1, endMs: 2, updatedAtMs: 3, active: false, canRetry: true,
    steps: [{ id: 'activities', resources: ['activities'], status: 'failed', count: 1 }] };
  it('restores durable status and never equates Garmin submission with delivery', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', { ...status, canRetry: false, steps: [{ ...status.steps[0], status: 'requested' }] }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('History requested; data may take hours or days to arrive.');
    expect(fixture.nativeElement.textContent).not.toContain('has been processed'); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('retries the opaque run once and gives feedback only after acceptance', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent); fixture.componentRef.setInput('status', status);
    let finish!: () => void; users.retryConnectionHistoryImport.mockReturnValue(new Promise<void>(resolve => finish = resolve));
    const pending = fixture.componentInstance.retry(); await fixture.componentInstance.retry();
    expect(users.retryConnectionHistoryImport).toHaveBeenCalledExactlyOnceWith('opaque'); expect(haptics.success).not.toHaveBeenCalled();
    finish(); await pending; expect(haptics.success).toHaveBeenCalledTimes(1);
  });
  it('keeps connection-independent failures visible and recoverable', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent); fixture.componentRef.setInput('status', status);
    users.retryConnectionHistoryImport.mockRejectedValue(new Error()); await fixture.componentInstance.retry(); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toContain('Could not retry'); expect(haptics.error).toHaveBeenCalledTimes(1);
  });
});
