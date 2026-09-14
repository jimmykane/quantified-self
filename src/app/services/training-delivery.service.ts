import { Injectable, computed, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData, query, where, limit, orderBy } from 'app/firebase/firestore';
import { combineLatest, finalize, firstValueFrom, from, map, Observable, of, timeout } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';
import { deliverySettingsId, parseTrainingDeliverySettingsV1, parseTrainingDeliveryStatusV1,
  TRAINING_DELIVERY_PAGE_SIZE, TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliveryScope, type TrainingDeliverySettingsV1, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppUserService } from './app.user.service';

export interface TrainingDeliveryView { settings: TrainingDeliverySettingsV1[]; statuses: TrainingDeliveryStatusV1[]; }
/** History is a read-only UI scope, never a delivery command or new consent scope. */
export type TrainingDeliveryViewScope = TrainingDeliveryScope | 'history';
export const EMPTY_TRAINING_DELIVERY_VIEW: TrainingDeliveryView = { settings: [], statuses: [] };
export const TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS = 30_000;
export const TRAINING_DELIVERY_SAVE_TIMEOUT_MS = 70_000;

@Injectable({ providedIn: 'root' })
export class TrainingDeliveryService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);
  private readonly browser = inject(BrowserCompatibilityService);
  private readonly users = inject(AppUserService);
  readonly isReady = (provider: PlannedWorkoutProviderId) => isTrainingProviderDeliveryEnabled(provider, this.users.user()?.uid);
  readonly anyReady = computed(() => PLANNED_WORKOUT_PROVIDER_IDS.some(provider => this.isReady(provider)));

  createMutationId(): string {
    return this.browser.createRandomUUID() ?? `delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  watchPresence(uid: string, scope: TrainingDeliveryViewScope, id: string): Observable<boolean> {
    if (!uid) return of(false);
    if (scope === 'history') return collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
      limit(1))).pipe(map(rows => rows.length > 0));
    return combineLatest([
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
        where(scope === 'plan' ? 'planId' : 'workoutId', '==', id), limit(1))),
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_SETTINGS),
        where('scope', '==', scope), where('scopeId', '==', id), limit(1))),
    ]).pipe(map(values => values.some(rows => rows.length > 0)));
  }
  watchScope(uid: string, scope: TrainingDeliveryViewScope, id: string,
    statusLimit = TRAINING_DELIVERY_PAGE_SIZE): Observable<TrainingDeliveryView> {
    if (!uid) return of(EMPTY_TRAINING_DELIVERY_VIEW);
    const settings$ = scope === 'history' ? of([] as TrainingDeliverySettingsV1[]) : combineLatest(PLANNED_WORKOUT_PROVIDER_IDS.map(provider => docData(doc(this.firestore,
      'users', uid, TRAINING_DELIVERY_SETTINGS, deliverySettingsId(scope, id, provider))))).pipe(
      map(values => values.filter(value => value !== undefined).map(parseTrainingDeliverySettingsV1)));
    const statuses$ = collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
      ...(scope === 'history' ? [] : [where(scope === 'plan' ? 'planId' : 'workoutId', '==', id)]),
      orderBy('__name__'), limit(statusLimit))).pipe(
      map(values => values.map(parseTrainingDeliveryStatusV1)));
    return combineLatest([settings$, statuses$]).pipe(map(([settings, statuses]) => ({ settings, statuses })));
  }
  async preview(command: TrainingDeliveryCommandV1, canExecute: () => boolean = () => true): Promise<TrainingDeliveryPreviewV1> {
    return this.invoke<TrainingDeliveryPreviewV1>('previewTrainingProviderDelivery', command, canExecute, TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS);
  }
  async mutate(command: TrainingDeliveryCommandV1, canExecute: () => boolean = () => true): Promise<TrainingDeliverySettingsV1> {
    return this.invoke<TrainingDeliverySettingsV1>('mutateTrainingProviderDelivery', command, canExecute, TRAINING_DELIVERY_SAVE_TIMEOUT_MS);
  }
  private async invoke<T>(name: 'previewTrainingProviderDelivery' | 'mutateTrainingProviderDelivery',
    command: TrainingDeliveryCommandV1, canExecute: () => boolean, timeoutMs: number): Promise<T> {
    const uid = this.users.user()?.uid;
    let active = true;
    // Bound App Check/token readiness as well as HTTP. A timeout cannot undo an
    // in-flight write: the dialog retains its mutation ID for a safe receipt replay.
    const result = await firstValueFrom(from(this.functions.call<TrainingDeliveryCommandV1, T>(name, command, {
      canExecute: () => active && !!uid && this.users.user()?.uid === uid && canExecute(),
    })).pipe(timeout(timeoutMs), finalize(() => { active = false; })));
    return result.data;
  }
}
