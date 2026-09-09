import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ActivityTypes, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { BehaviorSubject, of } from 'rxjs';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import {
  TrainingPlansService,
  type CurrentTrainingScheduleV1,
} from '../../services/training-plans.service';
import { PlansWorkspaceComponent } from './plans-workspace.component';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';

describe('PlansWorkspaceComponent', () => {
  const user = { uid: 'user-1', settings: { unitSettings: {} } };
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> } };
  let schedule: CurrentTrainingScheduleV1;
  let watchSchedule: ReturnType<typeof vi.fn>;
  let mutate: ReturnType<typeof vi.fn>;
  let getHistory: ReturnType<typeof vi.fn>;
  let previewRestore: ReturnType<typeof vi.fn>;
  let restoreSchedule: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 12));
    route = { snapshot: { queryParamMap: convertToParamMap({}) } };
    schedule = populatedSchedule();
    watchSchedule = vi.fn().mockImplementation(() => of(schedule));
    mutate = vi.fn().mockImplementation(async request => ({
      mutationId: request.mutationId,
      state: schedule.state,
      plans: [],
      workouts: [],
      removedPlanIds: [],
      permanentlyDeletedWorkoutIds: [],
    }));
    getHistory = vi.fn();
    previewRestore = vi.fn();
    restoreSchedule = vi.fn();
    dialogOpen = vi.fn();
    snackBarOpen = vi.fn();
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [PlansWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
        { provide: AppHapticsService, useValue: haptics },
        {
          provide: TrainingPlansService,
          useValue: {
            watchSchedule,
            createEntityId: vi.fn().mockReturnValue('workout-new'),
            createMutationId: vi.fn().mockReturnValue('mutation-1'),
            mutate,
            getHistory,
            previewRestore,
            restore: restoreSchedule,
            deletePlan: vi.fn(),
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
        {
          provide: AppEventColorService,
          useValue: {
            getActivityColor: vi.fn().mockReturnValue(''),
            getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue(''),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  it('has one contextual add action without overview or duplicate plan headings', async () => {
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelector('.plans-overview')).toBeNull();
    expect([...fixture.nativeElement.querySelectorAll('h2')].map((el: HTMLElement) => el.textContent?.trim()))
      .toEqual(['Plan schedule (1 workout)']);
    expect([...fixture.nativeElement.querySelectorAll('button')].filter((el: HTMLElement) => el.textContent?.includes('Add workout')))
      .toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Add here');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('uses shared compact rows with labelled headings, actions, and dividers between workouts', async () => {
    schedule.workouts.push({ ...schedule.workouts[0], id: 'recovery', title: 'Recovery', lifecycle: 'skipped' });
    schedule.state.currentWorkoutCount = 3;
    schedule.plans[0].workoutCount = 2;
    const fixture = await renderPlans();
    const rows = fixture.debugElement.queryAll(By.directive(CompactRowComponent));
    expect(rows).toHaveLength(2);
    expect(rows.map(row => (row.componentInstance as CompactRowComponent).title())).toEqual(['Plan run', 'Recovery']);
    expect(rows.map(row => (row.componentInstance as CompactRowComponent).showDivider())).toEqual([true, false]);
    for (const row of rows) {
      const component = row.componentInstance as CompactRowComponent;
      expect(component.layout()).toBe('stacked');
      expect(component.density()).toBe('compact');
      expect(row.nativeElement.querySelector('article')?.getAttribute('aria-labelledby')).toBe(component.titleId());
      expect(row.nativeElement.querySelector('.compact-row__action [aria-label="Edit workout"]')).toBeTruthy();
      expect(row.nativeElement.querySelector('.compact-row__body .workout-row-actions')).toBeNull();
      expect(row.nativeElement.querySelector('.workout-row-meta')?.textContent).toContain('Running');
    }
    expect(fixture.nativeElement.querySelector('.workout-list mat-card')).toBeNull();
    expect(rows[1].nativeElement.querySelector('mat-chip')?.textContent).toContain('Skipped');
  });

  it('shows only the selected day and prefills that date and plan when adding to an empty day', async () => {
    const fixture = await renderPlans();
    const day = fixture.nativeElement.querySelector('[data-plan-date="2026-09-10"]') as HTMLButtonElement;
    day.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.displayedWorkoutRows()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.workout-empty-state')?.textContent).toContain('Nothing scheduled');
    expect(fixture.nativeElement.querySelectorAll('.workout-row')).toHaveLength(0);
    expect(haptics.selection).toHaveBeenCalledOnce();
    (fixture.nativeElement.querySelector('.workout-list-heading button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.editor()).toMatchObject({ destinationPlanId: 'active-plan', value: { localDate: '2026-09-10' } });
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-10');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('renders a future paused plan and its skipped workout independently from active and standalone workouts', async () => {
    schedule.plans.push({ ...schedule.plans[0], id: 'paused', lifecycle: 'paused', startLocalDate: '2026-12-03', endLocalDate: '2026-12-20' });
    schedule.workouts.push({ ...schedule.workouts[0], id: 'paused-workout', planId: 'paused', localDate: '2026-12-03', lifecycle: 'skipped', title: 'Paused run' });
    const fixture = await renderPlans();
    fixture.componentInstance.selectPlan('paused');
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-12-03');
    expect(fixture.nativeElement.querySelector('.calendar-navigation h3')?.textContent).toBe('December 2026');
    expect(fixture.nativeElement.querySelector('.workout-row')?.textContent).toContain('Paused run');
    expect(fixture.nativeElement.querySelector('.workout-row mat-chip')?.textContent).toContain('Skipped');
    expect(fixture.nativeElement.querySelector('.workout-list')?.textContent).not.toContain('Plan run');
    expect(fixture.nativeElement.querySelector('.workout-list')?.textContent).not.toContain('Standalone run');
    fixture.componentInstance.selectView('standalone');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-plan-schedule-calendar')).toBeNull();
    expect(fixture.nativeElement.querySelector('.workout-row')?.textContent).toContain('Standalone run');
  });

  it('preserves selection during live refresh, clamps it after shifting the range, and selects a saved workout date', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    const fixture = await renderPlans();
    fixture.componentInstance.selectScheduleDate('2026-09-15');
    live.next({ ...schedule, plans: [{ ...schedule.plans[0], revision: 3 }] });
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-15');
    live.next({ ...schedule, plans: [{ ...schedule.plans[0], startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' }] });
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-10-01');
    fixture.componentInstance.openNewWorkout('active-plan', '2026-10-12');
    fixture.componentInstance.updateEditorField('title', 'New workout');
    await fixture.componentInstance.saveWorkout();
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-10-12');
  });

  it('refreshes today on window focus without replacing an explicitly selected plan date', async () => {
    const fixture = await renderPlans();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    window.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-current="date"]')?.getAttribute('data-plan-date')).toBe('2026-09-10');
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-10');
    fixture.componentInstance.selectScheduleDate('2026-09-15');
    vi.setSystemTime(new Date(2026, 8, 11, 12));
    window.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-15');
    expect(haptics.selection).not.toHaveBeenCalled();

    fixture.componentInstance.selectView('standalone');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.workout-list-heading button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-11');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('refreshes a resumed mobile tab without changing an open workout draft', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      const fixture = await renderPlans();
      fixture.componentInstance.openNewWorkout('active-plan', '2026-09-15');
      fixture.componentInstance.updateEditorField('title', 'Keep this draft');
      vi.setSystemTime(new Date(2026, 8, 10, 12));
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-09');
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-10');
      expect(fixture.componentInstance.editor()?.value).toMatchObject({ localDate: '2026-09-15', title: 'Keep this draft' });
      expect(haptics.selection).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      visibility.mockRestore();
    }
  });

  it('updates an open calendar after local midnight and cleans up its clock on destruction', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 8, 9, 23, 59, 30));
    const fixture = await renderPlans();
    const refresh = vi.spyOn(fixture.componentInstance, 'refreshToday');
    await vi.advanceTimersByTimeAsync(60_000);
    fixture.detectChanges();
    expect(refresh).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[aria-current="date"]')?.getAttribute('data-plan-date')).toBe('2026-09-10');
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('uses the click-time date for standalone adds even before the day clock refreshes', async () => {
    const fixture = await renderPlans();
    fixture.componentInstance.selectView('standalone');
    fixture.detectChanges();
    vi.setSystemTime(new Date(2026, 8, 10, 0, 0, 1));
    (fixture.nativeElement.querySelector('.workout-list-heading button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-10');
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    { preference: {}, expected: '1.61 Km' },
    { preference: { distanceUnits: DistanceUnits.Miles }, expected: '1.00 mi' },
  ])('retains unit-aware distance display in compact workout rows: $expected', async ({ preference, expected }) => {
    const unitUser = { ...user, settings: { unitSettings: normalizeUserUnitSettings(preference) } };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(unitUser), user$: of(unitUser) } });
    schedule.workouts[0].structure = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'mile', purpose: 'work', ending: { kind: 'distance', meters: 1609.344 }, targets: [] }],
    };
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelector('app-compact-row.workout-row .workout-summary')?.textContent).toContain(expected);
  });

  it('uses compact rows for editable steps and repeats without nesting cards or changing edit actions', async () => {
    const fixture = await renderPlans();
    (fixture.nativeElement.querySelector('.workout-row-actions [aria-label="Edit workout"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.editor()?.original?.id).toBe('plan-workout');
    expect(haptics.selection).toHaveBeenCalledOnce();
    (fixture.nativeElement.querySelectorAll('.workout-node-add-actions button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    const rows = fixture.debugElement.queryAll(By.directive(CompactRowComponent));
    expect(rows.map(row => (row.componentInstance as CompactRowComponent).title())).toEqual(['Step 1', 'Repeat block 2']);
    expect(rows.map(row => (row.componentInstance as CompactRowComponent).showDivider())).toEqual([true, false]);
    expect(fixture.nativeElement.querySelectorAll('.workout-node-row .compact-row__action button')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.workout-editor mat-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.editor-save-actions [appHapticTap]')).toBeTruthy();
  });

  it('keeps a newly created plan selected when the callable finishes before the live plan listener', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    const createdPlan = { ...schedule.plans[0], id: 'workout-new', name: 'Next block', lifecycle: 'paused' as const, revision: 1, workoutCount: 0 };
    const acknowledgedState = { ...schedule.state, revision: 5 };
    mutate.mockResolvedValue({ state: acknowledgedState, plans: [createdPlan], workouts: [], removedPlanIds: [], permanentlyDeletedWorkoutIds: [] });
    const fixture = await renderPlans();
    fixture.componentInstance.beginPlanCreation();
    fixture.componentInstance.updatePlanDraft('name', 'Next block');
    fixture.componentInstance.updatePlanDraft('activate', false);
    await fixture.componentInstance.createPlan();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedPlan()?.name).toBe('Next block');
    live.next({ ...schedule, state: { ...schedule.state, revision: 5 } });
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedPlanId()).toBe(createdPlan.id);
    live.next({ ...schedule, state: acknowledgedState, plans: [...schedule.plans, createdPlan] });
    fixture.detectChanges();
    expect(fixture.componentInstance.planOptions()).toHaveLength(2);
    expect(fixture.componentInstance.selectedPlanId()).toBe(createdPlan.id);
    live.next(schedule);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedPlanId()).toBe('active-plan');
  });

  it('shows a single useful empty state instead of an empty selector and disabled workout list', async () => {
    schedule = { state: { ...schedule.state, activePlanId: null, currentWorkoutCount: 0 }, plans: [], workouts: [] };
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.workout-list')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.plans-empty-state')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.plans-empty-state button')?.textContent).toContain('Create your first plan');
  });

  it('keeps standalone to one heading and one add action without plan creation controls', async () => {
    const fixture = await renderPlans();
    fixture.componentInstance.selectView('standalone');
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('h2')].map((el: HTMLElement) => el.textContent?.trim()))
      .toEqual(['Standalone workouts (1)']);
    expect(fixture.nativeElement.textContent).not.toContain('New plan');
    const add = fixture.nativeElement.querySelector('.workout-list-heading button') as HTMLButtonElement;
    add.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.editor()?.destinationPlanId).toBeNull();
  });

  it('focuses the editor, hides competing actions, and restores focus without replacing a draft', async () => {
    const fixture = await renderPlans();
    (fixture.nativeElement.querySelector('.workout-list-heading button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const title = fixture.nativeElement.querySelector('input[maxlength="120"]') as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(fixture.nativeElement.querySelector('.plans-view-navigation')).toBeNull();
    expect(fixture.nativeElement.querySelector('.plan-scope')).toBeNull();
    expect(fixture.nativeElement.querySelector('.workout-list')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.updateEditorField('title', 'Draft to keep');
    fixture.componentInstance.openNewWorkout(null);
    fixture.componentInstance.selectView('standalone');
    fixture.componentInstance.beginPlanCreation();
    expect(fixture.componentInstance.editor()?.value.title).toBe('Draft to keep');
    expect(fixture.componentInstance.showPlanForm()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.workout-list-heading button'));
  });

  it('keeps fields and competing actions disabled during save, then shows the saved destination', async () => {
    let finishMutation: () => void = () => undefined;
    mutate.mockImplementation(request => new Promise(resolve => {
      finishMutation = () => resolve({ mutationId: request.mutationId, state: schedule.state, plans: [], workouts: [] });
    }));
    const fixture = await renderPlans();
    fixture.componentInstance.openNewWorkout(null);
    fixture.componentInstance.updateEditorField('title', 'Standalone draft');
    const pending = fixture.componentInstance.saveWorkout();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.editor-fields')?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('input')?.matches(':disabled')).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-select')?.getAttribute('aria-disabled')).toBe('true');
    expect(fixture.nativeElement.querySelector('.editor-save-actions .button-content mat-spinner')).toBeTruthy();
    expect(haptics.success).not.toHaveBeenCalled();
    finishMutation();
    await pending;
    expect(fixture.componentInstance.view()).toBe('standalone');
    expect(fixture.componentInstance.editor()).toBeNull();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('keeps a failed save editable and gives error feedback only after failure', async () => {
    mutate.mockRejectedValue(new Error('Could not save'));
    const fixture = await renderPlans();
    fixture.componentInstance.openNewWorkout();
    fixture.componentInstance.updateEditorField('title', 'Keep this draft');
    await fixture.componentInstance.saveWorkout();
    expect(fixture.componentInstance.editor()?.value.title).toBe('Keep this draft');
    expect(fixture.componentInstance.busyAction()).toBeNull();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledOnce();
  });

  it('does not vibrate for hydration, typing, or unchanged selections', async () => {
    const fixture = await renderPlans();
    fixture.componentInstance.selectView('plans');
    fixture.componentInstance.selectPlan('active-plan');
    fixture.componentInstance.openNewWorkout();
    fixture.componentInstance.updateEditorField('title', 'Typing');
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.Running);
    fixture.componentInstance.updateEditorDestination('active-plan');
    fixture.componentInstance.updateStep(0, null, 'endingValue', 20);
    fixture.componentInstance.updateStep(0, null, 'purpose', 'work');
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.Cycling);
    fixture.componentInstance.updateStep(0, null, 'purpose', 'warmup');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('defaults a calendar add request to the active plan', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-09-10' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()).toMatchObject({
      mode: 'create',
      destinationPlanId: 'active-plan',
      value: { localDate: '2026-09-10' },
    });
  });

  it('honors the prominent standalone calendar add path even with an active plan', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-09-10', scope: 'standalone' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()?.destinationPlanId).toBeNull();
    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-10');
  });

  it('defaults calendar adds to standalone when there is no active plan', async () => {
    schedule = { ...populatedSchedule(), state: { ...populatedSchedule().state, activePlanId: null } };
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-09-10' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()?.destinationPlanId).toBeNull();
  });

  it('opens a linked standalone workout in the editor without requiring a plan', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ workout: 'standalone-workout' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.view()).toBe('standalone');
    expect(fixture.componentInstance.editor()).toMatchObject({
      mode: 'edit',
      destinationPlanId: null,
      original: { id: 'standalone-workout' },
    });
  });

  it('returns to the linked workout date when cancelling the calendar-originated editor', async () => {
    schedule.workouts[0].localDate = '2026-09-20';
    route.snapshot.queryParamMap = convertToParamMap({ workout: 'plan-workout' });
    const fixture = await renderPlans();
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-20');
    expect(fixture.componentInstance.displayedWorkoutRows().map(row => row.workout.id)).toEqual(['plan-workout']);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns to the calendar add scope and date after cancellation (standalone: %s)', async standalone => {
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-09-20', ...(standalone ? { scope: 'standalone' } : {}) });
    const fixture = await renderPlans();
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe(standalone ? 'standalone' : 'plans');
    if (!standalone) expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-20');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('creates a standalone workout through the same revisioned mutation path', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-09-10', scope: 'standalone' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('title', 'Unplanned run');

    await fixture.componentInstance.saveWorkout();

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisions: [{ scope: 'state', id: 'current', revision: 4 }],
      operation: expect.objectContaining({
        kind: 'create-workout',
        workoutId: 'workout-new',
        planId: null,
        localDate: '2026-09-10',
        title: 'Unplanned run',
      }),
    }));
  });

  it('saves content, date, and plan association in one atomic update mutation', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ workout: 'standalone-workout' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('title', 'Attached run');
    fixture.componentInstance.updateEditorField('localDate', '2026-09-10');
    fixture.componentInstance.updateEditorDestination('active-plan');

    await fixture.componentInstance.saveWorkout();

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisions: [
        { scope: 'state', id: 'current', revision: 4 },
        { scope: 'plan', id: 'active-plan', revision: 2 },
        { scope: 'workout', id: 'standalone-workout', revision: 1 },
      ],
      operation: expect.objectContaining({
        kind: 'update-workout',
        workoutId: 'standalone-workout',
        planId: 'active-plan',
        localDate: '2026-09-10',
        title: 'Attached run',
        confirmPlanRangeExtension: false,
      }),
    }));
  });

  it('keeps the editor-open workout revision instead of borrowing a concurrent update', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ workout: 'standalone-workout' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('title', 'My pending edit');
    schedule.workouts.find(workout => workout.id === 'standalone-workout')!.revision = 9;

    await fixture.componentInstance.saveWorkout();

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisions: expect.arrayContaining([
        { scope: 'workout', id: 'standalone-workout', revision: 1 },
      ]),
    }));
  });

  it('reports a failed range-extension retry without losing the open editor', async () => {
    route.snapshot.queryParamMap = convertToParamMap({ date: '2026-10-10' });
    mutate
      .mockRejectedValueOnce(new Error('Moving this workout requires extending Autumn build to include 2026-10-10.'))
      .mockRejectedValueOnce(new Error('The schedule changed before the extension was applied.'));
    const fixture = await renderPlans();
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    const componentSnackBar = (fixture.componentInstance as unknown as { snackBar: MatSnackBar }).snackBar;
    vi.spyOn(componentDialog, 'open').mockReturnValue({ afterClosed: () => of(true) } as never);
    const errorNotice = vi.spyOn(componentSnackBar, 'open');
    fixture.componentInstance.updateEditorField('title', 'Long run');

    await expect(fixture.componentInstance.saveWorkout()).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ confirmPlanRangeExtension: true }),
    }));
    expect(errorNotice).toHaveBeenCalledWith(
      'The schedule changed before the extension was applied.',
      'Dismiss',
      { duration: 7000 },
    );
    expect(fixture.componentInstance.editor()).not.toBeNull();
  });

  it('closes the destructive deletion panel after archiving instead', async () => {
    const fixture = await renderPlans();
    const plan = schedule.plans[0];
    fixture.componentInstance.beginPlanDeletion(plan);

    await fixture.componentInstance.setPlanLifecycle(plan, 'archived');

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: { kind: 'set-plan-lifecycle', planId: plan.id, lifecycle: 'archived' },
    }));
    expect(fixture.componentInstance.deletingPlanId()).toBeNull();
  });

  it('keeps plan mutations visibly pending beside the triggering controls', async () => {
    const fixture = await renderPlans();

    fixture.componentInstance.busyAction.set('shift-active-plan');
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedPlanActionBusy()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Updating plan');
  });

  it('keeps restore revisions fixed across preview and confirmation', async () => {
    const fixture = await renderPlans();
    previewRestore.mockImplementation(async () => {
      schedule.state.revision = 8;
      schedule.plans[0].revision = 7;
      return {
        scope: { kind: 'plan', id: 'active-plan' },
        targetRevision: 1,
        changedPlanIds: ['active-plan'],
        changedWorkoutIds: [],
        skippedWorkoutIds: [],
        warnings: [],
      };
    });
    restoreSchedule.mockResolvedValue({
      mutation: {
        mutationId: 'mutation-1',
        state: schedule.state,
        plans: [],
        workouts: [],
        removedPlanIds: [],
        permanentlyDeletedWorkoutIds: [],
      },
      skippedWorkoutIds: [],
    });
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    vi.spyOn(componentDialog, 'open').mockReturnValue({ afterClosed: () => of(true) } as never);
    fixture.componentInstance.historyPanel.set({
      scope: { kind: 'plan', id: 'active-plan' },
      status: 'ready',
      entries: [],
      nextBeforeRevision: null,
      error: null,
    });

    await fixture.componentInstance.restoreHistoryEntry({
      revision: 1,
      operationKind: 'create-plan',
      createdAtMs: 1,
      mutationId: 'create',
      isCheckpoint: true,
    });

    expect(restoreSchedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisions: [
        { scope: 'state', id: 'current', revision: 4 },
        { scope: 'plan', id: 'active-plan', revision: 2 },
      ],
    }));
  });

  it('routes plan-bound workout history through the plan stream and standalone history through the workout stream', async () => {
    const fixture = await renderPlans();

    expect(fixture.componentInstance.workoutRows()[0]?.historyScope).toEqual({
      kind: 'plan', id: 'active-plan',
    });
    fixture.componentInstance.selectView('standalone');
    expect(fixture.componentInstance.workoutRows()[0]?.historyScope).toEqual({
      kind: 'workout', id: 'standalone-workout',
    });
  });

  it('renders complete revision details outside single-line Material list slots and supports retry', async () => {
    getHistory.mockRejectedValueOnce(new Error('deadline-exceeded')).mockResolvedValueOnce({
      scope: { kind: 'workout', id: 'standalone-workout' },
      entries: [{ revision: 3, operationKind: 'update-workout', createdAtMs: 1_789_000_000_000, mutationId: 'update', isCheckpoint: true }],
      nextBeforeRevision: null,
    });
    const fixture = await renderPlans();
    await fixture.componentInstance.openHistory({ kind: 'workout', id: 'standalone-workout' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.history-status')?.textContent).toContain('Could not load revision history');
    expect(haptics.error).toHaveBeenCalledOnce();
    (fixture.nativeElement.querySelector('.history-status button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.history-entry h3')?.textContent).toContain('Revision 3 · update-workout');
    expect(fixture.nativeElement.querySelector('.history-entry p')?.textContent).toContain('checkpoint');
    expect(fixture.nativeElement.querySelector('.history-entry button .button-content')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.history-entry [matListItemMeta]')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('does not reopen revision history after an in-flight request is closed', async () => {
    let resolveHistory: (value: unknown) => void = () => undefined;
    getHistory.mockReturnValue(new Promise(resolve => { resolveHistory = resolve; }));
    const fixture = await renderPlans();

    const pending = fixture.componentInstance.openHistory({ kind: 'plan', id: 'active-plan' });
    fixture.componentInstance.closeHistory();
    resolveHistory({
      scope: { kind: 'plan', id: 'active-plan' },
      entries: [],
      nextBeforeRevision: null,
    });
    await pending;

    expect(fixture.componentInstance.historyPanel()).toBeNull();
  });

  it('does not continue a restore after its history panel is closed', async () => {
    let resolvePreview: (value: {
      scope: { kind: 'plan'; id: string };
      targetRevision: number;
      changedPlanIds: string[];
      changedWorkoutIds: string[];
      skippedWorkoutIds: string[];
      warnings: string[];
    }) => void = () => undefined;
    previewRestore.mockReturnValue(new Promise(resolve => { resolvePreview = resolve; }));
    const fixture = await renderPlans();
    fixture.componentInstance.historyPanel.set({
      scope: { kind: 'plan', id: 'active-plan' },
      status: 'ready',
      entries: [],
      nextBeforeRevision: null,
      error: null,
    });

    const pending = fixture.componentInstance.restoreHistoryEntry({
      revision: 1,
      operationKind: 'create-plan',
      createdAtMs: 1,
      mutationId: 'create',
      isCheckpoint: true,
    });
    fixture.componentInstance.closeHistory();
    resolvePreview({
      scope: { kind: 'plan', id: 'active-plan' },
      targetRevision: 1,
      changedPlanIds: ['active-plan'],
      changedWorkoutIds: [],
      skippedWorkoutIds: [],
      warnings: [],
    });
    await pending;

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(restoreSchedule).not.toHaveBeenCalled();
  });

  it('loads older history pages without replacing newer revisions', async () => {
    getHistory
      .mockResolvedValueOnce({
        scope: { kind: 'plan', id: 'active-plan' },
        entries: [{ revision: 3, operationKind: 'rename-plan', createdAtMs: 3, mutationId: 'm3', isCheckpoint: false }],
        nextBeforeRevision: 3,
      })
      .mockResolvedValueOnce({
        scope: { kind: 'plan', id: 'active-plan' },
        entries: [{ revision: 2, operationKind: 'create-workout', createdAtMs: 2, mutationId: 'm2', isCheckpoint: false }],
        nextBeforeRevision: null,
      });
    const fixture = await renderPlans();

    await fixture.componentInstance.openHistory({ kind: 'plan', id: 'active-plan' });
    await fixture.componentInstance.loadOlderHistory();

    expect(getHistory).toHaveBeenLastCalledWith({
      scope: { kind: 'plan', id: 'active-plan' },
      beforeRevision: 3,
      limit: 50,
    });
    expect(fixture.componentInstance.historyPanel()?.entries.map(entry => entry.revision)).toEqual([3, 2]);
    expect(fixture.componentInstance.historyPanel()?.nextBeforeRevision).toBeNull();
  });

  async function renderPlans() {
    const fixture = TestBed.createComponent(PlansWorkspaceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
});

function populatedSchedule(): CurrentTrainingScheduleV1 {
  const structure = {
    version: 1 as const,
    sport: ActivityTypes.Running,
    nodes: [{
      kind: 'step' as const,
      id: 'steady',
      purpose: 'work' as const,
      ending: { kind: 'time' as const, seconds: 1800 },
      targets: [],
    }],
  };
  return {
    state: { schemaVersion: 1, activePlanId: 'active-plan', revision: 4, currentWorkoutCount: 2, updatedAtMs: 4 },
    plans: [{
      schemaVersion: 1,
      id: 'active-plan',
      name: 'Autumn build',
      lifecycle: 'active',
      startLocalDate: '2026-09-01',
      endLocalDate: '2026-09-30',
      revision: 2,
      lastCheckpointRevision: 1,
      workoutCount: 1,
      createdAtMs: 1,
      updatedAtMs: 2,
    }],
    workouts: [
      {
        schemaVersion: 1,
        id: 'plan-workout',
        planId: 'active-plan',
        localDate: '2026-09-09',
        lifecycle: 'planned',
        title: 'Plan run',
        structure,
        revision: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        schemaVersion: 1,
        id: 'standalone-workout',
        planId: null,
        localDate: '2026-09-08',
        lifecycle: 'planned',
        title: 'Standalone run',
        structure,
        revision: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
  };
}
