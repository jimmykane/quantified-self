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
            previewRestore: vi.fn(),
            restore: vi.fn(),
            deletePlan: vi.fn(),
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
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

  it('routes plan-bound workout history through the plan stream and standalone history through the workout stream', async () => {
    const fixture = await renderPlans();
    const [planWorkout, standaloneWorkout] = schedule.workouts;

    expect(fixture.componentInstance.historyScopeForWorkout(planWorkout)).toEqual({
      kind: 'plan', id: 'active-plan',
    });
    expect(fixture.componentInstance.historyScopeForWorkout(standaloneWorkout)).toEqual({
      kind: 'workout', id: 'standalone-workout',
    });
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
