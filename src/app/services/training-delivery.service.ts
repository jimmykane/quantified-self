import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData, query, where, limit, orderBy, startAfter, getDocs } from 'app/firebase/firestore';
import { combineLatest, map, Observable, of } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, isPlannedWorkoutProviderDeliveryEnabled } from '@shared/planned-workout-providers';
import { deliverySettingsId, parseTrainingDeliverySettingsV1, parseTrainingDeliveryStatusV1,
  TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliveryScope, type TrainingDeliverySettingsV1, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';

export interface TrainingDeliveryView { settings: TrainingDeliverySettingsV1[]; statuses: TrainingDeliveryStatusV1[]; }
export const EMPTY_TRAINING_DELIVERY_VIEW: TrainingDeliveryView = { settings: [], statuses: [] };

@Injectable({ providedIn: 'root' })
export class TrainingDeliveryService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);
  private readonly browser = inject(BrowserCompatibilityService);
  readonly isReady = isPlannedWorkoutProviderDeliveryEnabled;
  readonly anyReady = PLANNED_WORKOUT_PROVIDER_IDS.some(isPlannedWorkoutProviderDeliveryEnabled);

  createMutationId(): string {
    return this.browser.createRandomUUID() ?? `delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  watchPresence(uid: string, scope: TrainingDeliveryScope, id: string): Observable<boolean> {
    if (!uid) return of(false);
    return combineLatest([
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
        where(scope === 'plan' ? 'planId' : 'workoutId', '==', id), limit(1))),
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_SETTINGS),
        where('scope', '==', scope), where('scopeId', '==', id), limit(1))),
    ]).pipe(map(values => values.some(rows => rows.length > 0)));
  }
  watchScope(uid: string, scope: TrainingDeliveryScope, id: string): Observable<TrainingDeliveryView> {
    if (!uid) return of(EMPTY_TRAINING_DELIVERY_VIEW);
    const settings$ = combineLatest(PLANNED_WORKOUT_PROVIDER_IDS.map(provider => docData(doc(this.firestore,
      'users', uid, TRAINING_DELIVERY_SETTINGS, deliverySettingsId(scope, id, provider))))).pipe(
      map(values => values.filter(value => value !== undefined).map(parseTrainingDeliverySettingsV1)));
    const statuses$ = collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
      where(scope === 'plan' ? 'planId' : 'workoutId', '==', id), orderBy('__name__'), limit(25))).pipe(
      map(values => values.map(parseTrainingDeliveryStatusV1)));
    return combineLatest([settings$, statuses$]).pipe(map(([settings, statuses]) => ({ settings, statuses })));
  }
  async moreStatuses(uid: string, scope: TrainingDeliveryScope, id: string, cursor: string): Promise<TrainingDeliveryStatusV1[]> {
    const snapshot = await getDocs(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
      where(scope === 'plan' ? 'planId' : 'workoutId', '==', id), orderBy('__name__'), startAfter(cursor), limit(25)));
    return snapshot.docs.map(doc => parseTrainingDeliveryStatusV1(doc.data()));
  }
  async preview(command: TrainingDeliveryCommandV1): Promise<TrainingDeliveryPreviewV1> {
    return (await this.functions.call<TrainingDeliveryCommandV1, TrainingDeliveryPreviewV1>('previewTrainingProviderDelivery', command)).data;
  }
  async mutate(command: TrainingDeliveryCommandV1): Promise<TrainingDeliverySettingsV1> {
    return (await this.functions.call<TrainingDeliveryCommandV1, TrainingDeliverySettingsV1>('mutateTrainingProviderDelivery', command)).data;
  }
}
