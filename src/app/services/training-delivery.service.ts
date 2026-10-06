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
import { parseScheduledWorkoutV1, parseTrainingPlanStateV1, parseTrainingPlanV1, TRAINING_PLAN_MAX_CURRENT_WORKOUTS } from '@shared/training-plans';
import { TRAINING_DELIVERY_VERIFICATIONS, parseTrainingVerificationV1,
  type TrainingVerificationReceiptV1, type TrainingVerificationV1 } from '@shared/training-provider-verification';

export interface TrainingDeliveryView {
  verifications?: TrainingVerificationV1[];
  settings: TrainingDeliverySettingsV1[];
  statuses: TrainingDeliveryStatusV1[];
  /** Summary-only look-ahead for plan workout overrides; ordinary dialog pagination is unchanged. */
  summaryComplete?: boolean;
}
/** History is a read-only UI scope, never a delivery command or new consent scope. */
export type TrainingDeliveryViewScope = TrainingDeliveryScope | 'history';
export const EMPTY_TRAINING_DELIVERY_VIEW: TrainingDeliveryView = { settings: [], statuses: [] };
export const TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS = 30_000;
export const TRAINING_DELIVERY_SAVE_TIMEOUT_MS = 70_000;
// One look-ahead beyond the current 400-workout/four-provider bound. Historical
// identities can exceed it; summaries must then explicitly withhold complete totals.
export const TRAINING_DELIVERY_SUMMARY_LIMIT = TRAINING_PLAN_MAX_CURRENT_WORKOUTS * PLANNED_WORKOUT_PROVIDER_IDS.length + 1;
// Cached missing documents are not proof of disabled consent. Metadata-only
// server acknowledgements must also unblock the initial read.
const SERVER_CONFIRMED = { waitForServer: true } as const;

function parseScopeSettings(value: unknown, scope: TrainingDeliveryScope, id: string,
  provider: PlannedWorkoutProviderId): TrainingDeliverySettingsV1 | undefined {
  if (value === undefined) return undefined;
  const setting = parseTrainingDeliverySettingsV1(value);
  if (setting.scope !== scope || setting.scopeId !== id || setting.provider !== provider) {
    throw new Error('Sync settings do not match their document.');
  }
  return setting;
}

/** Browser setup follows the shared provider-admission boundary. */
export function isTrainingDeliverySetupAvailableInApp(
  provider: PlannedWorkoutProviderId,
  uid: string | null | undefined,
  _planDelivery: boolean,
): boolean {
  return isTrainingProviderDeliveryEnabled(provider, uid);
}

@Injectable({ providedIn: 'root' })
export class TrainingDeliveryService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(AppFunctionsService);
  private readonly browser = inject(BrowserCompatibilityService);
  private readonly users = inject(AppUserService);
  readonly isReady = (provider: PlannedWorkoutProviderId) => isTrainingProviderDeliveryEnabled(provider, this.users.user()?.uid);
  readonly isVisible = (provider: PlannedWorkoutProviderId) => this.isReady(provider);
  readonly isSetupAvailable = (provider: PlannedWorkoutProviderId, planDelivery: boolean) =>
    isTrainingDeliverySetupAvailableInApp(provider, this.users.user()?.uid, planDelivery);
  readonly anyReady = computed(() => PLANNED_WORKOUT_PROVIDER_IDS.some(provider => this.isReady(provider)));

  createMutationId(): string {
    return this.browser.createRandomUUID() ?? `delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  watchPresence(uid: string, scope: TrainingDeliveryViewScope, id: string): Observable<boolean> {
    if (!uid) return of(false);
    const visibleProviders = PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => this.isVisible(provider));
    if (!visibleProviders.length) return of(false);
    if (scope === 'history') return combineLatest(visibleProviders.map(provider => collectionData(query(
      collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES), where('provider', '==', provider), limit(1)),
      SERVER_CONFIRMED))).pipe(timeout({ first: TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS }), map(results => results.some(rows => rows.length > 0)));
    return combineLatest([
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
        where(scope === 'plan' ? 'planId' : 'workoutId', '==', id), limit(TRAINING_DELIVERY_SUMMARY_LIMIT)), SERVER_CONFIRMED),
      collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_SETTINGS),
        where('scope', '==', scope), where('scopeId', '==', id), limit(PLANNED_WORKOUT_PROVIDER_IDS.length)), SERVER_CONFIRMED),
    ]).pipe(timeout({ first: TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS }),
      map(values => values.some(rows => rows.some(row => visibleProviders.includes(row['provider'] as PlannedWorkoutProviderId)))));
  }
  watchScope(uid: string, scope: TrainingDeliveryViewScope, id: string,
    statusLimit = TRAINING_DELIVERY_PAGE_SIZE, includeVerification = true): Observable<TrainingDeliveryView> {
    if (!uid) return of(EMPTY_TRAINING_DELIVERY_VIEW);
    const settings$ = scope === 'history' ? of([] as TrainingDeliverySettingsV1[]) : combineLatest(PLANNED_WORKOUT_PROVIDER_IDS.map(provider => docData(doc(this.firestore,
      'users', uid, TRAINING_DELIVERY_SETTINGS, deliverySettingsId(scope, id, provider)), SERVER_CONFIRMED))).pipe(
      map(values => values.map((value, index) => parseScopeSettings(value, scope, id, PLANNED_WORKOUT_PROVIDER_IDS[index]))
        .filter((value): value is TrainingDeliverySettingsV1 => value !== undefined)));
    const statuses$ = collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_STATUSES),
      ...(scope === 'history' ? [] : [where(scope === 'plan' ? 'planId' : 'workoutId', '==', id)]),
      orderBy('__name__'), limit(statusLimit)), SERVER_CONFIRMED).pipe(
      map(values => values.map(parseTrainingDeliveryStatusV1)));
    const verifications$ = includeVerification ? collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_VERIFICATIONS),
      ...(scope === 'history' ? [] : [where(scope === 'plan' ? 'planId' : 'workoutId', '==', id)]),
      orderBy('__name__'), limit(statusLimit)), SERVER_CONFIRMED).pipe(map(values => values.map(parseTrainingVerificationV1))) : of([]);
    return combineLatest([settings$, statuses$, verifications$]).pipe(timeout({ first: TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS }),
      map(([settings, statuses, verifications]) => ({ settings, statuses, verifications })));
  }
  watchSummaryScope(uid: string, scope: 'plan' | 'workout', id: string, parentPlanId: string | null): Observable<TrainingDeliveryView> {
    // A single workout can show its latest remote check beside the accepted-send status.
    // Keep the plan aggregate bounded to delivery records; it is not a live inventory.
    const view$ = this.watchScope(uid, scope, id, TRAINING_DELIVERY_SUMMARY_LIMIT, scope === 'workout');
    if (!uid) return view$;
    if (scope === 'plan') {
      const overrides$ = collectionData(query(collection(this.firestore, 'users', uid, TRAINING_DELIVERY_SETTINGS),
        where('scope', '==', 'workout'), where('associationPlanId', '==', id), limit(TRAINING_DELIVERY_SUMMARY_LIMIT)), SERVER_CONFIRMED).pipe(
        map(values => values.map(parseTrainingDeliverySettingsV1)));
      return combineLatest([view$, overrides$]).pipe(timeout({ first: TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS }), map(([view, overrides]) => ({ ...view,
        settings: [...view.settings, ...overrides], summaryComplete: overrides.length < TRAINING_DELIVERY_SUMMARY_LIMIT })));
    }
    if (!parentPlanId) return view$;
    const parent$ = combineLatest(PLANNED_WORKOUT_PROVIDER_IDS.map(provider => docData(doc(this.firestore,
      'users', uid, TRAINING_DELIVERY_SETTINGS, deliverySettingsId('plan', parentPlanId, provider)), SERVER_CONFIRMED))).pipe(
      map(values => values.map((value, index) => parseScopeSettings(value, 'plan', parentPlanId, PLANNED_WORKOUT_PROVIDER_IDS[index]))
        .filter((value): value is TrainingDeliverySettingsV1 => value !== undefined)));
    return combineLatest([view$, parent$]).pipe(timeout({ first: TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS }),
      map(([view, parent]) => ({ ...view, settings: [...view.settings, ...parent] })));
  }
  async preview(command: TrainingDeliveryCommandV1, canExecute: () => boolean = () => true): Promise<TrainingDeliveryPreviewV1> {
    return this.invoke<TrainingDeliveryPreviewV1>('previewTrainingProviderDelivery', command, canExecute, TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS);
  }
  async mutate(command: TrainingDeliveryCommandV1, canExecute: () => boolean = () => true): Promise<TrainingDeliverySettingsV1> {
    return this.invoke<TrainingDeliverySettingsV1>('mutateTrainingProviderDelivery', command, canExecute, TRAINING_DELIVERY_SAVE_TIMEOUT_MS);
  }
  async check(command: TrainingDeliveryCommandV1 & { action: 'check' }, canExecute: () => boolean = () => true): Promise<TrainingVerificationReceiptV1> {
    return this.invoke<TrainingVerificationReceiptV1>('mutateTrainingProviderDelivery', command, canExecute, TRAINING_DELIVERY_SAVE_TIMEOUT_MS);
  }
  private async invoke<T>(name: 'previewTrainingProviderDelivery' | 'mutateTrainingProviderDelivery',
    command: TrainingDeliveryCommandV1, canExecute: () => boolean, timeoutMs: number): Promise<T> {
    const uid = this.users.user()?.uid;
    let active = true;
    const current = () => active && !!uid && this.users.user()?.uid === uid && canExecute();
    const request = { ...command };
    // Bound server reads, App Check/token readiness and HTTP together. A timeout
    // cannot undo an in-flight write; keep approved commands/receipt replays exact.
    const result = await firstValueFrom(from((async () => {
      if (!current()) throw Object.assign(new Error('Sync review is no longer open.'), { code: 'cancelled' });
      let payload = request;
      if (name === 'previewTrainingProviderDelivery' || request.action === 'check') {
        const revisions = await this.readCurrentRevisions(uid!, request, current);
        if (!current()) throw Object.assign(new Error('Sync review is no longer open.'), { code: 'cancelled' });
        if (request.action === 'check') payload = { ...request, ...revisions };
        else if (Object.entries(revisions).some(([key, revision]) => request[key as keyof typeof revisions] !== revision)) {
          // Never silently turn a stale "off" view into a fresh consent review.
          throw Object.assign(new Error('The schedule or sync settings changed.'), { code: 'aborted' });
        }
      }
      return this.functions.call<TrainingDeliveryCommandV1, T>(name, payload, { canExecute: current });
    })()).pipe(timeout(timeoutMs), finalize(() => { active = false; })));
    return result.data;
  }

  private async readCurrentRevisions(uid: string, command: TrainingDeliveryCommandV1, current: () => boolean): Promise<Pick<TrainingDeliveryCommandV1,
    'expectedScheduleRevision' | 'expectedScopeRevision' | 'expectedSettingsRevision'>> {
    const assertCurrent = () => {
      if (!current()) throw Object.assign(new Error('Sync review is no longer open.'), { code: 'cancelled' });
    };
    assertCurrent();
    // Full SDK server reads still use its watch/local-store path, which can
    // repeat a persisted NoDocument result. Like profile verification, use
    // uncached Lite REST reads with the same app's Auth and App Check providers.
    // Keep this dependency lazy and the existing live listeners unchanged.
    const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
    assertCurrent();
    const firestore = getFirestore(this.firestore.app);
    const [state, scope, settings] = await Promise.all([
      getDoc(doc(firestore, 'users', uid, 'trainingPlanState', 'current')),
      getDoc(doc(firestore, 'users', uid, command.scope === 'plan' ? 'trainingPlans' : 'scheduledWorkouts', command.scopeId)),
      getDoc(doc(firestore, 'users', uid, TRAINING_DELIVERY_SETTINGS, deliverySettingsId(command.scope, command.scopeId, command.provider))),
    ]);
    assertCurrent();
    const record = scope.exists() ? (command.scope === 'plan' ? parseTrainingPlanV1(scope.data()) : parseScheduledWorkoutV1(scope.data())) : undefined;
    if (record && record.id !== command.scopeId) throw new Error('Sync source does not match its document.');
    const setting = parseScopeSettings(settings.exists() ? settings.data() : undefined, command.scope, command.scopeId, command.provider);
    return { expectedScheduleRevision: state.exists() ? parseTrainingPlanStateV1(state.data()).revision : 0,
      expectedScopeRevision: record?.revision ?? 0, expectedSettingsRevision: setting?.revision ?? 0 };
  }
}
