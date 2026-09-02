import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { AppUserService } from '../../services/app.user.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import {
  TrainingPlansService,
  type CurrentTrainingScheduleV1,
} from '../../services/training-plans.service';
import { PlansWorkspaceComponent } from './plans-workspace.component';

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

  beforeEach(async () => {
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
    await TestBed.configureTestingModule({
      imports: [PlansWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
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
