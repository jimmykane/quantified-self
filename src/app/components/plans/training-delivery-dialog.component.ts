import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { PLANNED_WORKOUT_PROVIDER_IDS, PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';
import { normalizeDeliveryTimeZone, type TrainingDeliveryAction, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliveryScope, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { EMPTY_TRAINING_DELIVERY_VIEW, TrainingDeliveryService } from '../../services/training-delivery.service';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { TRAINING_DELIVERY_STATUS_LABELS } from '../../helpers/training-delivery-display.helper';
import { trainingPlansWorkoutRoute } from '../../helpers/training-plans-navigation.helper';

export interface TrainingDeliveryDialogData { scope: TrainingDeliveryScope; id: string; title: string; }
interface DeliveryDraft { provider: PlannedWorkoutProviderId; action: TrainingDeliveryAction; timeZone: string; approvalDigest?: string; }

@Component({ selector: 'app-training-delivery-dialog', standalone: true,
  imports: [SharedModule, CompactRowComponent], templateUrl: './training-delivery-dialog.component.html',
  styleUrl: './training-delivery-dialog.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingDeliveryDialogComponent {
  readonly data = inject<TrainingDeliveryDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<TrainingDeliveryDialogComponent>);
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
  readonly extraStatuses = signal<TrainingDeliveryStatusV1[]>([]);
  readonly moreAvailable = signal(true);
  readonly view = toSignal(this.users.user$.pipe(switchMap(user => user?.uid ? this.delivery.watchScope(user.uid, this.data.scope, this.data.id).pipe(
    map(view => ({ ...view, loaded: true, error: false })),
    startWith({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: false, error: false }),
    catchError(() => of({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: true, error: true })),
  ) : of({ ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: true, error: false }))),
  { initialValue: { ...EMPTY_TRAINING_DELIVERY_VIEW, loaded: false, error: false } });
  readonly schedule = toSignal(this.users.user$.pipe(switchMap(user => user?.uid ? this.plans.watchSchedule(user.uid).pipe(
    startWith(null), catchError(() => of(null))) : of(null))), { initialValue: null });
  readonly scopeRecord = computed(() => this.data.scope === 'plan'
    ? this.schedule()?.plans.find(plan => plan.id === this.data.id)
    : this.schedule()?.workouts.find(workout => workout.id === this.data.id));
  readonly planBound = computed(() => this.schedule()?.workouts.find(workout => workout.id === this.data.id)?.planId != null && this.data.scope === 'workout');
  readonly statuses = computed(() => [...new Map([...this.extraStatuses(), ...this.view().statuses].map(status => [status.id, status])).values()]);
  readonly rows = computed(() => PLANNED_WORKOUT_PROVIDER_IDS.map(provider => {
    const setting = this.view().settings.find(item => item.provider === provider);
    const statuses = this.statuses().filter(item => item.provider === provider).map(status => ({ ...status,
      label: TRAINING_DELIVERY_STATUS_LABELS[status.status], route: trainingPlansWorkoutRoute(status.workoutId) }));
    const ready = this.delivery.isReady(provider);
    return { provider, label: PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label, ready, setting, statuses,
      visible: ready || !!setting || statuses.length > 0,
      canStop: !!setting?.enabled || statuses.some(item => item.hasRemoteCopy || item.status === 'pending'),
      approvalDigest: statuses.find(item => item.approvalDigest)?.approvalDigest ?? null,
      canRetry: statuses.some(item => ['failed', 'needs_attention', 'retrying'].includes(item.status)),
      reconnect: statuses.some(item => ['reconnect_required', 'connection_repair', 'fresh_consent_required'].includes(item.status)),
    };
  }).filter(row => row.visible));
  readonly canLoadMore = computed(() => this.view().statuses.length === 25 && this.moreAvailable());
  readonly canConfirm = computed(() => {
    const preview = this.preview();
    return !!preview && (preview.command.action === 'stop'
      || (preview.result.available && (preview.result.hasPro || preview.command.action === 'retry') && preview.result.connection === 'connected'
        && (preview.command.action !== 'approve' || !!preview.result.approvalDigest)));
  });

  constructor() {
    effect(() => {
      if (!this.uid() || this.uid() !== this.initialUid) {
        this.preview.set(null); this.draft.set(null); this.extraStatuses.set([]); this.dialogRef.close();
      }
    });
  }
  begin(provider: PlannedWorkoutProviderId, action: TrainingDeliveryAction, approvalDigest?: string): void {
    if (this.busy() || !this.uid()) return;
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
    if (!draft || !scope || !schedule || !uid || this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      const command: TrainingDeliveryCommandV1 = { schemaVersion: 1, mutationId: this.delivery.createMutationId(),
        scope: this.data.scope, scopeId: this.data.id, provider: draft.provider, action: draft.action,
        expectedScheduleRevision: schedule.state.revision, expectedScopeRevision: scope.revision,
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
  async loadMore(): Promise<void> {
    const uid = this.uid(); if (!uid || this.busy()) return;
    const cursor = this.statuses().map(status => status.id).sort().pop(); if (!cursor) return;
    this.busy.set(true);
    try {
      const page = await this.delivery.moreStatuses(uid, this.data.scope, this.data.id, cursor);
      if (this.uid() !== uid) return;
      this.extraStatuses.update(rows => [...rows, ...page]); this.moreAvailable.set(page.length === 25);
    } catch { if (this.uid() === uid) { this.error.set('Unable to load more delivery details.'); this.haptics.error(); } }
    finally { this.busy.set(false); }
  }
}
