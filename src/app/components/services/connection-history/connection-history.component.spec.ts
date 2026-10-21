import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';
import { ConnectionHistoryOptionComponent, ConnectionHistoryStatusComponent } from './connection-history.component';
import { RecordedHistoryStartService } from '../../../services/recorded-history-start.service';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
const users = { retryConnectionHistoryImport: vi.fn(), user: signal<{ uid: string; isAnonymous?: boolean } | null>({ uid: 'owner' }) };
const history = { firstSleepDate: vi.fn(), firstHealthDate: vi.fn(), lastReportedGarminSleepCutoff: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); users.user.set({ uid: 'owner' });
  history.firstSleepDate.mockResolvedValue('2026-09-12'); history.firstHealthDate.mockResolvedValue('2026-09-13');
  history.lastReportedGarminSleepCutoff.mockResolvedValue(Date.parse('2026-09-12T05:00:00Z'));
  TestBed.configureTestingModule({ imports: [ConnectionHistoryOptionComponent, ConnectionHistoryStatusComponent],
  providers: [{ provide: AppHapticsService, useValue: haptics }, { provide: AppUserService, useValue: users },
    { provide: RecordedHistoryStartService, useValue: history }] }); });
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
  it('describes Suunto route-library scope independently of the date range', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent);
    fixture.componentRef.setInput('service', ServiceNames.SuuntoApp); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('activities, Sleep, Health, and saved routes');
    expect(fixture.nativeElement.textContent).toContain('entire Suunto route library, regardless of the history range');
    fixture.componentRef.setInput('range', 'maximum'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('entire Suunto route library');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('offers provider-specific maximums and emits an accessible range choice', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent); const changed = vi.fn();
    fixture.componentInstance.rangeChange.subscribe(changed); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().at(-1)?.label).toBe('Maximum available (up to 5 years)');
    fixture.componentInstance.changeRange('maximum');
    expect(changed).toHaveBeenCalledWith('maximum');
    fixture.componentRef.setInput('service', ServiceNames.COROSAPI); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().map(option => option.label)).toEqual([
      '30 days', '60 days', 'Maximum available (3 months)',
    ]);
    fixture.componentRef.setInput('service', ServiceNames.WahooAPI); fixture.detectChanges();
    expect(fixture.componentInstance.rangeOptions().at(-1)?.label).toBe('All available history');
  });
  it('qualifies Garmin maximum availability without changing the selection or other providers', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryOptionComponent);
    fixture.componentRef.setInput('range', 'maximum'); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Maximum available (up to 5 years)');
    expect(fixture.nativeElement.textContent).toContain('History availability varies by data type and Garmin account.');
    expect(fixture.componentInstance.range()).toBe('maximum');
    expect(fixture.componentInstance.rangeOptions().at(-1)?.value).toBe('maximum');
    for (const service of [ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI]) {
      fixture.componentRef.setInput('service', service); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Garmin account');
      expect(fixture.componentInstance.range()).toBe('maximum');
    }
    expect(haptics.selection).not.toHaveBeenCalled();
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
  it('shows a manual selected range and retry controls without implying a connection-time preset', () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('service', ServiceNames.SuuntoApp);
    fixture.componentRef.setInput('status', { ...status, rangePreset: 'custom' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Requested range: Selected dates');
    expect(fixture.nativeElement.textContent).toContain('Retry failed imports');
    expect(fixture.nativeElement.textContent).not.toContain('30 days');
    expect(fixture.componentInstance.rangeTimezone()).toBeUndefined();
    fixture.componentRef.setInput('service', ServiceNames.COROSAPI); fixture.detectChanges();
    expect(fixture.componentInstance.rangeTimezone()).toBe('UTC');
    expect(haptics.success).not.toHaveBeenCalled();
  });
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
  const sleepHealthStatus = { runId: 'opaque', rangePreset: 'maximum', startMs: Date.parse('2021-10-13T00:00:00Z'),
    endMs: Date.parse('2026-10-13T05:00:00Z'), updatedAtMs: 3, active: false, canRetry: false,
    steps: [{ id: 'sleep', resources: ['sleep'], status: 'requested', count: 2 },
      { id: 'health', resources: ['health'], status: 'requested', count: 10 }] };
  const flush = async (fixture: ReturnType<typeof TestBed.createComponent<ConnectionHistoryStatusComponent>>) => {
    for (let i = 0; i < 10; i++) { fixture.detectChanges(); TestBed.flushEffects(); await Promise.resolve(); }
    fixture.detectChanges();
  };
  it('checks owner-scoped stored dates only on expansion, separately from requested range and historical Sleep limits', async () => {
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', sleepHealthStatus); await flush(fixture);
    expect(history.firstSleepDate).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentInstance.setExpanded(true); await flush(fixture);
    expect(history.firstSleepDate).toHaveBeenCalledExactlyOnceWith('owner', 'GarminAPI', expect.any(AbortSignal));
    expect(history.firstHealthDate).toHaveBeenCalledExactlyOnceWith('owner', 'GarminAPI', expect.any(AbortSignal));
    const copy = fixture.nativeElement.textContent;
    expect(copy).toContain('Requested range: Maximum available (up to 5 years)');
    expect(copy).toContain('first stored date Sep 12, 2026');
    expect(copy).toContain('not confirmed data coverage');
    expect(copy).toContain('not a guarantee for the current account or for Health metrics');
    expect(copy).toContain('Gaps and missing metrics may remain');
    expect(users.retryConnectionHistoryImport).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
    fixture.componentRef.setInput('status', { ...sleepHealthStatus, updatedAtMs: 4,
      steps: sleepHealthStatus.steps.map(step => ({ ...step, count: 25 })) }); await flush(fixture);
    expect(history.firstSleepDate).toHaveBeenCalledOnce();
    fixture.componentInstance.refreshStoredHistory(); fixture.componentInstance.refreshStoredHistory(); await flush(fixture);
    expect(history.firstSleepDate).toHaveBeenCalledTimes(2); expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('distinguishes an unavailable read from no stored records and never applies Garmin limits to Suunto', async () => {
    history.firstSleepDate.mockRejectedValue(new Error('offline')); history.firstHealthDate.mockResolvedValue(null);
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('service', ServiceNames.SuuntoApp); fixture.componentRef.setInput('status', sleepHealthStatus);
    fixture.componentInstance.setExpanded(true); await flush(fixture);
    expect(fixture.nativeElement.textContent).toContain('stored history could not be checked');
    expect(fixture.nativeElement.textContent).toContain('no records stored yet');
    expect(history.lastReportedGarminSleepCutoff).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.stored-history button').disabled).toBe(false);
  });
  it.each(['provider', 'run', 'owner', 'closed', 'destroyed'])('discards late stored dates when %s changes', async change => {
    let finish!: (value: string) => void;
    history.firstSleepDate.mockReturnValueOnce(new Promise(done => finish = done));
    const fixture = TestBed.createComponent(ConnectionHistoryStatusComponent);
    fixture.componentRef.setInput('status', sleepHealthStatus); fixture.componentInstance.setExpanded(true); await flush(fixture);
    const oldSignal = history.firstSleepDate.mock.calls[0][2];
    if (change === 'provider') fixture.componentRef.setInput('service', ServiceNames.WahooAPI);
    if (change === 'run') fixture.componentRef.setInput('status', { ...sleepHealthStatus, runId: 'replacement', steps: [] });
    if (change === 'owner') users.user.set(null);
    if (change === 'closed') fixture.componentInstance.setExpanded(false);
    if (change === 'destroyed') fixture.destroy(); else await flush(fixture);
    expect(oldSignal.aborted).toBe(true); finish('2020-01-01');
    if (change !== 'destroyed') {
      await flush(fixture);
      expect(fixture.componentInstance.storedHistory()).toEqual([]);
      expect(fixture.componentInstance.sleepCutoff()).toBeNull();
    }
    expect(haptics.error).not.toHaveBeenCalled();
  });
});
