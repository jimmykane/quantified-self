import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { TrainingDeliverySettingsV1, TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import { TrainingDeliveryService, type TrainingDeliveryView } from '../../services/training-delivery.service';
import { AppUserService } from '../../services/app.user.service';
import { AppEventService } from '../../services/app.event.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';

describe('Training delivery summaries on the workspace', () => {
  const user = signal<{ uid: string } | null>({ uid: 'owner' });
  const user$ = new BehaviorSubject(user());
  const setting: TrainingDeliverySettingsV1 = { schemaVersion: 1, scope: 'plan', scopeId: 'p', provider: 'garmin', revision: 1,
    enabled: true, suppressed: false, timeZone: 'Europe/Helsinki', destinationKey: 'safe', connectionEpoch: 0, scopeGeneration: 0,
    associationPlanId: null, approvedDigest: null, updatedAtMs: 1 };
  const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: 'p', localDate: '2027-01-01', lifecycle: 'planned',
    title: 'Run', structure: { version: 1, sport: ActivityTypes.Running, nodes: [] }, revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'p', name: 'Winter', lifecycle: 'active', revision: 1, lastCheckpointRevision: 1,
    startLocalDate: '2026-12-01', endLocalDate: '2027-02-01', workoutCount: 1, createdAtMs: 1, updatedAtMs: 1 };
  const status: TrainingDeliveryStatusV1 = { schemaVersion: 1, id: createHash('sha256').update(JSON.stringify(['owner', 'garmin', 'safe', 'w'])).digest('hex'),
    workoutId: 'w', planId: 'p', provider: 'garmin', status: 'delivered', hasRemoteCopy: true, differsFromQS: false,
    timeZone: 'Europe/Helsinki', approvalDigest: null, issues: [], lastAcceptedAtMs: 2, lastAttemptAtMs: 2, retryCount: 0, nextRetryAtMs: null, updatedAtMs: 3 };
  let view$: BehaviorSubject<TrainingDeliveryView>;
  let service: { watchSummaryScope: ReturnType<typeof vi.fn>; watchPresence: ReturnType<typeof vi.fn>; anyReady: ReturnType<typeof vi.fn>; isReady: ReturnType<typeof vi.fn> };
  let open: ReturnType<typeof vi.fn>;
  let selection: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto); user.set({ uid: 'owner' }); user$.next(user());
    view$ = new BehaviorSubject<TrainingDeliveryView>({ settings: [setting], statuses: [status] });
    service = { watchSummaryScope: vi.fn(() => view$), watchPresence: vi.fn(() => of(true)), anyReady: vi.fn(() => false), isReady: vi.fn(() => false) };
    open = vi.fn(); selection = vi.fn();
    TestBed.overrideComponent(ServiceSourceIconComponent, { set: { template: '' } });
    TestBed.overrideComponent(TrainingDeliveryButtonComponent, { add: { providers: [{ provide: MatDialog, useValue: { open } }] } });
    await TestBed.configureTestingModule({ imports: [TrainingDeliveryButtonComponent], providers: [provideRouter([]), provideNoopAnimations(),
      { provide: TrainingDeliveryService, useValue: service }, { provide: AppUserService, useValue: { user, user$ } },
      { provide: MatDialog, useValue: { open } }, { provide: AppHapticsService, useValue: { selection } },
      { provide: AppEventService, useValue: {} },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
    ] }).compileComponents();
  });
  afterEach(() => vi.unstubAllGlobals());
  async function render(scope: 'plan' | 'workout' = 'plan') {
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', scope); fixture.componentRef.setInput('entityId', scope === 'plan' ? 'p' : 'w');
    fixture.componentRef.setInput('title', scope === 'plan' ? plan.name : workout.title);
    fixture.componentRef.setInput('summaryWorkouts', [workout]); fixture.componentRef.setInput('summaryPlan', plan);
    fixture.detectChanges();
    await vi.waitFor(() => { fixture.detectChanges(); expect(fixture.componentInstance.summaries().length).toBe(1); });
    return fixture;
  }
  it.each(['plan', 'workout'] as const)('shows %s destination confirmation and opens details without granting consent', async scope => {
    const fixture = await render(scope);
    expect(fixture.nativeElement.textContent).toContain(scope === 'plan' ? 'Garmin Connect · 1 of 1 workout synced' : 'Garmin Connect · Synced');
    expect(service.watchPresence).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.delivery-summary');
    expect(button.getAttribute('aria-label')).toContain(`Open ${scope} sync details`);
    button.click(); expect(selection).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data).toEqual({ scope, id: scope === 'plan' ? 'p' : 'w', title: scope === 'plan' ? plan.name : workout.title });
  });
  it('updates live failures and authored edits without reopening all Firestore listeners', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('summaryWorkouts', [{ ...workout, updatedAtMs: 10 }]); fixture.detectChanges();
    await vi.waitFor(() => { fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('awaiting latest check'); });
    expect(service.watchSummaryScope).toHaveBeenCalledTimes(1);
    view$.next({ settings: [setting], statuses: [{ ...status, status: 'approval_required', differsFromQS: true, updatedAtMs: 11 }] });
    await vi.waitFor(() => { fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('1 needs approval'); });
    expect(fixture.nativeElement.textContent).toContain('needs approval'); expect(open).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });
  it('clears summaries immediately on account change/sign-out and tears down the old read', async () => {
    const fixture = await render();
    user.set({ uid: 'other' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Garmin Connect');
    user.set(null); user$.next(null); fixture.detectChanges(); await fixture.whenStable();
    expect(view$.observed).toBe(false); expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it('keeps unavailable-provider details visible, but honors disabled controls', async () => {
    const fixture = await render(); fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.delivery-summary');
    expect(button.disabled).toBe(true); button.click(); expect(open).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });
  it('reports read errors without displaying invented zero/success totals', async () => {
    service.watchSummaryScope.mockReturnValue(throwError(() => new Error('private')));
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    for (const [key, value] of Object.entries({ scope: 'plan', entityId: 'p', title: 'Winter', summaryWorkouts: [workout], summaryPlan: plan })) fixture.componentRef.setInput(key, value);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sync status unavailable');
    expect(fixture.nativeElement.textContent).not.toMatch(/0 of|synced|private/);
  });
  it('clears old scope results when the same component selects another plan', async () => {
    const fixture = await render();
    service.watchSummaryScope.mockReturnValue(of({ settings: [], statuses: [] }));
    fixture.componentRef.setInput('entityId', 'other-plan'); fixture.componentRef.setInput('title', 'Other');
    fixture.componentRef.setInput('summaryPlan', { ...plan, id: 'other-plan' }); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(view$.observed).toBe(false); expect(service.watchSummaryScope).toHaveBeenLastCalledWith('owner', 'plan', 'other-plan', null);
    expect(fixture.nativeElement.textContent).not.toContain('synced');
  });
  it('fails closed if destination matching is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    for (const [key, value] of Object.entries({ scope: 'plan', entityId: 'p', title: 'Winter', summaryWorkouts: [workout], summaryPlan: plan })) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    await vi.waitFor(() => { fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Sync status unavailable'); });
    expect(fixture.nativeElement.textContent).not.toContain('workouts synced'); expect(open).not.toHaveBeenCalled();
  });
  it('keeps a multi-service mixed-result plan compact and individually named', async () => {
    const fixture = await render();
    const providers = ['garmin', 'coros', 'wahoo', 'suunto'] as const;
    const workouts = [workout, { ...workout, id: 'new', title: 'New-year workout', localDate: '2027-01-03' }];
    fixture.componentRef.setInput('summaryWorkouts', workouts);
    view$.next({ settings: providers.map(provider => ({ ...setting, provider })), statuses: providers.flatMap(provider => workouts.map((workout, index) => ({
      ...status, provider, workoutId: workout.id,
      id: createHash('sha256').update(JSON.stringify(['owner', provider, 'safe', workout.id])).digest('hex'),
      status: index ? 'approval_required' : 'delivered', differsFromQS: index > 0,
    }))) });
    await vi.waitFor(() => { fixture.detectChanges(); expect(fixture.componentInstance.summaries()).toHaveLength(4); });
    expect(fixture.nativeElement.querySelectorAll('.delivery-summary')).toHaveLength(4);
    for (const button of fixture.nativeElement.querySelectorAll('.delivery-summary')) expect(button.getAttribute('aria-label')).toContain('1 of 2 workouts synced');
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    if (process.env.TRAINING_DELIVERY_QA_DIR) {
      const require = createRequire(import.meta.url);
      const sass = createRequire(require.resolve('@angular/build/package.json'))('sass');
      const css = sass.compileString('app-training-delivery-button {' + readFileSync('src/app/components/plans/training-delivery-button.component.scss', 'utf8')
        .replace(/:host/g, '&') + '}').css;
      for (const theme of ['light', 'dark']) writeFileSync(join(process.env.TRAINING_DELIVERY_QA_DIR, `sync-summary-${theme}.html`),
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sync summary QA</title>'
        + '<link rel="stylesheet" href="styles.css">' + Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
        + '<style>' + css + 'body{margin:0;background:var(--mat-sys-surface);color:var(--mat-sys-on-surface)}main{padding:16px;max-width:900px;margin:auto}h1{font:var(--mat-sys-title-large)}</style></head>'
        + `<body class="app-hydrated ${theme}-theme"><main><h1>Winter plan · Sync by service</h1><app-training-delivery-button>${fixture.nativeElement.innerHTML}</app-training-delivery-button></main></body></html>`);
    }
  });
});
