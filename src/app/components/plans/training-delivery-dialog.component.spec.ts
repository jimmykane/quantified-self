import { ApplicationRef, ErrorHandler, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconRegistry } from '@angular/material/icon';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By, DomSanitizer } from '@angular/platform-browser';
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
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { AppEventService } from '../../services/app.event.service';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';
import { WAHOO_TRAINING_PERMISSION_ISSUE } from '@shared/wahoo-training';
import { WahooRouteAccessReconnectDialogComponent } from '../wahoo-route-access-reconnect-dialog/wahoo-route-access-reconnect-dialog.component';

describe('Training provider delivery controls', () => {
  const user = signal<{ uid: string } | null>({ uid: 'owner' });
  const user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' });
  let close: ReturnType<typeof vi.fn>;
  let service: { anyReady: () => boolean; isReady: ReturnType<typeof vi.fn>; watchPresence: ReturnType<typeof vi.fn>;
    watchScope: ReturnType<typeof vi.fn>; createMutationId: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };
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
      mutate: vi.fn(async () => ({})), check: vi.fn(async () => ({ schemaVersion: 1, action: 'check', result: 'queued', requestedAtMs: 1, notBeforeMs: 1 })) };
    await TestBed.configureTestingModule({ imports: [TrainingDeliveryDialogComponent, TrainingDeliveryButtonComponent], providers: [
      provideRouter([]), provideNoopAnimations(), { provide: AppUserService, useValue: { user, user$ } },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: MatIconRegistry, useFactory: () => {
        const sanitizer = inject(DomSanitizer);
        const registry = new MatIconRegistry(null, sanitizer, document, inject(ErrorHandler));
        for (const provider of ['garmin', 'coros', 'wahoo', 'suunto']) {
          registry.addSvgIconLiteral(provider, sanitizer.bypassSecurityTrustHtml(readFileSync(`src/assets/logos/${provider}.svg`, 'utf8')));
        }
        return registry;
      } },
      { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
      { provide: AppHapticsService, useValue: haptics }, { provide: TrainingDeliveryService, useValue: service },
      { provide: AppEventService, useValue: { getEventMetaDataKeys: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: { scope: 'workout', id: 'w', title: 'Morning run' } },
      { provide: MatDialogRef, useValue: { close } }, { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: TrainingPlansService, useValue: { watchSchedule: () => of({ state: { revision: 3 }, plans: [], workouts: [{
        schemaVersion: 1, id: 'w', planId: null, title: 'Morning run', revision: 2, localDate: '2026-09-10', lifecycle: 'planned',
        createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [] },
      }] }), watchWorkoutCompletions: () => of([]) } },
    ] }).compileComponents();
  });
  it.each(['plan', 'workout', 'history'])('renders a provider overview with destination logos in %s sync without extra reads or actions', scope => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope, id: 'w', title: 'Example' } });
    const providers = ['garmin', 'coros', 'wahoo', 'suunto'];
    service.watchScope.mockReturnValue(of({ settings: [], statuses: providers.map(provider => ({ ...status, provider, id: provider })) }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.delivery-provider-overview app-compact-row')).toHaveLength(4);
    fixture.nativeElement.querySelectorAll('.delivery-provider-overview app-compact-row').forEach((row: HTMLElement) => {
      expect(row.classList).toContain('compact-row-host--mobile-action-full');
    });
    expect(fixture.nativeElement.querySelector('[role="tab"]')).toBeNull();
    const icons = fixture.debugElement.queryAll(By.directive(ServiceSourceIconComponent));
    expect(icons).toHaveLength(4);
    icons.forEach((icon, index) => {
      const component = icon.componentInstance as ServiceSourceIconComponent;
      expect(component.presentation?.mode).toBe('destination');
      expect(component.serviceLogo).toBe(providers[index]);
      expect(icon.nativeElement.closest('app-compact-row')?.textContent.trim()).toContain(fixture.componentInstance.rows()[index].displayLabel);
      expect(icon.nativeElement.getAttribute('aria-hidden')).toBe('true');
      expect(icon.nativeElement.querySelector('svg')).not.toBeNull();
      expect(component.showTooltip).toBe(false);
      expect(component.iconWidth).toBe(48); expect(component.iconHeight).toBe(16);
      const manage = icon.nativeElement.closest('app-compact-row')?.querySelector('button[compactRowAction]') as HTMLButtonElement;
      expect(manage.textContent?.trim()).toBe('Manage');
      expect(manage.getAttribute('aria-label')).toBe(`Manage ${fixture.componentInstance.rows()[index].displayLabel} sync`);
    });
    expect(TestBed.inject(AppEventService).getEventMetaDataKeys).not.toHaveBeenCalled();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('shows provider sync state separately from workout status before Manage', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'plan', id: 'p', title: 'Winter build' } });
    service.watchScope.mockReturnValue(of({ settings: [
      { provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' },
      { provider: 'suunto', enabled: false, timeZone: 'Europe/Helsinki' },
    ], statuses: [{ ...status, provider: 'garmin', planId: 'p', status: 'delivered', differsFromQS: false,
      lastAcceptedAtMs: status.lastAttemptAtMs }, { ...status, id: 'suunto-delivery', provider: 'suunto', planId: 'p' }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'p', name: 'Winter build', revision: 2, lifecycle: 'active' }],
      workouts: [{ id: 'w', planId: 'p', title: 'Morning run', localDate: '2026-09-10', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const garmin = (fixture.nativeElement.querySelector('button[aria-label="Manage Garmin Connect sync"]') as HTMLElement).closest('app-compact-row')!;
    const suunto = (fixture.nativeElement.querySelector('button[aria-label="Manage Suunto App sync"]') as HTMLElement).closest('app-compact-row')!;
    expect(garmin.textContent).toContain('Sync enabled');
    expect(garmin.querySelector('.delivery-provider-state')?.classList).toContain('delivery-provider-state--enabled');
    expect(garmin.textContent).toContain('Sent · remote checking unavailable');
    expect(suunto.textContent).toContain('Sync off');
    expect(suunto.querySelector('.delivery-provider-state')?.classList).not.toContain('delivery-provider-state--enabled');
    expect(suunto.textContent).toContain('Delivery uncertain');
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('opens one provider directly and drills into a provider without sync side effects', async () => {
    let fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).toBeNull();
    expect(fixture.nativeElement.querySelector('.delivery-provider-logo')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Garmin');

    fixture.destroy();
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [status,
      { ...status, id: 'suunto-delivery', provider: 'suunto' }] }));
    fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).not.toBeNull();
    const manage = fixture.nativeElement.querySelector('button[aria-label="Manage Suunto App sync"]') as HTMLButtonElement;
    manage.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).toBeNull();
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Suunto');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.delivery-dialog-title'));
    expect(fixture.nativeElement.textContent).toContain('All services');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    (fixture.nativeElement.querySelector('.delivery-provider-back') as HTMLButtonElement).click(); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).not.toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-delivery-provider="suunto"]'));
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('returns to the provider overview if the selected provider disappears from the live view', async () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: {
      scope: 'workout', id: 'w', title: 'Morning run', selectedProvider: 'suunto',
    } });
    const scope$ = new BehaviorSubject({ settings: [], statuses: [
      status,
      { ...status, id: 'suunto-delivery', provider: 'suunto' },
    ] });
    service.watchScope.mockReturnValue(scope$);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Suunto App');
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).toBeNull();

    scope$.next({ settings: [], statuses: [
      status,
      { ...status, id: 'wahoo-delivery', provider: 'wahoo' },
    ] });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h2').textContent.trim()).toBe('Workout sync');
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).not.toBeNull();
    expect(fixture.componentInstance.selectedProvider()).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.delivery-dialog-title'));
    expect(fixture.nativeElement.textContent).not.toContain('No providers are available');
    scope$.next({ settings: [], statuses: [status,
      { ...status, id: 'wahoo-delivery', provider: 'wahoo' },
      { ...status, id: 'suunto-returned', provider: 'suunto' },
    ] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-provider-overview')).not.toBeNull();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
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
  it('shows whether the activity link came from this provider or another confirmed provider copy', async () => {
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [
      { ...status, provider: 'garmin', status: 'past', differsFromQS: false, lastAcceptedAtMs: 1000 },
      { ...status, id: 'suunto-delivery', provider: 'suunto', status: 'completed', differsFromQS: false, lastAcceptedAtMs: 1000 },
    ] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: {
      watchSchedule: () => of({ state: { revision: 3 }, plans: [], workouts: [{
        schemaVersion: 1, id: 'w', planId: null, title: 'Morning run', revision: 2, localDate: '2026-09-10', lifecycle: 'planned',
        createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [] },
      }] }),
      watchWorkoutCompletions: () => of([{ workoutId: 'w', planId: null, provider: 'suunto' }]),
    } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    fixture.componentInstance.showProvider('garmin'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sent · workout completed');
    fixture.componentInstance.showProvider('suunto'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Completed · activity linked');
    expect(fixture.nativeElement.textContent).not.toContain('left unchanged');
  });
  it('offers targeted Wahoo reconnect without mutating sync settings and preserves account guards', async () => {
    const open = vi.fn();
    TestBed.overrideComponent(TrainingDeliveryDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    service.isReady.mockImplementation(provider => provider === 'wahoo');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'wahoo', status: 'connection_repair', issues: [WAHOO_TRAINING_PERMISSION_ISSUE] }] }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((item: HTMLButtonElement) => item.textContent.includes('Reconnect Wahoo')) as HTMLButtonElement;
    expect(button).toBeTruthy(); button.click();
    expect(open).toHaveBeenCalledWith(WahooRouteAccessReconnectDialogComponent, expect.objectContaining({ data: { purpose: 'training' } }));
    expect(haptics.selection).toHaveBeenCalledTimes(1); expect(service.mutate).not.toHaveBeenCalled();
    user.set({ uid: 'other' }); user$.next(user()); fixture.detectChanges();
    fixture.componentInstance.reconnectWahooTraining(); expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
  it('shows Wahoo scope repair directly in preview and explains duration and device limits', async () => {
    const open = vi.fn();
    TestBed.overrideComponent(TrainingDeliveryDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    service.isReady.mockImplementation(provider => provider === 'wahoo');
    service.preview.mockResolvedValue({ schemaVersion: 1, available: true, connection: 'connection_repair', hasPro: true,
      timeZone: 'Europe/Helsinki', effect: 'enable', settingsRevision: 0, eligibleCount: 0, warningCount: 0, issues: [WAHOO_TRAINING_PERMISSION_ISSUE], approvalDigest: null });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    fixture.componentInstance.showProvider('wahoo'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Distance-based steps are not sent');
    expect(fixture.nativeElement.textContent).toContain('Automatic restoration is unavailable');
    await fixture.componentInstance.begin('wahoo', 'send'); fixture.detectChanges();
    expect(fixture.componentInstance.canConfirm()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Reconnect Wahoo');
    fixture.componentInstance.reconnectWahooTraining();
    expect(open).toHaveBeenCalledTimes(1); expect(service.mutate).not.toHaveBeenCalled();
  });
  it.each([false, true])('makes review primary and keeps plan exclusion in a secondary menu, even when paused: %s', async paused => {
    service.isReady.mockImplementation(provider => provider === 'suunto' && !paused);
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'suunto', planId: 'p',
      status: 'approval_required', hasRemoteCopy: false, differsFromQS: false, lastAttemptAtMs: null, retryCount: 0, approvalDigest: 'approval' }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'p', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const heading = fixture.nativeElement.querySelector('.delivery-provider-settings .delivery-status-label');
    expect(heading.textContent).toBe('Not sent · Needs review');
    expect(fixture.nativeElement.textContent).not.toContain('A provider copy exists');
    expect(fixture.nativeElement.querySelectorAll('.delivery-status-label')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.delivery-provider-settings').textContent).not.toContain('today and the next six days');
    const guidance = fixture.nativeElement.querySelector('#delivery-guidance-details') as HTMLElement;
    expect(guidance.hidden).toBe(true); expect(guidance.textContent).toContain('today and the next six days');
    const review = fixture.nativeElement.querySelector('button[aria-label="Review workout changes for Suunto"]') as HTMLButtonElement | null;
    expect(!!review).toBe(!paused);
    if (review) expect(review.hasAttribute('mat-flat-button')).toBe(true);
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).not.toContain('Stop workout sync');
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    const more = fixture.nativeElement.querySelector('button[aria-label="More Suunto workout sync actions"]') as HTMLButtonElement;
    more.click(); fixture.detectChanges(); await fixture.whenStable();
    const exclude = document.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(exclude.textContent?.trim()).toBe('Exclude from plan sync');
    expect(document.querySelector('[role="menu"]')?.classList.contains('qs-menu-panel')).toBe(true);
    exclude.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Exclude from plan sync?');
    expect(fixture.nativeElement.textContent).toContain('It stays in your QS plan');
    expect(fixture.nativeElement.textContent).toContain('Other workouts are not affected');
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ provider: 'suunto', action: 'stop' }), expect.any(Function));
    expect(service.mutate).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.componentInstance.cancelReview(); fixture.detectChanges();
    fixture.componentInstance.phase.set('saving'); fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('button[aria-label="More Suunto workout sync actions"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('reviews real differences without approving them on open, and labels retained copies as updates', async () => {
    service.isReady.mockImplementation(provider => provider === 'suunto');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'suunto',
      status: 'approval_required', approvalDigest: 'approval', lastAcceptedAtMs: 1000 }] }));
    service.preview.mockResolvedValue({ ...(await service.preview()), approvalDigest: 'approval',
      issues: ['The instruction will be shortened on the watch.'] });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Update needs review');
    expect(fixture.nativeElement.textContent).not.toContain('Not sent');
    fixture.nativeElement.querySelector('button[aria-label="Review workout changes for Suunto"]').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('The instruction will be shortened on the watch');
    expect(fixture.nativeElement.textContent).toContain('Approve differences');
    expect(service.mutate).not.toHaveBeenCalled();
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve', approvalDigest: 'approval' }), expect.any(Function));
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('checks without a preview or consent wizard and distinguishes cloud checking from device availability', async () => {
    service.isReady.mockReturnValue(true);
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, status: 'delivered', lastAcceptedAtMs: 1000 }],
      verifications: [{ id: status.id, canCheck: true, state: 'present', lastCheckedAtMs: 2000, missing: false }] }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    fixture.componentInstance.showProvider('garmin'); fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(button.some(item => item.textContent?.trim() === 'Check Garmin')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Last sent'); expect(fixture.nativeElement.textContent).toContain('Last checked');
    expect(fixture.nativeElement.textContent).toContain('does not confirm a device download');
    await fixture.componentInstance.checkProvider('garmin'); fixture.detectChanges();
    expect(service.check).toHaveBeenCalledWith(expect.objectContaining({ action: 'check', scope: 'workout',
      scopeId: 'w', expectedScheduleRevision: 3, expectedScopeRevision: 2, expectedSettingsRevision: 0 }), expect.any(Function));
    expect(fixture.componentInstance.draft()).toBeNull();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Check queued');
  });
  it('explains COROS calendar and watch behavior without offering unsupported remote checks', () => {
    service.isReady.mockImplementation(provider => provider === 'coros');
    service.watchScope.mockReturnValue(of({
      settings: [],
      statuses: [{ ...status, provider: 'coros', status: 'delivered', differsFromQS: false,
        lastAcceptedAtMs: 1000, lastAttemptAtMs: 1000 }],
      verifications: [{ id: status.id, canCheck: false, state: 'unsupported', lastCheckedAtMs: null, missing: false }],
    }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sent · remote checking unavailable');
    expect([...fixture.nativeElement.querySelectorAll('button')].some((button: HTMLButtonElement) =>
      button.textContent?.trim() === 'Check COROS')).toBe(false);
    const guidance: HTMLElement = fixture.nativeElement.querySelector('#delivery-guidance-details');
    expect(guidance.textContent).toContain('COROS training calendar');
    expect(guidance.textContent).toContain('two-week watch window');
    expect(guidance.textContent).toContain('one training plan synced to a watch at a time');
    expect(guidance.textContent).toContain('does not confirm that your watch received it');
    expect(service.check).not.toHaveBeenCalled();
  });
  it('shows the last attempt for partial delivery instead of an empty last-sent date', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-status > .delivery-caption').textContent).toContain('Last attempt');
  });
  it('describes a failed manual check without telling the user to save sync settings', async () => {
    service.check.mockRejectedValue(new Error('not available'));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    await fixture.componentInstance.checkProvider('garmin'); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toContain('Unable to check delivery');
    expect(fixture.componentInstance.error()).not.toContain('Saving');
  });
  it('ignores an in-flight manual check after sign-out', async () => {
    let resolve!: (value: unknown) => void;
    service.check.mockImplementation(() => new Promise(done => { resolve = done; }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const pending = fixture.componentInstance.checkProvider('garmin');
    user.set(null); user$.next(null); fixture.detectChanges();
    resolve({ result: 'queued' }); await pending;
    expect(fixture.componentInstance.notice()).toBeNull(); expect(haptics.success).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
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
    expect(guidance.textContent).toContain('Provider copies for past dates or completed workouts are kept');
    expect(guidance.textContent).toContain('If your Pro subscription ends, sync pauses');
    expect(guidance.textContent).not.toMatch(/disconnect|account deletion|withdraws/i);
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('places one Edit workout link beside the workout context, outside sync controls and history', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const links: NodeListOf<HTMLAnchorElement> = fixture.nativeElement.querySelectorAll('a[href="/training/plans/workout/w"]');
    expect(links).toHaveLength(1);
    const edit = links[0];
    expect(edit.closest('.delivery-context')?.querySelector('.delivery-context-copy')?.textContent).toContain('Morning run');
    expect(edit.closest('.delivery-context')?.textContent).toContain('Standalone workout');
    expect(edit.closest('app-compact-row, .delivery-actions, .delivery-workouts, .delivery-guidance')).toBeNull();
    expect(edit.textContent).toContain('Edit workout');
    edit.click();
    expect(close).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).serializeUrl(navigate.mock.calls[0][0] as import('@angular/router').UrlTree)).toBe('/training/plans/workout/w');
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it.each(['missing', 'deleted'])('omits Edit workout for a %s source', lifecycle => {
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 }, plans: [],
      workouts: lifecycle === 'missing' ? [] : [{ id: 'w', title: 'Deleted workout', lifecycle: 'deleted' }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-edit-workout')).toBeNull();
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
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Plan sync with Garmin Connect');
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
    expect(fixture.nativeElement.querySelector('.delivery-edit-workout')).toBeNull();
    rows[0].click();
    expect(open).toHaveBeenCalledWith(TrainingDeliveryDialogComponent, expect.objectContaining({ data: {
      scope: 'workout', id: 'w', title: 'Year-end run', selectedProvider: 'garmin',
      returnTo: { scope: 'plan', id: 'p', title: 'Winter build', selectedProvider: 'garmin' },
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
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Workout sync with Garmin Connect');
    expect(fixture.nativeElement.textContent).toContain('Plan: Winter build');
    expect(fixture.nativeElement.textContent).toContain('These controls affect only this workout');
    expect(fixture.nativeElement.querySelector('.delivery-context a[href="/training/plans/workout/w"]').textContent).toContain('Edit workout');
    await fixture.componentInstance.begin('garmin', 'stop'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-edit-workout')).toBeNull();
    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Exclude from plan sync?');
    expect(fixture.nativeElement.textContent).toContain('Other workouts are not affected');
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workout', scopeId: 'w', action: 'stop' }), expect.any(Function));
    fixture.componentInstance.cancelReview(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-context .delivery-edit-workout')).not.toBeNull();
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
    const consent = fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement;
    expect(Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button') as NodeListOf<HTMLButtonElement>)
      .map(button => button.textContent?.trim())).toEqual(['Cancel', scope === 'plan' ? 'Enable plan sync' : 'Send workout']);
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
    expect(component.editingTimeZone()).toBe(true); expect(service.mutate).not.toHaveBeenCalled();
    await component.confirm(); expect(service.mutate.mock.calls[0][0].timeZone).toBe('America/New_York');
  });
  it.each(['plan', 'workout'] as const)('opens existing %s settings without a request and only saves an actual checked change', async scope => {
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: true, revision: 1, timeZone: 'Europe/Helsinki' }], statuses: [] }));
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope, id: 'w', title: 'Morning run' } });
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [{ id: 'w', revision: 2, lifecycle: 'active' }], workouts: [{ id: 'w', revision: 2, planId: null }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', scope === 'plan' ? 'configure' : 'send'); fixture.detectChanges();
    expect(component.dialogTitle()).toBe(scope === 'plan' ? 'Plan sync settings' : 'Workout sync settings');
    expect(fixture.nativeElement.textContent).toContain('Sync with Garmin is already enabled');
    expect(fixture.nativeElement.querySelector('#delivery-time-zone').hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]').disabled).toBe(true);
    await component.review(); await component.confirm();
    expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try {
      component.updateTimeZone(' Europe/Helsinki '); await vi.advanceTimersByTimeAsync(450);
      expect(service.preview).not.toHaveBeenCalled(); expect(component.hasSettingsChanges()).toBe(false);
      component.updateTimeZone('Europe/Berlin'); component.updateTimeZone('America/New_York');
      await vi.advanceTimersByTimeAsync(450); fixture.detectChanges();
      expect(service.preview).toHaveBeenCalledOnce(); expect(component.canConfirm()).toBe(true);
      expect(service.preview.mock.calls[0][0].timeZone).toBe('America/New_York');
      expect(service.mutate).not.toHaveBeenCalled();
      component.updateTimeZone('Europe/Helsinki'); await vi.advanceTimersByTimeAsync(450);
      expect(component.canConfirm()).toBe(false); expect(service.preview).toHaveBeenCalledOnce();
      component.updateTimeZone('bad/zone'); await vi.advanceTimersByTimeAsync(450); fixture.detectChanges();
      expect(component.canConfirm()).toBe(false); expect(service.preview).toHaveBeenCalledOnce();
      expect(fixture.nativeElement.textContent).toContain('Enter a valid time zone');
      component.updateTimeZone('Europe/Berlin'); await vi.advanceTimersByTimeAsync(450);
      await component.confirm();
      expect(service.mutate).toHaveBeenCalledOnce();
      expect(service.mutate.mock.calls[0][0]).toMatchObject({ timeZone: 'Europe/Berlin', expectedSettingsRevision: 1 });
    } finally { fixture.destroy(); vi.useRealTimers(); }
  });
  it('discards a late time-zone check when the user reverts an edit', async () => {
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: true, timeZone: 'Europe/Helsinki' }], statuses: [] }));
    const response = await service.preview(); service.preview.mockClear();
    let resolve!: (value: unknown) => void;
    service.preview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance; await component.begin('garmin', 'send');
    component.updateTimeZone('Europe/Berlin'); const pending = component.review(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="timeZone"]').disabled).toBe(false);
    component.updateTimeZone('Europe/Helsinki'); resolve(response); await pending;
    expect(component.preview()).toBeNull(); expect(component.busy()).toBe(false);
    await component.confirm(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('keeps settings unchanged even with historical account warnings and offers a separate explicit consent review', async () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: true, revision: 1, timeZone: 'Europe/Helsinki' }],
      statuses: [{ ...status, status: 'fresh_consent_required' }, { ...status, id: 'current', status: 'delivered' }] }));
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delivery-actions').textContent).toContain('Workout sync settings');
    const component = fixture.componentInstance; await component.begin('garmin', 'send');
    expect(component.editingSettings()).toBe(true); expect(component.canConfirm()).toBe(false);
    await component.confirm(); expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    component.cancelReview(); fixture.detectChanges();
    const review = Array.from(fixture.nativeElement.querySelectorAll('.delivery-actions button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Review sync setup');
    expect(review).toBeDefined(); review!.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(component.editingSettings()).toBe(false); expect(component.confirmLabel()).toBe('Send workout');
    expect(service.preview).toHaveBeenCalledOnce(); expect(component.canConfirm()).toBe(true);
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('blocks stale settings edits but can replay an uncertain save receipt after a live settings echo', async () => {
    const setting = { provider: 'garmin', enabled: true, revision: 1, timeZone: 'Europe/Helsinki' };
    const view$ = new BehaviorSubject({ settings: [setting], statuses: [] }); service.watchScope.mockReturnValue(view$);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance; await component.begin('garmin', 'send');
    component.updateTimeZone('Europe/Berlin'); await component.review();
    view$.next({ settings: [{ ...setting, enabled: false, revision: 2 }], statuses: [] }); fixture.detectChanges();
    expect(component.canConfirm()).toBe(false); await component.confirm();
    expect(service.mutate).not.toHaveBeenCalled();
    view$.next({ settings: [setting], statuses: [] }); fixture.detectChanges();
    service.mutate.mockImplementationOnce(async () => {
      view$.next({ settings: [{ ...setting, timeZone: 'Europe/Berlin', revision: 2 }], statuses: [] });
      throw new Error('uncertain');
    });
    await component.confirm(); fixture.detectChanges();
    const checked = component.preview(); const previewCount = service.preview.mock.calls.length;
    await component.review(); expect(component.preview()).toBe(checked);
    expect(service.preview).toHaveBeenCalledTimes(previewCount);
    expect(component.canConfirm()).toBe(true); await component.confirm();
    expect(service.mutate).toHaveBeenCalledTimes(2);
    expect(service.mutate.mock.calls[1][0]).toEqual(service.mutate.mock.calls[0][0]);
  });
  it.each(['cancel', 'destroy', 'account change'] as const)('cancels a scheduled time-zone check on %s', async action => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance; await component.begin('garmin', 'send'); service.preview.mockClear();
    vi.useFakeTimers();
    try {
      component.updateTimeZone('Europe/Berlin');
      if (action === 'cancel') component.cancelReview();
      if (action === 'destroy') fixture.destroy();
      if (action === 'account change') { user.set(null); user$.next(null); fixture.detectChanges(); }
      await vi.advanceTimersByTimeAsync(450);
      expect(service.preview).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('uses one footer and never offers Cancel after saving has started', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const labels = () => Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button') as NodeListOf<HTMLButtonElement>)
      .map(button => button.textContent?.trim());
    expect(labels()).toEqual(['Close']);
    await fixture.componentInstance.begin('garmin', 'send'); fixture.detectChanges();
    expect(labels()).toEqual(['Cancel', 'Send workout']);
    let resolve!: () => void;
    service.mutate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const pending = fixture.componentInstance.confirm(); fixture.detectChanges();
    expect(labels()).toEqual(['Close', 'Saving…']);
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]').disabled).toBe(true);
    resolve(); await pending; fixture.detectChanges(); expect(labels()).toEqual(['Close']);
  });
  it('closes direct initial consent on Cancel without saving', async () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [] }));
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { scope: 'workout', id: 'w', title: 'Morning run', initialProvider: 'garmin' } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.cancelReview(); expect(close).toHaveBeenCalledOnce();
    expect(service.mutate).not.toHaveBeenCalled();
  });
  it('does not turn mapping warnings into automatic degradation approval', async () => {
    const response = await service.preview(); service.preview.mockClear();
    service.preview.mockResolvedValue({ ...response, warningCount: 1, issues: ['Power target requires review.'], approvalDigest: 'latest-digest' });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.begin('garmin', 'send'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 workout needs review');
    expect(fixture.nativeElement.textContent).toContain('degraded workouts require individual approval');
    expect(service.mutate).not.toHaveBeenCalled();
    await component.confirm();
    expect(service.mutate.mock.calls[0][0]).not.toHaveProperty('approvalDigest');
    await component.begin('garmin', 'approve', 'old-digest');
    expect(service.mutate).toHaveBeenCalledOnce(); // approving is a separate, explicit action
    await component.confirm();
    expect(service.mutate.mock.calls[1][0]).toMatchObject({ action: 'approve', approvalDigest: 'latest-digest' });
  });
  it.each([0, 1, 2])('renders %s preview warnings with matching nouns and verbs', async warningCount => {
    service.preview.mockResolvedValue({ ...(await service.preview()), warningCount });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    await fixture.componentInstance.begin('garmin', 'send'); fixture.detectChanges();
    if (warningCount) expect(fixture.nativeElement.textContent).toContain(`${warningCount} ${warningCount === 1 ? 'workout needs' : 'workouts need'} review`);
    else expect(fixture.nativeElement.textContent).not.toContain('workouts need review');
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
    fixture.componentInstance.showProvider('garmin'); fixture.detectChanges();
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
    expect(fixture.nativeElement.querySelector('button[aria-label="More Garmin workout sync actions"]')).not.toBeNull();
  });
  it('keeps Stop available after a transfer before a delivery status exists, ignoring the old plan suppression', () => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [{ provider: 'garmin', enabled: false, suppressed: true,
      associationPlanId: 'old-plan', timeZone: 'Europe/Berlin' }], statuses: [] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'new-plan', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.componentInstance.rows()[0].canStop).toBe(true);
    expect(fixture.nativeElement.querySelector('button[aria-label="More Garmin workout sync actions"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Resume workout sync');
  });
  it.each(['old-plan', 'new-plan'])('only offers status-derived Resume for the current plan, not a previous plan (%s)', planId => {
    service.isReady.mockImplementation(provider => provider === 'garmin');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, planId, status: 'stopped', hasRemoteCopy: false }] }));
    TestBed.overrideProvider(TrainingPlansService, { useValue: { watchSchedule: () => of({ state: { revision: 3 },
      plans: [], workouts: [{ id: 'w', planId: 'new-plan', revision: 2 }] }) } });
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent.includes('Resume workout sync')).toBe(planId === 'new-plan');
    expect(fixture.nativeElement.querySelector('button[aria-label="More Garmin workout sync actions"]')).not.toBeNull();
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
    expect(fixture.nativeElement.textContent).toContain('Excluded from plan sync');
    expect(fixture.nativeElement.textContent).toContain('Resume workout sync');
    expect(fixture.nativeElement.querySelector('button[aria-label="More Garmin workout sync actions"]')).toBeNull();
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
    expect(fixture.nativeElement.querySelector('button[aria-label="More Garmin workout sync actions"]')).not.toBeNull();
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
      expect.objectContaining({ data: { scope: 'workout', id: 'deleted', title: 'Deleted workout', selectedProvider: 'garmin',
        returnTo: { scope: 'history', id: 'current', title: 'All provider deliveries', selectedProvider: 'garmin' } } }));
    expect(close).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('a[href*="deleted"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.delivery-edit-workout')).toBeNull();
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
      ['app-service-source-icon', 'src/app/components/event-summary/service-source-icon/service-source-icon.component.css'],
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
        // Match the running app; pre-hydration global styles intentionally hide font icons.
        body.classList.add('app-hydrated');
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
    expect(ref.componentInstance.data).toEqual({ scope: 'workout', id: 'deleted', title: 'Deleted workout', selectedProvider: 'garmin',
      returnTo: { scope: 'history', id: 'current', title: 'All provider deliveries', selectedProvider: 'garmin' } });
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
    service.isReady.mockImplementation(provider => provider === 'garmin' || provider === 'suunto');
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
    await TestBed.inject(ApplicationRef).whenStable(); render('plan-sync-overview'); render('plan-sync-overview-dark');
    expect(document.querySelectorAll('.delivery-provider-overview app-compact-row')).toHaveLength(2);
    ref.componentInstance.showProvider('garmin');
    TestBed.inject(ApplicationRef).tick(); await TestBed.inject(ApplicationRef).whenStable();
    render('plan-sync'); render('plan-sync-dark');
    expect(document.querySelectorAll('.delivery-workout-button')).toHaveLength(2);
    await ref.componentInstance.begin('garmin', 'configure');
    TestBed.inject(ApplicationRef).tick(); await TestBed.inject(ApplicationRef).whenStable();
    render('plan-settings'); render('plan-settings-dark');
    expect(document.querySelector<HTMLInputElement>('input[name="timeZone"]')?.value).toBe('Europe/Helsinki');
    ref.componentInstance.updateTimeZone('Europe/Berlin'); await ref.componentInstance.review();
    TestBed.inject(ApplicationRef).tick(); await TestBed.inject(ApplicationRef).whenStable(); render('plan-settings-changed');
    expect(document.querySelector<HTMLInputElement>('input[name="timeZone"]')?.value).toBe('Europe/Berlin');
    ref.componentInstance.phase.set('saving'); render('plan-settings-saving'); ref.componentInstance.phase.set(null);
    ref.componentInstance.cancelReview();
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
    for (const state of ['present', 'checking', 'restoring', 'deferred', 'unknown', 'unsupported']) {
      service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, status: 'delivered', lastAcceptedAtMs: status.lastAttemptAtMs }],
        verifications: [{ id: status.id, state, canCheck: state !== 'unsupported', missing: state === 'restoring',
          lastCheckedAtMs: status.lastAttemptAtMs + 60000, nextCheckAtMs: status.lastAttemptAtMs + 120000 }] }));
      ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
        data: { scope: 'workout', id: 'w', title: 'Winter endurance workout' }, width: '640px', maxWidth: '95vw',
      });
      await TestBed.inject(ApplicationRef).whenStable(); render(`verification-${state}`); render(`verification-${state}-dark`); ref.close();
    }
    service.isReady.mockImplementation(provider => provider === 'suunto');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'suunto', status: 'delivered',
      differsFromQS: false, lastAcceptedAtMs: status.lastAttemptAtMs }], verifications: [{ id: status.id, state: 'present',
      canCheck: true, missing: false, lastCheckedAtMs: status.lastAttemptAtMs + 60_000 }] }));
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'workout', id: 'w', title: 'Winter endurance workout' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable(); render('suunto-guide'); render('suunto-guide-dark');
    expect(document.body.textContent).toContain('Check Suunto');
    expect(document.body.textContent).toContain('today and the next six days');
    expect(document.body.textContent).toContain('not confirmed on your watch');
    expect(document.body.textContent).toContain('Pinning stays under your control');
    ref.close();
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'suunto', planId: 'p',
      status: 'approval_required', hasRemoteCopy: false, differsFromQS: false, lastAttemptAtMs: null, retryCount: 0, approvalDigest: 'approval',
      updatedAtMs: Date.parse('2026-12-29T12:00:00Z'),
      issues: ['The step instruction is too long for the watch. Review the shortened version before sending.'] }] }));
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'workout', id: 'w', title: 'Winter endurance workout' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable(); render('suunto-review'); render('suunto-review-dark');
    const menuButton = document.querySelector('button[aria-label="More Suunto workout sync actions"]') as HTMLButtonElement;
    menuButton.focus();
    menuButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    // JSDOM does not synthesize the native click following a keyboard activation.
    menuButton.click();
    await TestBed.inject(ApplicationRef).whenStable(); render('suunto-review-menu'); render('suunto-review-menu-dark');
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain('Exclude from plan sync');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    await TestBed.inject(ApplicationRef).whenStable(); render('suunto-exclude'); render('suunto-exclude-dark');
    expect(ref.componentInstance.draft()?.action).toBe('stop');
    ref.close();
    service.isReady.mockImplementation(provider => provider === 'wahoo');
    service.watchScope.mockReturnValue(of({ settings: [], statuses: [{ ...status, provider: 'wahoo', planId: 'p',
      status: 'connection_repair', issues: [WAHOO_TRAINING_PERMISSION_ISSUE] }] }));
    ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'workout', id: 'w', title: 'Time-based running workout with a long name' }, width: '640px', maxWidth: '95vw',
    });
    await TestBed.inject(ApplicationRef).whenStable();
    ref.componentInstance.guidanceExpanded.set(true);
    render('wahoo-training'); render('wahoo-training-dark');
    expect(document.body.textContent).toContain('Reconnect Wahoo');
    expect(document.body.textContent).toContain('Distance-based steps are not sent');
    expect(document.body.textContent).toContain('Automatic restoration is unavailable');
    ref.close();
  });
});
