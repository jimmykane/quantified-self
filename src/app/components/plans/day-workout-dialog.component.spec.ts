import { signal } from '@angular/core';
import { By, DomSanitizer } from '@angular/platform-browser';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { DAY_WORKOUT_SPORTS, defaultDayWorkoutControls, parseGenerateDayWorkoutRequest } from '@shared/day-workout';
import { SummaryDisclosureComponent } from '../shared/summary-disclosure/summary-disclosure.component';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogContainer, MatDialogRef } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconRegistry } from '@angular/material/icon';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import type { TrainingRestDayV1 } from '@shared/training-rest-days';
import type { MutateTrainingScheduleRequestV1, MutateTrainingScheduleResponseV1 } from '@shared/training-plans';
import { Auth } from 'app/firebase/auth';
import type { GenerateDayWorkoutResponse } from '@shared/day-workout';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import { AppUserService, type ActivityServiceConnectionState } from '../../services/app.user.service';
import { AppEventService } from '../../services/app.event.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DayWorkoutService } from '../../services/day-workout.service';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import type { AssistantQuotaStatus } from '@shared/assistant.types';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../services/training-plans.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { DayWorkoutDialogComponent } from './day-workout-dialog.component';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const sdk = vi.hoisted(() => ({ authState: vi.fn() }));
type DialogProfile = { uid: string; displayName?: string; settings: { unitSettings: object } };
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState }));
const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat', sets: [
  { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 12.5, restAfterSeconds: 90 },
] }] };
const quotaStatus: AssistantQuotaStatus = { role: 'pro', limit: 100, successfulRequestCount: 12,
  activeRequestCount: 0, remainingCount: 88, periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z',
  periodKind: 'subscription', resetMode: 'date', isEligible: true, blockedReason: null };
function response(requestId: string): GenerateDayWorkoutResponse {
  return { requestId, kind: 'workout', observedAt: '2026-10-28T12:00:00Z', rationale: 'Keep this controlled.',
    draft: { title: 'Strength session', strength, structure: projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 }), estimatedMinutes: { minimum: 20, maximum: 30 } },
    usedContext: ['Previously planned strength', 'Current freshness (Form)', 'Recorded HRV'],
    missingContext: ['No usable existing Feeling/RPE feedback was found.', 'HRV personal baseline is still building.'],
    previousLoads: [{ exerciseId: 'squat', localDate: '2026-10-25' }] };
}

function exportDailySuggestionDialogQa(element: HTMLElement, name: string) {
  const dir = process.env.DAY_WORKOUT_QA_DIR; if (!dir) return;
  const saved = !!element.querySelector('.saved-workout');
  const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
  const css = (MatDialogContainer as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n')
    + [[`#${element.id}`, 'plans/day-workout-dialog'], ['app-compact-row', 'shared/compact-row/compact-row'],
      ['app-training-delivery-button', 'plans/training-delivery-button']]
      .map(([selector, path]) => sass.compileString(`${selector} {` + readFileSync(`src/app/components/${path}.component.scss`, 'utf8')
        .replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&') + '}').css).join('');
  const markup = element.cloneNode(true) as HTMLElement;
  const inputs: HTMLInputElement[] = [...element.querySelectorAll('input')];
  markup.querySelectorAll('input').forEach((input, i) => { input.setAttribute('value', inputs[i].value); input.toggleAttribute('checked', inputs[i].checked); });
  for (const dark of [false, true]) writeFileSync(join(dir, `${name}${dark ? '-dark' : ''}.html`),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="styles.css">' + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('')
    + '<style>' + css + 'body{display:flex;min-height:100dvh;align-items:center;justify-content:center}.qa-pane{width:720px;max-width:100vw;max-height:100dvh;margin:auto}@media(max-width:600px){.qa-pane{width:100vw;height:' + (saved ? 'auto' : '100dvh') + '}}</style></head>'
    + '<body class="app-hydrated' + (dark ? ' dark-theme' : '') + '"><div class="qa-pane"><mat-dialog-container class="mat-mdc-dialog-container mdc-dialog mdc-dialog--open">'
    + '<div class="mat-mdc-dialog-inner-container mdc-dialog__container"><div class="mat-mdc-dialog-surface mdc-dialog__surface">'
    + markup.outerHTML + '</div></div></mat-dialog-container></div></body></html>');
}

describe('DayWorkoutDialogComponent', () => {
  let schedule: BehaviorSubject<CurrentTrainingScheduleV1>;
  let auth: BehaviorSubject<{ uid: string } | null>;
  let generate: ReturnType<typeof vi.fn>;
  let mutate: ReturnType<typeof vi.fn>;
  let setCalendarRestDay: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let loadQuotaStatus: ReturnType<typeof vi.fn>;
  let connections: BehaviorSubject<ActivityServiceConnectionState>;
  let profile: BehaviorSubject<DialogProfile | null>;
  let sendApprovedWorkout: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    auth = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' }); sdk.authState.mockReturnValue(auth);
    schedule = new BehaviorSubject<CurrentTrainingScheduleV1>({
      state: { schemaVersion: 1, activePlanId: 'plan', revision: 7, currentWorkoutCount: 0, updatedAtMs: 1 },
      plans: [{ schemaVersion: 1, id: 'plan', name: 'Autumn', lifecycle: 'active', startLocalDate: '2026-10-01',
        endLocalDate: '2026-10-31', revision: 2, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 2 }], workouts: [],
    });
    generate = vi.fn(async (_uid, request) => response(parseGenerateDayWorkoutRequest(request).requestId));
    connections = new BehaviorSubject({ [ServiceNames.GarminAPI]: true, [ServiceNames.SuuntoApp]: true,
      [ServiceNames.COROSAPI]: false, [ServiceNames.WahooAPI]: false });
    sendApprovedWorkout = vi.fn(async (_uid, _workout, _revision, providers) => providers.map(provider => ({ provider, state: 'queued' })));
    loadQuotaStatus = vi.fn().mockResolvedValue(quotaStatus);
    setCalendarRestDay = vi.fn(async (_uid, localDate, _isRestDay, revision) => ({ schemaVersion: 1, localDate, isRestDay: true, revision: revision + 1 }));
    mutate = vi.fn().mockImplementation(async (request: MutateTrainingScheduleRequestV1): Promise<MutateTrainingScheduleResponseV1> => {
      if (request.operation.kind !== 'create-workout') throw new Error('Expected workout creation.');
      const operation = request.operation;
      return { mutationId: request.mutationId, state: { ...schedule.value.state, revision: schedule.value.state.revision + 1,
        currentWorkoutCount: schedule.value.state.currentWorkoutCount + 1 }, plans: [], removedPlanIds: [], permanentlyDeletedWorkoutIds: [],
        workouts: [{ schemaVersion: 1, id: operation.workoutId, planId: operation.planId, localDate: operation.localDate,
          title: operation.title, structure: operation.structure, lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1 }] };
    }); close = vi.fn(); dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(true) });
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() }; let counter = 0;
    TestBed.overrideComponent(TrainingDeliveryButtonComponent, { add: { providers: [{ provide: MatDialog, useValue: { open: dialogOpen } }] } });
    const user = { uid: 'owner', settings: { unitSettings: {} } };
    profile = new BehaviorSubject<DialogProfile | null>(user);
    await TestBed.configureTestingModule({ imports: [DayWorkoutDialogComponent], providers: [
      provideRouter([]),
      { provide: MAT_DIALOG_DATA, useValue: { ownerUid: 'owner', localDate: '2026-10-28', sport: ActivityTypes.StrengthTraining } },
      { provide: Auth, useValue: {} },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: AppUserService, useValue: { user: signal(user), user$: profile, watchActivityServiceConnectionState: () => connections } },
      { provide: AppEventService, useValue: {} },
      { provide: AppHapticsService, useValue: haptics },
      { provide: MatDialogRef, useValue: { close, disableClose: false, updateSize: vi.fn() } }, { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: DayWorkoutService, useValue: { generate, isOwner: () => auth.value?.uid === 'owner' } },
      { provide: AssistantQuotaService, useValue: { loadQuotaStatus } },
      { provide: TrainingPlansService, useValue: { watchCalendarRestDay: () => of(null), setCalendarRestDay, watchSchedule: () => schedule, mutate,
        createMutationId: (prefix: string) => `${prefix}:00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, createEntityId: () => `workout-${++counter}` } },
      { provide: TrainingDeliveryService, useValue: { sendApprovedWorkout, watchScope: () => of({ settings: [{ provider: 'garmin', enabled: true }] }),
        watchPresence: () => of(false), watchSummaryScope: () => of({ settings: [], statuses: [], verifications: [] }),
        anyReady: () => true, isVisible: (provider: string) => provider !== 'coros', isReady: () => true, isSetupAvailable: () => true } },
    ] }).compileComponents();
    const registry = TestBed.inject(MatIconRegistry), sanitizer = TestBed.inject(DomSanitizer);
    for (const provider of ['garmin', 'suunto', 'coros', 'wahoo']) {
      registry.addSvgIconLiteral(provider, sanitizer.bypassSecurityTrustHtml(readFileSync(`src/assets/logos/${provider}.svg`, 'utf8')));
    }
  });
  afterEach(() => vi.useRealTimers());
  async function render() { const fixture = TestBed.createComponent(DayWorkoutDialogComponent);
    vi.spyOn((fixture.componentInstance as unknown as { dialogs: MatDialog }).dialogs, 'open').mockImplementation(dialogOpen);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); return fixture; }
  it('explains a standalone calendar rest day and keeps the rest result without another generation', async () => {
    TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => of({ schemaVersion: 1, localDate: '2026-10-28', isRestDay: true, revision: 1 });
    const fixture = await render(); const component = fixture.componentInstance;
    generate.mockImplementationOnce(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null, previousLoads: [] }));
    await component.generate(); fixture.detectChanges();
    expect(component.calendarRestDay()).toBe(true); expect(component.primaryLabel()).toBe('Keep rest day');
    expect(fixture.nativeElement.textContent).toContain('Remove this marker in Calendar');
    await component.primaryAction(); expect(close).toHaveBeenCalledOnce(); expect(generate).toHaveBeenCalledOnce(); expect(mutate).not.toHaveBeenCalled();
  });
  it('reviews an included daily suggestion draft without generation, preserves Standalone and reports only its explicit successful Add', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); const onAdded = vi.fn();
    data.initialControls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki', ActivityTypes.StrengthTraining);
    data.initialResult = response('daily-suggestion:2026-10-28'); data.onAdded = onAdded;
    const fixture = await render();
    expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.controls().destinationPlanId).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Included daily suggestion');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-review');
    await fixture.componentInstance.add();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({ kind: 'create-workout', planId: null }) }), expect.any(Function));
    expect(onAdded).toHaveBeenCalledExactlyOnceWith('workout');
  });
  it('saves daily suggestion preferences with all data enabled without generating or saving a workout', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.mode = 'preferences'; data.savePreferences = vi.fn().mockResolvedValue(undefined);
    const fixture = await render(); const component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('One included suggestion per local day');
    expect(component.primaryLabel()).toBe('Save preferences');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-preferences');
    expect(component.mainChoices().some(choice => choice.key === 'destinationPlanId')).toBe(false);
    expect(component.contextChoices().filter(choice => ['activityContext', 'trainingContext'].includes(choice.key)).every(choice => choice.disabled && choice.checked)).toBe(true);
    await component.primaryAction();
    expect(data.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ destinationPlanId: null, timelineContext: true, hrvContext: true }), true, { enabled: false, providers: [] });
    expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  function configureDailyDelivery() {
    const data = TestBed.inject(MAT_DIALOG_DATA);
    data.initialControls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki', ActivityTypes.StrengthTraining);
    data.initialResult = response('daily-suggestion:2026-10-28');
    data.dailyDelivery = { enabled: true, providers: ['garmin'] };
    data.onAdded = vi.fn();
    return data;
  }
  it('requires an explicit connected service in the default-off daily delivery preference', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.mode = 'preferences'; data.savePreferences = vi.fn().mockResolvedValue(undefined);
    const fixture = await render(), component = fixture.componentInstance;
    expect(component.dailyDelivery()).toEqual({ enabled: false, providers: [] });
    component.setDeliveryEnabled(true); fixture.detectChanges(); expect(component.approvalValid()).toBe(false);
    expect(component.valid()).toBe(true); await component.primaryAction(); expect(data.savePreferences).not.toHaveBeenCalled();
    component.selectDeliveryProvider('coros', true); expect(component.dailyDelivery().providers).toEqual([]);
    component.selectDeliveryProvider('garmin', true); fixture.detectChanges(); expect(component.approvalValid()).toBe(true);
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-preferences');
    await component.primaryAction();
    expect(data.savePreferences).toHaveBeenCalledWith(expect.any(Object), true, { enabled: true, providers: ['garmin'] });
    expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled(); expect(sendApprovedWorkout).not.toHaveBeenCalled();
  });
  it('adds the reviewed daily workout once and sends only after the acknowledged creation', async () => {
    const data = configureDailyDelivery();
    const fixture = await render(), component = fixture.componentInstance;
    expect(component.primaryLabel()).toBe('Add & send');
    const deliveryChoice = fixture.nativeElement.querySelector('.daily-delivery') as HTMLElement;
    expect(deliveryChoice.compareDocumentPosition(fixture.nativeElement.querySelector('.review')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sendApprovedWorkout).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-add-and-send');
    await component.primaryAction(); fixture.detectChanges();
    expect(sendApprovedWorkout).toHaveBeenCalledExactlyOnceWith('owner', expect.objectContaining({ id: component.savedWorkoutId(), revision: 1, planId: null }),
      8, ['garmin'], 'Europe/Helsinki', expect.any(Function));
    expect(data.onAdded).toHaveBeenCalledExactlyOnceWith('workout');
    expect(component.deliveryOutcomeText()).toContain('Delivery queued for Garmin');
    expect(component.saveUncertain()).toBe(false); expect(generate).not.toHaveBeenCalled();
    await component.primaryAction(); await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).toHaveBeenCalledOnce();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-queued');
  });
  it.each(['review-required', 'failed', 'unexpected-error'] as const)('keeps the acknowledged workout when delivery needs recovery: %s', async state => {
    configureDailyDelivery();
    if (state === 'unexpected-error') sendApprovedWorkout.mockRejectedValueOnce(Error('offline'));
    else sendApprovedWorkout.mockResolvedValueOnce([{ provider: 'garmin', state }]);
    const fixture = await render(), component = fixture.componentInstance;
    await component.add(); fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeTruthy(); expect(component.saveUncertain()).toBe(false); expect(component.error()).toBeNull();
    expect(component.deliveryOutcomeText()).toContain('Review sync');
    expect(fixture.nativeElement.textContent).toContain('Workout added');
    await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).toHaveBeenCalledOnce();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-'+state);
  });
  it('keeps Done and manual sync disabled until delivery admission finishes', async () => {
    configureDailyDelivery(); let finish!: (value: { provider: string; state: string }[]) => void;
    sendApprovedWorkout.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(sendApprovedWorkout).toHaveBeenCalledOnce()); fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeTruthy(); expect(component.busy()).toBe('save');
    const done = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.trim() === 'Done') as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Checking compatibility and sending');
    finish([{ provider: 'garmin', state: 'queued' }]); await pending; fixture.detectChanges();
    expect(component.busy()).toBeNull(); expect(done.disabled).toBe(false);
  });
  it('lets a user opt out for this approval without changing the saved preference', async () => {
    const data = configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    component.setDeliveryEnabled(false); fixture.detectChanges(); expect(component.primaryLabel()).toBe('Add workout');
    await component.add(); expect(sendApprovedWorkout).not.toHaveBeenCalled(); expect(mutate).toHaveBeenCalledOnce();
    expect(data.dailyDelivery).toEqual({ enabled: true, providers: ['garmin'] });
  });
  it('blocks a newly disconnected destination and still allows Add without sending', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    connections.next({ ...connections.value, [ServiceNames.GarminAPI]: false }); fixture.detectChanges();
    expect(component.deliveryValid()).toBe(false); await component.add(); expect(mutate).not.toHaveBeenCalled();
    component.setDeliveryEnabled(false); await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).not.toHaveBeenCalled();
  });
  it('allows manual regeneration when a selected delivery service becomes unavailable', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    connections.next({ ...connections.value, [ServiceNames.GarminAPI]: false }); fixture.detectChanges();
    const regenerate = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.trim() === 'Generate again') as HTMLButtonElement;
    expect(regenerate.disabled).toBe(false);
    await component.generate(); fixture.detectChanges();
    expect(generate).toHaveBeenCalledOnce(); expect(component.showDailyDelivery()).toBe(false);
    await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).not.toHaveBeenCalled();
  });
  it('reuses connection subscriptions across same-owner profile updates and still observes disconnects', async () => {
    configureDailyDelivery();
    const watch = vi.spyOn(TestBed.inject(AppUserService), 'watchActivityServiceConnectionState');
    const fixture = await render(), component = fixture.componentInstance;
    expect(watch).toHaveBeenCalledOnce();
    profile.next({ ...profile.value!, displayName: 'Updated name' }); fixture.detectChanges();
    profile.next({ ...profile.value!, settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledOnce();
    connections.next({ ...connections.value, [ServiceNames.GarminAPI]: false }); fixture.detectChanges();
    expect(component.deliveryValid()).toBe(false);
    profile.next(null); fixture.detectChanges();
    profile.next({ uid: 'owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
  });
  it.each(['queued', 'failed'] as const)('keeps the %s delivery result visible when the saved schedule read fails', async state => {
    configureDailyDelivery(); let finish!: () => void;
    sendApprovedWorkout.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([{ provider: 'garmin', state }]); }));
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(sendApprovedWorkout).toHaveBeenCalledOnce());
    schedule.error(Error('Offline')); fixture.detectChanges();
    finish(); await pending; fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(false); expect(component.savedWorkoutId()).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain(state === 'queued' ? 'Delivery queued for Garmin' : 'Review sync for Garmin');
    expect(fixture.nativeElement.textContent).toContain('Reload schedule');
    expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-schedule-unavailable-'+state);
    const workout = component.savedWorkout()!;
    schedule = new BehaviorSubject<CurrentTrainingScheduleV1>({ state: { schemaVersion: 1, revision: 8,
      currentWorkoutCount: 1, activePlanId: null, updatedAtMs: 8 }, plans: [], workouts: [workout] });
    const reload = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Reload schedule')) as HTMLButtonElement;
    reload.click(); fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(state === 'queued' ? 'Delivery queued for Garmin' : 'Review sync for Garmin');
    expect(mutate).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
  });
  it('never sends for a rest result', async () => {
    const data = configureDailyDelivery(); data.initialResult = { ...data.initialResult, kind: 'rest', draft: null };
    const fixture = await render(), component = fixture.componentInstance;
    expect(component.showDailyDelivery()).toBe(false); await component.primaryAction();
    expect(setCalendarRestDay).toHaveBeenCalledOnce(); expect(sendApprovedWorkout).not.toHaveBeenCalled();
  });
  it('keeps sending off for a new manual generation replacing the daily draft', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    component.set('minutes', 40); await component.generate(); fixture.detectChanges();
    expect(component.showDailyDelivery()).toBe(false); expect(component.primaryLabel()).toBe('Add workout');
    await component.add(); expect(sendApprovedWorkout).not.toHaveBeenCalled(); expect(mutate).toHaveBeenCalledOnce();
  });
  it('does not send before an uncertain Add is acknowledged and reuses that Add on retry', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    mutate.mockRejectedValueOnce({ code: 'functions/deadline-exceeded' });
    await component.add(); expect(sendApprovedWorkout).not.toHaveBeenCalled(); expect(component.saveUncertain()).toBe(true);
    const original = mutate.mock.calls[0][0];
    await component.add(); expect(mutate.mock.calls[1][0]).toEqual(original); expect(sendApprovedWorkout).toHaveBeenCalledOnce();
    expect(component.saveUncertain()).toBe(false);
  });
  it('drops late delivery results and feedback when the account changes', async () => {
    configureDailyDelivery(); let finish!: () => void;
    sendApprovedWorkout.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([{ provider: 'garmin', state: 'queued' }]); }));
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(sendApprovedWorkout).toHaveBeenCalledOnce());
    auth.next({ uid: 'other' }); finish(); await pending;
    expect(haptics.success).not.toHaveBeenCalled(); expect(component.savedWorkoutId()).toBeNull();
  });
  it('keeps a successful Add open with the shared Send control and prevents duplicate saves or generation', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA);
    data.initialControls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki', ActivityTypes.StrengthTraining);
    data.initialResult = response('daily-suggestion:2026-10-28'); data.onAdded = vi.fn();
    const fixture = await render(); const component = fixture.componentInstance;
    await component.add(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const id = mutate.mock.calls[0][0].operation.workoutId;
    expect(fixture.nativeElement.querySelector('[aria-label="Saved workout"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-dialog-actions [mat-flat-button]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Your workout is saved.');
    expect(fixture.nativeElement.textContent).toContain('88 of 100 remaining');
    expect(close).not.toHaveBeenCalled(); expect(data.onAdded).toHaveBeenCalledOnce();
    expect(TestBed.inject(MatDialogRef).updateSize).toHaveBeenCalledWith(undefined, 'auto');
    const deliveryButton = fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent)).componentInstance as TrainingDeliveryButtonComponent;
    expect(deliveryButton.entityId()).toBe(id); expect(deliveryButton.standalone()).toBe(true);
    deliveryButton.open();
    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ scope: 'workout', id }) }));
    expect(close).not.toHaveBeenCalled(); // Cancelling provider review leaves the saved confirmation available.
    exportDailySuggestionDialogQa(fixture.nativeElement, 'workout-added-send');
    await component.add(); await component.primaryAction(); await component.generate(); component.edit(); component.set('minutes', 90);
    expect(component.controls().minutes).toBe(30);
    expect(mutate).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled(); expect(loadQuotaStatus).toHaveBeenCalledOnce();
  });

  it('uses the acknowledged saved workout for delivery summaries and removes the action on account change', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate();
    mutate.mockImplementationOnce(async request => ({ workouts: [{ schemaVersion: 1, id: request.operation.workoutId,
      planId: request.operation.planId, localDate: request.operation.localDate, title: 'Acknowledged workout',
      structure: request.operation.structure, revision: 1, lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1 }] }));
    await component.add(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const button = fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent)).componentInstance as TrainingDeliveryButtonComponent;
    expect(button.summaryWorkouts()?.[0].title).toBe('Acknowledged workout'); expect(button.standalone()).toBe(false);
    const saved = button.summaryWorkouts()![0];
    schedule.next({ ...schedule.value, workouts: [{ ...saved, planId: null, localDate: '2026-10-30', title: 'Moved saved workout',
      structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'steady', purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [] }] } }] });
    fixture.detectChanges();
    expect(button.standalone()).toBe(true); expect(button.summaryPlan()).toBeNull();
    expect(component.savedDetails()).toMatchObject({ title: 'Moved saved workout', localDate: '2026-10-30', sport: ActivityTypes.Running, summary: '30m 00s' });
    auth.next({ uid: 'other-owner' }); fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeNull();
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes the saved confirmation when provider review navigates to another page', async () => {
    const events = new Subject<NavigationStart>();
    vi.spyOn(TestBed.inject(Router), 'events', 'get').mockReturnValue(events);
    const fixture = await render(); const component = fixture.componentInstance;
    events.next(new NavigationStart(1, '/services')); expect(close).not.toHaveBeenCalled();
    await component.generate(); await component.add();
    events.next(new NavigationStart(2, '/training/plans/workout/saved'));
    expect(close).toHaveBeenCalledOnce(); expect(mutate).toHaveBeenCalledOnce();
    fixture.destroy(); expect(events.observed).toBe(false);
  });

  it.each(['removed', 'restore', 'read-error'] as const)('withholds stale Send after the saved workout is %s', async change => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); await component.add();
    const workout = component.savedWorkout()!;
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8, currentWorkoutCount: 1 }, workouts: [workout] });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeTruthy();
    if (change === 'read-error') schedule.error(new Error('Offline'));
    else schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 9, currentWorkoutCount: 0 }, workouts: [],
      ...(change === 'restore' ? { restoreUnavailable: true as const } : {}) });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Reload schedule');
    await component.add(); expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not resurrect an acknowledgement when the workout was removed before its first live echo', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); await component.add();
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 9, currentWorkoutCount: 0 }, workouts: [] });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeNull();
  });

  it('retains an acknowledged save while state arrives before workouts and withholds incomplete reads', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); await component.add();
    const workout = component.savedWorkout()!;
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8, currentWorkoutCount: 1 }, workouts: [] });
    expect(component.savedSyncAvailable()).toBe(true);
    expect(component.savedWorkout()).toEqual(workout);
    schedule.next({ ...schedule.value, workoutsComplete: false });
    fixture.detectChanges(); expect(component.savedSyncAvailable()).toBe(false);
    schedule.next({ ...schedule.value, workoutsComplete: true, workouts: [workout] });
    fixture.detectChanges(); expect(component.savedSyncAvailable()).toBe(true);
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeTruthy();
    expect(mutate).toHaveBeenCalledOnce(); expect(generate).toHaveBeenCalledOnce();
  });

  it('reloads saved availability after a read error without saving or generating again', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); await component.add(); const workout = component.savedWorkout()!;
    schedule.error(new Error('Offline')); fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(false);
    const quotaReads = loadQuotaStatus.mock.calls.length;
    schedule = new BehaviorSubject<CurrentTrainingScheduleV1>({ state: { schemaVersion: 1, revision: 8, currentWorkoutCount: 1,
      activePlanId: null, updatedAtMs: 8 }, plans: [], workouts: [workout] });
    haptics.selection.mockClear(); haptics.success.mockClear();
    const reload = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.includes('Reload schedule')) as HTMLButtonElement;
    reload.click(); fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(true);
    expect(fixture.debugElement.query(By.directive(TrainingDeliveryButtonComponent))).toBeTruthy();
    expect(mutate).toHaveBeenCalledOnce(); expect(generate).toHaveBeenCalledOnce();
    expect(loadQuotaStatus).toHaveBeenCalledTimes(quotaReads);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
  });

  it('shows the shared Assistant allowance before generation and refreshes authoritative counts after attempts', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const text = () => fixture.nativeElement.querySelector('.allowance').textContent;
    expect(text()).toContain('88 of 100 remaining');
    expect(loadQuotaStatus).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    loadQuotaStatus.mockResolvedValueOnce({ ...quotaStatus, successfulRequestCount: 13, remainingCount: 87 });
    await component.generate(); await fixture.whenStable(); fixture.detectChanges();
    expect(text()).toContain('87 of 100 remaining');
    loadQuotaStatus.mockResolvedValueOnce({ ...quotaStatus, successfulRequestCount: 13, remainingCount: 87 });
    generate.mockRejectedValueOnce(new Error('Generation failed before billing'));
    await component.generate(); await fixture.whenStable(); fixture.detectChanges();
    expect(text()).toContain('87 of 100 remaining');
    expect(loadQuotaStatus).toHaveBeenCalledTimes(3); expect(mutate).not.toHaveBeenCalled();
  });
  it('distinguishes exhausted allowance from an unavailable read and still lets a reviewed workout be saved', async () => {
    const fixture = await render();
    loadQuotaStatus.mockResolvedValueOnce({ ...quotaStatus, successfulRequestCount: 100, remainingCount: 0, blockedReason: 'limit_reached' });
    await fixture.componentInstance.generate(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.allowance').textContent).toContain('0 of 100 remaining');
    const add = [...fixture.nativeElement.querySelectorAll('mat-dialog-actions button')]
      .find((button: HTMLButtonElement) => button.textContent?.trim() === 'Add workout') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    loadQuotaStatus.mockResolvedValueOnce(null);
    await fixture.componentInstance.generate(); await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.allowance').textContent;
    expect(text).toContain('Assistant allowance unavailable');
    expect(text).not.toContain('88'); expect(text).not.toContain('0 of');
  });
  it('shows loading and rejects stale quota replies and replies for a previous account', async () => {
    let initial!: (value: AssistantQuotaStatus) => void;
    loadQuotaStatus.mockReturnValueOnce(new Promise(resolve => { initial = resolve; }));
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.allowance').textContent).toContain('loading');
    loadQuotaStatus.mockResolvedValueOnce({ ...quotaStatus, successfulRequestCount: 13, remainingCount: 87 });
    await fixture.componentInstance.generate(); await fixture.whenStable(); fixture.detectChanges();
    initial(quotaStatus); await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
    expect(fixture.componentInstance.quota()?.remainingCount).toBe(87);
    let late!: (value: AssistantQuotaStatus) => void;
    loadQuotaStatus.mockReturnValueOnce(new Promise(resolve => { late = resolve; }));
    await fixture.componentInstance.generate();
    auth.next({ uid: 'different-owner' }); late(quotaStatus);
    await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
    expect(fixture.componentInstance.quota()).toBeNull();
  });
  it('renders enabled defaults, independent opt-outs and full reviewed strength without writing', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    expect(component.controls()).toMatchObject({ minutes: 30, destinationPlanId: 'plan', equipment: ['bodyweight'], trainingContext: true, timelineContext: true, usePreviousWeights: true });
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.generate(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('8 reps');
    expect(fixture.nativeElement.textContent).toContain('12.5 kg');
    expect(fixture.nativeElement.textContent).toContain('Previously planned on 2026-10-25');
    expect(fixture.nativeElement.textContent).toContain('AI planning estimate');
    expect(fixture.nativeElement.textContent).toContain('Inherits plan sync: garmin');
    expect(mutate).not.toHaveBeenCalled();
    if (process.env.DAY_WORKOUT_QA_DIR) {
      const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
      const css = (MatDialogContainer as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n')
        + [[`#${fixture.nativeElement.id}`, 'plans/day-workout-dialog'],
          ['app-compact-row', 'shared/compact-row/compact-row'],
          ['app-summary-disclosure', 'shared/summary-disclosure/summary-disclosure']]
          .map(([selector, path]) => sass.compileString(`${selector} {`
            + readFileSync(`src/app/components/${path}.component.scss`, 'utf8').replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&') + '}').css).join('\n');
      const exportView = (name: string) => {
        const markup = fixture.nativeElement.cloneNode(true) as HTMLElement;
        const inputs: HTMLInputElement[] = [...fixture.nativeElement.querySelectorAll('input')];
        markup.querySelectorAll('input').forEach((input, index) => {
          input.setAttribute('value', inputs[index].value);
          if (input.type === 'checkbox') input.toggleAttribute('checked', inputs[index].checked);
        });
        for (const dark of [false, true]) writeFileSync(join(process.env.DAY_WORKOUT_QA_DIR!, `${name}${dark ? '-dark' : ''}.html`),
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<link rel="stylesheet" href="styles.css">' + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('')
          + '<style>' + css + '.qa-pane{width:720px;max-width:100vw;max-height:100dvh;margin:auto}@media(max-width:600px){.qa-pane{width:100vw;height:100dvh}}</style>'
          + '</head><body class="app-hydrated' + (dark ? ' dark-theme' : '') + '"><div class="qa-pane">'
          + '<mat-dialog-container class="mat-mdc-dialog-container mdc-dialog mdc-dialog--open"><div class="mat-mdc-dialog-inner-container mdc-dialog__container">'
          + '<div class="mat-mdc-dialog-surface mdc-dialog__surface">' + markup.outerHTML + '</div></div></mat-dialog-container></div></body></html>');
      };
      exportView('strength-review');
      component.busy.set('save'); fixture.detectChanges(); exportView('saving'); component.busy.set(null);
      component.saveUncertain.set(true); component.error.set('Save confirmation lost. Keep this dialog open and Retry Add to check the same workout.');
      fixture.detectChanges(); exportView('save-retry'); component.saveUncertain.set(false); component.error.set(null);
      component.staleReview.set(true); fixture.detectChanges(); exportView('stale-review'); component.staleReview.set(false);
      const details = fixture.debugElement.query(By.directive(SummaryDisclosureComponent)).componentInstance as SummaryDisclosureComponent;
      details.toggleDetails(); fixture.detectChanges(); exportView('strength-context');
      component.showSettings.set(true); component.more.set(true); fixture.detectChanges(); exportView('strength-options');
      component.result.set(null); component.more.set(false); fixture.detectChanges(); exportView('strength-setup');
      component.busy.set('generate'); fixture.detectChanges(); exportView('generating'); component.busy.set(null);
      component.result.set({ ...response('rest-review'), kind: 'rest', draft: null, previousLoads: [] });
      component.showSettings.set(false); fixture.detectChanges(); exportView('rest-review');
      const longStrength = { ...strength, exercises: Array.from({ length: 6 }, (_, index) => ({ ...strength.exercises[0],
        id: `exercise-${index}`, name: `Exercise ${index + 1}`, sets: Array.from({ length: 4 }, (_, set) => ({ ...strength.exercises[0].sets[0], id: `set-${index}-${set}` })) })) };
      component.result.set({ ...response('long-review'), draft: { ...response('').draft!, strength: longStrength,
        structure: projectStrengthWorkoutToV1({ ...longStrength, workoutId: 'draft', revision: 1 }) }, previousLoads: [] });
      fixture.detectChanges(); exportView('long-review');
      component.result.set(null); component.error.set('Generation failed. Retry checks this request; Generate again uses a new AI request.');
      fixture.detectChanges(); exportView('generation-error');
      component.more.set(true);
      component.set('sport', ActivityTypes.Running); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); exportView('endurance-options'); component.more.set(false); fixture.detectChanges(); exportView('endurance-setup');
      component.set('sport', ActivityTypes.StrengthTraining); component.result.set(response(generate.mock.calls[0][1].requestId));
      component.showSettings.set(false); component.refreshReview(); fixture.detectChanges();
    }
    component.edit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ ownerUid: 'owner', draft: response('').draft,
      saveRequest: expect.objectContaining({ operation: expect.objectContaining({ strength }) }) }));
  });
  it('renders enabled context choices and sends independent opt-outs with a new generation', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.more.set(true); fixture.detectChanges();
    const inputs = [...fixture.nativeElement.querySelectorAll('#day-workout-personalization mat-checkbox input')] as HTMLInputElement[];
    expect(inputs).toHaveLength(11);
    expect(inputs.every(input => input.checked && !input.disabled)).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.generate(); fixture.detectChanges();
    expect(generate.mock.calls[0][1].controls).toMatchObject({ trainingContext: true, timelineContext: true, usePreviousWeights: true });
    component.showSettings.set(true); fixture.detectChanges(); haptics.selection.mockClear();
    const choice = (label: string) => [...fixture.nativeElement.querySelectorAll('#day-workout-personalization mat-checkbox')]
      .find((element: HTMLElement) => element.textContent?.trim() === label)!.querySelector('input') as HTMLInputElement;
    choice('Timeline notes').click(); fixture.detectChanges();
    expect(component.controls()).toMatchObject({ trainingContext: true, timelineContext: false });
    expect(component.result()).toBeNull(); expect(haptics.selection).toHaveBeenCalledOnce();
    await component.generate(); fixture.detectChanges();
    expect(generate.mock.calls[1][1].controls).toMatchObject({ trainingContext: true, timelineContext: false });
    expect(generate.mock.calls[1][1].requestId).not.toBe(generate.mock.calls[0][1].requestId);
    component.showSettings.set(true); fixture.detectChanges(); choice('Training plans & workouts').click(); fixture.detectChanges();
    expect(component.controls()).toMatchObject({ trainingContext: false, timelineContext: false });
    expect(choice('Reuse planned weights').disabled).toBe(true); expect(mutate).not.toHaveBeenCalled();
  });
  it('shows every data choice selected initially and disables derived readiness when a source is turned off', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const region = fixture.nativeElement.querySelector('#day-workout-personalization') as HTMLElement;
    expect(region.hidden).toBe(false);
    expect(component.contextSelection()).toBe('All selected');
    const inputs = [...region.querySelectorAll('mat-checkbox input')] as HTMLInputElement[];
    expect(inputs.every(input => input.checked && !input.disabled)).toBe(true);
    haptics.selection.mockClear(); inputs[1].click(); fixture.detectChanges();
    expect(component.controls()).toMatchObject({ hrvContext: false, readinessContext: false, timelineContext: true });
    expect(inputs[4].checked).toBe(false); expect(inputs[4].disabled).toBe(true);
    expect(region.textContent).toContain('Enable all four');
    expect(haptics.selection).toHaveBeenCalledOnce();
    await component.generate();
    expect(generate.mock.calls[0][1].controls).toMatchObject({ hrvContext: false, readinessContext: false, sleepContext: true, timelineContext: true });
    component.set('hrvContext', true); fixture.detectChanges();
    expect(inputs[4].disabled).toBe(false); expect(inputs[4].checked).toBe(false);
  });
  it('starts Training routine selected, preserves its opt-out and requires activity evidence', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const routine = () => [...fixture.nativeElement.querySelectorAll('mat-checkbox')]
      .find((element: HTMLElement) => element.textContent?.trim() === 'Training routine')!.querySelector('input') as HTMLInputElement;
    expect(routine().checked).toBe(true); expect(routine().disabled).toBe(false);
    haptics.selection.mockClear(); routine().click(); fixture.detectChanges();
    expect(component.controls().routineContext).toBe(false); expect(haptics.selection).toHaveBeenCalledOnce();
    await component.generate(); expect(generate.mock.calls[0][1].controls.routineContext).toBe(false);
    component.set('routineContext', true); component.set('activityContext', false); fixture.detectChanges();
    expect(routine().disabled).toBe(true); expect(routine().checked).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Training routine requires Recent activities.');
    component.set('activityContext', true); fixture.detectChanges();
    expect(routine().checked).toBe(true); expect(routine().disabled).toBe(false);
  });
  it('focuses new reviews and errors without stealing focus during unrelated option changes', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.review > h3'));
    const edit = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent?.trim() === 'Edit workout') as HTMLButtonElement;
    edit.focus(); component.showSettings.set(true); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(edit);
    generate.mockRejectedValueOnce(new Error('Unavailable'));
    await component.generate(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('p[role="alert"]'));
    expect(mutate).not.toHaveBeenCalled();
  });
  it('focuses review on the prescription while keeping options and context inspectable without discarding it', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const button = (label: string) => [...element.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
    expect(element.querySelector('fieldset')!.hidden).toBe(false);
    const personalization = element.querySelector('#day-workout-personalization')!;
    expect(personalization.closest('[hidden]')).toBeNull();
    expect(personalization.closest('#day-workout-more')).toBeNull();
    for (const signal of ['Freshness', 'training load', 'HRV', 'Sleep', 'Overnight heart rate', 'Readiness', 'Feeling / RPE']) {
      expect(personalization.textContent).toContain(signal);
    }
    expect(component.controls()).toMatchObject({ trainingContext: true, timelineContext: true, usePreviousWeights: true });
    expect(element.querySelector('input[type="date"]')).toBeNull();
    expect(element.querySelector('.review-destination')!.textContent).toContain('Oct 28, 2026');
    expect(element.querySelector('mat-dialog-actions')!.textContent).toContain('Generate workout');
    await component.generate(); fixture.detectChanges();
    const draft = component.result();
    expect(element.querySelector('fieldset')!.hidden).toBe(true);
    expect([...element.querySelectorAll('mat-dialog-actions button')].map(item => item.textContent?.trim())).toEqual(['Cancel', 'Add workout']);
    button('Change options').click(); fixture.detectChanges();
    expect(element.querySelector('fieldset')!.hidden).toBe(false);
    expect(button('Hide options').getAttribute('aria-expanded')).toBe('true');
    expect(component.result()).toBe(draft);
    const context = element.querySelector('#day-workout-context-details') as HTMLElement;
    expect(context.hidden).toBe(true);
    haptics.selection.mockClear(); (element.querySelector('.summary-disclosure-control') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(context.hidden).toBe(false); expect(context.textContent).toContain('No usable existing Feeling/RPE');
    expect(context.textContent).toContain('Current freshness (Form)');
    expect(context.textContent).toContain('Recorded HRV');
    expect(context.textContent).toContain('HRV personal baseline is still building.');
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.set('minutes', 45, false); fixture.detectChanges();
    expect(component.result()).toBeNull(); expect(element.querySelector('fieldset')!.hidden).toBe(false);
    await component.generate(); fixture.detectChanges();
    expect(element.querySelector('fieldset')!.hidden).toBe(true);
    expect((element.querySelector('#day-workout-context-details') as HTMLElement).hidden).toBe(true);
  });
  it('offers explicit rest marking and keeps the easy-session alternative behind one generation', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    generate.mockImplementationOnce(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null, previousLoads: [] }));
    await component.generate(); fixture.detectChanges(); haptics.selection.mockClear();
    expect(fixture.nativeElement.querySelector('mat-dialog-actions').textContent).toContain('Mark as rest day');
    expect(fixture.nativeElement.querySelector('mat-dialog-actions').textContent).not.toContain('Add workout');
    expect(fixture.nativeElement.querySelector('.review-actions').textContent).toContain('Try easy session');
    expect(setCalendarRestDay).not.toHaveBeenCalled();
    await component.easy();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(generate.mock.calls[1][1].controls.purpose).toBe('general-strength');
    expect(mutate).not.toHaveBeenCalled();
  });
  it('marks a model rest recommendation only on explicit acceptance, without another generation or workout', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.set('trainingContext', false, false);
    generate.mockImplementationOnce(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null, previousLoads: [] }));
    await component.generate(); fixture.detectChanges(); haptics.success.mockClear();
    const quotaReads = loadQuotaStatus.mock.calls.length;
    expect(setCalendarRestDay).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Existing workouts stay unchanged.');
    expect(fixture.nativeElement.textContent).not.toContain('Inherits plan sync');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'ai-rest-review');
    const action = fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement;
    action.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(setCalendarRestDay).toHaveBeenCalledExactlyOnceWith('owner', '2026-10-28', true, 0, expect.any(Function));
    expect(setCalendarRestDay.mock.calls[0][4]()).toBe(true);
    expect(close).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
    expect(loadQuotaStatus).toHaveBeenCalledTimes(quotaReads);
    await component.primaryAction(); expect(setCalendarRestDay).toHaveBeenCalledOnce();
  });
  it('reports a daily rest acceptance only after confirmation and prevents duplicate saves', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.initialResult = { ...response('daily-rest'), kind: 'rest', draft: null, previousLoads: [] };
    data.onAdded = vi.fn();
    let finish!: () => void;
    setCalendarRestDay.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const fixture = await render(); const component = fixture.componentInstance;
    const pending = component.primaryAction(); await vi.waitFor(() => expect(setCalendarRestDay).toHaveBeenCalledOnce());
    fixture.detectChanges();
    expect(component.primaryLabel()).toBe('Marking…');
    expect((fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement).disabled).toBe(true);
    await component.primaryAction();
    expect(data.onAdded).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    finish(); await pending;
    expect(setCalendarRestDay).toHaveBeenCalledOnce(); expect(data.onAdded).toHaveBeenCalledExactlyOnceWith('rest');
    expect(close).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it('keeps the rest review on failure and retries with the current marker revision', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.initialResult = { ...response('daily-rest'), kind: 'rest', draft: null, previousLoads: [] };
    data.onAdded = vi.fn();
    const fixture = await render(); const component = fixture.componentInstance;
    setCalendarRestDay.mockRejectedValueOnce(Error('Reply lost'));
    await component.primaryAction(); fixture.detectChanges();
    expect(component.error()).toContain('could not be confirmed'); expect(component.result()?.kind).toBe('rest');
    expect(haptics.error).toHaveBeenCalledOnce(); expect(data.onAdded).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => of({ schemaVersion: 1, localDate: '2026-10-28', isRestDay: false, revision: 4 });
    await component.primaryAction();
    expect(setCalendarRestDay.mock.calls[1].slice(0, 4)).toEqual(['owner', '2026-10-28', true, 4]);
    expect(data.onAdded).toHaveBeenCalledExactlyOnceWith('rest'); expect(haptics.success).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it('does not write rest when the marker read fails', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.initialResult = { ...response('daily-rest'), kind: 'rest', draft: null, previousLoads: [] };
    const fixture = await render();
    TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => throwError(() => Error('Read unavailable'));
    await fixture.componentInstance.primaryAction();
    expect(setCalendarRestDay).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('could not be confirmed');
  });
  it('releases a pending rest marker read when the review closes, without feedback or writes', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.initialResult = { ...response('daily-rest'), kind: 'rest', draft: null, previousLoads: [] };
    const fixture = await render(); const marker = new Subject<TrainingRestDayV1 | null>();
    TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => marker;
    const pending = fixture.componentInstance.primaryAction();
    expect(marker.observed).toBe(true); fixture.destroy(); await pending;
    expect(marker.observed).toBe(false); expect(setCalendarRestDay).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it.each(['read', 'write'] as const)('fences rest acceptance and feedback when the account changes during its %s', async stage => {
    const data = TestBed.inject(MAT_DIALOG_DATA); data.initialResult = { ...response('daily-rest'), kind: 'rest', draft: null, previousLoads: [] };
    data.onAdded = vi.fn();
    const fixture = await render(); const component = fixture.componentInstance;
    const marker = new Subject<TrainingRestDayV1 | null>(); let finish!: () => void;
    if (stage === 'read') TestBed.inject(TrainingPlansService).watchCalendarRestDay = () => marker;
    else setCalendarRestDay.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = component.primaryAction();
    if (stage === 'write') await vi.waitFor(() => expect(setCalendarRestDay).toHaveBeenCalledOnce());
    auth.next({ uid: 'other' }); auth.next({ uid: 'owner' });
    if (stage === 'read') marker.next(null); else finish();
    await pending;
    if (stage === 'read') expect(setCalendarRestDay).not.toHaveBeenCalled();
    else expect(setCalendarRestDay.mock.calls[0][4]()).toBe(false);
    expect(data.onAdded).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it('keeps an authored rest day instead of offering a redundant easy-session generation', async () => {
    schedule.next({ ...schedule.value, plans: schedule.value.plans.map(plan => ({ ...plan, restDays: ['2026-10-28'] })) });
    const fixture = await render(); const component = fixture.componentInstance;
    generate.mockImplementationOnce(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null, previousLoads: [] }));
    await component.generate(); fixture.detectChanges(); haptics.selection.mockClear();
    expect(fixture.nativeElement.textContent).toContain('Planned rest day');
    expect(component.primaryLabel()).toBe('Keep rest day');
    expect(fixture.nativeElement.textContent).not.toContain('Try easy session');
    await component.primaryAction(); expect(close).toHaveBeenCalledOnce(); expect(generate).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled(); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('shows a disabled pending primary action and wires the error primary action to the same request', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    let reject!: (error: unknown) => void;
    generate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = component.generate(); fixture.detectChanges();
    const action = fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement;
    expect(action.textContent).toContain('Generating…'); expect(action.disabled).toBe(true);
    reject(new Error('Response lost')); await pending; fixture.detectChanges();
    expect(action.textContent).toContain('Retry generation'); expect(action.disabled).toBe(false);
    action.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(generate.mock.calls[1][1]).toEqual(generate.mock.calls[0][1]);
  });
  it('uses the shared single-sport picker and preserves draft resets, allowed sports and busy guards', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const picker = fixture.debugElement.query(By.directive(ActivityFilterPickerComponent)).componentInstance as ActivityFilterPickerComponent;
    expect(picker.multiple()).toBe(false);
    expect(picker.selectedValues()).toEqual([ActivityTypes.StrengthTraining]);
    expect(new Set(picker.options().map(option => option.value))).toEqual(new Set(DAY_WORKOUT_SPORTS));
    expect(picker.options().every(option => option.activityType === option.value)).toBe(true);
    haptics.selection.mockClear();
    for (const invalid of [[], ['unsupported'], [ActivityTypes.Running, ActivityTypes.Cycling], [ActivityTypes.StrengthTraining]]) {
      picker.selectionChange.emit(invalid);
    }
    expect(component.controls().sport).toBe(ActivityTypes.StrengthTraining); expect(haptics.selection).not.toHaveBeenCalled();
    component.set('equipment', [], false); expect(component.valid()).toBe(false);
    component.result.set(response('previous-review'));
    picker.selectionChange.emit([ActivityTypes.Running]); fixture.detectChanges();
    expect(component.controls()).toMatchObject({ sport: ActivityTypes.Running, purpose: 'suggest', target: 'auto', equipment: ['bodyweight'] });
    expect(component.result()).toBeNull(); expect(component.valid()).toBe(true);
    expect(picker.selectedValues()).toEqual([ActivityTypes.Running]); expect(haptics.selection).toHaveBeenCalledOnce();
    for (const state of ['busy', 'uncertain'] as const) {
      component.busy.set(state === 'busy' ? 'generate' : null); component.saveUncertain.set(state === 'uncertain'); fixture.detectChanges();
      expect(picker.disabled()).toBe(true); picker.selectionChange.emit([ActivityTypes.Cycling]);
      expect(component.controls().sport).toBe(ActivityTypes.Running);
    }
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.busy.set(null); component.saveUncertain.set(false);
    await component.generate();
    expect(generate.mock.calls[0][1].controls).toMatchObject({ sport: ActivityTypes.Running, equipment: ['bodyweight'] });
  });
  it('keeps an exact generation retry and gives a new request to explicit regeneration', async () => {
    const fixture = await render(); generate.mockRejectedValueOnce(new Error('Lost response'));
    await fixture.componentInstance.generate(); await fixture.componentInstance.generate(true);
    expect(generate.mock.calls[1][1]).toEqual(generate.mock.calls[0][1]);
    await fixture.componentInstance.generate();
    expect(generate.mock.calls[2][1].requestId).not.toBe(generate.mock.calls[1][1].requestId);
  });
  it('retains confirmed extension and identical save IDs across uncertain retries even if live revisions advance', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.set('localDate', '2026-11-02'); await component.generate();
    mutate.mockRejectedValueOnce({ code: 'functions/unavailable' }); await component.add();
    expect(component.saveUncertain()).toBe(true); fixture.detectChanges();
    const retry = fixture.nativeElement.querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement;
    expect(retry.textContent).toContain('Retry Add'); expect(retry.disabled).toBe(false);
    const command = mutate.mock.calls[0][0]; expect(command.operation.confirmPlanRangeExtension).toBe(true);
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8 } });
    component.set('minutes', 50); expect(component.controls().minutes).toBe(30);
    await component.add();
    expect(mutate.mock.calls[1][0]).toEqual(command); expect(dialogOpen).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(component.savedWorkoutId()).toBe(command.operation.workoutId);
  });
  it('requires a current-day review after a definitive conflict and retains the draft', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    await component.generate(); mutate.mockRejectedValueOnce({ code: 'functions/aborted' }); await component.add();
    expect(component.result()?.draft).not.toBeNull(); expect(component.staleReview()).toBe(true);
    await component.add(); expect(mutate).toHaveBeenCalledOnce();
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8 } }); component.refreshReview(); await component.add();
    expect(mutate.mock.calls[1][0].expectedRevisions[0].revision).toBe(8);
  });
  it('does not save a rest suggestion or use a late generation after the owner changes', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    generate.mockImplementationOnce(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null, previousLoads: [] }));
    await component.generate(); await component.add(); expect(mutate).not.toHaveBeenCalled();
    let resolve!: (value: GenerateDayWorkoutResponse) => void;
    generate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = component.generate(); auth.next({ uid: 'other' }); resolve(response(generate.mock.calls[1][1].requestId)); await pending;
    expect(component.result()).toBeNull(); expect(close).toHaveBeenCalledOnce();
    expect(generate.mock.calls[1][2]()).toBe(false);
  });
});
