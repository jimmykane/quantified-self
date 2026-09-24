import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { normalizeTrainingLocalDate, type ExpectedTrainingScheduleRevision,
  type MutateTrainingScheduleRequestV1, type MutateTrainingScheduleResponseV1,
  type ScheduledWorkoutV1, type TrainingPlanV1 } from '@shared/training-plans';
import { ConfirmationDialogComponent } from '../components/confirmation-dialog/confirmation-dialog.component';
import { TrainingWorkoutDuplicateDialogComponent,
  type TrainingWorkoutDuplicateDialogData } from '../components/plans/training-workout-duplicate-dialog.component';
import { AppHapticsService } from './app.haptics.service';
import { AppUserService } from './app.user.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from './training-plans.service';

export interface DuplicatedWorkoutResult {
  kind: 'duplicated-workout';
  workoutId: string;
  localDate: string;
  planId: string | null;
  acknowledgedPlan?: TrainingPlanV1;
  acknowledgedState?: CurrentTrainingScheduleV1['state'];
}

@Injectable({ providedIn: 'root' })
export class TrainingWorkoutDuplicateService {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly users = inject(AppUserService);
  private readonly plans = inject(TrainingPlansService);
  private readonly haptics = inject(AppHapticsService);

  async duplicate(
    ownerUid: string,
    source: ScheduledWorkoutV1,
    getSchedule: () => CurrentTrainingScheduleV1 | null,
  ): Promise<DuplicatedWorkoutResult | null> {
    if (this.users.user()?.uid !== ownerUid) return null;
    const openingSchedule = getSchedule();
    const openingPlan = openingSchedule?.plans.find(plan => plan.id === source.planId);
    if (source.planId && !openingPlan) return this.fail('This plan is no longer available. Reload and try again.');
    const data: TrainingWorkoutDuplicateDialogData = {
      title: source.title,
      scopeName: openingPlan?.name ?? 'Standalone',
      localDate: source.localDate,
      startOfWeek: this.users.user()?.settings?.unitSettings?.startOfTheWeek ?? null,
      planRange: openingPlan ? {
        startLocalDate: openingPlan.startLocalDate, endLocalDate: openingPlan.endLocalDate,
      } : null,
    };
    const date = await firstValueFrom(this.dialog.open<TrainingWorkoutDuplicateDialogComponent,
      TrainingWorkoutDuplicateDialogData, string | undefined>(TrainingWorkoutDuplicateDialogComponent, {
        data, width: '420px', maxWidth: 'calc(100vw - 32px)',
      }).afterClosed());
    if (!date || this.users.user()?.uid !== ownerUid) return null;
    let localDate: string;
    try { localDate = normalizeTrainingLocalDate(date); }
    catch { return this.fail('Choose a valid workout date.'); }

    const schedule = getSchedule();
    const current = schedule?.workouts.find(workout => workout.id === source.id);
    const plan = source.planId ? schedule?.plans.find(item => item.id === source.planId) : null;
    if (!schedule || !current || current.lifecycle === 'deleted' || current.revision !== source.revision
      || current.planId !== source.planId || (source.planId && !plan)) {
      return this.fail('This workout changed while you were choosing a date. Reload it and try again.');
    }
    const workoutId = this.plans.createEntityId('workout');
    const expectedRevisions: ExpectedTrainingScheduleRevision[] = [
      { scope: 'state', id: 'current', revision: schedule.state.revision },
      { scope: 'workout', id: current.id, revision: current.revision },
    ];
    if (plan) expectedRevisions.push({ scope: 'plan', id: plan.id, revision: plan.revision });
    const request: MutateTrainingScheduleRequestV1 = {
      mutationId: this.plans.createMutationId('copy-workout'),
      expectedRevisions,
      operation: {
        kind: 'copy-workout', sourceWorkoutId: source.id, workoutId,
        planId: source.planId, localDate, confirmPlanRangeExtension: false,
      },
    };
    let response: MutateTrainingScheduleResponseV1;
    try {
      response = await this.plans.mutate(request);
    } catch (error) {
      const message = duplicateErrorMessage(error);
      if (!/requires extending/i.test(message)) return this.fail(message);
      if (this.users.user()?.uid !== ownerUid) return null;
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmationDialogComponent, {
        data: { title: 'Extend plan dates?',
          message: `This date is outside ${plan?.name ?? 'the plan'}'s current range. Extend the plan to include ${localDate} and duplicate the workout?`,
          confirmText: 'Extend and duplicate' },
      }).afterClosed());
      if (confirmed !== true || this.users.user()?.uid !== ownerUid) return null;
      try {
        response = await this.plans.mutate({ ...request, operation: {
          kind: 'copy-workout', sourceWorkoutId: source.id, workoutId, planId: source.planId,
          localDate, confirmPlanRangeExtension: true,
        } });
      } catch (retryError) { return this.fail(duplicateErrorMessage(retryError)); }
    }
    if (this.users.user()?.uid !== ownerUid) return null;
    this.haptics.success();
    this.snackBar.open(`Workout duplicated to ${localDate}.`, 'Dismiss', { duration: 4000 });
    const acknowledgedPlan = source.planId ? response.plans.find(item => item.id === source.planId) : undefined;
    return { kind: 'duplicated-workout', workoutId, localDate, planId: source.planId,
      ...(acknowledgedPlan ? { acknowledgedPlan, acknowledgedState: response.state } : {}) };
  }

  private fail(message: string): null {
    this.haptics.error();
    this.snackBar.open(message, 'Dismiss', { duration: 7000 });
    return null;
  }
}

function duplicateErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim()
    ? message.replace(/^FirebaseError:\s*/i, '').replace(/^functions\/[^:]+:\s*/i, '')
    : 'The workout could not be duplicated. Try again.';
}
