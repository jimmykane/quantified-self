import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  documentId,
  getDoc,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'app/firebase/firestore';
import { catchError, combineLatest, from, map, Observable, of, retry, shareReplay, switchMap, throwError, timeout } from 'rxjs';
import {
  SCHEDULED_WORKOUTS_COLLECTION_ID,
  DELETED_WORKOUT_RECOVERY_MS,
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
import {
  STRENGTH_DETAILS_COLLECTION_ID,
  STRENGTH_DETAILS_DOCUMENT_ID,
  parseStrengthWorkoutDetailsV1,
  type StrengthWorkoutDetailsV1,
} from '@shared/strength-workout';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import {
  TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
  parseTrainingWorkoutCompletionV1,
  type TrainingWorkoutCompletionV1,
} from '@shared/training-workout-completion';

export interface CurrentTrainingScheduleV1 {
  state: TrainingPlanStateV1;
  plans: TrainingPlanV1[];
  workouts: ScheduledWorkoutV1[];
  /** Local read state only; never part of the persisted v1 schedule or MCP contract. */
  restoreUnavailable?: true;
}

export interface DeletedTrainingWorkoutsPageV1 {
  workouts: ScheduledWorkoutV1[];
  nextCursor: { deletedAtMs: number; id: string } | null;
}

const DELETED_WORKOUT_PAGE_SIZE = 25;
export const TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS = 30_000;

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
  private readonly completionStreams = new Map<string, Observable<TrainingWorkoutCompletionV1[]>>();

  watchSchedule(userId: string | null | undefined): Observable<CurrentTrainingScheduleV1> {
    const uid = `${userId || ''}`.trim();
    if (!uid) return of(emptyTrainingSchedule());
    const existing = this.scheduleStreams.get(uid);
    if (existing) return existing;

    const userPath = ['users', uid] as const;
    const stateRef = doc(this.firestore, ...userPath, TRAINING_PLAN_STATE_COLLECTION_ID, TRAINING_PLAN_STATE_DOCUMENT_ID);
    const plansRef = collection(this.firestore, ...userPath, TRAINING_PLANS_COLLECTION_ID);
    const workoutsRef = collection(this.firestore, ...userPath, SCHEDULED_WORKOUTS_COLLECTION_ID);
    const availabilityRef = doc(this.firestore, ...userPath, TRAINING_PLAN_STATE_COLLECTION_ID,
      TRAINING_PLAN_STATE_DOCUMENT_ID, 'availability', 'restore');
    const schedule$ = docData(availabilityRef).pipe(
      timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
      switchMap(availability => {
        if (availability !== undefined) return of({ ...emptyTrainingSchedule(), restoreUnavailable: true as const });
        return combineLatest([
          // Even a server-acknowledged document/query watch can repeat a stale
          // missing state. Keep its live invalidation signal but independently
          // verify the exact state through uncached REST before publishing it.
          docData(stateRef, { waitForServer: true }).pipe(
            timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
            switchMap(() => from(this.readCurrentState(uid)).pipe(
              timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
            )),
          ),
          collectionData(plansRef, { idField: 'id' }).pipe(
            timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
          ),
          collectionData(query(workoutsRef, where('lifecycle', 'in', ['planned', 'skipped'])), { idField: 'id' }).pipe(
            timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
          ),
        ]).pipe(
          map(([stateValue, planValues, workoutValues]) => {
            const plans = (planValues as unknown[]).map(parseTrainingPlanV1)
              .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
            const workouts = (workoutValues as unknown[]).map(parseScheduledWorkoutV1)
              .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id));
            const state = stateValue === undefined ? emptyTrainingSchedule().state : parseTrainingPlanStateV1(stateValue);
            // These are independent listeners. Adjacent emissions can be
            // temporarily inconsistent even for a single atomic transaction.
            return { state, plans, workouts };
          }),
          // A workout listener may see the rule fence just before the
          // availability listener receives the lock. Let that signal cancel
          // and reattach the inner listeners instead of stranding the page.
          retry({ count: 2, delay: 1000 }),
          catchError(error => from(getDoc(availabilityRef)).pipe(
            timeout({ first: TRAINING_SCHEDULE_STATE_READ_TIMEOUT_MS }),
            switchMap(snapshot => snapshot.exists()
              ? of({ ...emptyTrainingSchedule(), restoreUnavailable: true as const })
              : throwError(() => error)),
          )),
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.scheduleStreams.set(uid, schedule$);
    return schedule$;
  }

  private async readCurrentState(uid: string): Promise<unknown> {
    const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
    const firestore = getFirestore(this.firestore.app);
    return (await getDoc(doc(firestore, 'users', uid, TRAINING_PLAN_STATE_COLLECTION_ID, TRAINING_PLAN_STATE_DOCUMENT_ID))).data();
  }

  async getDeletedWorkoutsPage(
    userId: string,
    planId: string | null,
    cursor: DeletedTrainingWorkoutsPageV1['nextCursor'] = null,
  ): Promise<DeletedTrainingWorkoutsPageV1> {
    const uid = `${userId || ''}`.trim();
    if (!uid) throw new Error('Sign in to view deleted workouts.');
    const workoutsRef = collection(this.firestore, 'users', uid, SCHEDULED_WORKOUTS_COLLECTION_ID);
    const constraints = [
      where('planId', '==', planId),
      where('lifecycle', '==', 'deleted'),
      where('deletedAtMs', '>', Date.now() - DELETED_WORKOUT_RECOVERY_MS),
      orderBy('deletedAtMs', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.deletedAtMs, cursor.id)] : []),
      limit(DELETED_WORKOUT_PAGE_SIZE + 1),
    ];
    const snapshot = await getDocsFromServer(query(workoutsRef, ...constraints));
    const visible = snapshot.docs.slice(0, DELETED_WORKOUT_PAGE_SIZE);
    const workouts = visible.map(item => parseScheduledWorkoutV1(item.data()));
    if (workouts.some((workout, index) => workout.id !== visible[index].id
      || workout.planId !== planId || workout.lifecycle !== 'deleted')) {
      throw new Error('Deleted workout history is inconsistent. Reload and try again.');
    }
    return {
      workouts,
      nextCursor: snapshot.docs.length > DELETED_WORKOUT_PAGE_SIZE
        ? { deletedAtMs: workouts.at(-1)!.deletedAtMs!, id: workouts.at(-1)!.id } : null,
    };
  }

  watchCalendarWorkouts(userId: string | null | undefined): Observable<ScheduledWorkoutV1[]> {
    return this.watchSchedule(userId).pipe(map(schedule => selectCalendarVisibleScheduledWorkouts(schedule)));
  }

  watchWorkoutCompletions(userId: string | null | undefined): Observable<TrainingWorkoutCompletionV1[]> {
    const uid = `${userId || ''}`.trim();
    if (!uid) return of([]);
    const existing = this.completionStreams.get(uid);
    if (existing) return existing;
    const completionsRef = collection(this.firestore, 'users', uid, TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID);
    const completions$ = collectionData(completionsRef, { idField: 'workoutId' }).pipe(
      map(values => (values as unknown[]).map(parseTrainingWorkoutCompletionV1)
        .sort((left, right) => left.scheduledLocalDate.localeCompare(right.scheduledLocalDate)
          || left.workoutId.localeCompare(right.workoutId))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.completionStreams.set(uid, completions$);
    return completions$;
  }

  async getStrengthDetails(userId: string, workoutId: string): Promise<StrengthWorkoutDetailsV1> {
    const snapshot = await getDoc(doc(this.firestore, 'users', userId, SCHEDULED_WORKOUTS_COLLECTION_ID,
      workoutId, STRENGTH_DETAILS_COLLECTION_ID, STRENGTH_DETAILS_DOCUMENT_ID));
    if (!snapshot.exists()) throw new Error('The strength prescription is missing. Reload before editing this workout.');
    const details = parseStrengthWorkoutDetailsV1(snapshot.data());
    if (details.workoutId !== workoutId) throw new Error('The strength prescription does not match this workout.');
    return details;
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
