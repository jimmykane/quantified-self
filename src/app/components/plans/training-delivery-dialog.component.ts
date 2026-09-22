import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, afterRenderEffect, effect, inject, signal,
  viewChild, viewChildren, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';
import { normalizeDeliveryTimeZone, TRAINING_DELIVERY_PAGE_SIZE, type TrainingDeliveryAction, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { EMPTY_TRAINING_DELIVERY_VIEW, TrainingDeliveryService, type TrainingDeliveryViewScope } from '../../services/training-delivery.service';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { trainingDeliveryCommandError, trainingDeliveryCopyMessage, trainingDeliveryLatestEvent } from '../../helpers/training-delivery-display.helper';
import { trainingPlansWorkoutRoute } from '../../helpers/training-plans-navigation.helper';
import { trainingVerificationCommandError, trainingVerificationLabel } from '../../helpers/training-verification-display.helper';
import { buildDestinationProviderPresentation } from '../../helpers/provider-presentation.helper';
import { WAHOO_TRAINING_PERMISSION_ISSUE } from '@shared/wahoo-training';
import { WahooRouteAccessReconnectDialogComponent } from '../wahoo-route-access-reconnect-dialog/wahoo-route-access-reconnect-dialog.component';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import type { TrainingDeliverySummary } from '../../helpers/training-delivery-summary.helper';

const PROVIDER_PRESENTATIONS = {
  garmin: buildDestinationProviderPresentation(ServiceNames.GarminAPI),
  coros: buildDestinationProviderPresentation(ServiceNames.COROSAPI),
  wahoo: buildDestinationProviderPresentation(ServiceNames.WahooAPI),
  suunto: buildDestinationProviderPresentation(ServiceNames.SuuntoApp),
} satisfies Record<PlannedWorkoutProviderId, ReturnType<typeof buildDestinationProviderPresentation>>;

export interface TrainingDeliveryDialogData {
  scope: TrainingDeliveryViewScope; id: string; title: string;
  returnTo?: { scope: 'plan' | 'history'; id: string; title: string; selectedProvider?: PlannedWorkoutProviderId };
  /** Select a provider in the overview without starting or changing consent. */
  selectedProvider?: PlannedWorkoutProviderId;
  /** Open a read-only consent check directly when there is only one available destination. */
  initialProvider?: PlannedWorkoutProviderId;
  /** Live presentation summaries from the plan surface; never used as delivery authority. */
  planSummaries?: Signal<readonly TrainingDeliverySummary[]>;
}
interface DeliveryDraft {
  provider: PlannedWorkoutProviderId; action: TrainingDeliveryAction; timeZone: string; approvalDigest?: string;
  editingSettings: boolean; initialTimeZone: string; initialSettingsRevision: number;
}

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
  readonly haptics = inject(AppHapticsService);
  private readonly destroyRef = inject(DestroyRef);
  private requestVersion = 0;
  private initialReviewHandled = false;
  private closeOnCancel = false;
  private timeZoneReviewTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly confirmationAttempted = signal(false);
  readonly uid = toSignal(this.users.user$.pipe(map(user => user?.uid ?? '')), { initialValue: '' });
  private readonly initialUid = this.users.user()?.uid;
  private readonly sameAccount = computed(() => !!this.initialUid && this.uid() === this.initialUid && this.users.user()?.uid === this.initialUid);
  readonly error = signal<string | null>(null);
  readonly phase = signal<'preview' | 'saving' | 'checking' | null>(null);
  readonly checkingProvider = signal<PlannedWorkoutProviderId | null>(null);
  readonly busy = computed(() => this.phase() !== null);
  readonly notice = signal<string | null>(null);
  readonly draft = signal<DeliveryDraft | null>(null);
  readonly selectedProvider = signal<PlannedWorkoutProviderId | null>(this.data.selectedProvider ?? this.data.initialProvider ?? null);
  readonly editingTimeZone = signal(false);
  readonly guidanceExpanded = signal(false);
  readonly attemptsExpanded = signal<string | null>(null);
  private readonly navigationFocus = signal<{ view: 'title' } | { view: 'overview'; provider: PlannedWorkoutProviderId } | null>(null);
  private readonly dialogTitleElement = viewChild<ElementRef<HTMLHeadingElement>>('dialogTitleElement');
  private readonly providerManageButtons = viewChildren('providerManage', { read: ElementRef<HTMLButtonElement> });
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
  readonly scheduleView = toSignal(this.users.user$.pipe(switchMap(user => user?.uid ? this.plans.watchSchedule(user.uid).pipe(
    map(value => ({ value, loaded: true, error: false })),
    startWith({ value: null, loaded: false, error: false }),
    catchError(() => of({ value: null, loaded: true, error: true })))
    : of({ value: null, loaded: true, error: false }))), { initialValue: { value: null, loaded: false, error: false } });
  readonly schedule = computed(() => this.scheduleView().value);
  readonly completions = toSignal(this.users.user$.pipe(switchMap(user => user?.uid
    ? (typeof this.plans.watchWorkoutCompletions === 'function'
      ? this.plans.watchWorkoutCompletions(user.uid).pipe(catchError(() => of([] as TrainingWorkoutCompletionV1[])))
      : of([] as TrainingWorkoutCompletionV1[]))
    : of([] as TrainingWorkoutCompletionV1[]))), { initialValue: [] as TrainingWorkoutCompletionV1[] });
  readonly scopeRecord = computed(() => this.data.scope === 'history' ? undefined : this.data.scope === 'plan'
    ? this.schedule()?.plans.find(plan => plan.id === this.data.id)
    : this.schedule()?.workouts.find(workout => workout.id === this.data.id));
  readonly workout = computed(() => this.data.scope === 'workout' ? this.schedule()?.workouts.find(item => item.id === this.data.id) : undefined);
  readonly parentPlan = computed(() => this.schedule()?.plans.find(plan => plan.id === this.workout()?.planId));
  readonly scopeTitle = computed(() => this.data.scope === 'plan'
    ? this.schedule()?.plans.find(plan => plan.id === this.data.id)?.name ?? this.data.title
    : this.workout()?.title ?? this.data.title);
  readonly workoutRoute = computed(() => this.workout() && this.workout()?.lifecycle !== 'deleted' ? trainingPlansWorkoutRoute(this.data.id) : null);
  readonly stopLabel = computed(() => this.data.scope === 'plan' ? 'Stop plan sync'
    : this.planBound() && this.canSend() ? 'Exclude from plan sync' : 'Stop workout sync');
  readonly planBound = computed(() => this.schedule()?.workouts.find(workout => workout.id === this.data.id)?.planId != null && this.data.scope === 'workout');
  readonly planDelivery = computed(() => this.data.scope === 'plan' || this.planBound());
  readonly canSend = computed(() => !!this.scopeRecord() && this.scopeRecord()!.lifecycle !== 'deleted');
  readonly canReview = computed(() => this.view().loaded && !this.view().error && !!this.schedule() && this.data.scope !== 'history'
    && (!!this.scopeRecord() || this.statuses().length > 0));
  readonly statuses = computed(() => this.view().statuses);
  readonly draftLabel = computed(() => {
    const draft = this.draft();
    return draft ? PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[draft.provider].label : '';
  });
  readonly editingSettings = computed(() => !!this.draft()?.editingSettings);
  readonly normalizedTimeZone = computed(() => {
    try { return normalizeDeliveryTimeZone(this.draft()?.timeZone.trim()); } catch { return null; }
  });
  readonly hasSettingsChanges = computed(() => {
    const draft = this.draft();
    if (!draft?.editingSettings || !this.normalizedTimeZone()) return false;
    return this.normalizedTimeZone() !== normalizeDeliveryTimeZone(draft.initialTimeZone);
  });
  readonly settingsChangedElsewhere = computed(() => {
    const draft = this.draft();
    if (!draft?.editingSettings) return false;
    const setting = this.view().settings.find(item => item.provider === draft.provider);
    return !setting?.enabled || (setting.revision ?? 0) !== draft.initialSettingsRevision;
  });
  readonly dialogTitle = computed(() => {
    if (this.editingSettings()) return this.data.scope === 'plan' ? 'Plan sync settings' : 'Workout sync settings';
    switch (this.draft()?.action) {
      case 'configure': return `Enable plan sync with ${this.draftLabel()}`;
      case 'send': return `Send workout to ${this.draftLabel()}`;
      case 'resume': return 'Resume workout sync';
      case 'stop': return `${this.stopLabel()}?`;
      case 'approve': return `Review ${this.draftLabel()} differences`;
      case 'retry': return this.data.scope === 'plan' ? 'Retry plan sync' : 'Retry workout sync';
      default: {
        const provider = this.providerDetailVisible() ? this.activeRow()?.displayLabel : null;
        if (this.data.scope === 'history') return provider ? `${provider} sync history` : 'Workout sync history';
        if (this.data.scope === 'plan') return provider ? `Plan sync with ${provider}` : 'Plan sync';
        return provider ? `Workout sync with ${provider}` : 'Workout sync';
      }
    }
  });
  readonly canChangeTimeZone = computed(() => {
    const action = this.draft()?.action;
    return action === 'configure' || action === 'send' || (action === 'resume' && !this.planBound());
  });
  readonly confirmLabel = computed(() => {
    const draft = this.draft();
    if (this.editingSettings()) return 'Save changes';
    switch (draft?.action) {
      case 'stop': return this.stopLabel();
      case 'retry': return 'Request recovery';
      case 'approve': return 'Approve differences';
      case 'resume': return 'Resume workout sync';
      case 'configure': return 'Enable plan sync';
      default: return 'Send workout';
    }
  });
  readonly rows = computed(() => PLANNED_WORKOUT_PROVIDER_IDS.map(provider => {
    const setting = this.view().settings.find(item => item.provider === provider);
    const currentPlanId = this.schedule()?.workouts.find(item => item.id === this.data.id)?.planId;
    const inheritedSetting = this.planBound() && setting?.associationPlanId === currentPlanId ? setting : undefined;
    const suppressed = !!inheritedSetting?.suppressed;
    const statuses = this.statuses().filter(item => item.provider === provider).map(status => {
      const verification = this.view().verifications?.find(item => item.id === status.id);
      const workout = this.schedule()?.workouts.find(item => item.id === status.workoutId);
      const plan = this.schedule()?.plans.find(item => item.id === workout?.planId);
      const completionPlanId = workout ? workout.planId : status.planId;
      const completion = this.completions().find(item => item.workoutId === status.workoutId && item.planId === completionPlanId);
      return { ...status, title: workout?.title ?? (this.scheduleView().error ? 'Workout unavailable'
        : this.scheduleView().loaded ? 'Deleted workout' : 'Loading workout…'),
        localDate: workout?.localDate ?? null,
        scopeLabel: workout?.lifecycle === 'deleted' ? 'Deleted workout'
          : workout ? workout.planId ? `Plan: ${plan?.name ?? 'Unavailable plan'}` : 'Standalone workout' : null,
        moved: !!workout && (workout.lifecycle === 'deleted' || (this.data.scope === 'plan' && workout.planId !== this.data.id)),
        verification, label: trainingVerificationLabel(status, verification, completion), copyMessage: trainingDeliveryCopyMessage(status),
        showLastSent: status.lastAcceptedAtMs !== null && (status.hasRemoteCopy || verification?.missing),
        ...trainingDeliveryLatestEvent(status),
      };
    }).sort((a, b) => (a.localDate ?? '9999-99-99').localeCompare(b.localDate ?? '9999-99-99') || a.id.localeCompare(b.id));
    const ready = this.delivery.isReady(provider);
    const setupAvailable = this.delivery.isSetupAvailable(provider, this.planDelivery());
    const attentionWorkoutCount = new Set(statuses.filter(item => ['approval_required', 'failed', 'needs_attention', 'unsupported',
      'reconnect_required', 'connection_repair', 'fresh_consent_required'].includes(item.status)).map(item => item.workoutId)).size;
    const statusWorkoutCount = new Set(statuses.map(item => item.workoutId)).size;
    const scopePlan = this.data.scope === 'plan' ? this.scopeRecord() : undefined;
    const planInactive = !!scopePlan && scopePlan.lifecycle !== 'active';
    const planFocus = this.data.scope === 'plan'
      ? this.data.planSummaries?.().find(summary => summary.provider === provider)?.planFocus ?? null : null;
    const setupComingSoon = provider === 'coros' && ready && !setupAvailable && !setting && !statuses.length;
    const overviewState = !this.view().loaded ? 'Loading sync status…'
      : setupComingSoon ? 'Plan sync coming soon'
      : this.data.scope === 'history' ? 'Sync history'
      : this.planBound() ? suppressed ? 'Excluded from plan sync' : 'Follows plan sync settings'
        : setting?.enabled ? planInactive ? 'Sync saved · plan inactive' : 'Sync enabled' : 'Sync off';
    const overviewIcon = !this.view().loaded ? 'sync'
      : setupComingSoon ? 'schedule'
      : this.data.scope === 'history' ? 'history'
      : this.planBound() ? suppressed ? 'sync_disabled' : 'link'
        : setting?.enabled ? planInactive ? 'pause_circle' : 'check_circle' : 'sync_disabled';
    const overviewDetail = setupComingSoon ? 'Standalone Send remains available.'
      : planFocus ? [planFocus.label, planFocus.detail].filter(Boolean).join(' · ')
      : !statuses.length ? 'No workout sync status yet.'
      : statuses.length === 1 ? statuses[0].label
        : attentionWorkoutCount ? `${statusWorkoutCount} ${statusWorkoutCount === 1 ? 'workout' : 'workouts'} · ${attentionWorkoutCount} ${attentionWorkoutCount === 1 ? 'needs' : 'need'} attention`
          : new Set(statuses.map(item => item.label)).size === 1
            ? `${statusWorkoutCount} ${statusWorkoutCount === 1 ? 'workout' : 'workouts'} · ${statuses[0].label}`
            : `${statusWorkoutCount} ${statusWorkoutCount === 1 ? 'workout' : 'workouts'} · different sync states`;
    return { provider, label: PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider].label,
      displayLabel: PROVIDER_PRESENTATIONS[provider].displayLabel, presentation: PROVIDER_PRESENTATIONS[provider], ready, setupAvailable, setting, statuses,
      overviewState, overviewDetail, overviewIcon, overviewEnabled: overviewState === 'Sync enabled',
      // Suunto partner records can outlive app/watch visibility. Ignore stale
      // canCheck projections and keep positive lookup internal to safe recovery.
      canCheck: provider !== 'suunto' && statuses.some(status => status.verification?.canCheck),
      needsFreshConsent: statuses.some(status => status.status === 'fresh_consent_required'),
      // Current settings precede the asynchronously reconciled status after Resume.
      canResume: suppressed || (!inheritedSetting && statuses.some(status => status.status === 'stopped'
        && (!this.planBound() || status.planId === currentPlanId))),
      settingLabel: this.planBound() ? suppressed ? 'Excluded from plan sync' : 'Follows plan sync settings'
        : this.data.scope === 'plan' ? setting?.enabled ? 'Plan sync enabled' : 'Plan sync off'
          : setting?.enabled ? 'Workout sync enabled' : 'Workout sync off',
      visible: (ready && this.canSend()) || !!setting || statuses.length > 0,
      canStop: !!setting?.enabled || (this.planBound() && !suppressed)
        || statuses.some(item => item.hasRemoteCopy || !['stopped', 'removed', 'past', 'completed'].includes(item.status)),
      approvalDigest: suppressed ? null : statuses.find(item => item.status === 'approval_required' && item.approvalDigest)?.approvalDigest ?? null,
      canRetry: statuses.some(item => ['failed', 'needs_attention', 'retrying', 'provider_unavailable'].includes(item.status)),
      wahooReconnect: provider === 'wahoo' && statuses.some(item => item.issues.includes(WAHOO_TRAINING_PERMISSION_ISSUE)),
      reconnect: statuses.some(item => ['reconnect_required', 'connection_repair', 'fresh_consent_required'].includes(item.status)),
    };
  }).filter(row => row.visible));
  readonly providerOverviewVisible = computed(() => this.rows().length > 1
    && (!this.selectedProvider() || !this.rows().some(row => row.provider === this.selectedProvider())));
  readonly activeProvider = computed(() => {
    const selected = this.selectedProvider();
    if (selected && this.rows().some(row => row.provider === selected)) return selected;
    return this.rows().length === 1 ? this.rows()[0].provider : null;
  });
  readonly activeRow = computed(() => this.rows().find(row => row.provider === this.activeProvider()) ?? null);
  readonly providerDetailVisible = computed(() => !!this.activeRow() && !this.providerOverviewVisible());
  private readonly selectedProviderValidityEffect = effect(() => {
    const selected = this.selectedProvider();
    if (!selected || !this.view().loaded || !this.scheduleView().loaded
      || this.rows().some(row => row.provider === selected)) return;
    this.selectedProvider.set(null);
    this.navigationFocus.set({ view: 'title' });
  });
  readonly showsSuuntoGuidance = computed(() => this.activeProvider() === 'suunto');
  readonly showsCorosGuidance = computed(() => this.activeProvider() === 'coros');
  readonly showsWahooGuidance = computed(() => this.activeProvider() === 'wahoo');
  readonly wahooPreviewReconnect = computed(() => this.preview()?.command.provider === 'wahoo'
    && this.preview()?.result.issues.includes(WAHOO_TRAINING_PERMISSION_ISSUE));
  readonly canLoadMore = computed(() => this.view().loaded && this.statuses().length === this.statusLimit());
  readonly canConfirm = computed(() => {
    const preview = this.preview();
    if (this.editingSettings() && (!this.hasSettingsChanges() || (this.settingsChangedElsewhere() && !this.confirmationAttempted()))) return false;
    return !!preview && (preview.command.action === 'stop'
      || (preview.result.available && (preview.result.hasPro || preview.command.action === 'retry') && preview.result.connection === 'connected'
        && (preview.command.action !== 'approve' || !!preview.result.approvalDigest)));
  });

  constructor() {
    this.destroyRef.onDestroy(() => { this.requestVersion++; this.clearTimeZoneReview(); });
    effect(() => {
      if (!this.uid() || this.uid() !== this.initialUid) {
        this.requestVersion++; this.clearTimeZoneReview(); this.phase.set(null); this.notice.set(null);
        this.preview.set(null); this.draft.set(null); this.dialogRef.close();
      }
    });
    effect(() => {
      // Presence is a lightweight entry-point hint. Wait for authoritative owner-visible
      // settings/schedule before skipping the provider chooser; never auto-consent.
      if (this.initialReviewHandled || !this.data.initialProvider || !this.canReview()) return;
      this.initialReviewHandled = true;
      const provider = this.data.initialProvider;
      if (this.delivery.isSetupAvailable(provider, this.planDelivery()) && this.canSend() && !this.planBound()
        && !this.view().settings.some(item => item.provider === provider)
        && !this.statuses().some(item => item.provider === provider)) {
        this.closeOnCancel = true;
        void this.begin(provider, this.data.scope === 'plan' ? 'configure' : 'send');
      }
    });
  }
  private readonly navigationFocusEffect = afterRenderEffect(() => {
    const target = this.navigationFocus();
    if (!target) return;
    const element = target.view === 'title' ? this.dialogTitleElement()?.nativeElement
      : this.providerManageButtons().find(button => button.nativeElement.dataset['deliveryProvider'] === target.provider)?.nativeElement;
    if (!element) return;
    element.focus();
    this.navigationFocus.set(null);
  });
  reconnectWahooTraining(): void {
    if (this.busy() || !this.sameAccount() || (!this.wahooPreviewReconnect() && !this.rows().some(row => row.wahooReconnect))) return;
    this.haptics.selection();
    this.dialogRef.close();
    this.dialog.open(WahooRouteAccessReconnectDialogComponent, { data: { purpose: 'training' }, width: '440px', maxWidth: 'calc(100vw - 32px)' });
  }
  async begin(provider: PlannedWorkoutProviderId, action: TrainingDeliveryAction, approvalDigest?: string, renewConsent = false): Promise<void> {
    if (this.busy() || !this.sameAccount() || !this.canReview() || this.data.scope === 'history'
      || (!this.canSend() && !['stop', 'retry'].includes(action))) return;
    const setting = this.view().settings.find(item => item.provider === provider);
    const setupAction = ['configure', 'send', 'resume'].includes(action);
    if (setupAction && !this.delivery.isSetupAvailable(provider, this.planDelivery())) return;
    // Historical copies can still need consent for an old account. They must not
    // silently turn opening current settings into enabling delivery again.
    const editingSettings = !!setting?.enabled && !renewConsent && (action === 'configure' || action === 'send');
    const timeZone = setting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.clearTimeZoneReview(); this.confirmationAttempted.set(false);
    this.error.set(null); this.preview.set(null); this.notice.set(null);
    this.editingTimeZone.set(editingSettings);
    this.draft.set({ provider, action, timeZone, editingSettings, initialTimeZone: timeZone,
      initialSettingsRevision: setting?.revision ?? 0,
      ...(approvalDigest ? { approvalDigest } : {}) });
    if (!editingSettings) await this.review();
  }
  async checkProvider(provider: PlannedWorkoutProviderId): Promise<void> {
    const schedule = this.schedule();
    if (this.busy() || !this.sameAccount() || !this.canReview() || !schedule || this.data.scope === 'history') return;
    const version = ++this.requestVersion;
    const current = () => !this.destroyRef.destroyed && this.sameAccount() && this.requestVersion === version;
    this.phase.set('checking'); this.checkingProvider.set(provider); this.error.set(null); this.notice.set(null);
    try {
      const receipt = await this.delivery.check({ schemaVersion: 1, action: 'check', mutationId: this.delivery.createMutationId(),
        scope: this.data.scope, scopeId: this.data.id, provider, expectedScheduleRevision: schedule.state.revision,
        expectedScopeRevision: this.scopeRecord()?.revision ?? 0,
        expectedSettingsRevision: this.view().settings.find(item => item.provider === provider)?.revision ?? 0 }, current);
      if (!current()) return;
      this.notice.set(receipt.result === 'coalesced' ? 'A recent check is already queued or complete.'
        : receipt.result === 'deferred' ? 'Check queued. It will run when the service is available.' : 'Check queued. Results will update here.');
      this.haptics.success();
    } catch (error) { if (current()) { this.error.set(trainingVerificationCommandError(error)); this.haptics.error(); } }
    finally { if (current()) { this.phase.set(null); this.checkingProvider.set(null); } }
  }
  updateTimeZone(value: string): void {
    if (this.phase() === 'saving') return;
    this.clearTimeZoneReview(); this.requestVersion++; this.phase.set(null); this.confirmationAttempted.set(false);
    this.draft.update(draft => draft ? { ...draft, timeZone: value } : null);
    this.preview.set(null); this.error.set(null);
    if (this.normalizedTimeZone() && (!this.editingSettings() || this.hasSettingsChanges())) {
      this.timeZoneReviewTimer = setTimeout(() => { this.timeZoneReviewTimer = undefined; void this.review(); }, 400);
    }
  }
  toggleTimeZone(): void {
    if (this.busy()) return;
    this.editingTimeZone.update(value => !value);
  }
  toggleAttempts(id: string): void {
    this.attemptsExpanded.update(value => value === id ? null : id);
  }
  cancelReview(): void {
    if (this.phase() === 'saving') return;
    this.requestVersion++; this.clearTimeZoneReview(); this.phase.set(null);
    this.draft.set(null); this.preview.set(null); this.error.set(null);
    if (this.closeOnCancel) this.dialogRef.close();
  }
  async review(): Promise<void> {
    this.clearTimeZoneReview();
    const draft = this.draft(); const scope = this.scopeRecord(); const schedule = this.schedule(); const uid = this.uid();
    if (!draft || !schedule || !this.sameAccount() || this.busy() || !this.canReview() || this.data.scope === 'history') return;
    // Enter in the time-zone form must not replace an uncertain save's receipt.
    if (this.confirmationAttempted() && this.preview()) return;
    if (draft.editingSettings && (!this.hasSettingsChanges() || this.settingsChangedElsewhere())) return;
    const version = ++this.requestVersion;
    const current = () => !this.destroyRef.destroyed && this.sameAccount() && this.uid() === uid && this.requestVersion === version;
    this.phase.set('preview'); this.error.set(null); this.preview.set(null);
    try {
      const command: TrainingDeliveryCommandV1 = { schemaVersion: 1, mutationId: this.delivery.createMutationId(),
        scope: this.data.scope, scopeId: this.data.id, provider: draft.provider, action: draft.action,
        expectedScheduleRevision: schedule.state.revision, expectedScopeRevision: scope?.revision ?? 0,
        expectedSettingsRevision: this.view().settings.find(item => item.provider === draft.provider)?.revision ?? 0,
        ...(['configure', 'send'].includes(draft.action) || (draft.action === 'resume' && !this.planBound())
          ? { timeZone: normalizeDeliveryTimeZone(draft.timeZone.trim()) } : {}),
        ...(draft.action === 'approve' ? { approvalDigest: draft.approvalDigest } : {}) };
      const result = await this.delivery.preview(command, current);
      if (!current()) return;
      this.preview.set({ result, command: command.action === 'approve' && result.approvalDigest
        ? { ...command, approvalDigest: result.approvalDigest } : command });
    } catch (error) { if (current()) { this.error.set(trainingDeliveryCommandError(error, false)); this.haptics.error(); } }
    finally { if (current()) this.phase.set(null); }
  }
  async confirm(): Promise<void> {
    const preview = this.preview(); const uid = this.uid();
    if (!preview || !this.sameAccount() || !this.canConfirm() || this.busy()) return;
    const version = ++this.requestVersion;
    const current = () => !this.destroyRef.destroyed && this.sameAccount() && this.uid() === uid && this.requestVersion === version;
    this.phase.set('saving'); this.error.set(null);
    this.confirmationAttempted.set(true);
    try {
      // Retain this exact mutation ID on failure, so an uncertain response is safe to retry.
      await this.delivery.mutate(preview.command, current);
      if (!current()) return;
      this.notice.set(preview.command.action === 'stop' ? `${this.stopLabel()} saved. Eligible copies will be removed in the background.`
        : preview.command.action === 'retry' ? 'Recovery requested. Service retry limits still apply.'
          : 'Sync settings saved. Workout delivery continues in the background.');
      this.preview.set(null); this.draft.set(null); this.closeOnCancel = false; this.haptics.success();
    } catch (error) { if (current()) { this.error.set(trainingDeliveryCommandError(error, true)); this.haptics.error(); } }
    finally { if (current()) this.phase.set(null); }
  }
  private clearTimeZoneReview(): void {
    if (this.timeZoneReviewTimer !== undefined) clearTimeout(this.timeZoneReviewTimer);
    this.timeZoneReviewTimer = undefined;
  }
  loadMore(): void {
    if (!this.sameAccount() || this.busy() || !this.canLoadMore()) return;
    this.statusLimit.update(count => count + TRAINING_DELIVERY_PAGE_SIZE);
  }
  showProvider(provider: PlannedWorkoutProviderId): void {
    if (!this.sameAccount() || this.busy() || !this.rows().some(row => row.provider === provider)) return;
    this.selectedProvider.set(provider);
    this.attemptsExpanded.set(null);
    this.guidanceExpanded.set(false);
    this.navigationFocus.set({ view: 'title' });
  }
  backToProviders(): void {
    const provider = this.activeProvider();
    if (!provider || !this.sameAccount() || this.busy() || !this.providerDetailVisible() || this.rows().length < 2) return;
    this.selectedProvider.set(null);
    this.attemptsExpanded.set(null);
    this.guidanceExpanded.set(false);
    this.navigationFocus.set({ view: 'overview', provider });
  }
  inspectWorkout(status: TrainingDeliveryStatusV1): void {
    if (!this.sameAccount() || this.busy()) return;
    const title = this.schedule()?.workouts.find(workout => workout.id === status.workoutId)?.title ?? 'Deleted workout';
    this.openContext({ scope: 'workout', id: status.workoutId, title, selectedProvider: status.provider,
      ...(this.data.planSummaries ? { planSummaries: this.data.planSummaries } : {}),
      ...(this.data.scope !== 'workout' ? { returnTo: { scope: this.data.scope, id: this.data.id,
        title: this.scopeTitle(), selectedProvider: status.provider } } : {}) });
  }
  backToOverview(): void {
    if (this.data.returnTo) this.openContext({ ...this.data.returnTo,
      ...(this.data.planSummaries ? { planSummaries: this.data.planSummaries } : {}) });
  }
  private openContext(data: TrainingDeliveryDialogData): void {
    if (!this.sameAccount() || this.busy()) return;
    this.dialogRef.close();
    this.dialog.open(TrainingDeliveryDialogComponent, { data,
      width: '640px', maxWidth: '95vw' });
  }
}
