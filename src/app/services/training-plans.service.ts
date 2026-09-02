import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
} from 'app/firebase/firestore';
import { combineLatest, map, Observable, of, shareReplay } from 'rxjs';
import {
  SCHEDULED_WORKOUTS_COLLECTION_ID,
  TRAINING_PLAN_SCHEMA_VERSION,
  TRAINING_PLAN_STATE_COLLECTION_ID,
  TRAINING_PLAN_STATE_DOCUMENT_ID,
  TRAINING_PLANS_COLLECTION_ID,
  parseScheduledWorkoutV1,
  parseTrainingPlanStateV1,
  parseTrainingPlanV1,
  type DeleteTrainingPlanRequestV1,
  type DeleteTrainingPlanResponseV1,
  type MutateTrainingScheduleRequestV1,
  type MutateTrainingScheduleResponseV1,
  type PreviewTrainingScheduleRestoreRequestV1,
  type RestoreTrainingScheduleRevisionRequestV1,
  type RestoreTrainingScheduleRevisionResponseV1,
  type ScheduledWorkoutV1,
  type TrainingPlanStateV1,
  type TrainingPlanV1,
  type TrainingScheduleHistoryRequestV1,
  type TrainingScheduleHistoryResponseV1,
  type TrainingScheduleRestorePreviewV1,
} from '@shared/training-plans';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';

export interface CurrentTrainingScheduleV1 {
  state: TrainingPlanStateV1;
  plans: TrainingPlanV1[];
  workouts: ScheduledWorkoutV1[];
}

function emptyTrainingSchedule(): CurrentTrainingScheduleV1 {
  return {
    state: {
      schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
      activePlanId: null,
      revision: 0,
      currentWorkoutCount: 0,
      updatedAtMs: 0,
    },
    plans: [],
    workouts: [],
  };
}

export function selectCalendarVisibleScheduledWorkouts(
  schedule: CurrentTrainingScheduleV1,
  startLocalDate?: string,
  endLocalDate?: string,
): ScheduledWorkoutV1[] {
  return schedule.workouts
    .filter(workout => (
      workout.lifecycle !== 'deleted'
      && (workout.planId === null || workout.planId === schedule.state.activePlanId)
      && (!startLocalDate || workout.localDate >= startLocalDate)
      && (!endLocalDate || workout.localDate <= endLocalDate)
    ))
    .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id));
}

@Injectable({ providedIn: 'root' })
export class TrainingPlansService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);
  private readonly browserCompatibility = inject(BrowserCompatibilityService);
  private readonly scheduleStreams = new Map<string, Observable<CurrentTrainingScheduleV1>>();

  watchSchedule(userId: string | null | undefined): Observable<CurrentTrainingScheduleV1> {
    const uid = `${userId || ''}`.trim();
    if (!uid) return of(emptyTrainingSchedule());
    const existing = this.scheduleStreams.get(uid);
    if (existing) return existing;

    const userPath = ['users', uid] as const;
    const stateRef = doc(
      this.firestore,
      ...userPath,
      TRAINING_PLAN_STATE_COLLECTION_ID,
      TRAINING_PLAN_STATE_DOCUMENT_ID,
    );
    const plansRef = collection(this.firestore, ...userPath, TRAINING_PLANS_COLLECTION_ID);
    const workoutsRef = collection(this.firestore, ...userPath, SCHEDULED_WORKOUTS_COLLECTION_ID);
    const schedule$ = combineLatest([
      docData(stateRef),
      collectionData(plansRef, { idField: 'id' }),
      collectionData(workoutsRef, { idField: 'id' }),
    ]).pipe(
      map(([stateValue, planValues, workoutValues]) => {
        const plans = (planValues as unknown[]).map(parseTrainingPlanV1)
          .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
        const workouts = (workoutValues as unknown[]).map(parseScheduledWorkoutV1)
          .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id));
        const state = stateValue === undefined ? emptyTrainingSchedule().state : parseTrainingPlanStateV1(stateValue);
        if (state.currentWorkoutCount !== workouts.filter(workout => workout.lifecycle !== 'deleted').length) {
          throw new Error('The training schedule count is inconsistent. Reload before editing.');
        }
        return { state, plans, workouts };
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.scheduleStreams.set(uid, schedule$);
    return schedule$;
  }

  watchCalendarWorkouts(userId: string | null | undefined): Observable<ScheduledWorkoutV1[]> {
    return this.watchSchedule(userId).pipe(map(schedule => selectCalendarVisibleScheduledWorkouts(schedule)));
  }

  createMutationId(prefix: string): string {
    const normalizedPrefix = `${prefix || 'training'}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'training';
    const uuid = this.browserCompatibility.createRandomUUID();
    if (uuid) return `${normalizedPrefix}:${uuid}`;
    return `${normalizedPrefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  createEntityId(prefix: string): string {
    const normalizedPrefix = `${prefix || 'item'}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24) || 'item';
    const unique = this.browserCompatibility.createRandomUUID()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${normalizedPrefix}-${unique}`.slice(0, 128);
  }

  async mutate(request: MutateTrainingScheduleRequestV1): Promise<MutateTrainingScheduleResponseV1> {
    return (await this.functions.call<MutateTrainingScheduleRequestV1, MutateTrainingScheduleResponseV1>(
      'mutateTrainingSchedule', request,
    )).data;
  }

  async getHistory(request: TrainingScheduleHistoryRequestV1): Promise<TrainingScheduleHistoryResponseV1> {
    return (await this.functions.call<TrainingScheduleHistoryRequestV1, TrainingScheduleHistoryResponseV1>(
      'getTrainingScheduleHistory', request,
    )).data;
  }

  async previewRestore(request: PreviewTrainingScheduleRestoreRequestV1): Promise<TrainingScheduleRestorePreviewV1> {
    return (await this.functions.call<PreviewTrainingScheduleRestoreRequestV1, TrainingScheduleRestorePreviewV1>(
      'previewTrainingScheduleRestore', request,
    )).data;
  }

  async restore(request: RestoreTrainingScheduleRevisionRequestV1): Promise<RestoreTrainingScheduleRevisionResponseV1> {
    return (await this.functions.call<RestoreTrainingScheduleRevisionRequestV1, RestoreTrainingScheduleRevisionResponseV1>(
      'restoreTrainingScheduleRevision', request,
    )).data;
  }

  async deletePlan(request: DeleteTrainingPlanRequestV1): Promise<DeleteTrainingPlanResponseV1> {
    return (await this.functions.call<DeleteTrainingPlanRequestV1, DeleteTrainingPlanResponseV1>(
      'deleteTrainingPlan', request,
    )).data;
  }
}
