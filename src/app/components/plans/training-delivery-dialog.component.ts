import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';
import { normalizeDeliveryTimeZone, TRAINING_DELIVERY_PAGE_SIZE, type TrainingDeliveryAction, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { EMPTY_TRAINING_DELIVERY_VIEW, TrainingDeliveryService, type TrainingDeliveryViewScope } from '../../services/training-delivery.service';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { TRAINING_DELIVERY_STATUS_LABELS } from '../../helpers/training-delivery-display.helper';
import { trainingPlansWorkoutRoute } from '../../helpers/training-plans-navigation.helper';

export interface TrainingDeliveryDialogData { scope: TrainingDeliveryViewScope; id: string; title: string; }
interface DeliveryDraft { provider: PlannedWorkoutProviderId; action: TrainingDeliveryAction; timeZone: string; approvalDigest?: string; }

@Component({ selector: 'app-training-delivery-dialog', standalone: true,
  imports: [SharedModule, CompactRowComponent], templateUrl: './training-delivery-dialog.component.html',
  styleUrl: './training-delivery-dialog.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingDeliveryDialogComponent {
  readonly data = inject<TrainingDeliveryDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<TrainingDeliveryDialogComponent>);
  private readonly dialog = inject(MatDialog);
  readonly delivery = inject(TrainingDeliveryService);
  private readonly plans = inject(TrainingPlansService);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  readonly uid = toSignal(this.users.user$.pipe(map(user => user?.uid ?? '')), { initialValue: '' });
  private readonly initialUid = this.users.user()?.uid;
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly draft = signal<DeliveryDraft | null>(null);
  readonly preview = signal<{ result: TrainingDeliveryPreviewV1; command: TrainingDeliveryCommandV1 } | null>(null);
  private readonly statusLimit = signal(TRAINING_DELIVERY_PAGE_SIZE);
  // Keep the entire loaded prefix live: separate cursor snapshots leave stale rows
  // and gaps when reconciliation inserts, removes, or transfers records between pages.
  readonly view = toSignal(combineLatest([this.users.user$, toObservable(this.statusLimit)]).pipe(
    switchMap(([user, statusLimit]) => user?.uid ? this.delivery.watchScope(user.uid, this.data.scope, this.data.id, statusLimit).pipe(
    map(view => ({ ...view, loaded: true, error: false })),
    startWith({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: false, error: false }),
    catchError(() => of({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: true, error: true })),
  ) : of({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: true, error: false }))),
  { initialValue: { ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: false, error: false } });
  readonly schedule = toSignal(this.users.user$.pipe(switchMap(user => user?.uid ? this.plans.watchSchedule(user.uid).pipe(
    startWith(null), catchError(() => of(null))) : of(null))), { initialValue: null });
  readonly scopeRecord = computed(() => this.data.scope === 'history' ? undefined : this.data.scope === 'plan'
    ? this.schedule()?.plans.find(plan => plan.id === this.data.id)
    : this.schedule()?.workouts.find(workout => workout.id === this.data.id));
  readonly planBound = computed(() => this.schedule()?.workouts.find(workout => workout.id === this.data.id)?.planId != null && this.data.scope === 'workout');
  readonly canSend = computed(() => !!this.scopeRecord() && this.scopeRecord()!.lifecycle !== 'deleted');
  readonly canReview = computed(() => !!this.schedule() && this.data.scope !== 'history'
    && (!!this.scopeRecord() || this.statuses().length > 0));
  readonly statuses = computed(() => this.view().statuses);
  readonly rows = computed(() => PLANNED_WORKOUT_PROVIDER_IDS.map(provider => {
    const setting = this.view().settings.find(item => item.provider === provider);
    const statuses = this.statuses().filter(item => item.provider === provider).map(status => {
      const workout = this.schedule()?.workouts.find(item => item.id === status.workoutId);
      return { ...status, title: workout?.title ?? 'Deleted workout', sourceExists: !!workout && workout.lifecycle !== 'deleted',
        label: TRAINING_DELIVERY_STATUS_LABELS[status.status], route: trainingPlansWorkoutRoute(status.workoutId) };
    });
    const ready = this.delivery.isReady(provider);
    return { provider, label: PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label, ready, setting, statuses,
      visible: (ready && this.canSend()) || !!setting || statuses.length > 0,
      canStop: !!setting?.enabled || (this.planBound() && !setting?.suppressed)
        || statuses.some(item => item.hasRemoteCopy || !['stopped', 'removed', 'past', 'completed'].includes(item.status)),
      approvalDigest: statuses.find(item => item.approvalDigest)?.approvalDigest ?? null,
      canRetry: statuses.some(item => ['failed', 'needs_attention', 'retrying'].includes(item.status)),
      reconnect: statuses.some(item => ['reconnect_required', 'connection_repair', 'fresh_consent_required'].includes(item.status)),
    };
  }).filter(row => row.visible));
  readonly canLoadMore = computed(() => this.view().loaded && this.statuses().length === this.statusLimit());
  readonly canConfirm = computed(() => {
    const preview = this.preview();
    return !!preview && (preview.command.action === 'stop'
      || (preview.result.available && (preview.result.hasPro || preview.command.action === 'retry') && preview.result.connection === 'connected'
        && (preview.command.action !== 'approve' || !!preview.result.approvalDigest)));
  });

  constructor() {
    effect(() => {
      if (!this.uid() || this.uid() !== this.initialUid) {
        this.preview.set(null); this.draft.set(null); this.dialogRef.close();
      }
    });
  }
  begin(provider: PlannedWorkoutProviderId, action: TrainingDeliveryAction, approvalDigest?: string): void {
    if (this.busy() || !this.uid() || this.data.scope === 'history'
      || (!this.canSend() && !['stop', 'retry'].includes(action))) return;
    const setting = this.view().settings.find(item => item.provider === provider);
    this.error.set(null); this.preview.set(null);
    this.draft.set({ provider, action, timeZone: setting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(approvalDigest ? { approvalDigest } : {}) });
  }
  updateTimeZone(value: string): void {
    this.draft.update(draft => draft ? { ...draft, timeZone: value } : null);
    this.preview.set(null);
  }
  cancelReview(): void {
    if (this.busy()) return;
    this.draft.set(null); this.preview.set(null); this.error.set(null);
  }
  async review(): Promise<void> {
    const draft = this.draft(); const scope = this.scopeRecord(); const schedule = this.schedule(); const uid = this.uid();
    if (!draft || !schedule || !uid || this.busy() || !this.canReview() || this.data.scope === 'history') return;
    this.busy.set(true); this.error.set(null);
    try {
      const command: TrainingDeliveryCommandV1 = { schemaVersion: 1, mutationId: this.delivery.createMutationId(),
        scope: this.data.scope, scopeId: this.data.id, provider: draft.provider, action: draft.action,
        expectedScheduleRevision: schedule.state.revision, expectedScopeRevision: scope?.revision ?? 0,
        expectedSettingsRevision: this.view().settings.find(item => item.provider === draft.provider)?.revision ?? 0,
        ...(['configure', 'send'].includes(draft.action) || (draft.action === 'resume' && !this.planBound())
          ? { timeZone: normalizeDeliveryTimeZone(draft.timeZone) } : {}),
        ...(draft.action === 'approve' ? { approvalDigest: draft.approvalDigest } : {}) };
      const result = await this.delivery.preview(command);
      if (this.uid() !== uid) return;
      this.preview.set({ result, command: command.action === 'approve' && result.approvalDigest
        ? { ...command, approvalDigest: result.approvalDigest } : command });
    } catch { if (this.uid() === uid) { this.error.set('Unable to preview. Check the time zone and refresh if the schedule changed.'); this.haptics.error(); } }
    finally { this.busy.set(false); }
  }
  async confirm(): Promise<void> {
    const preview = this.preview(); const uid = this.uid();
    if (!preview || !uid || !this.canConfirm() || this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      // Retain this exact mutation ID on failure, so an uncertain response is safe to retry.
      await this.delivery.mutate(preview.command);
      if (this.uid() !== uid) return;
      this.preview.set(null); this.draft.set(null); this.haptics.success();
    } catch { if (this.uid() === uid) { this.error.set('The change was not confirmed. Retry safely, or cancel and review the latest schedule.'); this.haptics.error(); } }
    finally { this.busy.set(false); }
  }
  loadMore(): void {
    if (!this.uid() || this.busy() || !this.canLoadMore()) return;
    this.statusLimit.update(count => count + TRAINING_DELIVERY_PAGE_SIZE);
  }
  inspectWorkout(status: TrainingDeliveryStatusV1): void {
    if (!this.uid() || this.busy()) return;
    const title = this.schedule()?.workouts.find(workout => workout.id === status.workoutId)?.title ?? 'Deleted workout';
    this.dialogRef.close();
    this.dialog.open(TrainingDeliveryDialogComponent, { data: { scope: 'workout', id: status.workoutId, title },
      width: '640px', maxWidth: '95vw' });
  }
}
