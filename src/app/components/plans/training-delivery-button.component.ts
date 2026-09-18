import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { catchError, combineLatest, distinctUntilChanged, from, map, of, startWith, switchMap } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1 } from '@shared/planned-workout-providers';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { TrainingDeliveryService, TRAINING_DELIVERY_SUMMARY_LIMIT, type TrainingDeliveryView, type TrainingDeliveryViewScope } from '../../services/training-delivery.service';
import { TrainingDeliveryDialogComponent, type TrainingDeliveryDialogData } from './training-delivery-dialog.component';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { buildTrainingDeliverySummaries, type TrainingDeliverySummary } from '../../helpers/training-delivery-summary.helper';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';

interface DeliveryReadState { uid: string; hasRecords: boolean; view: TrainingDeliveryView | null; loaded: boolean; error: boolean; }
const EMPTY_READ: DeliveryReadState = { uid: '', hasRecords: false, view: null, loaded: false, error: false };

@Component({ selector: 'app-training-delivery-button', standalone: true, imports: [SharedModule, ServiceSourceIconComponent],
  templateUrl: './training-delivery-button.component.html', styleUrl: './training-delivery-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingDeliveryButtonComponent {
  readonly scope = input.required<TrainingDeliveryViewScope>();
  readonly entityId = input.required<string>();
  readonly title = input.required<string>();
  readonly standalone = input(false);
  readonly summaryWorkouts = input<readonly ScheduledWorkoutV1[] | null>(null);
  readonly summaryPlan = input<TrainingPlanV1 | null>(null);
  readonly summaryCompletions = input<readonly TrainingWorkoutCompletionV1[]>([]);
  readonly context = computed<TrainingDeliveryDialogData>(() => ({ scope: this.scope(), id: this.entityId(), title: this.title() }));
  readonly disabled = input(false);
  private readonly users = inject(AppUserService);
  private readonly delivery = inject(TrainingDeliveryService);
  private readonly dialog = inject(MatDialog);
  private readonly readContext = computed(() => ({ scope: this.scope(), id: this.entityId(),
    summaries: this.summaryWorkouts() !== null, parentPlanId: this.scope() === 'workout'
      ? this.summaryWorkouts()?.find(workout => workout.id === this.entityId())?.planId ?? null : null }));
  readonly readState = toSignal(combineLatest([
    this.users.user$.pipe(map(user => user?.uid ?? ''), distinctUntilChanged()),
    toObservable(this.readContext).pipe(distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))),
  ]).pipe(switchMap(([uid, context]) => {
    if (!uid) return of(EMPTY_READ);
    const source = context.summaries && context.scope !== 'history'
      ? this.delivery.watchSummaryScope(uid, context.scope, context.id, context.parentPlanId).pipe(
        map(view => ({ uid, hasRecords: !!(view.settings.length || view.statuses.length), view, loaded: true, error: false })))
      : this.delivery.watchPresence(uid, context.scope, context.id).pipe(
        map(hasRecords => ({ uid, hasRecords, view: null, loaded: true, error: false })));
    return source.pipe(startWith({ ...EMPTY_READ, uid }), catchError(() => of({ ...EMPTY_READ, uid, loaded: true, hasRecords: true, error: true })));
  })), { initialValue: EMPTY_READ });
  readonly hasRecords = computed(() => this.readState().uid === this.users.user()?.uid && this.readState().hasRecords);
  readonly summaryState = toSignal(combineLatest([toObservable(this.readState), toObservable(this.summaryWorkouts),
    toObservable(this.summaryPlan), toObservable(this.summaryCompletions), toObservable(this.context)]).pipe(switchMap(
    ([read, workouts, plan, completions, context]) => {
    const empty = { uid: read.uid, rows: [] as TrainingDeliverySummary[], error: read.error };
    if (!read.view || workouts === null || context.scope === 'history') return of(empty);
    return from(buildTrainingDeliverySummaries({ uid: read.uid, scope: context.scope, id: context.id, workouts, plan,
      ...read.view, completions,
      complete: read.view.summaryComplete !== false && read.view.statuses.length < TRAINING_DELIVERY_SUMMARY_LIMIT })).pipe(
      map(rows => ({ ...empty, rows })), startWith(empty), catchError(() => of({ ...empty, error: true })));
  })), { initialValue: { uid: '', rows: [] as TrainingDeliverySummary[], error: false } });
  readonly summaries = computed(() => this.summaryState().uid === this.users.user()?.uid ? this.summaryState().rows : []);
  readonly planSummaryAriaLabel = computed(() => `Plan sync. ${this.summaries().map(summary =>
    `${summary.presentation.displayLabel}: ${summary.label}${summary.detail && summary.detail !== summary.label ? `. ${summary.detail}` : ''}`)
    .join('. ')}. Open plan sync details`);
  readonly visible = computed(() => !!this.users.user()?.uid
    && (this.summaryWorkouts() === null || this.readState().uid === this.users.user()?.uid)
    && ((this.scope() !== 'history' && this.delivery.anyReady()) || this.hasRecords()));
  readonly singleProvider = computed(() => {
    const providers = PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => this.delivery.isReady(provider));
    return providers.length === 1 ? providers[0] : null;
  });
  readonly buttonLabel = computed(() => {
    if (this.scope() === 'history') return 'Workout sync history';
    if (this.hasRecords()) return this.scope() === 'plan' ? 'Plan sync' : 'Workout sync';
    const provider = this.singleProvider();
    const label = provider ? PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label : null;
    return this.scope() === 'plan' ? label ? `Sync plan with ${label}` : 'Sync plan'
      : this.standalone() ? label ? `Send to ${label}` : 'Send workout' : 'Workout sync';
  });
  open(): void {
    if (!this.visible() || this.disabled()) return;
    const provider = this.singleProvider();
    const data: TrainingDeliveryDialogData = { ...this.context(),
      ...(this.readState().loaded && !this.hasRecords() && provider && (this.scope() === 'plan' || this.standalone()) ? { initialProvider: provider } : {}) };
    this.dialog.open(TrainingDeliveryDialogComponent, { data, width: '640px', maxWidth: '95vw' });
  }
}
