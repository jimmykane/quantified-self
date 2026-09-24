import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { of, Subject } from 'rxjs';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import { AppHapticsService } from './app.haptics.service';
import { AppUserService } from './app.user.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from './training-plans.service';
import { TrainingWorkoutDuplicateService } from './training-workout-duplicate.service';

describe('TrainingWorkoutDuplicateService', () => {
  const source: ScheduledWorkoutV1 = {
    schemaVersion: 1, id: 'source', planId: 'plan', localDate: '2026-12-31', lifecycle: 'skipped', title: 'Long ride',
    structure: { version: 1, sport: ActivityTypes.Cycling, nodes: [{ id: 'ride', kind: 'step', purpose: 'work',
      ending: { kind: 'time', seconds: 3600 }, targets: [] }] },
    revision: 3, createdAtMs: 1, updatedAtMs: 2,
  };
  let schedule: CurrentTrainingScheduleV1;
  let viewer: ReturnType<typeof signal<{ uid: string; settings: { unitSettings: { startOfTheWeek: number } } } | null>>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let mutate: ReturnType<typeof vi.fn>;
  let haptics: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let service: TrainingWorkoutDuplicateService;

  beforeEach(() => {
    schedule = { state: { schemaVersion: 1, activePlanId: 'plan', revision: 7, currentWorkoutCount: 1, updatedAtMs: 2 },
      plans: [{ schemaVersion: 1, id: 'plan', name: 'Winter', lifecycle: 'active', startLocalDate: '2026-12-01',
        endLocalDate: '2026-12-31', revision: 4, lastCheckpointRevision: 1, workoutCount: 1,
        createdAtMs: 1, updatedAtMs: 2 }], workouts: [source] };
    viewer = signal({ uid: 'owner', settings: { unitSettings: { startOfTheWeek: 6 } } });
    dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of('2027-01-02') });
    mutate = vi.fn().mockImplementation(async () => ({ plans: schedule.plans, state: schedule.state,
      workouts: [], removedPlanIds: [], permanentlyDeletedWorkoutIds: [], mutationId: 'copy-receipt' }));
    haptics = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [
      TrainingWorkoutDuplicateService,
      { provide: AppUserService, useValue: { user: viewer } },
      { provide: TrainingPlansService, useValue: {
        createEntityId: () => 'new-copy', createMutationId: () => 'copy-receipt', mutate,
      } },
      { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: AppHapticsService, useValue: haptics },
    ] });
    service = TestBed.inject(TrainingWorkoutDuplicateService);
  });

  it('duplicates to a chosen date in the same plan with a fresh identity and revision checks', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2027-01-02') })
      .mockReturnValueOnce({ afterClosed: () => of(true) });
    const result = await service.duplicate('owner', source, () => schedule);
    expect(result).toMatchObject({ kind: 'duplicated-workout', workoutId: 'new-copy', localDate: '2027-01-02', planId: 'plan',
      acknowledgedPlan: { id: 'plan' }, acknowledgedState: { revision: 7 } });
    expect(dialogOpen.mock.calls[0][1].data).toMatchObject({ localDate: '2026-12-31', startOfWeek: 6,
      scopeName: 'Winter', planRange: { endLocalDate: '2026-12-31' } });
    expect(dialogOpen.mock.calls[0][1]).toMatchObject({ width: '420px', maxWidth: 'calc(100vw - 32px)' });
    expect(mutate).toHaveBeenCalledWith({ mutationId: 'copy-receipt', expectedRevisions: [
      { scope: 'state', id: 'current', revision: 7 },
      { scope: 'workout', id: 'source', revision: 3 },
      { scope: 'plan', id: 'plan', revision: 4 },
    ], operation: { kind: 'copy-workout', sourceWorkoutId: 'source', workoutId: 'new-copy',
      planId: 'plan', localDate: '2027-01-02', confirmPlanRangeExtension: true } });
    expect(mutate).toHaveBeenCalledOnce();
    expect(haptics.success).toHaveBeenCalledOnce();
    expect(source.lifecycle).toBe('skipped');
  });

  it('asks before one range-extending mutation instead of sending an expected failure', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2027-01-02') })
      .mockReturnValueOnce({ afterClosed: () => of(true) });
    await service.duplicate('owner', source, () => schedule);
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toMatchObject({ mutationId: 'copy-receipt',
      operation: { workoutId: 'new-copy', confirmPlanRangeExtension: true } });
    expect(dialogOpen.mock.calls[1][1].data.confirmText).toBe('Extend and duplicate');
    expect(dialogOpen.mock.calls[1][1].data.message).toContain('Extend the plan to include 2027-01-02');
  });

  it('allows same-day duplication and leaves the schedule unchanged when range extension is cancelled', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2026-12-31') });
    expect(await service.duplicate('owner', source, () => schedule)).toMatchObject({ localDate: '2026-12-31' });
    expect(mutate.mock.calls[0][0].operation).toMatchObject({ localDate: '2026-12-31',
      confirmPlanRangeExtension: false });

    mutate.mockClear();
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2027-01-02') })
      .mockReturnValueOnce({ afterClosed: () => of(false) });
    expect(await service.duplicate('owner', source, () => schedule)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('does not copy a workout changed while range confirmation is open', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2027-01-02') })
      .mockReturnValueOnce({ afterClosed: () => {
        schedule = { ...schedule, workouts: [{ ...source, revision: source.revision + 1 }] };
        return of(true);
      } });
    expect(await service.duplicate('owner', source, () => schedule)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledOnce();
  });

  it('does not extend a plan whose range changed while confirmation is open', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of('2027-01-02') })
      .mockReturnValueOnce({ afterClosed: () => {
        schedule = { ...schedule, plans: [{ ...schedule.plans[0], revision: 5, startLocalDate: '2026-11-01' }] };
        return of(true);
      } });
    expect(await service.duplicate('owner', source, () => schedule)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledOnce();
  });

  it('does not write after cancellation, a changed source, or account switch', async () => {
    dialogOpen.mockReturnValueOnce({ afterClosed: () => of(undefined) });
    expect(await service.duplicate('owner', source, () => schedule)).toBeNull();
    schedule = { ...schedule, workouts: [{ ...source, revision: 4 }] };
    expect(await service.duplicate('owner', source, () => schedule)).toBeNull();
    const date$ = new Subject<string>();
    dialogOpen.mockReturnValueOnce({ afterClosed: () => date$ });
    const pending = service.duplicate('owner', { ...source, revision: 4 }, () => schedule);
    viewer.set({ uid: 'other', settings: { unitSettings: { startOfTheWeek: 1 } } });
    date$.next('2027-01-02'); date$.complete();
    expect(await pending).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('keeps standalone copies standalone and sends no provider command', async () => {
    const standalone = { ...source, planId: null };
    schedule = { ...schedule, workouts: [standalone] };
    const result = await service.duplicate('owner', standalone, () => schedule);
    expect(result?.planId).toBeNull();
    expect(dialogOpen.mock.calls[0][1].data).toMatchObject({ scopeName: 'Standalone', planRange: null });
    expect(mutate.mock.calls[0][0].expectedRevisions).toHaveLength(2);
    expect(mutate.mock.calls[0][0].operation.planId).toBeNull();
  });
});
