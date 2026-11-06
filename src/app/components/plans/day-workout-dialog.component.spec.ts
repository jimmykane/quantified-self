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
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
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
  let mutateWithDelivery: ReturnType<typeof vi.fn>;
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
    mutateWithDelivery = vi.fn(async (request, delivery, current) => ({ ...await mutate(request, current),
      deliveryOutcomes: delivery.providers.map(provider => ({ provider, state: 'queued' })) }));
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() }; let counter = 0;
    TestBed.overrideComponent(TrainingDeliveryButtonComponent, { add: { providers: [{ provide: MatDialog, useValue: { open: dialogOpen } }] } });
    const user = { uid: 'owner', settings: { unitSettings: {} } };
    profile = new BehaviorSubject<DialogProfile | null>(user);
    await TestBed.configureTestingModule({ imports: [DayWorkoutDialogComponent], providers: [
      provideRouter([]),
      { provide: MAT_DIALOG_DATA, useValue: { ownerUid: 'owner', localDate: '2026-10-28', sport: ActivityTypes.StrengthTraining } },
      { provide: Auth, useValue: {} },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: AppUserService, useValue: { user: signal(user), user$: profile, updateUserProperties: vi.fn().mockResolvedValue(undefined),
        watchActivityServiceConnectionState: () => connections } },
      { provide: AppEventService, useValue: {} },
      { provide: AppHapticsService, useValue: haptics },
      { provide: MatDialogRef, useValue: { close, disableClose: false, updateSize: vi.fn() } }, { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: DayWorkoutService, useValue: { generate, isOwner: () => auth.value?.uid === 'owner' } },
      { provide: AssistantQuotaService, useValue: { loadQuotaStatus } },
      { provide: TrainingPlansService, useValue: { watchWorkoutCompletionsForWorkouts: vi.fn(() => of([])), watchCalendarRestDay: () => of(null), setCalendarRestDay, watchSchedule: () => schedule, mutate, mutateWithDelivery,
        createMutationId: (prefix: string) => `${prefix}:00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, createEntityId: () => `workout-${++counter}` } },
      { provide: TrainingDeliveryService, useValue: { preview: vi.fn(), mutate: vi.fn(), watchScope: () => of({ settings: [{ provider: 'garmin', enabled: true }] }),
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

  it.each(['override', 'shared'] as const)('reviews the generation-time %s reference rather than current settings', async origin => {
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent);
    const component = fixture.componentInstance;
    const draft = response('source-review');
    draft.powerReference = origin === 'shared' ? { kind: 'training-ftp', sport: ActivityTypes.Running, family: 'running',
      revision: 2, effectiveAtMs: Date.parse('2026-10-25T12:00Z'), reference: { kind: 'functional-threshold-power', watts: 280 } }
      : { sport: ActivityTypes.Running, provider: 'suunto', source: 'Watch running power',
        reference: { kind: 'critical-power', watts: 250 }, referenceDate: '2026-10-25', zoneUpperBoundsWatts: [150, 200] };
    component.controls.set(defaultDayWorkoutControls('2026-10-28', 'UTC', ActivityTypes.Running));
    draft.draft = { title: 'Easy power run', structure: { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 600 },
        targets: [{ kind: 'power', mode: 'relative', minimumPercent: 60, maximumPercent: 80, reference: draft.powerReference.reference }] }] } };
    draft.previousLoads = []; draft.usedContext = ['Manually confirmed power reference for the selected sport']; draft.missingContext = [];
    component.result.set(draft); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    if (origin === 'shared') {
      expect(fixture.nativeElement.textContent).toContain('Shared Running FTP 280 watt');
      expect(fixture.nativeElement.textContent).toContain('Effective since 2026-10-25T12:00:00.000Z');
      expect(fixture.nativeElement.textContent).not.toContain('Reference date');
    } else {
      expect(fixture.nativeElement.textContent).toContain('Suunto · Watch running power · Critical power 250 watt');
      expect(fixture.nativeElement.textContent).toContain('Reference date 2026-10-25');
      expect(fixture.nativeElement.textContent).toContain('Z2: 150 watt to below 200 watt');
    }
    expect(fixture.nativeElement.textContent).toContain('Saved target values stay fixed');
    exportDailySuggestionDialogQa(fixture.nativeElement, `power-${origin}-review`);
  });
  it('reviews a replacement, saves the same workout with revision guards and preserves provider preferences', async () => {
    const completion = new BehaviorSubject<TrainingWorkoutCompletionV1[]>([]);
    vi.mocked(TestBed.inject(TrainingPlansService).watchWorkoutCompletionsForWorkouts).mockReturnValue(completion);
    const data = TestBed.inject(MAT_DIALOG_DATA);
    const original = { schemaVersion: 1 as const, id: 'existing-workout', planId: null, localDate: '2026-10-28',
      title: 'Original strength', structure: response('original').draft!.structure, lifecycle: 'planned' as const,
      revision: 3, createdAtMs: 1, updatedAtMs: 1 };
    schedule.next({ ...schedule.value, workouts: [original] });
    Object.assign(data, { initialControls: defaultDayWorkoutControls(original.localDate, 'UTC', ActivityTypes.StrengthTraining),
      replacement: { id: original.id, revision: original.revision, title: original.title }, dailyDelivery: { enabled: true, providers: ['garmin'] } });
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent), component = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('only after approval');
    component.set('sport', ActivityTypes.Running); expect(component.controls().sport).toBe(ActivityTypes.StrengthTraining);
    await component.generate(); await fixture.whenStable(); fixture.detectChanges();
    expect(generate.mock.calls[0][1].replaceWorkout).toEqual({ id: original.id, revision: 3 });
    expect(mutate).not.toHaveBeenCalled(); expect(component.primaryLabel()).toBe('Replace workout');
    expect(component.showDailyDelivery()).toBe(false);
    exportDailySuggestionDialogQa(fixture.nativeElement, 'replacement-review');
    mutate.mockRejectedValueOnce(Error('Response lost')).mockResolvedValue({ mutationId: 'saved', state: { ...schedule.value.state, revision: 8 },
      plans: [], workouts: [{ ...original, title: 'Replacement strength', revision: 4 }], removedPlanIds: [], permanentlyDeletedWorkoutIds: [] });
    await component.add(); expect(component.saveUncertain()).toBe(true);
    expect(component.primaryLabel()).toBe('Retry replacement');
    // Completion may arrive after the server committed but before its response is recovered.
    completion.next([{ schemaVersion: 1, workoutId: original.id, planId: null, provider: 'garmin', matchMethod: 'provider_marker',
      eventId: 'event', activityId: null, sourceSessionIndex: null, activityStartAtMs: null, scheduledLocalDate: original.localDate,
      workoutRevisionAtLink: 4, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1 }]);
    fixture.detectChanges();
    expect(component.replacementCurrent()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Close this review and reopen it');
    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(button => button.textContent.includes('Retry replacement'));
    expect(retry?.disabled).toBe(false);
    await component.primaryAction(); fixture.detectChanges();
    expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
    expect(mutate.mock.calls[0][0]).toMatchObject({ requireUncompletedWorkout: true, expectedRevisions: expect.arrayContaining([
      { scope: 'state', id: 'current', revision: 7 }, { scope: 'workout', id: original.id, revision: 3 }]),
      operation: { kind: 'update-workout', workoutId: original.id, planId: null, localDate: original.localDate } });
    expect(mutateWithDelivery).not.toHaveBeenCalled();
    expect(data.dailyDelivery).toEqual({ enabled: true, providers: ['garmin'] });
    expect(component.savedWorkoutId()).toBe(original.id);
    expect(component.savedWorkout()?.title).toBe('Replacement strength');
    expect(component.savedDetails().title).toBe('Replacement strength');
    // The state listener may advance before the workout listener supplies the replacement.
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8, currentWorkoutCount: 1 } });
    expect(component.savedWorkout()?.revision).toBe(4);
    schedule.next({ ...schedule.value, workouts: [{ ...original, revision: 4, title: 'Replacement strength' }] });
    expect(component.savedWorkout()?.title).toBe('Replacement strength');
    schedule.next({ ...schedule.value, workouts: [{ ...original, revision: 5, title: 'Later edit' }] });
    expect(component.savedWorkout()?.title).toBe('Later edit');
    schedule.next({ ...schedule.value, workouts: [{ ...original, revision: 6, lifecycle: 'deleted' }] });
    expect(component.savedWorkout()).toBeNull(); expect(component.savedSyncAvailable()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Workout replaced');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'regenerated-saved');
  });
  it('blocks a changed replacement and keeps the original when AI recommends rest', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA), original = { schemaVersion: 1 as const, id: 'existing-workout', planId: null,
      localDate: '2026-10-28', title: 'Original strength', structure: response('original').draft!.structure,
      lifecycle: 'planned' as const, revision: 3, createdAtMs: 1, updatedAtMs: 1 };
    schedule.next({ ...schedule.value, workouts: [original] });
    Object.assign(data, { initialControls: defaultDayWorkoutControls(original.localDate, 'UTC', ActivityTypes.StrengthTraining),
      replacement: { id: original.id, revision: 3, title: original.title } });
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent), component = fixture.componentInstance;
    generate.mockImplementation(async (_uid, request) => ({ ...response(request.requestId), kind: 'rest', draft: null }));
    await component.generate(); expect(component.primaryLabel()).toBe('Keep current workout');
    await component.primaryAction(); expect(close).toHaveBeenCalled(); expect(setCalendarRestDay).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
    schedule.next({ ...schedule.value, workouts: [{ ...original, revision: 4 }] });
    expect(component.replacementCurrent()).toBe(false); expect(component.approvalValid()).toBe(false);
    generate.mockClear(); await component.generate(); expect(generate).not.toHaveBeenCalled();
  });
  it.each(['completed', 'unavailable'] as const)('stops replacement approval when completion becomes %s during review', async status => {
    const completion = new Subject<TrainingWorkoutCompletionV1[]>();
    vi.mocked(TestBed.inject(TrainingPlansService).watchWorkoutCompletionsForWorkouts).mockReturnValue(completion);
    const original = { schemaVersion: 1 as const, id: 'existing', planId: null, localDate: '2026-10-28', title: 'Original',
      structure: response('original').draft!.structure, lifecycle: 'planned' as const, revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    schedule.next({ ...schedule.value, workouts: [original] });
    Object.assign(TestBed.inject(MAT_DIALOG_DATA), { replacement: { id: original.id, revision: 1, title: original.title },
      initialControls: defaultDayWorkoutControls(original.localDate, 'UTC', ActivityTypes.StrengthTraining) });
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent), component = fixture.componentInstance;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Checking the current workout');
    expect(fixture.nativeElement.textContent).not.toContain('was completed, or could not be checked');
    expect(component.replacementCurrent()).toBe(false); await component.generate(); expect(generate).not.toHaveBeenCalled();
    completion.next([]); await component.generate(); expect(component.approvalValid()).toBe(true);
    if (status === 'unavailable') completion.error(new Error('Unavailable'));
    else completion.next([{ schemaVersion: 1, workoutId: original.id, planId: null, provider: 'garmin', matchMethod: 'provider_marker',
      eventId: 'event', activityId: null, sourceSessionIndex: null, activityStartAtMs: null, scheduledLocalDate: original.localDate,
      workoutRevisionAtLink: original.revision, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1 }]);
    fixture.detectChanges();
    expect(component.approvalValid()).toBe(false); expect(component.replacementCurrent()).toBe(false);
    await component.add(); expect(mutate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('was completed, or could not be checked');
    const regenerate = [...fixture.nativeElement.querySelectorAll('button')].find(button => button.textContent.includes('Generate again'));
    expect(regenerate?.disabled).toBe(true);
    fixture.destroy(); expect(completion.observed).toBe(false);
  });
  it('uses persistent daily regeneration without claiming an included allowance', async () => {
    const data = TestBed.inject(MAT_DIALOG_DATA);
    const regenerateSuggestion = vi.fn(async request => response(request.requestId));
    Object.assign(data, { regenerateSuggestion, dailyDelivery: { enabled: true, providers: ['garmin'] }, initialControls: defaultDayWorkoutControls('2026-10-28', 'UTC', ActivityTypes.StrengthTraining) });
    const fixture = TestBed.createComponent(DayWorkoutDialogComponent), component = fixture.componentInstance;
    await component.generate(); await fixture.whenStable(); fixture.detectChanges();
    expect(regenerateSuggestion).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
    expect(component.primaryLabel()).toBe('Add & send'); component.setSkipSendingToday(true);
    expect(component.primaryLabel()).toBe('Add workout'); expect(data.dailyDelivery).toEqual({ enabled: true, providers: ['garmin'] });
    expect(fixture.nativeElement.textContent).not.toContain('Assistant allowance unchanged');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'regenerated-review');
  });
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
    const picker = fixture.debugElement.query(By.directive(ActivityFilterPickerComponent)).componentInstance as ActivityFilterPickerComponent;
    const selectedSport = picker.selectedValues();
    expect(picker.label()).toBe('Fallback sport');
    fixture.debugElement.query(By.css('mat-checkbox')).triggerEventHandler('change', { checked: false }); fixture.detectChanges();
    expect(picker.label()).toBe('Sport');
    expect(fixture.nativeElement.textContent).toContain('Use the selected sport every day.');
    expect(picker.selectedValues()).toEqual(selectedSport);
    fixture.debugElement.query(By.css('mat-checkbox')).triggerEventHandler('change', { checked: true }); fixture.detectChanges();
    expect(picker.label()).toBe('Fallback sport');
    expect(fixture.nativeElement.textContent).toContain('The fallback sport below is used when no clear routine is available.');
    expect(picker.selectedValues()).toEqual(selectedSport);
    expect(component.dailyDelivery()).toEqual({ enabled: false, providers: [] });
    component.setDeliveryEnabled(true); fixture.detectChanges(); expect(component.approvalValid()).toBe(false);
    expect(component.valid()).toBe(true); await component.primaryAction(); expect(data.savePreferences).not.toHaveBeenCalled();
    component.selectDeliveryProvider('coros', true); expect(component.dailyDelivery().providers).toEqual([]);
    component.selectDeliveryProvider('garmin', true); fixture.detectChanges(); expect(component.approvalValid()).toBe(true);
    expect(fixture.nativeElement.querySelector('[aria-label="Daily workout delivery services"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Skip sending today');
    expect(fixture.nativeElement.textContent).toContain('Changing services keeps today’s saved suggestion.');
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-preferences');
    await component.primaryAction();
    expect(data.savePreferences).toHaveBeenCalledWith(expect.any(Object), true, { enabled: true, providers: ['garmin'] });
    expect(generate).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled(); expect(mutateWithDelivery).not.toHaveBeenCalled();
  });
  it('saves the reviewed daily workout and delivery approval in one server request', async () => {
    const data = configureDailyDelivery();
    const fixture = await render(), component = fixture.componentInstance;
    expect(component.primaryLabel()).toBe('Add & send');
    const deliveryChoice = fixture.nativeElement.querySelector('.daily-delivery') as HTMLElement;
    expect(deliveryChoice.textContent).toContain('Saved services · Garmin');
    expect(deliveryChoice.textContent).toContain('Skip sending today');
    expect(deliveryChoice.querySelector('[aria-label="Daily workout delivery services"]')).toBeNull();
    expect(deliveryChoice.querySelector('mat-slide-toggle')).toBeNull();
    expect(deliveryChoice.querySelector('button')).toBeNull();
    expect((deliveryChoice.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect(deliveryChoice.compareDocumentPosition(fixture.nativeElement.querySelector('.review')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mutateWithDelivery).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-add-and-send');
    await component.primaryAction(); fixture.detectChanges();
    expect(mutateWithDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: expect.objectContaining({ kind: 'create-workout', planId: null }) }),
      { providers: ['garmin'], timeZone: 'Europe/Helsinki' }, expect.any(Function));
    expect(data.onAdded).toHaveBeenCalledExactlyOnceWith('workout');
    expect(component.deliveryOutcomeText()).toContain('Delivery queued for Garmin');
    expect(component.saveUncertain()).toBe(false); expect(generate).not.toHaveBeenCalled();
    await component.primaryAction(); await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).toHaveBeenCalledOnce();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-queued');
  });
  it.each(['review-required', 'failed'] as const)('keeps the acknowledged workout when delivery needs recovery: %s', async state => {
    configureDailyDelivery();
    mutateWithDelivery.mockImplementationOnce(async request => ({ ...await mutate(request), deliveryOutcomes: [{ provider: 'garmin', state }] }));
    const fixture = await render(), component = fixture.componentInstance;
    await component.add(); fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeTruthy(); expect(component.saveUncertain()).toBe(false); expect(component.error()).toBeNull();
    expect(component.deliveryOutcomeText()).toContain('Review sync');
    expect(fixture.nativeElement.textContent).toContain('Workout added');
    await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).toHaveBeenCalledOnce();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-delivery-'+state);
  });
  it('locks approval while the atomic save is pending and never sends a browser follow-up', async () => {
    configureDailyDelivery(); let finish!: () => Promise<void>;
    mutateWithDelivery.mockImplementationOnce((request, delivery) => new Promise(resolve => {
      finish = async () => resolve({ ...await mutate(request), deliveryOutcomes: delivery.providers.map(provider => ({ provider, state: 'queued' })) });
    }));
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(mutateWithDelivery).toHaveBeenCalledOnce()); fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeNull(); expect(component.busy()).toBe('save');
    const actions = [...fixture.nativeElement.querySelectorAll('mat-dialog-actions button')] as HTMLButtonElement[];
    expect(actions.every(button => button.disabled)).toBe(true);
    await finish(); await pending; fixture.detectChanges();
    expect(component.savedWorkoutId()).toBeTruthy(); expect(component.busy()).toBeNull();
    expect(component.deliveryOutcomeText()).toContain('Delivery queued for Garmin');
    expect(mutateWithDelivery).toHaveBeenCalledOnce();
  });
  it('never follows a missing delivery acknowledgement with a browser Send request', async () => {
    configureDailyDelivery(); mutateWithDelivery.mockImplementationOnce(async request => mutate(request));
    const fixture = await render(); await fixture.componentInstance.add();
    expect(fixture.componentInstance.savedWorkoutId()).toBeTruthy();
    expect(fixture.componentInstance.deliveryOutcomeText()).toContain('Review sync for Garmin');
    expect(mutateWithDelivery).toHaveBeenCalledOnce();
    expect(TestBed.inject(TrainingDeliveryService).preview).not.toHaveBeenCalled();
    expect(TestBed.inject(TrainingDeliveryService).mutate).not.toHaveBeenCalled();
  });
  it('needs no browser follow-up when the review is destroyed before the save response', async () => {
    const data = configureDailyDelivery(); let finish!: () => void;
    mutateWithDelivery.mockImplementationOnce(async request => { const saved = await mutate(request);
      return new Promise(resolve => { finish = () => resolve({ ...saved, deliveryOutcomes: [{ provider: 'garmin', state: 'queued' }] }); }); });
    const fixture = await render(), pending = fixture.componentInstance.add();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); fixture.destroy(); finish(); await pending;
    expect(mutateWithDelivery).toHaveBeenCalledOnce(); expect(data.onAdded).not.toHaveBeenCalled();
    expect(TestBed.inject(TrainingDeliveryService).mutate).not.toHaveBeenCalled();
    expect(data.dailyDelivery).toEqual({ enabled: true, providers: ['garmin'] });
  });
  it('skips sending today without changing saved destinations or future approvals', async () => {
    const data = configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    const skip = fixture.nativeElement.querySelector('.daily-delivery input[type="checkbox"]') as HTMLInputElement;
    haptics.selection.mockClear(); expect(haptics.success).not.toHaveBeenCalled();
    skip.click(); fixture.detectChanges();
    expect(component.primaryLabel()).toBe('Add workout'); expect(haptics.selection).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).not.toContain('Standalone: send separately after saving.');
    component.setSkipSendingToday(true); expect(haptics.selection).toHaveBeenCalledOnce();
    skip.click(); fixture.detectChanges(); expect(component.primaryLabel()).toBe('Add & send');
    skip.click(); fixture.detectChanges();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-skip-sending');
    await component.primaryAction(); expect(mutateWithDelivery).not.toHaveBeenCalled(); expect(mutate).toHaveBeenCalledOnce();
    expect(data.dailyDelivery).toEqual({ enabled: true, providers: ['garmin'] });
    fixture.destroy(); const next = await render();
    expect(next.componentInstance.primaryLabel()).toBe('Add & send');
    expect(next.componentInstance.skipSendingToday()).toBe(false);
  });
  it.each(['success', 'rejected', 'uncertain'] as const)('never persists a skipped approval or changes saved providers across an Add %s', async outcome => {
    const data = configureDailyDelivery();
    const saved = Object.freeze({ enabled: true, providers: Object.freeze(['garmin', 'suunto']) });
    data.dailyDelivery = saved; data.savePreferences = vi.fn().mockResolvedValue(undefined);
    const writeSettings = vi.mocked(TestBed.inject(AppUserService).updateUserProperties);
    const fixture = await render(), component = fixture.componentInstance;
    const skip = fixture.nativeElement.querySelector('.daily-delivery input[type="checkbox"]') as HTMLInputElement;
    skip.click(); fixture.detectChanges();
    if (outcome !== 'success') mutate.mockRejectedValueOnce({ code: outcome === 'uncertain' ? 'functions/deadline-exceeded' : 'functions/aborted' });
    await component.primaryAction();
    if (outcome !== 'success') {
      const original = mutate.mock.calls[0][0];
      if (outcome === 'uncertain') {
        component.setSkipSendingToday(false); expect(component.skipSendingToday()).toBe(true);
      } else component.refreshReview();
      await component.primaryAction();
      if (outcome === 'uncertain') expect(mutate.mock.calls[1][0]).toEqual(original);
    }
    expect(component.savedWorkoutId()).toBeTruthy(); expect(component.error()).toBeNull();
    expect(component.dailyDelivery()).toEqual(saved); expect(data.dailyDelivery).toBe(saved);
    expect(data.savePreferences).not.toHaveBeenCalled(); expect(writeSettings).not.toHaveBeenCalled();
    expect(mutateWithDelivery).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    fixture.destroy(); const next = await render();
    expect(next.componentInstance.primaryLabel()).toBe('Add & send');
    expect(next.componentInstance.dailyDelivery()).toEqual({ enabled: true, providers: ['garmin', 'suunto'] });
  });
  it('keeps provider setup out of review when the saved delivery preference is off', async () => {
    const data = configureDailyDelivery(); data.dailyDelivery = { enabled: false, providers: ['garmin'] };
    const watch = vi.spyOn(TestBed.inject(AppUserService), 'watchActivityServiceConnectionState');
    const fixture = await render(), component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('.daily-delivery')).toBeNull(); expect(watch).not.toHaveBeenCalled();
    component.setDeliveryEnabled(true); component.selectDeliveryProvider('suunto', true); component.setSkipSendingToday(true);
    expect(component.dailyDelivery()).toEqual({ enabled: false, providers: ['garmin'] });
    expect(component.skipSendingToday()).toBe(false); expect(haptics.selection).not.toHaveBeenCalled();
    expect(component.primaryLabel()).toBe('Add workout');
    await component.primaryAction(); expect(mutateWithDelivery).not.toHaveBeenCalled();
  });
  it('keeps the saved providers fixed in review and locks skip during generation, Add and uncertain Add', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    component.setDeliveryEnabled(false); component.selectDeliveryProvider('suunto', true); component.selectDeliveryProvider('garmin', false);
    expect(component.dailyDelivery()).toEqual({ enabled: true, providers: ['garmin'] });
    expect(haptics.selection).not.toHaveBeenCalled();
    for (const state of ['generate', 'save', 'uncertain'] as const) {
      component.busy.set(state === 'uncertain' ? null : state); component.saveUncertain.set(state === 'uncertain'); fixture.detectChanges();
      expect((fixture.nativeElement.querySelector('.daily-delivery input') as HTMLInputElement).disabled).toBe(true);
      component.setSkipSendingToday(true); expect(component.skipSendingToday()).toBe(false);
    }
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('blocks a newly disconnected destination and still allows Add without sending', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    connections.next({ ...connections.value, [ServiceNames.GarminAPI]: false }); fixture.detectChanges();
    expect(component.deliveryValid()).toBe(false); await component.add(); expect(mutate).not.toHaveBeenCalled();
    component.setSkipSendingToday(true); fixture.detectChanges();
    expect(component.primaryLabel()).toBe('Add workout');
    await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).not.toHaveBeenCalled();
  });
  it('allows manual regeneration when a selected delivery service becomes unavailable', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    connections.next({ ...connections.value, [ServiceNames.GarminAPI]: false }); fixture.detectChanges();
    const regenerate = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.trim() === 'Generate again') as HTMLButtonElement;
    expect(regenerate.disabled).toBe(false);
    await component.generate(); fixture.detectChanges();
    expect(generate).toHaveBeenCalledOnce(); expect(component.showDailyDelivery()).toBe(false);
    await component.add(); expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).not.toHaveBeenCalled();
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
    mutateWithDelivery.mockImplementationOnce(async request => { const saved = await mutate(request);
      return new Promise(resolve => { finish = () => resolve({ ...saved, deliveryOutcomes: [{ provider: 'garmin', state }] }); }); });
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    schedule.error(Error('Offline')); fixture.detectChanges();
    finish(); await pending; fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(false); expect(component.savedWorkoutId()).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain(state === 'queued' ? 'Delivery queued for Garmin' : 'Review sync for Garmin');
    expect(fixture.nativeElement.textContent).toContain('Reload schedule');
    expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
    exportDailySuggestionDialogQa(fixture.nativeElement, 'daily-suggestion-schedule-unavailable-'+state);
    const workout = component.savedWorkout()!;
    schedule = new BehaviorSubject<CurrentTrainingScheduleV1>({ state: { schemaVersion: 1, revision: 8,
      currentWorkoutCount: 1, activePlanId: null, updatedAtMs: 8 }, plans: [], workouts: [workout] });
    const reload = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent.includes('Reload schedule')) as HTMLButtonElement;
    reload.click(); fixture.detectChanges();
    expect(component.savedSyncAvailable()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(state === 'queued' ? 'Delivery queued for Garmin' : 'Review sync for Garmin');
    expect(mutate).toHaveBeenCalledOnce(); expect(mutateWithDelivery).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
  });
  it('never sends for a rest result', async () => {
    const data = configureDailyDelivery(); data.initialResult = { ...data.initialResult, kind: 'rest', draft: null };
    const fixture = await render(), component = fixture.componentInstance;
    expect(component.showDailyDelivery()).toBe(false); await component.primaryAction();
    expect(setCalendarRestDay).toHaveBeenCalledOnce(); expect(mutateWithDelivery).not.toHaveBeenCalled();
  });
  it('keeps sending off for a new manual generation replacing the daily draft', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    component.set('minutes', 40); await component.generate(); fixture.detectChanges();
    expect(component.showDailyDelivery()).toBe(false); expect(component.primaryLabel()).toBe('Add workout');
    await component.add(); expect(mutateWithDelivery).not.toHaveBeenCalled(); expect(mutate).toHaveBeenCalledOnce();
  });
  it('retries the same atomic approval after an uncertain Add without a separate Send request', async () => {
    configureDailyDelivery(); const fixture = await render(), component = fixture.componentInstance;
    mutate.mockRejectedValueOnce({ code: 'functions/deadline-exceeded' });
    await component.add(); expect(mutateWithDelivery).toHaveBeenCalledOnce(); expect(component.saveUncertain()).toBe(true);
    const original = mutate.mock.calls[0][0];
    await component.add(); expect(mutate.mock.calls[1][0]).toEqual(original); expect(mutateWithDelivery).toHaveBeenCalledTimes(2);
    expect(mutateWithDelivery.mock.calls[1].slice(0, 2)).toEqual(mutateWithDelivery.mock.calls[0].slice(0, 2));
    expect(component.saveUncertain()).toBe(false);
  });
  it('drops late atomic save results and feedback when the account changes', async () => {
    configureDailyDelivery(); let finish!: () => void;
    mutateWithDelivery.mockImplementationOnce(async request => { const saved = await mutate(request);
      return new Promise(resolve => { finish = () => resolve({ ...saved, deliveryOutcomes: [{ provider: 'garmin', state: 'queued' }] }); }); });
    const fixture = await render(), component = fixture.componentInstance;
    const pending = component.add(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
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
    const reviewParagraphs = [...fixture.nativeElement.querySelectorAll('[aria-label="Workout review"] > p')] as HTMLElement[];
    expect(reviewParagraphs[1].textContent).toBe('AI planning estimate: 20m 00s–30m 00s');
    expect(reviewParagraphs[1].classList.contains('hint')).toBe(false);
    expect(reviewParagraphs[2].textContent).toContain('Timing breakdown: 01m 30s timed subtotal');
    expect(reviewParagraphs[2].textContent).toContain('Rep-based sets and transitions add time.');
    expect(reviewParagraphs[2].classList.contains('hint')).toBe(true);
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
    expect(inputs).toHaveLength(12);
    expect(inputs.every(input => input.checked && !input.disabled)).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.generate(); fixture.detectChanges();
    expect(generate.mock.calls[0][1].controls).toMatchObject({ trainingContext: true, timelineContext: true, usePreviousWeights: true, goalsContext: true });
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
    expect(choice('Goals').disabled).toBe(true);
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
    expect(component.controls()).toMatchObject({ trainingContext: true, timelineContext: true, usePreviousWeights: true, goalsContext: true });
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
    expect(picker.multiple()).toBe(false); expect(picker.label()).toBe('Sport');
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
  it('offers Garmin averaging only for power choices and clears it on incompatible selections', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.set('sport', ActivityTypes.Running); component.more.set(true); fixture.detectChanges();
    const find = () => fixture.debugElement.queryAll(By.css('mat-select')).map(element => element.componentInstance)
      .find(select => select.options.some((option: { viewValue: string }) => option.viewValue === '30 seconds'));
    expect(find().value).toBe(0); haptics.selection.mockClear();
    find().selectionChange.emit({ value: 10 }); fixture.detectChanges();
    expect(component.controls().garminPowerAveragingSeconds).toBe(10); expect(haptics.selection).toHaveBeenCalledOnce();
    component.setAveraging(10); component.setAveraging(5); expect(haptics.selection).toHaveBeenCalledOnce();
    component.set('target', 'heart-rate'); fixture.detectChanges();
    expect(component.controls()).not.toHaveProperty('garminPowerAveragingSeconds'); expect(find()).toBeUndefined();
    component.set('target', 'garmin-power-zone'); component.setAveraging(30); fixture.detectChanges();
    expect(component.controls().garminPowerAveragingSeconds).toBe(30);
    component.set('sport', ActivityTypes.StrengthTraining); fixture.detectChanges();
    expect(component.controls()).not.toHaveProperty('garminPowerAveragingSeconds'); expect(find()).toBeUndefined();
  });

});
