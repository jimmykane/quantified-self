import { signal } from '@angular/core';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDatepickerInput } from '@angular/material/datepicker';
import { MatSelect } from '@angular/material/select';
import { MatFormField } from '@angular/material/form-field';
import { ActivatedRoute, Router, convertToParamMap, provideRouter, type Data, type ParamMap } from '@angular/router';
import { ActivityTypes, DistanceUnits, PaceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { WorkoutLibraryItemV1 } from '@shared/workout-library';
import dayjs from 'dayjs';
import { BehaviorSubject, Subject, concat, defer, of, type Observable } from 'rxjs';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { TrainingWorkoutDuplicateService } from '../../services/training-workout-duplicate.service';
import { WorkoutLibraryService } from '../../services/workout-library.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import {
  TrainingPlansService,
  type CurrentTrainingScheduleV1,
} from '../../services/training-plans.service';
import { PlansWorkspaceComponent } from './plans-workspace.component';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { TRAINING_PLAN_COLOR_OPTIONS, trainingPlanAppearance } from '../../helpers/training-plan-appearance.helper';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

describe('PlansWorkspaceComponent', () => {
  const user = { uid: 'planning-user', settings: { unitSettings: {} } };
  let route: {
    snapshot: { paramMap: ParamMap; queryParamMap: ParamMap; data: Data };
    paramMap: Observable<ParamMap>;
    queryParamMap: Observable<ParamMap>;
    data: Observable<Data>;
  };
  let routeParamChanges$: Subject<ParamMap>;
  let routeQueryChanges$: Subject<ParamMap>;
  let routeDataChanges$: Subject<Data>;
  let schedule: CurrentTrainingScheduleV1;
  let watchSchedule: ReturnType<typeof vi.fn>;
  let watchWorkoutCompletions: ReturnType<typeof vi.fn>;
  let mutate: ReturnType<typeof vi.fn>;
  let getHistory: ReturnType<typeof vi.fn>;
  let getDeletedWorkoutsPage: ReturnType<typeof vi.fn>;
  let getStrengthDetails: ReturnType<typeof vi.fn>;
  let libraryItems: BehaviorSubject<WorkoutLibraryItemV1[]>;
  let libraryWatch: ReturnType<typeof vi.fn>;
  let libraryMutate: ReturnType<typeof vi.fn>;
  let libraryPlace: ReturnType<typeof vi.fn>;
  let libraryGet: ReturnType<typeof vi.fn>;
  let previewRestore: ReturnType<typeof vi.fn>;
  let restoreSchedule: ReturnType<typeof vi.fn>;
  let deleteTrainingPlan: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let userSignal: ReturnType<typeof signal<typeof user | null>>;
  let userSubject: BehaviorSubject<typeof user | null>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 12));
    routeParamChanges$ = new Subject();
    routeQueryChanges$ = new Subject();
    routeDataChanges$ = new Subject();
    route = {
      snapshot: {
        paramMap: convertToParamMap({}),
        queryParamMap: convertToParamMap({}),
        data: { trainingPlansMode: 'browse', trainingPlansScope: 'plans' },
      },
      paramMap: concat(defer(() => of(route.snapshot.paramMap)), routeParamChanges$),
      queryParamMap: concat(defer(() => of(route.snapshot.queryParamMap)), routeQueryChanges$),
      data: concat(defer(() => of(route.snapshot.data)), routeDataChanges$),
    };
    schedule = populatedSchedule();
    userSignal = signal<typeof user | null>(user);
    userSubject = new BehaviorSubject<typeof user | null>(user);
    watchSchedule = vi.fn().mockImplementation(() => of(schedule));
    watchWorkoutCompletions = vi.fn().mockReturnValue(of([]));
    mutate = vi.fn().mockImplementation(async request => ({
      mutationId: request.mutationId,
      state: schedule.state,
      plans: [],
      workouts: [],
      removedPlanIds: [],
      permanentlyDeletedWorkoutIds: [],
    }));
    getHistory = vi.fn();
    getDeletedWorkoutsPage = vi.fn().mockResolvedValue({ workouts: [], nextCursor: null });
    getStrengthDetails = vi.fn();
    libraryItems = new BehaviorSubject<WorkoutLibraryItemV1[]>([]);
    libraryWatch = vi.fn().mockImplementation(() => libraryItems);
    libraryMutate = vi.fn();
    libraryPlace = vi.fn();
    libraryGet = vi.fn();
    previewRestore = vi.fn();
    restoreSchedule = vi.fn();
    deleteTrainingPlan = vi.fn();
    dialogOpen = vi.fn();
    snackBarOpen = vi.fn();
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [PlansWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
        { provide: ActivatedRoute, useValue: route },
        { provide: AppUserService, useValue: { user: userSignal, user$: userSubject } },
        { provide: AppHapticsService, useValue: haptics },
        { provide: WorkoutLibraryService, useValue: { watch: libraryWatch,
          get: libraryGet, mutate: libraryMutate, place: libraryPlace } },
        { provide: TrainingDeliveryService, useValue: { anyReady: () => false, watchPresence: () => of(false),
          isSetupAvailable: () => false,
          watchSummaryScope: () => of({ settings: [], statuses: [] }) } },
        {
          provide: TrainingPlansService,
          useValue: {
            watchSchedule,
            watchWorkoutCompletions,
            createEntityId: vi.fn().mockReturnValue('workout-new'),
            createMutationId: vi.fn().mockReturnValue('mutation-1'),
            mutate,
            getHistory,
            getDeletedWorkoutsPage,
            getStrengthDetails,
            previewRestore,
            restore: restoreSchedule,
            deletePlan: deleteTrainingPlan,
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

  function setRouteState(options: {
    mode?: 'browse' | 'create' | 'edit' | 'library-browse' | 'library-create' | 'library-edit';
    scope?: 'plans' | 'standalone';
    workoutId?: string;
    itemId?: string;
    planId?: string;
    date?: string;
  }, emit = false): void {
    route.snapshot.paramMap = convertToParamMap({
      ...(options.workoutId ? { workoutId: options.workoutId } : {}),
      ...(options.itemId ? { itemId: options.itemId } : {}),
      ...(options.planId ? { planId: options.planId } : {}),
    });
    route.snapshot.queryParamMap = convertToParamMap(options.date ? { date: options.date } : {});
    route.snapshot.data = {
      trainingPlansMode: options.mode ?? 'browse',
      trainingPlansScope: options.scope ?? 'plans',
    };
    if (emit) {
      routeParamChanges$.next(route.snapshot.paramMap);
      routeQueryChanges$.next(route.snapshot.queryParamMap);
      routeDataChanges$.next(route.snapshot.data);
    }
  }

  it('places Sync beside the Plans title and removes the Main Calendar header action', async () => {
    TestBed.overrideProvider(TrainingDeliveryService, { useValue: { anyReady: () => false,
      watchPresence: () => of(true), isSetupAvailable: () => false,
      watchSummaryScope: () => of({ settings: [], statuses: [] }) } });
    const fixture = await renderPlans();
    const header: HTMLElement = fixture.nativeElement.querySelector('app-page-header');
    const button = header.querySelector('.qs-page-header__title-row app-training-delivery-button button');
    expect(button?.getAttribute('aria-label')).toBe('Workout sync history');
    expect(button?.textContent?.trim()).toBe('syncSync');
    expect(header.textContent).not.toContain('Main Calendar');
    expect(header.querySelector('.qs-page-header__actions')?.textContent?.trim()).toBe('');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

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

  it('shows compact saved workouts and schedules weekly copies without implicit service consent', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Weekly easy run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 2,
      createdAtMs: 1, updatedAtMs: 2 };
    libraryItems.next([item]);
    libraryPlace.mockResolvedValue({ mutationId: 'mutation-1', workoutIds: ['copy-1', 'copy-2'],
      dates: ['2026-09-09', '2026-09-16'], stateRevision: 3, planRevision: 2 });
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelectorAll('.workout-library app-compact-row')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.plan-scope')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Weekly easy run');
    const component = fixture.componentInstance;
    component.busyAction.set(`library-${item.id}`);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.workout-library .workout-row-actions mat-spinner')).not.toBeNull();
    component.busyAction.set(null);
    component.beginLibraryPlacement(item);
    component.placementStartDate.set('2026-09-09');
    component.placementEndDate.set('2026-09-16');
    component.placementWeekdays.set([3]);
    expect(component.placementDates()).toEqual(['2026-09-09', '2026-09-16']);
    await component.placeLibraryItem();
    expect(libraryPlace).toHaveBeenCalledWith(expect.objectContaining({
      itemId: item.id, expectedTemplateRevision: 2, planId: schedule.state.activePlanId,
      dates: ['2026-09-09', '2026-09-16'], confirmPlanRangeExtension: false,
    }));
    expect(mutate).not.toHaveBeenCalled();
    expect(component.placementItem()).toBeNull();
  });

  it('labels the standalone placement destination and gives saved rows full-width mobile actions', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Long saved workout title',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    libraryItems.next([item]);
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    const row = fixture.nativeElement.querySelector('.workout-library app-compact-row') as HTMLElement;
    expect(row.classList.contains('compact-row-host--mobile-action-full')).toBe(true);

    fixture.componentInstance.beginLibraryPlacement(item);
    fixture.componentInstance.placementPlanId.set(null);
    fixture.detectChanges();
    const destination = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    expect(destination.value).toBe('standalone');
  });

  it('keeps chosen repeat weekdays when the placement range start changes', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    component.beginLibraryPlacement(item);
    component.setPlacementStartDate('2026-09-16');
    expect(component.placementWeekdays()).toEqual([3]);
    component.togglePlacementWeekday(2);
    component.togglePlacementWeekday(4);
    expect(component.placementWeekdays()).toEqual([2, 3, 4]);

    component.setPlacementStartDate('2026-09-14');

    expect(component.placementWeekdays()).toEqual([2, 3, 4]);
    expect(component.placementStartDate()).toBe('2026-09-14');
    expect(component.placementEndDate()).toBe('2026-09-14');

    component.beginLibraryPlacement(item);
    component.setPlacementStartDate('2026-09-15');
    expect(component.placementWeekdays()).toEqual([2]);
  });

  it('does not apply a saved-workout deletion confirmed after sign-out', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    const confirmation = new Subject<boolean>();
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    vi.spyOn(componentDialog, 'open').mockReturnValue({ afterClosed: () => confirmation } as never);

    const deletion = fixture.componentInstance.deleteLibraryItem(item);
    userSignal.set(null);
    userSubject.next(null);
    confirmation.next(true);
    confirmation.complete();
    await deletion;

    expect(libraryMutate).not.toHaveBeenCalled();
    expect(snackBarOpen).not.toHaveBeenCalled();
  });

  it('does not show stale library-action success after sign-out', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    let resolveMutation!: (value: unknown) => void;
    libraryMutate.mockReturnValue(new Promise(resolve => { resolveMutation = resolve; }));

    const copy = fixture.componentInstance.copyLibraryItem(item);
    userSignal.set(null);
    userSubject.next(null);
    resolveMutation({ mutationId: 'mutation-1', item });
    await copy;

    expect(haptics.success).not.toHaveBeenCalled();
    expect(snackBarOpen).not.toHaveBeenCalled();
  });

  it('locks the placement destination while a bulk add is pending', async () => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    let resolvePlacement!: (value: unknown) => void;
    libraryPlace.mockReturnValue(new Promise(resolve => { resolvePlacement = resolve; }));
    fixture.componentInstance.beginLibraryPlacement(item);

    const placement = fixture.componentInstance.placeLibraryItem();
    fixture.detectChanges();
    const destination = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    expect(destination.disabled).toBe(true);
    resolvePlacement({ mutationId: 'mutation-1', workoutIds: ['copy-1'], dates: ['2026-09-09'],
      stateRevision: 5, planRevision: 3 });
    await placement;
    expect(fixture.componentInstance.busyAction()).toBeNull();
  });

  it.each([false, true])('explains library range extension and %s confirmation without an error toast', async confirmed => {
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    libraryItems.next([item]);
    libraryPlace.mockRejectedValueOnce(new Error('Moving this workout requires extending Autumn build to include 2026-10-10.'));
    if (confirmed) libraryPlace.mockResolvedValueOnce({ mutationId: 'mutation-1', workoutIds: ['copy-1', 'copy-2'],
      dates: ['2026-10-03', '2026-10-10'], stateRevision: 5, planRevision: 3 });
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    const componentDialog = (component as unknown as { dialog: MatDialog }).dialog;
    const confirmDialog = vi.spyOn(componentDialog, 'open')
      .mockReturnValue({ afterClosed: () => of(confirmed) } as never);
    component.beginLibraryPlacement(item);
    component.placementStartDate.set('2026-10-03');
    component.placementEndDate.set('2026-10-10');
    component.placementWeekdays.set([6]);
    expect(component.placementError()).toBeNull();
    expect(component.placementDates()).toEqual(['2026-10-03', '2026-10-10']);
    expect(component.placementPlanId()).toBe('active-plan');

    await component.placeLibraryItem();

    expect(libraryPlace).toHaveBeenCalledTimes(confirmed ? 2 : 1);
    expect(confirmDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({ message: 'Adding 2 workouts will extend Autumn build to 2026-09-01–2026-10-10.' }),
    }));
    expect(snackBarOpen).not.toHaveBeenCalledWith(
      expect.stringContaining('requires extending'), expect.anything(), expect.anything(),
    );
    if (!confirmed) expect(snackBarOpen).not.toHaveBeenCalled();
    expect(component.placementItem()).toBe(confirmed ? null : item);
  });

  it('reads saved recipes only while a library route is open', async () => {
    const fixture = await renderPlans();
    expect(libraryWatch).not.toHaveBeenCalled();

    setRouteState({ mode: 'library-browse' }, true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(libraryWatch).toHaveBeenCalledWith(user.uid);
  });

  it('starts placement inside a future active plan instead of suggesting an unwanted extension', async () => {
    const futureYear = new Date().getFullYear() + 1;
    const planStart = `${futureYear}-10-01`;
    schedule = { ...schedule, plans: schedule.plans.map(plan => ({ ...plan,
      startLocalDate: planStart, endLocalDate: `${futureYear + 1}-03-31` })) };
    watchSchedule.mockReturnValue(of(schedule));
    const item: WorkoutLibraryItemV1 = { schemaVersion: 1, id: 'library-1', title: 'Base run',
      structure: schedule.workouts[0].structure, status: 'active', revision: 1,
      createdAtMs: 1, updatedAtMs: 1 };
    setRouteState({ mode: 'library-browse' });
    const fixture = await renderPlans();

    fixture.componentInstance.beginLibraryPlacement(item);

    expect(fixture.componentInstance.placementPlanId()).toBe('active-plan');
    expect(fixture.componentInstance.placementStartDate()).toBe(planStart);
    expect(fixture.componentInstance.placementEndDate()).toBe(planStart);
  });

  it('creates a saved recipe through the existing editor without a date or schedule mutation', async () => {
    libraryMutate.mockResolvedValue({ mutationId: 'mutation-1', item: null });
    setRouteState({ mode: 'library-create' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('.workout-destination')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="date"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.editor-library-copy-action')).toBeNull();
    component.updateEditorField('title', 'Saved aerobic run');
    await component.saveWorkout();
    expect(libraryMutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'create', title: 'Saved aerobic run' }),
    }));
    expect(mutate).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      ['/training/plans/library'], { replaceUrl: true });
  });

  it('offers a visible save-to-library action on a scheduled workout row', async () => {
    libraryMutate.mockResolvedValue({ mutationId: 'mutation-1', item: null });
    const fixture = await renderPlans();
    const row = fixture.nativeElement.querySelector('[data-workout-id="plan-workout"]') as HTMLElement;
    expect(row.classList.contains('compact-row-host--mobile-action-full')).toBe(true);
    const saveButton = [...row.querySelectorAll('.workout-row-actions button')]
      .find(button => button.textContent?.includes('Save to library')) as HTMLButtonElement;
    expect(saveButton).toBeTruthy();

    saveButton.click();
    await fixture.whenStable();

    expect(libraryMutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'save-workout', sourceWorkoutId: 'plan-workout',
        expectedSourceRevision: schedule.workouts[0].revision }),
    }));
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('copies the unsaved editor version to the library without updating the scheduled workout', async () => {
    libraryMutate.mockResolvedValue({ mutationId: 'mutation-1', item: null });
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    const notice = vi.spyOn((component as unknown as { snackBar: MatSnackBar }).snackBar, 'open');
    component.updateEditorField('title', 'Edited library version');
    component.updateStep(0, null, 'endingValue', 45);
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('.editor-library-copy-action') as HTMLButtonElement;
    expect(saveButton).toBeTruthy();
    saveButton.click();
    await fixture.whenStable();

    expect(libraryMutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'create', title: 'Edited library version',
        structure: expect.objectContaining({ nodes: [expect.objectContaining({
          ending: { kind: 'time', seconds: 45 * 60 },
        })] }),
      }),
    }));
    expect(mutate).not.toHaveBeenCalled();
    expect(component.editor()?.value.title).toBe('Edited library version');
    expect(component.busyAction()).toBeNull();
    expect(haptics.success).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith(
      'Copy saved to Workout library. Your calendar workout is unchanged.', 'Dismiss', { duration: 5000 });
  });

  it('does not show editor-copy success after sign-out', async () => {
    let resolveMutation!: (value: unknown) => void;
    libraryMutate.mockReturnValue(new Promise(resolve => { resolveMutation = resolve; }));
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    const notice = vi.spyOn((component as unknown as { snackBar: MatSnackBar }).snackBar, 'open');

    const copy = component.saveEditorCopyToLibrary();
    userSignal.set(null);
    userSubject.next(null);
    resolveMutation({ mutationId: 'mutation-1', item: null });
    await copy;

    expect(haptics.success).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('returns from a library editor through its recorded browse entry', async () => {
    setRouteState({ mode: 'library-create' });
    const fixture = await renderPlans();
    const location = TestBed.inject(Location);
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    vi.spyOn(location, 'getState').mockReturnValue({
      trainingPlansEditorReturn: { uid: user.uid, url: '/training/plans/library' },
    });

    fixture.componentInstance.cancelEditor();

    expect(back).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalledWith(
      ['/training/plans/library'], expect.anything());
  });

  it('replaces a direct library editor link on Cancel instead of reopening it on Back', async () => {
    setRouteState({ mode: 'library-create' });
    const fixture = await renderPlans();
    const location = TestBed.inject(Location);
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    vi.spyOn(location, 'getState').mockReturnValue({});

    fixture.componentInstance.cancelEditor();

    expect(back).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      ['/training/plans/library'], { replaceUrl: true });
  });

  it('pauses the plan workspace while a staged restore hides workout roots', async () => {
    watchSchedule.mockReturnValue(of({ ...schedule, restoreUnavailable: true }));
    const fixture = await renderPlans();
    expect(fixture.nativeElement.textContent).toContain('Restoring your training plan…');
    expect(fixture.nativeElement.querySelector('.workout-list')).toBeNull();
    expect(fixture.componentInstance.scheduleState().status).toBe('loading');
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

  it('shows a compact activity link without changing the authored workout or recorded totals', async () => {
    watchWorkoutCompletions.mockReturnValue(of([{
      schemaVersion: 1,
      workoutId: schedule.workouts[0].id,
      planId: schedule.workouts[0].planId,
      provider: 'suunto',
      matchMethod: 'provider_marker',
      eventId: 'event-1',
      activityId: 'activity-1',
      sourceSessionIndex: 0,
      activityStartAtMs: Date.parse('2026-09-09T08:00:00Z'),
      scheduledLocalDate: schedule.workouts[0].localDate,
      workoutRevisionAtLink: schedule.workouts[0].revision,
      timing: 'late',
      linkedAtMs: 1,
      updatedAtMs: 1,
    }]));
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelector('.workout-completion-state > span')?.textContent.replace(/\s+/g, ' ').trim())
      .toBe('Completed · activity linked · late');
    expect(schedule.workouts[0].lifecycle).toBe('planned');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('reacts to the account week-start setting without moving the selected date or writing the schedule', async () => {
    const currentUser = signal({ ...user, settings: { unitSettings: { startOfTheWeek: 0 } } });
    TestBed.overrideProvider(AppUserService, { useValue: { user: currentUser, user$: of(user) } });
    const fixture = await renderPlans();
    expect(fixture.nativeElement.querySelector('.calendar-weekday--week-start')?.textContent).toBe('Sun');
    expect(fixture.nativeElement.querySelector('.calendar-hint')?.textContent).toContain('Weeks start on Sunday.');
    currentUser.set({ ...user, settings: { unitSettings: { startOfTheWeek: 6 } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.calendar-weekday--week-start')?.textContent).toBe('Sat');
    expect(fixture.nativeElement.querySelector('.calendar-hint')?.textContent).toContain('Weeks start on Saturday.');
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-09');
    expect(fixture.nativeElement.querySelector('[aria-pressed="true"]')?.getAttribute('data-plan-date')).toBe('2026-09-09');
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
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

  it('selects the confirmed destination day after duplicating beyond the plan range', async () => {
    const updatedPlan = { ...schedule.plans[0], endLocalDate: '2026-10-05', revision: 3 };
    const duplicate = vi.fn().mockResolvedValue({ kind: 'duplicated-workout', workoutId: 'new-copy',
      planId: 'active-plan', localDate: '2026-10-05', acknowledgedPlan: updatedPlan,
      acknowledgedState: { ...schedule.state, revision: 5 } });
    TestBed.overrideProvider(TrainingWorkoutDuplicateService, { useValue: { duplicate } });
    const fixture = await renderPlans();
    await fixture.componentInstance.duplicateWorkout(schedule.workouts[0]);
    fixture.detectChanges();
    expect(duplicate).toHaveBeenCalledWith(user.uid, expect.objectContaining({ id: 'plan-workout' }), expect.any(Function));
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-10-05');
    expect(fixture.componentInstance.selectedPlan()?.endLocalDate).toBe('2026-10-05');
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/training/plans/plan', 'active-plan'],
      expect.objectContaining({ queryParams: { date: '2026-10-05' } }));
  });

  it('keeps a duplicated standalone workout in Standalone', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    const duplicate = vi.fn().mockResolvedValue({ kind: 'duplicated-workout', workoutId: 'new-copy',
      planId: null, localDate: '2026-09-15' });
    TestBed.overrideProvider(TrainingWorkoutDuplicateService, { useValue: { duplicate } });
    const fixture = await renderPlans();
    fixture.componentInstance.selectView('standalone');
    await fixture.componentInstance.duplicateWorkout(schedule.workouts.find(workout => workout.planId === null)!);
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe('standalone');
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/training/plans/standalone'],
      expect.objectContaining({ queryParams: undefined }));
    const copy = { ...schedule.workouts.find(workout => workout.planId === null)!, id: 'new-copy',
      localDate: '2026-09-15', revision: 1 };
    live.next({ ...schedule, workouts: [...schedule.workouts, copy] });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const focusedRow = fixture.nativeElement.querySelector('[data-workout-id="new-copy"]') as HTMLElement;
    expect(focusedRow).toBeTruthy();
    expect(document.activeElement).toBe(focusedRow);
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
    expect(fixture.componentInstance.nowMs()).toBe(new Date(2026, 8, 10, 0, 0, 30).getTime());
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

  it.each([
    { preference: {}, label: 'Kilometres', meters: 1000, pace: 'min/km' },
    { preference: { distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile] },
      label: 'Miles', meters: 1609.344, pace: 'min/mi' },
  ])('uses $label and $pace in the editor and saves canonical values', async ({ preference, label, meters, pace }) => {
    const unitUser = { ...user, settings: { unitSettings: normalizeUserUnitSettings(preference) } };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(unitUser), user$: of(unitUser) } });
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('title', 'Distance test');
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'distance');
    fixture.componentInstance.updateStep(0, null, 'endingValue', 1);
    fixture.componentInstance.updateStep(0, null, 'targetKind', 'pace');
    fixture.componentInstance.updateStep(0, null, 'targetMinimum', 4);
    fixture.componentInstance.updateStep(0, null, 'targetMaximum', 5);
    fixture.detectChanges();
    expect(fixture.componentInstance.editorDistanceUnit()).toBe(label);
    expect(fixture.componentInstance.editorPaceUnit()).toBe(pace);
    expect(fixture.nativeElement.querySelector('.step-fields')?.textContent).toContain(label);
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({
        structure: expect.objectContaining({ nodes: [expect.objectContaining({
          ending: { kind: 'distance', meters },
          targets: [expect.objectContaining({
            minimumMetersPerSecond: meters / 300,
            maximumMetersPerSecond: meters / 240,
          })],
        })] }),
      }),
    }));
  });

  it('keeps an existing workout in its opening units and preserves metres on an unrelated edit', async () => {
    const unitUser = signal({ ...user, settings: {
      unitSettings: normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }),
    } });
    TestBed.overrideProvider(AppUserService, { useValue: { user: unitUser, user$: of(unitUser()) } });
    schedule.workouts[0].structure = {
      version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'kilometer', purpose: 'work',
        ending: { kind: 'distance', meters: 1000 }, targets: [] }],
    };
    const fixture = await renderPlans();
    fixture.componentInstance.editWorkout(schedule.workouts[0]);
    expect(fixture.componentInstance.editorDistanceUnit()).toBe('Miles');
    expect(fixture.componentInstance.editor()?.value.nodes[0]).toMatchObject({ endingValue: 0.621371 });
    unitUser.set({ ...unitUser(), settings: { unitSettings: normalizeUserUnitSettings({}) } });
    fixture.detectChanges();
    expect(fixture.componentInstance.editorDistanceUnit()).toBe('Miles');
    fixture.componentInstance.updateEditorField('title', 'Updated title');
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'update-workout',
        structure: expect.objectContaining({ nodes: [expect.objectContaining({
          ending: { kind: 'distance', meters: 1000 },
        })] }),
      }),
    }));

    unitUser.set({ ...unitUser(), settings: {
      unitSettings: normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }),
    } });
    fixture.componentInstance.editWorkout(schedule.workouts[0]);
    fixture.componentInstance.updateStep(0, null, 'endingValue', 1);
    fixture.componentInstance.updateStep(0, null, 'endingValue', 0.621371);
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'update-workout',
        structure: expect.objectContaining({ nodes: [expect.objectContaining({
          ending: { kind: 'distance', meters: 0.621371 * 1609.344 },
        })] }),
      }),
    }));
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

  it('opens saved workouts at a path URL without putting IDs in query parameters', async () => {
    const fixture = await renderPlans();
    const router = TestBed.inject(Router);
    const navigate = vi.mocked(router.navigate);
    navigate.mockClear();

    fixture.componentInstance.editWorkout(schedule.workouts[0]);

    expect(navigate).toHaveBeenCalledWith(
      ['/training/plans/workout', 'plan-workout'],
      expect.objectContaining({ queryParams: undefined, replaceUrl: undefined }),
    );
    expect(navigate.mock.calls[0]?.[1]?.state).toMatchObject({
      trainingPlansEditorReturn: { uid: user.uid },
    });
  });

  it('restores browse and edit screens through route history without live refreshes replacing the draft', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    setRouteState({ planId: 'active-plan', date: '2026-09-09' });
    const fixture = await renderPlans();

    setRouteState({ mode: 'edit', workoutId: 'plan-workout' }, true);
    fixture.detectChanges();
    fixture.componentInstance.updateEditorField('title', 'Unsaved title');
    live.next({ ...schedule, state: { ...schedule.state, updatedAtMs: 2 } });
    fixture.detectChanges();
    expect(fixture.componentInstance.editor()?.value.title).toBe('Unsaved title');

    setRouteState({ planId: 'active-plan', date: '2026-09-09' }, true);
    fixture.detectChanges();
    expect(fixture.componentInstance.editor()).toBeNull();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-09');

    setRouteState({ mode: 'edit', workoutId: 'plan-workout' }, true);
    fixture.detectChanges();
    expect(fixture.componentInstance.editor()).toMatchObject({
      mode: 'edit',
      original: { id: 'plan-workout' },
      value: { title: 'Plan run' },
    });
  });

  it('uses the recorded Plans history entry for Cancel and never guesses Back for a direct link', async () => {
    const fixture = await renderPlans();
    const location = TestBed.inject(Location);
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    vi.spyOn(location, 'getState').mockReturnValue({
      trainingPlansEditorReturn: {
        uid: user.uid,
        url: '/training/plans/plan/active-plan?date=2026-09-09',
      },
    });
    fixture.componentInstance.editWorkout(schedule.workouts[0]);

    fixture.componentInstance.cancelEditor();

    expect(back).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.editor()).toBeNull();
  });

  it('replaces an unavailable workout path with the owner-safe active plan route', async () => {
    const fixture = await renderPlans();
    const component = fixture.componentInstance as unknown as {
      applyRoute(requested: {
        mode: 'edit'; workoutId: string; planId: null; standalone: false; localDate: null;
      }): void;
      snackBar: MatSnackBar;
    };
    const notice = vi.spyOn(component.snackBar, 'open');

    component.applyRoute({
      mode: 'edit', workoutId: 'missing-workout', planId: null, standalone: false, localDate: null,
    });

    expect(fixture.componentInstance.editor()).toBeNull();
    expect(notice).toHaveBeenCalledWith(
      'That planned workout is no longer available.',
      'Dismiss',
      { duration: 5000 },
    );
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      ['/training/plans/plan', 'active-plan'],
      expect.objectContaining({ replaceUrl: true }),
    );
  });

  it('replaces a plan path when a live refresh removes that plan', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    setRouteState({ planId: 'active-plan', date: '2026-09-09' });
    const fixture = await renderPlans();
    const navigate = vi.mocked(TestBed.inject(Router).navigate);
    const componentSnackBar = (fixture.componentInstance as unknown as { snackBar: MatSnackBar }).snackBar;
    const unavailableNotice = vi.spyOn(componentSnackBar, 'open');
    navigate.mockClear();

    live.next({
      // The independent plan listener may arrive before the state document clears activePlanId.
      state: schedule.state,
      plans: [],
      workouts: schedule.workouts.filter(workout => workout.planId === null),
    });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(
      ['/training/plans'],
      expect.objectContaining({ replaceUrl: true }),
    );
    expect(unavailableNotice).toHaveBeenCalledWith(
      'That training plan is no longer available.',
      'Dismiss',
      { duration: 5000 },
    );
  });

  it('keeps plan IDs in browse and create paths while using the query string only for a date', async () => {
    schedule.plans.push({ ...schedule.plans[0], id: 'paused-plan', lifecycle: 'paused' });
    const fixture = await renderPlans();
    const navigate = vi.mocked(TestBed.inject(Router).navigate);
    navigate.mockClear();

    fixture.componentInstance.selectPlan('paused-plan');
    expect(navigate).toHaveBeenLastCalledWith(
      ['/training/plans/plan', 'paused-plan'],
      expect.objectContaining({ queryParams: { date: '2026-09-09' } }),
    );

    navigate.mockClear();
    fixture.componentInstance.openNewWorkout('paused-plan', '2026-09-10');
    expect(navigate).toHaveBeenLastCalledWith(
      ['/training/plans/plan', 'paused-plan', 'new'],
      expect.objectContaining({ queryParams: { date: '2026-09-10' } }),
    );
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

  it('offers named colors on creation, retains a failed draft, and saves only the selected palette key', async () => {
    const fixture = await renderPlans();
    fixture.componentInstance.beginPlanCreation();
    fixture.detectChanges();
    const select = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    expect(select.options.map(option => option.value)).toEqual(TRAINING_PLAN_COLOR_OPTIONS.map(option => option.id));
    expect(select.value).toBe('default');
    const colorField = fixture.debugElement.queryAll(By.directive(MatFormField))
      .find(field => field.nativeElement.textContent.includes('Plan color'))!;
    expect((colorField.componentInstance as MatFormField).subscriptSizing).toBe('dynamic');
    fixture.componentInstance.updatePlanDraft('name', 'Purple build');
    fixture.componentInstance.updatePlanDraft('color', 'purple');
    fixture.componentInstance.updatePlanDraft('color', 'purple');
    expect(haptics.selection).toHaveBeenCalledOnce();
    mutate.mockRejectedValueOnce(new Error('Offline'));
    await fixture.componentInstance.createPlan();
    expect(fixture.componentInstance.planDraft().color).toBe('purple');
    expect(fixture.componentInstance.showPlanForm()).toBe(true);
    expect(haptics.error).toHaveBeenCalledOnce();
    await fixture.componentInstance.createPlan();
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ operation: expect.objectContaining({ kind: 'create-plan', color: 'purple' }) }));
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('revision-checks color changes, disables pending controls, and recolors from the live plan', async () => {
    const live = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(live);
    let resolveMutation!: (value: unknown) => void;
    mutate.mockImplementationOnce(() => new Promise(resolve => { resolveMutation = resolve; }));
    const fixture = await renderPlans();
    const plan = fixture.componentInstance.selectedPlan()!;
    await fixture.componentInstance.setPlanColor(plan, 'default');
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    const pending = fixture.componentInstance.setPlanColor(plan, 'purple');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedPlanActionBusy()).toBe(true);
    expect(fixture.nativeElement.querySelector('[aria-label="Updating plan"] mat-spinner')).toBeTruthy();
    expect((fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect).disabled).toBe(true);
    await fixture.componentInstance.setPlanColor(plan, 'green');
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisions: expect.arrayContaining([{ scope: 'plan', id: plan.id, revision: plan.revision }]),
      operation: { kind: 'set-plan-color', planId: plan.id, color: 'purple' },
    }));
    expect(haptics.success).not.toHaveBeenCalled();
    resolveMutation({ plans: [{ ...plan, color: 'purple' }] });
    await pending;
    live.next({ ...schedule, plans: [{ ...plan, color: 'purple', revision: plan.revision + 1 }] });
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedPlanAppearance()).toEqual(trainingPlanAppearance({ color: 'purple' }));
    expect((fixture.nativeElement.querySelector('.plan-calendar') as HTMLElement).style.getPropertyValue('--plan-calendar-color'))
      .toBe(trainingPlanAppearance({ color: 'purple' }).color);
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-09');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('keeps the color submenu backdrop off so sibling plan actions remain pointer-interactive', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/plans/plans-workspace.component.html'),
      'utf8',
    );

    expect(template).toMatch(/<mat-menu #planColorMenu="matMenu"[^>]*\[hasBackdrop\]="false"/);
  });

  it('keeps the saved plan color when changing it fails', async () => {
    schedule.plans[0].color = 'purple';
    mutate.mockRejectedValueOnce(new Error('Changed elsewhere'));
    const fixture = await renderPlans();
    await fixture.componentInstance.setPlanColor(fixture.componentInstance.selectedPlan()!, 'green');
    expect(fixture.componentInstance.selectedPlanAppearance().id).toBe('purple');
    expect(fixture.componentInstance.busyAction()).toBeNull();
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
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

  it('offers exact running, cycling, swimming, walking, hiking, and rowing profiles in sport groups', async () => {
    const fixture = await renderPlans();
    expect(fixture.componentInstance.sportOptionGroups).toEqual([
      {
        label: 'Running',
        options: [
          { value: ActivityTypes.Running, label: 'Running' },
          { value: ActivityTypes.TrailRunning, label: 'Trail Running' },
          { value: ActivityTypes.Treadmill, label: 'Treadmill' },
        ],
      },
      {
        label: 'Cycling',
        options: [
          { value: ActivityTypes.Cycling, label: 'Cycling' },
          { value: ActivityTypes.MountainBiking, label: 'Mountain Biking' },
          { value: ActivityTypes.IndoorCycling, label: 'Indoor Cycling' },
          { value: ActivityTypes.EBiking, label: 'E-Biking' },
          { value: ActivityTypes.Handcycle, label: 'Hand Cycle' },
        ],
      },
      {
        label: 'Swimming',
        options: [
          { value: ActivityTypes.Swimming, label: 'Pool swimming' },
          { value: ActivityTypes.OpenWaterSwimming, label: 'Open-water swimming' },
        ],
      },
      {
        label: 'Walking & hiking',
        options: [
          { value: ActivityTypes.Walking, label: 'Walking' },
          { value: ActivityTypes.Hiking, label: 'Hiking' },
        ],
      },
      {
        label: 'Rowing',
        options: [
          { value: ActivityTypes.Rowing, label: 'Rowing' },
          { value: ActivityTypes.IndoorRowing, label: 'Indoor Rowing' },
        ],
      },
      { label: 'Strength', options: [{ value: ActivityTypes.StrengthTraining, label: 'Strength Training' }] },
    ]);
  });

  it.each(['plans', 'standalone'] as const)('creates a lap-ended workout in %s through the Material selector', async scope => {
    setRouteState({ mode: 'create', scope, date: '2026-09-09' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    component.updateEditorField('title', 'Warm up until ready');
    component.updateStep(0, null, 'purpose', 'warmup');
    haptics.selection.mockClear();
    const endingSelect = fixture.debugElement.queryAll(By.directive(MatSelect))
      .find(element => element.componentInstance.value === 'time')!;
    endingSelect.componentInstance.open();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(endingSelect.componentInstance.options.map((option: { value: string }) => option.value))
      .toEqual(['time', 'distance', 'manual']);
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find(option => option.textContent?.includes('Lap button press'))!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.editor()?.value.nodes[0]).toMatchObject({ purpose: 'warmup', endingKind: 'manual' });
    expect(fixture.nativeElement.querySelector('.step-fields input[type="number"]')).toBeNull();
    const hint: HTMLElement = fixture.nativeElement.querySelector('.step-fields mat-hint');
    expect(hint.textContent).toContain('without a time or distance limit');
    expect(hint.textContent).toContain('Wahoo delivery is unsupported');
    expect(endingSelect.nativeElement.getAttribute('aria-describedby')?.split(' ')).toContain(hint.id);
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.updateStep(0, null, 'endingKind', 'manual');
    expect(haptics.selection).toHaveBeenCalledOnce();
    const stepId = component.editor()!.value.nodes[0].id;
    await component.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'create-workout', planId: scope === 'plans' ? 'active-plan' : null,
        structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: stepId,
          purpose: 'warmup', ending: { kind: 'manual' }, targets: [] }] } }),
    }));
  });

  it('reopens lap-ended steps with targets and restores numeric inputs when switching endings', async () => {
    schedule.workouts[0].structure = { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'step', id: 'lap-warmup', purpose: 'warmup', ending: { kind: 'manual' },
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 }],
        note: 'Press lap when ready' }] };
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.step-fields input[type="number"]')).toHaveLength(2);
    for (const endingKind of ['time', 'distance'] as const) {
      component.updateStep(0, null, 'endingKind', endingKind);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.step-fields input[type="number"]')).toHaveLength(3);
      expect(fixture.nativeElement.querySelector('.step-fields mat-hint')).toBeNull();
    }
    component.updateStep(0, null, 'endingKind', 'manual');
    component.updateEditorField('title', 'Edited lap warmup');
    await component.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'update-workout', workoutId: 'plan-workout',
        structure: schedule.workouts[0].structure }),
    }));
  });

  it('keeps lap endings when copying an edited scheduled recipe to the library', async () => {
    libraryMutate.mockResolvedValue({ mutationId: 'mutation-1', item: null });
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'manual');
    await fixture.componentInstance.saveEditorCopyToLibrary();
    expect(libraryMutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'create', structure: expect.objectContaining({
        nodes: [expect.objectContaining({ id: 'steady', ending: { kind: 'manual' } })],
      }) }),
    }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    [false, ActivityTypes.Running], [true, ActivityTypes.Running],
    [false, ActivityTypes.Swimming], [true, ActivityTypes.Swimming],
  ] as const)('preserves exact distance through lap toggles for repeat=%s and sport=%s', async (repeat, sport) => {
    const imperialUser = { ...user, settings: { unitSettings: { distanceUnits: DistanceUnits.Miles } } };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(imperialUser), user$: of(imperialUser) } });
    const step = { kind: 'step' as const, id: 'distance', purpose: 'work' as const,
      ending: { kind: 'distance' as const, meters: 1000 }, targets: [] };
    schedule.workouts[0].structure = { version: 1, sport: ActivityTypes.Running,
      nodes: repeat ? [{ kind: 'repeat', id: 'repeats', count: 2, steps: [step] }] : [step] };
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    component.updateStep(0, repeat ? 0 : null, 'endingKind', 'manual');
    component.updateEditorField('sport', sport);
    component.updateStep(0, repeat ? 0 : null, 'endingKind', 'distance');
    await component.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'update-workout',
        structure: { ...schedule.workouts[0].structure, sport } }),
    }));
  });

  it.each([
    [false, 'edit'], [true, 'edit'], [false, 'time'], [true, 'time'],
  ] as const)('discards a previous distance after %s repeat / %s changes', async (repeat, change) => {
    const imperialUser = { ...user, settings: { unitSettings: { distanceUnits: DistanceUnits.Miles } } };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(imperialUser), user$: of(imperialUser) } });
    const step = { kind: 'step' as const, id: 'distance', purpose: 'work' as const,
      ending: { kind: 'distance' as const, meters: 1000 }, targets: [] };
    schedule.workouts[0].structure = { version: 1, sport: ActivityTypes.Running,
      nodes: repeat ? [{ kind: 'repeat', id: 'repeats', count: 2, steps: [step] }] : [step] };
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    const child = repeat ? 0 : null;
    component.updateStep(0, child, 'endingKind', 'manual');
    component.updateStep(0, child, 'endingKind', change === 'time' ? 'time' : 'distance');
    component.updateStep(0, child, 'endingValue', 1);
    component.updateStep(0, child, 'endingKind', 'distance');
    await component.saveWorkout();
    const savedStep = { ...step, ending: { kind: 'distance', meters: 1609.344 } };
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ structure: { version: 1, sport: ActivityTypes.Running,
        nodes: repeat ? [{ kind: 'repeat', id: 'repeats', count: 2, steps: [savedStep] }] : [savedStep] } }),
    }));
  });

  it('creates a library recipe with lap-ended repeat children through the shared step controls', async () => {
    libraryMutate.mockResolvedValue({ mutationId: 'mutation-1', item: null });
    setRouteState({ mode: 'library-create' });
    const fixture = await renderPlans();
    const component = fixture.componentInstance;
    component.updateEditorField('title', 'Lap repeats');
    component.addEditorRepeat();
    component.updateStep(1, 1, 'endingKind', 'manual');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.step-fields mat-hint')).toHaveLength(1);
    expect(component.editor()?.value.nodes[1]).toMatchObject({ kind: 'repeat', steps: [
      expect.objectContaining({ endingKind: 'time' }), expect.objectContaining({ endingKind: 'manual' }),
    ] });
    await component.saveWorkout();
    expect(libraryMutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'create', structure: expect.objectContaining({ nodes: [
        expect.objectContaining({ ending: { kind: 'time', seconds: 600 } }),
        expect.objectContaining({ kind: 'repeat', steps: [
          expect.objectContaining({ ending: { kind: 'time', seconds: 600 } }),
          expect.objectContaining({ purpose: 'recovery', ending: { kind: 'manual' } }),
        ] }),
      ] }) }),
    }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('creates an exercise-aware strength workout with reps, hold, load and rest', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    const editor = fixture.componentInstance;
    editor.updateEditorField('sport', ActivityTypes.StrengthTraining);
    editor.updateEditorField('title', 'Gym session');
    editor.updateStrengthExerciseName(0, 'Squat');
    editor.updateStrengthSet(0, 0, 'value', 5);
    editor.updateStrengthSet(0, 0, 'externalLoadKg', 80);
    editor.updateStrengthSet(0, 0, 'restAfterSeconds', 120);
    editor.addStrengthSet(0);
    editor.updateStrengthSet(0, 1, 'kind', 'time');
    editor.updateStrengthSet(0, 1, 'value', 30);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Exercises and sets');
    expect(fixture.nativeElement.textContent).toContain('External load (kg, optional)');
    await editor.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({
      kind: 'create-workout', strength: expect.objectContaining({ exercises: [expect.objectContaining({
        name: 'Squat', sets: [expect.objectContaining({ externalLoadKg: 80, restAfterSeconds: 120 }),
          expect.objectContaining({ ending: { kind: 'time', seconds: 30 } })],
      })] }), structure: expect.objectContaining({ sport: ActivityTypes.StrengthTraining }),
    }) }));
  });

  it('loads a strength companion before editing and rejects a missing companion', async () => {
    const strength = { version: 1 as const, workoutId: 'standalone-workout', revision: 1,
      exercises: [{ id: 'squat', name: 'Squat', sets: [{ id: 'set-one',
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 }] }] };
    schedule = { ...populatedSchedule(), workouts: populatedSchedule().workouts.map(workout => workout.id === 'standalone-workout'
      ? { ...workout, structure: projectStrengthWorkoutToV1(strength) } : workout) };
    getStrengthDetails.mockResolvedValue(strength);
    setRouteState({ mode: 'edit', workoutId: 'standalone-workout' });
    const fixture = await renderPlans();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.editor()?.strength?.exercises[0].sets[0].externalLoadKg).toBe(80);
    expect(getStrengthDetails).toHaveBeenCalledWith('planning-user', 'standalone-workout');
  });

  it('uses the opening weight unit for strength input and preserves unchanged canonical kilograms', async () => {
    const unitUser = signal({ ...user, settings: {
      unitSettings: normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds }),
    } });
    TestBed.overrideProvider(AppUserService, { useValue: { user: unitUser, user$: of(unitUser()) } });
    const strength = { version: 1 as const, workoutId: 'standalone-workout', revision: 1,
      exercises: [{ id: 'squat', name: 'Squat', sets: [{ id: 'set-one',
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 }] }] };
    schedule = { ...populatedSchedule(), workouts: populatedSchedule().workouts.map(workout => workout.id === 'standalone-workout'
      ? { ...workout, structure: projectStrengthWorkoutToV1(strength) } : workout) };
    getStrengthDetails.mockResolvedValue(strength);
    setRouteState({ mode: 'edit', workoutId: 'standalone-workout' });
    const fixture = await renderPlans();
    await fixture.whenStable();
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    expect(editor.editorWeightUnit()).toBe('lb');
    expect(fixture.nativeElement.textContent).toContain('External load (lb, optional)');
    expect(editor.strengthLoadInputValue(80)).toBe(176.4);
    unitUser.set({ ...unitUser(), settings: { unitSettings: normalizeUserUnitSettings({}) } });
    editor.updateEditorField('title', 'Edited strength');
    await editor.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({
      strength: expect.objectContaining({ exercises: [expect.objectContaining({ sets: [
        expect.objectContaining({ externalLoadKg: 80 }),
      ] })] }),
    }) }));

  });

  it('converts a new strength load from pounds to canonical kilograms', async () => {
    const unitUser = { ...user, settings: {
      unitSettings: normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds }),
    } };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(unitUser), user$: of(unitUser) } });
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    const editor = fixture.componentInstance;
    editor.updateEditorField('sport', ActivityTypes.StrengthTraining);
    editor.updateStrengthSet(0, 0, 'externalLoadKg', 100);
    expect(editor.editor()?.strength?.exercises[0].sets[0].externalLoadKg).toBeCloseTo(45.359237, 6);
    expect(editor.strengthLoadInputValue(editor.editor()?.strength?.exercises[0].sets[0].externalLoadKg)).toBe(100);
  });

  it('edits pool-swim distance in metres and shows the swim-pace unit', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.Swimming);
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'distance');
    fixture.componentInstance.updateStep(0, null, 'endingValue', 100);
    fixture.detectChanges();
    expect(fixture.componentInstance.editorIsSwimming()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Metres');
    expect(fixture.componentInstance.editorPaceUnit()).toBe('min/100m');
    fixture.componentInstance.updateEditorField('title', 'Pool test');
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({
        structure: expect.objectContaining({
          sport: ActivityTypes.Swimming,
          nodes: expect.arrayContaining([expect.objectContaining({ ending: { kind: 'distance', meters: 100 } })]),
        }),
      }),
    }));
  });

  it('labels rowing distance in metres and target pace per 500 m', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.Rowing);
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'distance');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Metres');
    expect(fixture.componentInstance.editorPaceUnit()).toBe('min/500m');
  });

  it('saves a selected 25 m pool length separately from the swim step distance', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.Swimming);
    fixture.componentInstance.updateEditorField('poolLengthValue', 25);
    fixture.componentInstance.updateEditorField('poolLengthUnit', 'meters');
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'distance');
    fixture.componentInstance.updateStep(0, null, 'endingValue', 25);
    fixture.componentInstance.updateEditorField('title', '25 m pool test');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Pool length (optional)');
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({
        structure: expect.objectContaining({
          sport: ActivityTypes.Swimming,
          poolLength: { meters: 25, presentation: 'meters' },
          nodes: expect.arrayContaining([expect.objectContaining({ ending: { kind: 'distance', meters: 25 } })]),
        }),
      }),
    }));
  });

  it('edits open-water distance in metres and persists the distinct sport', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-24' });
    const fixture = await renderPlans();
    fixture.componentInstance.updateEditorField('sport', ActivityTypes.OpenWaterSwimming);
    fixture.componentInstance.updateStep(0, null, 'endingKind', 'distance');
    fixture.componentInstance.updateStep(0, null, 'endingValue', 500);
    fixture.componentInstance.updateEditorField('title', 'Open-water test');
    fixture.detectChanges();
    expect(fixture.componentInstance.editorIsSwimming()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Metres');
    expect(fixture.componentInstance.editorPaceUnit()).toBe('min/100m');
    await fixture.componentInstance.saveWorkout();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({
        structure: expect.objectContaining({
          sport: ActivityTypes.OpenWaterSwimming,
          nodes: expect.arrayContaining([expect.objectContaining({ ending: { kind: 'distance', meters: 500 } })]),
        }),
      }),
    }));
  });

  it('defaults a calendar add request to the active plan', async () => {
    setRouteState({ mode: 'create', date: '2026-09-10' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()).toMatchObject({
      mode: 'create',
      destinationPlanId: 'active-plan',
      value: { localDate: '2026-09-10' },
    });
  });

  it('honors the prominent standalone calendar add path even with an active plan', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-10' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()?.destinationPlanId).toBeNull();
    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-10');
  });

  it('defaults calendar adds to standalone when there is no active plan', async () => {
    schedule = { ...populatedSchedule(), state: { ...populatedSchedule().state, activePlanId: null } };
    setRouteState({ mode: 'create', date: '2026-09-10' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.editor()?.destinationPlanId).toBeNull();
  });

  it('opens a linked standalone workout in the editor without requiring a plan', async () => {
    setRouteState({ mode: 'edit', workoutId: 'standalone-workout' });
    const fixture = await renderPlans();

    expect(fixture.componentInstance.view()).toBe('standalone');
    expect(fixture.componentInstance.editor()).toMatchObject({
      mode: 'edit',
      destinationPlanId: null,
      original: { id: 'standalone-workout' },
    });
  });

  it('uses the localized Material date picker while preserving the canonical workout date', async () => {
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const dateInput = fixture.debugElement.query(By.directive(MatDatepickerInput))
      .injector.get(MatDatepickerInput);

    expect(fixture.nativeElement.querySelector('.workout-editor input[type="date"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.workout-editor mat-datepicker-toggle')).toBeTruthy();
    expect((dateInput.value as { format(pattern: string): string }).format('YYYY-MM-DD')).toBe('2026-09-09');

    fixture.componentInstance.updateWorkoutDate(dayjs('2027-01-03'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2027-01-03');
    expect((dateInput.value as { format(pattern: string): string }).format('YYYY-MM-DD')).toBe('2027-01-03');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('commits a typed date before an immediate save, without requiring blur', async () => {
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    fixture.debugElement.query(By.directive(MatDatepickerInput))
      .triggerEventHandler('dateInput', { value: dayjs('2026-09-10') });

    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-10');
    await fixture.componentInstance.saveWorkout();

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'update-workout', localDate: '2026-09-10' }),
    }));
  });

  it('blocks saving a partially typed date instead of retaining the previous date', async () => {
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    const snackBar = (fixture.componentInstance as unknown as { snackBar: MatSnackBar }).snackBar;
    const invalidDateNotice = vi.spyOn(snackBar, 'open');
    fixture.debugElement.query(By.directive(MatDatepickerInput))
      .triggerEventHandler('dateInput', { value: null });
    fixture.detectChanges();

    expect(fixture.componentInstance.editor()?.value.localDate).toBe('2026-09-09');
    expect(fixture.nativeElement.querySelector('.editor-save-actions button:last-child').disabled).toBe(true);
    await fixture.componentInstance.saveWorkout();

    expect(mutate).not.toHaveBeenCalled();
    expect(invalidDateNotice).toHaveBeenCalledWith('Choose a valid workout date.', 'Dismiss', { duration: 7000 });
    expect(haptics.error).toHaveBeenCalledOnce();
  });

  it('does not silently retain the previous workout date after an invalid date-picker value', async () => {
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();

    fixture.componentInstance.updateWorkoutDate(null);
    await fixture.componentInstance.saveWorkout();

    expect(fixture.componentInstance.editor()?.value.localDate).toBe('');
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledOnce();
  });

  it('returns to the linked workout date when cancelling the calendar-originated editor', async () => {
    schedule.workouts[0].localDate = '2026-09-20';
    setRouteState({ mode: 'edit', workoutId: 'plan-workout' });
    const fixture = await renderPlans();
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-20');
    expect(fixture.componentInstance.displayedWorkoutRows().map(row => row.workout.id)).toEqual(['plan-workout']);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns to the calendar add scope and date after cancellation (standalone: %s)', async standalone => {
    setRouteState({ mode: 'create', scope: standalone ? 'standalone' : 'plans', date: '2026-09-20' });
    const fixture = await renderPlans();
    fixture.componentInstance.cancelEditor();
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe(standalone ? 'standalone' : 'plans');
    if (!standalone) expect(fixture.componentInstance.planScheduleDate()).toBe('2026-09-20');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('creates a standalone workout through the same revisioned mutation path', async () => {
    setRouteState({ mode: 'create', scope: 'standalone', date: '2026-09-10' });
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
    setRouteState({ mode: 'edit', workoutId: 'standalone-workout' });
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
    setRouteState({ mode: 'edit', workoutId: 'standalone-workout' });
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
    setRouteState({ mode: 'create', date: '2026-10-10' });
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

  it('replaces a deleted plan path with Standalone when its workouts were kept there', async () => {
    deleteTrainingPlan.mockResolvedValue({
      mutationId: 'mutation-1',
      state: { ...schedule.state, activePlanId: null, revision: schedule.state.revision + 1 },
      removedPlanId: 'active-plan',
      workoutDisposition: 'convert-to-standalone',
      convertedWorkoutIds: ['plan-workout'],
      permanentlyDeletedWorkoutIds: [],
    });
    const fixture = await renderPlans();
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    vi.spyOn(componentDialog, 'open').mockReturnValue({ afterClosed: () => of(true) } as never);
    const navigate = vi.mocked(TestBed.inject(Router).navigate);
    navigate.mockClear();

    await fixture.componentInstance.deletePlan(schedule.plans[0]);

    expect(navigate).toHaveBeenCalledWith(
      ['/training/plans/standalone'],
      expect.objectContaining({ replaceUrl: true }),
    );
    expect(fixture.componentInstance.view()).toBe('standalone');
  });

  it('keeps past-provider cleanup opt-in off by default and sends the selected plan choice', async () => {
    deleteTrainingPlan.mockResolvedValue({ mutationId: 'mutation-1', state: schedule.state,
      removedPlanId: 'active-plan', workoutDisposition: 'convert-to-standalone',
      convertedWorkoutIds: [], permanentlyDeletedWorkoutIds: [] });
    const fixture = await renderPlans();
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    vi.spyOn(componentDialog, 'open').mockReturnValue({ afterClosed: () => of(true) } as never);
    fixture.componentInstance.beginPlanDeletion(schedule.plans[0]);
    expect(fixture.componentInstance.removePastProviderCopies()).toBe(false);
    fixture.componentInstance.removePastProviderCopies.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Some providers cannot remove past workouts');
    await fixture.componentInstance.deletePlan(schedule.plans[0]);
    expect(deleteTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({ removePastProviderCopies: true }));
  });

  it('passes the explicit single-workout cleanup choice and leaves cancellation inert', async () => {
    const fixture = await renderPlans();
    const componentDialog = (fixture.componentInstance as unknown as { dialog: MatDialog }).dialog;
    vi.spyOn(componentDialog, 'open')
      .mockReturnValueOnce({ afterClosed: () => of({ confirmed: true, removePastProviderCopies: true }) } as never)
      .mockReturnValueOnce({ afterClosed: () => of(false) } as never);
    await fixture.componentInstance.deleteWorkout(schedule.workouts[0]);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      operation: { kind: 'delete-workout', workoutId: 'plan-workout', removePastProviderCopies: true },
    }));
    await fixture.componentInstance.permanentlyDeleteWorkout(schedule.workouts[0]);
    expect(mutate).toHaveBeenCalledTimes(1);
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
  it('keeps long revision histories bounded and deleted-workout details surface-free', async () => {
    const deleted = { ...schedule.workouts[0], id: 'deleted', title: 'Deleted review run',
      lifecycle: 'deleted' as const, deletedAtMs: 1_789_000_000_000 };
    getDeletedWorkoutsPage.mockResolvedValue({ workouts: [deleted], nextCursor: null });
    const fixture = await renderPlans();
    fixture.componentInstance.historyPanel.set({ scope: { kind: 'plan', id: 'active-plan' }, status: 'ready',
      entries: Array.from({ length: 50 }, (_, index) => ({ revision: 50 - index, operationKind: 'update-workout',
        createdAtMs: 1_789_000_000_000 - index * 60000, mutationId: 'edit-' + index, isCheckpoint: false })), nextBeforeRevision: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.history-entry')).toHaveLength(50);
    expect(fixture.nativeElement.querySelector('.history-entries').getAttribute('tabindex')).toBe('0');
    expect(fixture.nativeElement.querySelector('.history-entry button[mat-stroked-button]')).toBeNull();
    const disclosure = fixture.nativeElement.querySelector('button[aria-controls="deleted-workout-list"]');
    const list = fixture.nativeElement.querySelector('#deleted-workout-list');
    expect(list.hidden).toBe(true); expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    disclosure.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(list.hidden).toBe(false); expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(getDeletedWorkoutsPage).toHaveBeenCalledWith(user.uid, 'active-plan', null);
    expect(fixture.nativeElement.textContent).toContain('Deleted review run');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    if (process.env.TRAINING_DELIVERY_QA_DIR) {
      const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass');
      const css = [
        ['app-plans-workspace', 'src/app/components/plans/plans-workspace.component.scss'],
        ['app-compact-row', 'src/app/components/shared/compact-row/compact-row.component.scss'],
      ].map(([host, file]) => sass.compileString(host + ' {' + readFileSync(file, 'utf8')
        .replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&') + '}').css).join('\n');
      // Export the real rendered history, not a hand-maintained visual facsimile.
      writeFileSync(join(process.env.TRAINING_DELIVERY_QA_DIR, 'revision-history.html'),
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="styles.css">' + Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
        + '<style>' + css + '</style></head><body><app-plans-workspace><main class="plans-workspace qs-workspace-page">'
        + fixture.nativeElement.querySelector('.history-panel').outerHTML + '</main></app-plans-workspace></body></html>');
    }
  });

  it('loads deleted workouts only on demand and advances a stable cursor', async () => {
    const first = { ...schedule.workouts[0], id: 'deleted-1', title: 'First deleted run',
      lifecycle: 'deleted' as const, deletedAtMs: 1_789_000_000_000 };
    const second = { ...first, id: 'deleted-2', title: 'Second deleted run', deletedAtMs: first.deletedAtMs - 1 };
    getDeletedWorkoutsPage
      .mockResolvedValueOnce({ workouts: [first], nextCursor: { deletedAtMs: first.deletedAtMs!, id: first.id } })
      .mockResolvedValueOnce({ workouts: [second], nextCursor: null });
    const fixture = await renderPlans();
    expect(getDeletedWorkoutsPage).not.toHaveBeenCalled();

    fixture.nativeElement.querySelector('button[aria-controls="deleted-workout-list"]').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(getDeletedWorkoutsPage).toHaveBeenNthCalledWith(1, user.uid, 'active-plan', null);
    expect(fixture.nativeElement.textContent).toContain('First deleted run');
    expect(fixture.nativeElement.textContent).not.toContain('Second deleted run');

    const more = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent?.includes('Show more deleted workouts')) as HTMLButtonElement;
    more.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(getDeletedWorkoutsPage).toHaveBeenNthCalledWith(2, user.uid, 'active-plan',
      { deletedAtMs: first.deletedAtMs, id: first.id });
    expect(fixture.nativeElement.textContent).toContain('Second deleted run');
    expect([...fixture.nativeElement.querySelectorAll('#deleted-workout-list mat-list-item')]).toHaveLength(2);
    expect(fixture.nativeElement.textContent).not.toContain('Show more deleted workouts');
    const openHistory = vi.spyOn(fixture.componentInstance, 'openHistory').mockResolvedValue();
    const permanentDelete = vi.spyOn(fixture.componentInstance, 'permanentlyDeleteWorkout').mockResolvedValue();
    const secondRow = fixture.nativeElement.querySelectorAll('#deleted-workout-list mat-list-item')[1] as HTMLElement;
    ([...secondRow.querySelectorAll('button')].find(button => button.textContent?.includes('History')) as HTMLButtonElement).click();
    (secondRow.querySelector('button[aria-label="Delete workout permanently"]') as HTMLButtonElement).click();
    expect(openHistory).toHaveBeenCalledWith({ kind: 'plan', id: 'active-plan' });
    expect(permanentDelete).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }));
  });

  it('shows an empty deleted page and discards an in-flight page after sign-out', async () => {
    const fixture = await renderPlans();
    fixture.nativeElement.querySelector('button[aria-controls="deleted-workout-list"]').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No deleted workouts in this plan');

    let resolvePage!: (value: { workouts: ScheduledWorkoutV1[]; nextCursor: { deletedAtMs: number; id: string } | null }) => void;
    getDeletedWorkoutsPage.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
    fixture.componentInstance.deletedWorkoutPanel.update(panel => panel && { ...panel, status: 'idle' });
    const pending = fixture.componentInstance.loadDeletedWorkouts();
    userSignal.set(null); userSubject.next(null); fixture.detectChanges();
    resolvePage({ workouts: [{ ...schedule.workouts[0], id: 'private-deleted', lifecycle: 'deleted',
      deletedAtMs: 1_789_000_000_000 }], nextCursor: null });
    await pending; await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.deletedWorkoutPanel()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('private-deleted');
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

  it('renders and reads planning for any signed-in account', async () => {
    const otherUser = { ...user, uid: 'another-user' };
    TestBed.overrideProvider(AppUserService, { useValue: { user: signal(otherUser), user$: of(otherUser) } });
    const fixture = await renderPlans();
    expect(watchSchedule).toHaveBeenCalledWith(otherUser.uid);
    expect(fixture.nativeElement.querySelector('main')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('removes the editor on sign-out without invoking a mutation', async () => {
    const viewer = signal<typeof user | null>(user);
    const viewers$ = new BehaviorSubject<typeof user | null>(user);
    TestBed.overrideProvider(AppUserService, { useValue: { user: viewer, user$: viewers$ } });
    const fixture = await renderPlans();
    fixture.componentInstance.editWorkout(schedule.workouts[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.workout-editor')).toBeTruthy();
    viewer.set(null); viewers$.next(null);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
    expect(fixture.componentInstance.editor()).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  async function renderPlans() {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation((commands, extras) => {
      const root = `${commands[0] ?? ''}`;
      if (root === '/training/plans/workout') {
        setRouteState({ mode: 'edit', workoutId: `${commands[1] ?? ''}` }, true);
      } else if (root === '/training/plans/standalone/new') {
        setRouteState({ mode: 'create', scope: 'standalone', date: `${extras?.queryParams?.['date'] ?? ''}` || undefined }, true);
      } else if (root === '/training/plans/plan' && commands[2] === 'new') {
        setRouteState({ mode: 'create', planId: `${commands[1] ?? ''}`, date: `${extras?.queryParams?.['date'] ?? ''}` || undefined }, true);
      } else if (root === '/training/plans/new') {
        setRouteState({ mode: 'create', date: `${extras?.queryParams?.['date'] ?? ''}` || undefined }, true);
      } else if (root === '/training/plans/standalone') {
        setRouteState({ scope: 'standalone' }, true);
      } else if (root === '/training/plans/plan') {
        setRouteState({ planId: `${commands[1] ?? ''}`, date: `${extras?.queryParams?.['date'] ?? ''}` || undefined }, true);
      } else {
        setRouteState({}, true);
      }
      return Promise.resolve(true);
    });
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
