import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { TrainingDeliveryDialogComponent } from './training-delivery-dialog.component';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';

describe('Training provider delivery controls', () => {
  const user = signal<{ uid: string } | null>({ uid: 'owner' });
  const user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' });
  let close: ReturnType<typeof vi.fn>;
  let service: { anyReady: () => boolean; isReady: ReturnType<typeof vi.fn>; watchPresence: ReturnType<typeof vi.fn>;
    watchScope: ReturnType<typeof vi.fn>; createMutationId: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn> };
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  const status = { schemaVersion: 1, id: 'delivery', workoutId: 'w', planId: null, provider: 'garmin',
    status: 'needs_attention', differsFromQS: true, hasRemoteCopy: true, timeZone: 'Europe/Helsinki',
    approvalDigest: null, issues: [], updatedAtMs: 1,
    lastAttemptAtMs: Date.parse('2026-09-10T10:00:00Z'), lastAcceptedAtMs: null, retryCount: 1, nextRetryAtMs: null };
  beforeEach(async () => {
    user.set({ uid: 'owner' }); user$.next(user()); close = vi.fn();
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    service = { anyReady: () => false, isReady: vi.fn(() => false), watchPresence: vi.fn(() => of(true)),
      watchScope: vi.fn(() => of({ settings: [], statuses: [status] })), createMutationId: vi.fn(() => 'mutation'),
      preview: vi.fn(async () => ({ schemaVersion: 1, available: true, connection: 'connected', hasPro: true,
        timeZone: 'Europe/Helsinki', effect: 'enable', settingsRevision: 0, eligibleCount: 1, warningCount: 0, issues: [], approvalDigest: null })),
      mutate: vi.fn(async () => ({})) };
    await TestBed.configureTestingModule({ imports: [TrainingDeliveryDialogComponent, TrainingDeliveryButtonComponent], providers: [
      provideRouter([]), provideNoopAnimations(), { provide: AppUserService, useValue: { user, user$ } },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
      { provide: AppHapticsService, useValue: haptics }, { provide: TrainingDeliveryService, useValue: service },
      { provide: MAT_DIALOG_DATA, useValue: { scope: 'workout', id: 'w', title: 'Morning run' } },
      { provide: MatDialogRef, useValue: { close } }, { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: TrainingPlansService, useValue: { watchSchedule: () => of({ state: { revision: 3 }, plans: [], workouts: [{
        schemaVersion: 1, id: 'w', planId: null, title: 'Morning run', revision: 2, localDate: '2026-09-10', lifecycle: 'planned',
        createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [] },
      }] }) } },
    ] }).compileComponents();
  });
  it('hides unavailable send controls but preserves problem details and Stop sync', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Delivery uncertain'); expect(text).toContain('Stop workout sync');
    expect(text).not.toContain('Send workout'); expect(text).not.toContain('Configure sync');
    expect(text).toContain('Last attempt'); expect(text).toContain('Failed attempts');
    expect(fixture.nativeElement.querySelector('.delivery-attempts').hidden).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
    // Multiple controls belong below the status, not in the compact heading's
    // single-action slot, where they squeeze the provider name at phone widths.
    expect(fixture.nativeElement.querySelector('[compactRowAction]')).toBeNull();
  });
  it('explains stopping sync without suggesting disconnection or deleting the QS workout', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const guidance: HTMLElement = fixture.nativeElement.querySelector('#delivery-guidance-details');
    expect(guidance.hidden).toBe(true);
    fixture.nativeElement.querySelector('[aria-controls="delivery-guidance-details"]').click();
    fixture.detectChanges();
    expect(guidance.hidden).toBe(false);
    expect(guidance.textContent).toContain('asks the connected app to remove upcoming synced workouts');
    expect(guidance.textContent).toContain('Your plans and workouts stay in Quantified Self');
    expect(guidance.textContent).toContain('Your provider account stays connected');
    expect(guidance.textContent).toContain('Past and completed workouts stay unchanged');
    expect(guidance.textContent).toContain('If your Pro subscription ends, sync pauses');
    expect(guidance.textContent).not.toMatch(/disconnect|account deletion|copies|withdraws/i);
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('separates plan controls from dated workout statuses and opens sync details, never the editor', async () => {
    const open = vi.fn();
    TestBed.overrideComponent(TrainingDeliveryDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'plan', id: 'p', title: 'Old plan name' } });
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' }],
      statuses: [{ ...status, id: 'later', workoutId: 'later', planId: 'p' }, { ...status, planId: 'p' }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'p', name: 'Winter build', revision: 2, lifecycle: 'active' }], workouts: [
        { id: 'w', planId: 'p', title: 'Year-end run', localDate: '2026-12-31', revision: 2 },
        { id: 'later', planId: 'p', title: 'New-year run', localDate: '2027-01-02', revision: 1 },
      ] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Plan sync');
    expect(fixture.nativeElement.querySelector('.delivery-subtitle').textContent).toBe('Winter build');
    expect(fixture.nativeElement.querySelector('.delivery-workouts h4').textContent).toBe('Workout sync status');
    const rows = fixture.nativeElement.querySelectorAll('.delivery-workout-button');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Year-end run');
    expect(rows[1].textContent).toContain('New-year run');
    expect(rows[0].querySelector('time').getAttribute('datetime')).toBe('2026-12-31');
    expect(rows[0].textContent).toContain('Dec 31, 2026');
    expect(rows[0].textContent).not.toContain('Last attempt');
    const description = fixture.nativeElement.querySelector('#' + rows[0].getAttribute('aria-describedby'));
    expect(description.textContent).toContain('Dec 31, 2026');
    expect(description.textContent).toContain('Delivery uncertain');
    expect(fixture.nativeElement.querySelector('.delivery-list a')).toBeNull();
    rows[0].click();
    expect(open).toHaveBeenCalledWith(TrainingDeliveryDialogComponent, expect.objectContaining({ data: {
      scope: 'workout', id: 'w', title: 'Year-end run', returnTo: { scope: 'plan', id: 'p', title: 'Winter build' },
    } }));
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it.each([['plan', 'Plan sync'], ['workout', 'Workout sync'], ['history', 'Workout sync history']])('names the %s entry point before opening it', (scope, label) => {
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', scope); fixture.componentRef.setInput('entityId', 'p'); fixture.componentRef.setInput('title', 'Example');
    fixture.detectChanges();
    expect(fixture.componentInstance.buttonLabel()).toBe(label);
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('does not imply activating a plan without opt-in will start sync', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'plan', id: 'p', title: 'Winter build' } });
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'p', revision: 2, lifecycle: 'paused' }], workouts: [] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Activate it and enable plan sync');
    expect(fixture.nativeElement.textContent).not.toContain('syncing resumes only after activation');
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it.each(['active', 'paused', 'archived'])('makes plan-wide Stop explicit and distinguishes an empty %s plan', async lifecycle => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'plan', id: 'p', title: 'Winter build' } });
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' }], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'p', revision: 2, lifecycle }], workouts: [] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No workout sync status yet');
    expect(fixture.nativeElement.textContent.includes('This plan is inactive')).toBe(lifecycle !== 'active');
    const stop = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent === 'Stop plan sync')!;
    stop.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Stop plan sync?');
    expect(fixture.nativeElement.textContent).toContain('Stop syncing this plan’s workouts to Garmin');
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'plan', scopeId: 'p', action: 'stop' }), expect.any(Function));
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('names the parent plan, separates Edit from sync, and returns to the overview without changing consent', async () => {
    const open = vi.fn(); const returnTo = { scope: 'plan', id: 'p', title: 'Winter build' };
    TestBed.overrideComponent(TrainingDeliveryDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'workout', id: 'w', title: 'Run', returnTo } });
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'p', name: 'Winter build' }], workouts: [{ id: 'w', planId: 'p', title: 'Run', localDate: '2026-12-31', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Workout sync');
    expect(fixture.nativeElement.textContent).toContain('Plan: Winter build');
    expect(fixture.nativeElement.textContent).toContain('These controls affect only this workout');
    expect(fixture.nativeElement.querySelector('a[href="/training/plans/workout/w"]').textContent).toContain('Edit workout');
    await fixture.componentInstance.begin('garmin', 'stop'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Stop workout sync?');
    expect(fixture.nativeElement.textContent).toContain('Other workouts are not affected');
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workout', scopeId: 'w', action: 'stop' }), expect.any(Function));
    fixture.componentInstance.cancelReview(); fixture.detectChanges();
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.includes('Back to plan sync'))!.click();
    expect(open).toHaveBeenCalledWith(TrainingDeliveryDialogComponent, expect.objectContaining({ data: returnTo }));
    expect(service.mutate).not.toHaveBeenCalled();
    open.mockClear(); user.set({ uid: 'replacement' }); fixture.componentInstance.backToOverview();
    expect(open).not.toHaveBeenCalled();
  });
  it('previews before consent and retries the exact mutation after an uncertain response', async () => {
    service.isReady.mockReturnValue(true);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'send'); component.updateTimeZone('Europe/Helsinki');
    expect(service.mutate).not.toHaveBeenCalled();
    await component.review();
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ expectedScheduleRevision: 3,
      expectedScopeRevision: 2, timeZone: 'Europe/Helsinki' }), expect.any(Function));
    service.mutate.mockRejectedValueOnce(new Error('uncertain'));
    await component.confirm(); expect(haptics.error).toHaveBeenCalledOnce();
    await component.confirm(); expect(haptics.success).toHaveBeenCalledOnce();
    expect(service.mutate.mock.calls[0][0]).toEqual(service.mutate.mock.calls[1][0]);
  });
  it.each(['plan', 'workout'] as const)('opens the only destination directly for a new %s, checks automatically, and waits for consent', async scope => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [] }));
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope, id: 'w', title: 'Morning run', initialProvider: 'garmin' } });
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'w', revision: 2, lifecycle: 'active' }], workouts: [{ id: 'w', revision: 2, planId: null }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(service.preview).toHaveBeenCalledOnce();
    expect(service.preview.mock.calls[0][0].action).toBe(scope === 'plan' ? 'configure' : 'send');
    expect(service.mutate).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Preview change');
    expect(fixture.nativeElement.querySelector('#delivery-time-zone').hidden).toBe(true);
    const consent = fixture.nativeElement.querySelector('.delivery-review-actions button') as HTMLButtonElement;
    expect(consent.textContent?.trim()).toBe(scope === 'plan' ? 'Enable plan sync' : 'Send workout');
    expect(consent.disabled).toBe(false); consent.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(service.mutate).toHaveBeenCalledOnce();
    expect(service.mutate.mock.calls[0][0]).toEqual(service.preview.mock.calls[0][0]);
    expect(fixture.componentInstance.draft()).toBeNull();
    expect(service.preview).toHaveBeenCalledOnce(); // live updates do not reopen consent
  });
  it('waits for settings to load and never auto-reviews existing consent from a stale presence hint', async () => {
    const view$ = new BehaviorSubject({ settings: [{ provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' }], statuses: [] });
    service.isReady.mockImplementation(provider => provider === 'garmin'); service.watchScope.mockReturnValue(view$);
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'workout', id: 'w', title: 'Morning run', initialProvider: 'garmin' } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.draft()).toBeNull(); expect(service.preview).not.toHaveBeenCalled();
    view$.next({ settings: [], statuses: [] }); fixture.detectChanges(); await fixture.whenStable();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('requires a fresh automatic check after an explicit time-zone edit and keeps failed checks retryable', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'send');
    component.toggleTimeZone(); component.updateTimeZone('America/New_York'); fixture.detectChanges();
    expect(component.canConfirm()).toBe(false);
    await component.confirm(); expect(service.mutate).not.toHaveBeenCalled();
    const response = { ...await service.preview.mock.results[0].value, timeZone: 'America/New_York' };
    service.preview.mockRejectedValueOnce({ name: 'TimeoutError' }); await component.review();
    expect(component.canConfirm()).toBe(false); expect(component.editingTimeZone()).toBe(true);
    service.preview.mockResolvedValueOnce(response); await component.review();
    expect(component.preview()?.command.timeZone).toBe('America/New_York');
    expect(component.editingTimeZone()).toBe(false); expect(service.mutate).not.toHaveBeenCalled();
    await component.confirm(); expect(service.mutate.mock.calls[0][0].timeZone).toBe('America/New_York');
  });
  it('does not turn mapping warnings into automatic degradation approval', async () => {
    const response = await service.preview(); service.preview.mockClear();
    service.preview.mockResolvedValue({ ...response, warningCount: 1, issues: ['Power target requires review.'], approvalDigest: 'latest-digest' });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'send'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('degraded workouts require individual approval');
    expect(service.mutate).not.toHaveBeenCalled();
    await component.confirm();
    expect(service.mutate.mock.calls[0][0]).not.toHaveProperty('approvalDigest');
    await component.begin('garmin', 'approve', 'old-digest');
    expect(service.mutate).toHaveBeenCalledOnce(); // approving is a separate, explicit action
    await component.confirm();
    expect(service.mutate.mock.calls[1][0]).toMatchObject({ action: 'approve', approvalDigest: 'latest-digest' });
  });
  it('renders 25 dense history summaries without a panel or repeated attempt/help details per workout', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'history', id: 'current', title: 'All deliveries' } });
    service.watchScope.mockReturnValue(of({ settings: [], statuses: Array.from({ length: 25 }, (_, i) => ({ ...status, id: String(i) })) }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.delivery-status--summary');
    expect(rows).toHaveLength(25);
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('.delivery-attempts')).toBeNull();
    expect(rows[0].querySelectorAll('button')).toHaveLength(1);
    expect(rows[0].querySelector('a')).toBeNull();
    expect(rows[0].querySelector('time').getAttribute('datetime')).toBe('2026-09-10');
    expect(rows[0].querySelector('button').getAttribute('aria-label')).toBe('Sync details for workout: Morning run');
    expect(rows[0].textContent).toContain('2026');
  });
  it('shows a newer failed attempt instead of an older successful delivery time in a compact row', () => {
    const accepted = Date.parse('2026-09-10T10:00:00Z');
    const attempted = Date.parse('2026-09-14T12:00:00Z');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, status: 'retrying',
      lastAcceptedAtMs: accepted, lastAttemptAtMs: attempted }] }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.componentInstance.rows()[0].statuses[0]).toMatchObject({ timestamp: attempted, timestampLabel: 'Last attempt' });
  });
  it('uses surface-free disclosures with controlled regions and one feedback owner', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    for (const id of ['delivery-attempt-delivery', 'delivery-guidance-details']) {
      const button = fixture.nativeElement.querySelector('button[aria-controls="' + id + '"]') as HTMLButtonElement;
      const region = fixture.nativeElement.querySelector('#' + id) as HTMLElement;
      expect(button.getAttribute('aria-expanded')).toBe('false'); expect(region.hidden).toBe(true);
      button.click(); fixture.detectChanges();
      expect(button.getAttribute('aria-expanded')).toBe('true'); expect(region.hidden).toBe(false);
    }
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
  });
  it('clears staged approval and records and closes when the account changes', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'stop');
    user.set(null); user$.next(null); fixture.detectChanges();
    expect(component.preview()).toBeNull(); expect(component.view().statuses).toEqual([]); expect(close).toHaveBeenCalled();
    await component.confirm(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('blocks actions immediately on account replacement before the close effect or user stream runs', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'send'); service.preview.mockClear();
    user.set({ uid: 'replacement' });
    await component.confirm(); await component.begin('garmin', 'send'); await component.review();
    expect(service.mutate).not.toHaveBeenCalled(); expect(service.preview).not.toHaveBeenCalled();
  });
  it('lets the user cancel a read-only preview and ignores its late response', async () => {
    const response = await service.preview();
    let resolve!: (value: unknown) => void;
    service.preview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    const pending = component.begin('garmin', 'stop'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Checking availability');
    expect(Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Cancel')?.disabled).toBe(false);
    component.cancelReview(); expect(component.busy()).toBe(false);
    resolve(response); await pending;
    expect(component.preview()).toBeNull(); expect(component.draft()).toBeNull();
    expect(service.mutate).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it.each(['preview', 'saving'] as const)('ignores late %s results after the dialog is destroyed', async phase => {
    const response = await service.preview();
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    if (phase === 'saving') await component.begin('garmin', 'stop');
    let resolve!: (value: unknown) => void;
    service[phase === 'saving' ? 'mutate' : 'preview'].mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = phase === 'saving' ? component.confirm() : component.begin('garmin', 'stop');
    fixture.destroy(); resolve(response); await pending;
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
    if (phase === 'preview') expect(component.preview()).toBeNull();
  });
  it('reports a preview timeout as read-only and distinguishes saving from delivery success', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    service.preview.mockRejectedValueOnce({ name: 'TimeoutError' });
    await component.begin('garmin', 'stop');
    expect(component.busy()).toBe(false); expect(component.error()).toContain('No sync settings were changed');
    await component.review(); await component.confirm(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Eligible copies will be removed in the background');
  });
  it('does not call a preview with an invalid IANA zone', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    await fixture.componentInstance.begin('garmin', 'send'); service.preview.mockClear();
    fixture.componentInstance.updateTimeZone('bad/zone');
    await fixture.componentInstance.review();
    expect(service.preview).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('time zone');
  });
  it('reports schedule read failure instead of showing a deleted workout or leaving actionable controls', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'plan', id: 'p', title: 'Plan' } });
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => throwError(() => new Error('unavailable')) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unable to load the training schedule');
    expect(fixture.nativeElement.textContent).not.toContain('Deleted workout');
    fixture.componentInstance.begin('garmin', 'stop');
    expect(fixture.componentInstance.draft()).toBeNull();
  });
  it('does not claim a first partial delivery is a different workout', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('delivery is not fully confirmed yet');
    expect(fixture.nativeElement.textContent).not.toContain('copy differs from Quantified Self');
  });
  it('does not offer Resume for already inherited delivery and keeps disclosure feedback user-triggered', () => {
    service.isReady.mockReturnValue(true);
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: false, suppressed: false,
      associationPlanId: 'p', timeZone: 'Europe/Helsinki' }], statuses: [status] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Follows plan sync settings');
    expect(fixture.nativeElement.textContent).not.toContain('Resume workout sync');
    expect(fixture.nativeElement.textContent).not.toContain('Sync off');
    expect(haptics.selection).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('button[aria-controls="delivery-attempt-delivery"]') as HTMLElement).click();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it.each(['send', 'stop'] as const)('shows permission repair with zero mapping warnings when reviewing %s', async action => {
    service.isReady.mockReturnValue(true);
    service.preview.mockResolvedValue({ ...(await service.preview()), connection: 'connection_repair', warningCount: 0,
      issues: ['Garmin Training permission is required. Reconnect Garmin and allow training workouts.'] });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    await fixture.componentInstance.begin('garmin', action); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Garmin Training permission is required. Reconnect Garmin');
    expect(fixture.nativeElement.textContent).not.toContain('Workout Import');
    expect(fixture.nativeElement.textContent).not.toContain('workouts need review');
    expect(fixture.componentInstance.canConfirm()).toBe(action === 'stop');
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('keeps loaded status pages live and drops records that leave the scope', async () => {
    const first = Array.from({ length: 25 }, (_, index) => ({ ...status, id: String(index).padStart(3, '0') }));
    const expanded$ = new BehaviorSubject({ settings: [], statuses: [...first, { ...status, id: '025' }] });
    service.watchScope.mockImplementation((_uid, _scope, _id, count = 25) => count === 25
      ? of({ settings: [], statuses: first }) : expanded$);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.loadMore(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.statuses()).toHaveLength(26);
    expanded$.next({ settings: [], statuses: [...first, { ...status, id: '025', status: 'removed', hasRemoteCopy: false }] });
    fixture.detectChanges();
    expect(component.statuses().find(item => item.id === '025')?.status).toBe('removed');
    expanded$.next({ settings: [], statuses: first }); fixture.detectChanges();
    expect(component.statuses()).toHaveLength(25);
    expect(component.canLoadMore()).toBe(false);
    fixture.destroy();
    expect(expanded$.observed).toBe(false);
  });
  it.each([false, true])('lets a plan workout suppress failed inherited sync, including stale prior-scope suppression: %s', staleSuppression => {
    service.watchScope.mockReturnValue(of({ settings: staleSuppression ? [{ provider: 'garmin', enabled: false, suppressed: true,
      associationPlanId: 'old-plan', timeZone: 'Europe/Helsinki' }] : [], statuses: [{ ...status, planId: 'p', hasRemoteCopy: false }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .some(button => button.textContent?.trim() === 'Stop workout sync')).toBe(true);
  });
  it('keeps Stop available after a transfer before a delivery status exists, ignoring the old plan suppression', () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: false, suppressed: true,
      associationPlanId: 'old-plan', timeZone: 'Europe/Berlin' }], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'new-plan', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.componentInstance.rows()[0].canStop).toBe(true);
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).toContain('Stop workout sync');
    expect(fixture.nativeElement.textContent).not.toContain('Resume workout sync');
  });
  it.each(['old-plan', 'new-plan'])('only offers status-derived Resume for the current plan, not a previous plan (%s)', planId => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, planId, status: 'stopped', hasRemoteCopy: false }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'new-plan', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent.includes('Resume workout sync')).toBe(planId === 'new-plan');
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).toContain('Stop workout sync');
  });
  it.each(['stop', 'retry', 'resume', 'approve'] as const)('shows only the server-resolved inherited zone when reviewing %s', async action => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: false, suppressed: false,
      associationPlanId: 'p', timeZone: 'Europe/Berlin' }], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    service.preview.mockResolvedValue({ ...(await service.preview()), timeZone: 'America/New_York' });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Follows plan sync settings');
    expect(fixture.nativeElement.textContent).not.toContain('Europe/Berlin');
    await fixture.componentInstance.begin('garmin', action); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Time zone: America/New_York');
    expect(fixture.nativeElement.querySelector('input[name="timeZone"]')).toBeNull();
    expect(service.preview.mock.calls.at(-1)![0]).not.toHaveProperty('timeZone');
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('retains Resume for current-plan suppression before a status exists', () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: false, suppressed: true,
      associationPlanId: 'p', timeZone: 'Europe/Helsinki' }], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Stopped for this workout');
    expect(fixture.nativeElement.textContent).toContain('Resume workout sync');
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).not.toContain('Stop workout sync');
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('does not offer Resume again after consent resumes while its old stopped status is still reconciling', () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    const view$ = new BehaviorSubject({ settings: [{ provider: 'garmin', enabled: false, suppressed: true,
      associationPlanId: 'p', timeZone: 'Europe/Helsinki' }], statuses: [{ ...status, planId: 'p', status: 'stopped', hasRemoteCopy: false }] });
    service.watchScope.mockReturnValue(view$);
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Resume workout sync');
    view$.next({ ...view$.value, settings: [{ ...view$.value.settings[0], suppressed: false }] }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Resume workout sync');
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).toContain('Stop workout sync');
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('opens retained workout delivery from history without linking to a deleted editor', () => {
    const open = vi.fn();
    TestBed.overrideComponent(TrainingDeliveryDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'history', id: 'current', title: 'All provider deliveries' } });
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, workoutId: 'deleted' }] }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const details = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.getAttribute('aria-label') === 'Sync details for workout: Deleted workout');
    expect(details).toBeDefined(); details!.click();
    expect(open).toHaveBeenCalledWith(TrainingDeliveryDialogComponent,
      expect.objectContaining({ data: { scope: 'workout', id: 'deleted', title: 'Deleted workout',
        returnTo: { scope: 'history', id: 'current', title: 'All provider deliveries' } } }));
    expect(close).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('a[href*="deleted"]')).toBeNull();
  });
  it('previews recovery for a missing source with revision zero and never offers Send', async () => {
    service.isReady.mockReturnValue(true);
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 }, plans: [], workouts: [] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).not.toContain('Send workout');
    component.begin('garmin', 'send'); expect(component.draft()).toBeNull();
    await component.begin('garmin', 'retry');
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workout', scopeId: 'w', expectedScopeRevision: 0, action: 'retry' }), expect.any(Function));
  });
  it('does not expose a button when no provider is ready and no settings/status exist', () => {
    service.watchPresence.mockReturnValue(of(false));
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', 'plan'); fixture.componentRef.setInput('entityId', 'p'); fixture.componentRef.setInput('title', 'Plan');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
  it.each([1, 2])('opens the consent check directly only for a single ready provider (%s ready)', count => {
    const open = vi.fn();
    TestBed.overrideComponent(TrainingDeliveryButtonComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    service.anyReady = () => true; service.watchPresence.mockReturnValue(of(false));
    service.isReady.mockImplementation(provider => provider === 'garmin' || (count === 2 && provider === 'coros'));
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', 'plan'); fixture.componentRef.setInput('entityId', 'p'); fixture.componentRef.setInput('title', 'Plan');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(count === 1 ? 'Sync plan with Garmin' : 'Sync plan');
    fixture.nativeElement.querySelector('button').click();
    const data = open.mock.calls[0][1].data;
    expect(data.initialProvider).toBe(count === 1 ? 'garmin' : undefined);
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('shows Send only for the pilot and hides it on account switch or sign-out without creating consent', () => {
    service.watchPresence.mockReturnValue(of(false));
    service.anyReady = () => isTrainingProviderDeliveryEnabled('garmin', user()?.uid);
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', 'workout'); fixture.componentRef.setInput('entityId', 'w');
    fixture.componentRef.setInput('title', 'Workout'); fixture.componentRef.setInput('standalone', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    user.set({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' }); user$.next(user()); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Send workout');
    user.set({ uid: 'another-user' }); user$.next(user()); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    user.set(null); user$.next(null); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('renders the Material dialog shell and permits recovery without Pro without granting consent', async () => {
    TestBed.overrideProvider(MatDialog, { useFactory: () => new MatDialog() });
    service.isReady.mockImplementation(provider => provider === 'garmin');
    let ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'workout', id: 'w', title: 'Morning run — September training' }, width: '640px', maxWidth: '95vw',
    });
    TestBed.inject(ApplicationRef).tick();
    await TestBed.inject(ApplicationRef).whenStable();
    // Vite's unit-test transform omits component SCSS. Compile those same source styles
    // only for the optional browser artifact, scoped to their real custom-element hosts.
    const qaCss = process.env.TRAINING_DELIVERY_QA_DIR ? [
      ['app-training-delivery-dialog', 'src/app/components/plans/training-delivery-dialog.component.scss'],
      ['app-compact-row', 'src/app/components/shared/compact-row/compact-row.component.scss'],
    ].map(([host, file]) => {
      const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass');
      return sass.compileString(`${host} { ${readFileSync(file, 'utf8').replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&')} }`).css;
    }).join('\n') : '';
    const render = (name: string) => {
      TestBed.inject(ApplicationRef).tick();
      ref.componentRef!.changeDetectorRef.detectChanges();
      // Optional synthetic DOM artifacts for desktop/mobile browser QA. No provider transport,
      // credentials, live data, or browser-selected production mode is involved.
      if (process.env.TRAINING_DELIVERY_QA_DIR) {
        const body = document.body.cloneNode(true) as HTMLElement;
        if (name.endsWith('-dark')) body.classList.add('dark-theme');
        document.querySelectorAll('input').forEach((input, index) => body.querySelectorAll('input')[index].setAttribute('value', input.value));
        writeFileSync(join(process.env.TRAINING_DELIVERY_QA_DIR, `${name}.html`),
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Training delivery QA</title><link rel="stylesheet" href="styles.css">${Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')}<style>${qaCss}</style></head>${body.outerHTML}</html>`);
      }
    };
    render('delivery-status'); render('delivery-status-dark');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.classList.contains('mdc-dialog--open')).toBe(true);
    expect(document.querySelector('h2')?.textContent).toContain('Workout sync');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(document.querySelector('h2')?.id);
    const check = ref.componentInstance.begin('garmin', 'send'); render('delivery-settings');
    await check; render('delivery-preview');
    ref.componentInstance.phase.set('saving'); render('delivery-pending'); ref.componentInstance.phase.set(null);
    ref.componentRef!.changeDetectorRef.detectChanges();
    Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Cancel')!.click();
    expect(ref.componentInstance.draft()).toBeNull();
    expect(ref.componentInstance.preview()).toBeNull();
    service.preview.mockResolvedValue({ ...(await service.preview()), hasPro: false, effect: 'retry' });
    await ref.componentInstance.begin('garmin', 'retry'); render('delivery-retry');
    expect(ref.componentInstance.canConfirm()).toBe(true);
    expect(document.body.textContent).toContain('Retry does not resume stopped sync');
    await ref.componentInstance.confirm();
    expect(service.mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'retry' }), expect.any(Function));
    expect(service.mutate.mock.calls[0][0]).not.toHaveProperty('timeZone');
    ref.close();
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, workoutId: 'deleted' }] }));
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'history', id: 'current', title: 'All provider deliveries' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable(); render('delivery-history');
    ref.componentInstance.inspectWorkout({ ...status, workoutId: 'deleted' } as Parameters<TrainingDeliveryDialogComponent['inspectWorkout']>[0]);
    await TestBed.inject(ApplicationRef).whenStable();
    ref = TestBed.inject(MatDialog).openDialogs.at(-1)!;
    expect(ref.componentInstance.data).toEqual({ scope: 'workout', id: 'deleted', title: 'Deleted workout',
      returnTo: { scope: 'history', id: 'current', title: 'All provider deliveries' } });
    await ref.componentInstance.begin('garmin', 'retry'); render('delivery-deleted-recovery');
    expect(ref.componentInstance.preview()?.command.expectedScopeRevision).toBe(0);
    ref.close();
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [] }));
    vi.spyOn(TestBed.inject(TrainingPlansService), 'watchSchedule').mockReturnValue(of({ state: { revision: 3 },
      plans: [{ id: 'p', revision: 2, lifecycle: 'active' }], workouts: [] }) as never);
    service.preview.mockResolvedValue({ ...(await service.preview()), hasPro: true, effect: 'enable', eligibleCount: 12 });
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'plan', id: 'p', title: 'Autumn training · September–December', initialProvider: 'garmin' }, width: '640px', maxWidth: '95vw',
    });
    TestBed.inject(ApplicationRef).tick();
    await TestBed.inject(ApplicationRef).whenStable(); render('plan-enable'); render('plan-enable-dark');
    expect(ref.componentInstance.confirmLabel()).toBe('Enable plan sync');
    expect(ref.componentInstance.canConfirm()).toBe(true); expect(ref.componentInstance.busy()).toBe(false);
    ref.componentInstance.toggleTimeZone(); render('plan-time-zone'); ref.close();
    const planStatuses = [{ ...status, planId: 'p', status: 'delivered', differsFromQS: false, lastAcceptedAtMs: status.lastAttemptAtMs },
      { ...status, id: 'second', workoutId: 'second', planId: 'p', status: 'pending', differsFromQS: false, lastAcceptedAtMs: null }];
    service.watchScope.mockImplementation((_uid, scope, id) => of({
      settings: scope === 'plan' ? [{ provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' }] : [],
      statuses: scope === 'workout' ? planStatuses.filter(item => item.workoutId === id) : planStatuses,
    }));
    vi.mocked(TestBed.inject(TrainingPlansService).watchSchedule).mockReturnValue(of({ state: { revision: 3 },
      plans: [{ id: 'p', name: 'Winter build · December–January', revision: 2, lifecycle: 'active' }], workouts: [
        { id: 'w', planId: 'p', title: 'Easy run with a relaxed finish', localDate: '2026-12-31', revision: 2 },
        { id: 'second', planId: 'p', title: 'New-year endurance workout with an unusually long descriptive title', localDate: '2027-01-02', revision: 1 },
      ] }) as never);
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'plan', id: 'p', title: 'Winter build' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable(); render('plan-sync'); render('plan-sync-dark');
    expect(document.querySelectorAll('.delivery-workout-button')).toHaveLength(2);
    await ref.componentInstance.begin('garmin', 'stop'); render('plan-stop'); ref.componentInstance.cancelReview();
    ref.componentInstance.inspectWorkout(planStatuses[0] as Parameters<TrainingDeliveryDialogComponent['inspectWorkout']>[0]);
    await TestBed.inject(ApplicationRef).whenStable(); ref = TestBed.inject(MatDialog).openDialogs.at(-1)!;
    render('plan-workout-sync'); render('plan-workout-sync-dark');
    expect(document.body.textContent).toContain('Back to plan sync');
    await ref.componentInstance.begin('garmin', 'stop'); render('workout-stop'); ref.close();
    service.watchScope.mockReturnValue(of({ settings: [], statuses: Array.from({ length: 25 }, (_, index) => ({
      ...status, id: 'history-' + index, status: index % 3 === 0 ? 'needs_attention' : 'delivered',
      lastAcceptedAtMs: index % 3 === 0 ? null : status.lastAttemptAtMs,
    })) }));
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'history', id: 'current', title: 'All provider deliveries' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable(); render('delivery-history-many'); render('delivery-history-many-dark');
    expect(document.querySelectorAll('.delivery-status--summary')).toHaveLength(25); ref.close();
  });
});
