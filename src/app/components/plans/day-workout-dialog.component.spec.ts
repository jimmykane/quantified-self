import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogContainer, MatDialogRef } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import type { GenerateDayWorkoutResponse } from '@shared/day-workout';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DayWorkoutService } from '../../services/day-workout.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../services/training-plans.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { DayWorkoutDialogComponent } from './day-workout-dialog.component';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const sdk = vi.hoisted(() => ({ authState: vi.fn() }));
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState }));
const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat', sets: [
  { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, externalLoadKg: 12.5, restAfterSeconds: 90 },
] }] };
function response(requestId: string): GenerateDayWorkoutResponse {
  return { requestId, kind: 'workout', observedAt: '2026-10-28T12:00:00Z', rationale: 'Keep this controlled.',
    draft: { title: 'Strength session', strength, structure: projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 }), estimatedMinutes: { minimum: 20, maximum: 30 } },
    usedContext: ['Previously planned strength'], missingContext: ['No usable existing Feeling/RPE feedback was found.'],
    previousLoads: [{ exerciseId: 'squat', localDate: '2026-10-25' }] };
}
describe('DayWorkoutDialogComponent', () => {
  let schedule: BehaviorSubject<CurrentTrainingScheduleV1>;
  let auth: BehaviorSubject<{ uid: string } | null>;
  let generate: ReturnType<typeof vi.fn>;
  let mutate: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    auth = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' }); sdk.authState.mockReturnValue(auth);
    schedule = new BehaviorSubject<CurrentTrainingScheduleV1>({
      state: { schemaVersion: 1, activePlanId: 'plan', revision: 7, currentWorkoutCount: 0, updatedAtMs: 1 },
      plans: [{ schemaVersion: 1, id: 'plan', name: 'Autumn', lifecycle: 'active', startLocalDate: '2026-10-01',
        endLocalDate: '2026-10-31', revision: 2, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 2 }], workouts: [],
    });
    generate = vi.fn(async (_uid, request) => response(request.requestId));
    mutate = vi.fn().mockResolvedValue({}); close = vi.fn(); dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(true) });
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() }; let counter = 0;
    const user = { uid: 'owner', settings: { unitSettings: {} } };
    await TestBed.configureTestingModule({ imports: [DayWorkoutDialogComponent], providers: [
      { provide: MAT_DIALOG_DATA, useValue: { ownerUid: 'owner', localDate: '2026-10-28', sport: ActivityTypes.StrengthTraining } },
      { provide: Auth, useValue: {} },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
      { provide: AppHapticsService, useValue: haptics },
      { provide: MatDialogRef, useValue: { close, disableClose: false } }, { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: DayWorkoutService, useValue: { generate, isOwner: () => auth.value?.uid === 'owner' } },
      { provide: TrainingPlansService, useValue: { watchSchedule: () => schedule, mutate,
        createMutationId: () => `mutation-${++counter}`, createEntityId: () => `workout-${++counter}` } },
      { provide: TrainingDeliveryService, useValue: { watchScope: () => of({ settings: [{ provider: 'garmin', enabled: true }] }) } },
    ] }).compileComponents();
  });
  afterEach(() => vi.useRealTimers());
  async function render() { const fixture = TestBed.createComponent(DayWorkoutDialogComponent);
    vi.spyOn((fixture.componentInstance as unknown as { dialogs: MatDialog }).dialogs, 'open').mockImplementation(dialogOpen);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); return fixture; }
  it('renders explicit defaults, separate consent and full reviewed strength without writing', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    expect(component.controls()).toMatchObject({ minutes: 30, destinationPlanId: 'plan', equipment: ['bodyweight'], trainingContext: false, timelineContext: false });
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
        + sass.compileString(`#${fixture.nativeElement.id} {` + readFileSync('src/app/components/plans/day-workout-dialog.component.scss', 'utf8')
          .replace(/:host/g, '&') + '}').css;
      const exportView = (name: string) => {
        const markup = fixture.nativeElement.cloneNode(true) as HTMLElement;
        const inputs: HTMLInputElement[] = [...fixture.nativeElement.querySelectorAll('input')];
        markup.querySelectorAll('input').forEach((input, index) => input.setAttribute('value', inputs[index].value));
        for (const dark of [false, true]) writeFileSync(join(process.env.DAY_WORKOUT_QA_DIR!, `${name}${dark ? '-dark' : ''}.html`),
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<link rel="stylesheet" href="styles.css">' + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('')
          + '<style>' + css + '.qa-pane{width:720px;max-width:100vw;max-height:100dvh;margin:auto}@media(max-width:600px){.qa-pane{width:100vw;height:100dvh}}</style>'
          + '</head><body class="app-hydrated' + (dark ? ' dark-theme' : '') + '"><div class="qa-pane">'
          + '<mat-dialog-container class="mat-mdc-dialog-container mdc-dialog mdc-dialog--open"><div class="mat-mdc-dialog-inner-container mdc-dialog__container">'
          + '<div class="mat-mdc-dialog-surface mdc-dialog__surface">' + markup.outerHTML + '</div></div></mat-dialog-container></div></body></html>');
      };
      exportView('strength-review'); component.more.set(true); fixture.detectChanges(); exportView('strength-options');
      component.set('sport', ActivityTypes.Running); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); exportView('endurance-options');
      component.set('sport', ActivityTypes.StrengthTraining); component.result.set(response(generate.mock.calls[0][1].requestId));
      component.refreshReview(); fixture.detectChanges();
    }
    component.edit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ ownerUid: 'owner', draft: response('').draft,
      saveRequest: expect.objectContaining({ operation: expect.objectContaining({ strength }) }) }));
  });
  it('restores a usable equipment default when switching sports after clearing the strength selection', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.set('equipment', []); expect(component.valid()).toBe(false);
    component.set('sport', ActivityTypes.Running); expect(component.valid()).toBe(true);
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
    expect(component.saveUncertain()).toBe(true);
    const command = mutate.mock.calls[0][0]; expect(command.operation.confirmPlanRangeExtension).toBe(true);
    schedule.next({ ...schedule.value, state: { ...schedule.value.state, revision: 8 } });
    component.set('minutes', 50); expect(component.controls().minutes).toBe(30);
    await component.add();
    expect(mutate.mock.calls[1][0]).toEqual(command); expect(dialogOpen).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
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
    generate.mockResolvedValueOnce({ ...response('mutation-1'), kind: 'rest', draft: null, previousLoads: [] });
    await component.generate(); await component.add(); expect(mutate).not.toHaveBeenCalled();
    let resolve!: (value: GenerateDayWorkoutResponse) => void;
    generate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = component.generate(); auth.next({ uid: 'other' }); resolve(response(generate.mock.calls[1][1].requestId)); await pending;
    expect(component.result()).toBeNull(); expect(close).toHaveBeenCalledOnce();
    expect(generate.mock.calls[1][2]()).toBe(false);
  });
});
