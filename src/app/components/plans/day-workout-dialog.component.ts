import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom, Subscription } from 'rxjs';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DAY_WORKOUT_EQUIPMENT, DAY_WORKOUT_SPORTS, defaultDayWorkoutControls, dayWorkoutLocalDate, dayWorkoutDateOffset,
  dayWorkoutPurposes, dayWorkoutTargets, DAY_WORKOUT_SIGNAL_OPTIONS, dayWorkoutReadinessSourcesEnabled,
  type DayWorkoutControls, type GenerateDayWorkoutRequest, type GenerateDayWorkoutResponse } from '@shared/day-workout';
import { isStrengthWorkoutSportV1 } from '@shared/strength-workout';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { isTrainingLocalDateWithinPlan, isTrainingPlanRestDay, normalizeTrainingLocalDate, type MutateTrainingScheduleRequestV1, type ScheduledWorkoutV1 } from '@shared/training-plans';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { DayWorkoutService, type DayWorkoutEditorDraft } from '../../services/day-workout.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../services/training-plans.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { dayWorkoutReview } from '../../helpers/day-workout-review.helper';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { Auth, authState } from 'app/firebase/auth';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { SummaryDisclosureComponent } from '../shared/summary-disclosure/summary-disclosure.component';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import type { AssistantQuotaStatus } from '@shared/assistant.types';

export interface DayWorkoutDialogData {
  ownerUid: string; localDate: string; sport: ActivityTypes;
  mode?: 'preferences'; initialControls?: DayWorkoutControls; initialResult?: GenerateDayWorkoutResponse;
  followRoutine?: boolean;
  savePreferences?: (controls: DayWorkoutControls, followRoutine: boolean) => Promise<void>;
  onAdded?: () => void;
}
type ChoiceKey = 'purpose' | 'destinationPlanId' | 'equipment' | 'timing' | 'target' | 'structure' | 'strengthFocus';
interface Choice { key: ChoiceKey; label: string; options: { value: string | null; label: string }[] }
@Component({ selector: 'app-day-workout-dialog', standalone: true, imports: [DatePipe, NgTemplateOutlet, FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule,
  MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, AppChartSharedModule,
  CompactRowComponent, SummaryDisclosureComponent, ActivityFilterPickerComponent, TrainingDeliveryButtonComponent],
  templateUrl: './day-workout-dialog.component.html', styleUrls: ['./day-workout-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush })
export class DayWorkoutDialogComponent {
  readonly data = inject<DayWorkoutDialogData>(MAT_DIALOG_DATA);
  readonly haptics = inject(AppHapticsService);
  private readonly users = inject(AppUserService);
  private readonly generation = inject(DayWorkoutService);
  private readonly quotaService = inject(AssistantQuotaService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly delivery = inject(TrainingDeliveryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(MatDialog);
  private readonly ref = inject(MatDialogRef<DayWorkoutDialogComponent, DayWorkoutEditorDraft | undefined>);
  readonly timeZone = this.data.initialControls?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly today = dayWorkoutLocalDate(new Date(), this.timeZone);
  readonly latestDate = dayWorkoutDateOffset(this.today, 365);
  readonly controls = signal(this.data.initialControls ? structuredClone(this.data.initialControls) : defaultDayWorkoutControls(this.data.localDate, this.timeZone, this.data.sport));
  readonly followRoutine = signal(this.data.followRoutine ?? true);
  readonly more = signal(false);
  readonly showPersonalization = signal(true);
  readonly showSettings = signal(false);
  readonly busy = signal<'generate' | 'save' | null>(null);
  readonly error = signal<string | null>(null);
  readonly result = signal<GenerateDayWorkoutResponse | null>(this.data.initialResult ? structuredClone(this.data.initialResult) : null);
  readonly schedule = signal<CurrentTrainingScheduleV1 | null>(null);
  readonly scheduleFailed = signal(false);
  readonly staleReview = signal(false);
  readonly saveUncertain = signal(false);
  readonly savedWorkoutId = signal<string | null>(null);
  private readonly savedAcknowledgement = signal<ScheduledWorkoutV1 | null>(null);
  readonly savedWorkout = computed(() => this.schedule()?.workouts.find(workout => workout.id === this.savedWorkoutId())
    ?? this.savedAcknowledgement());
  readonly savedDetails = computed(() => {
    const workout = this.savedWorkout(), controls = this.controls();
    const planId = workout ? workout.planId : controls.destinationPlanId;
    return {
      title: workout?.title ?? this.result()?.draft?.title ?? 'Workout', localDate: workout?.localDate ?? controls.localDate,
      sport: workout?.structure.sport ?? controls.sport,
      summary: workout ? formatWorkoutPrescriptionSummaryV1(workout.structure, this.user()?.settings?.unitSettings, workout.structure.sport) : this.review()?.summary,
      plan: this.schedule()?.plans.find(plan => plan.id === planId) ?? null,
      standalone: planId === null, workouts: workout ? [workout] : null,
    };
  });
  readonly syncLabel = signal('');
  readonly quota = signal<AssistantQuotaStatus | null>(null);
  readonly quotaLoading = signal(true);
  readonly quotaText = computed(() => {
    if (this.quotaLoading()) return 'Assistant allowance: loading…';
    const status = this.quota();
    return status ? `Assistant: ${status.remainingCount} of ${status.limit} remaining${status.isEligible ? '' : ' · Pro required'}`
      : 'Assistant allowance unavailable';
  });
  private readonly reviewHeading = viewChild<ElementRef<HTMLElement>>('reviewHeading');
  private readonly savedHeading = viewChild<ElementRef<HTMLElement>>('savedHeading');
  private readonly generationError = viewChild<ElementRef<HTMLElement>>('generationError');
  private readonly outcomeFocus = afterRenderEffect(() => {
    const target = this.savedWorkoutId() ? this.savedHeading()?.nativeElement : this.error() ? this.generationError()?.nativeElement
      : this.result() ? this.reviewHeading()?.nativeElement : null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest' });
  });
  readonly strength = computed(() => isStrengthWorkoutSportV1(this.controls().sport));
  readonly planOptions = computed(() => this.schedule()?.plans.filter(plan => plan.lifecycle !== 'archived') ?? []);
  readonly selectedPlan = computed(() => this.planOptions().find(plan => plan.id === this.controls().destinationPlanId) ?? null);
  readonly restDayPlan = computed(() => {
    if (!this.controls().trainingContext || this.scheduleFailed() || this.schedule()?.restoreUnavailable) return null;
    const planId = this.controls().destinationPlanId ?? this.schedule()?.state.activePlanId;
    const plan = this.planOptions().find(item => item.id === planId);
    return plan && isTrainingPlanRestDay(plan, this.controls().localDate) ? plan : null;
  });
  readonly existing = computed(() => this.schedule()?.workouts.filter(workout => workout.lifecycle !== 'deleted'
    && workout.localDate === this.controls().localDate
    && [null, this.schedule()?.state.activePlanId, this.controls().destinationPlanId].includes(workout.planId)) ?? []);
  readonly user = toSignal(this.users.user$, { initialValue: this.users.user() });
  readonly review = computed(() => { const draft = this.result()?.draft;
    return draft ? dayWorkoutReview(draft, this.user()?.settings?.unitSettings, this.result()?.previousLoads) : null; });
  readonly contextDetails = computed(() => [...(this.result()?.usedContext ?? []), ...(this.result()?.missingContext ?? [])]);
  readonly valid = computed(() => { try {
    const controls = this.controls(); const date = normalizeTrainingLocalDate(controls.localDate);
    return date >= this.today && date <= this.latestDate && Number.isSafeInteger(controls.minutes)
      && controls.minutes >= 5 && controls.minutes <= 240 && controls.equipment.length > 0
      && (this.data.mode === 'preferences' || !!this.schedule() && !this.scheduleFailed() && !this.schedule()?.restoreUnavailable)
      && (!this.controls().destinationPlanId || !!this.selectedPlan());
  } catch { return false; } });
  readonly labels: Record<string, string> = {
    suggest: 'Suggest for me', recovery: 'Recovery / easy',
    none: 'No targets', speed: 'Pace / speed',
    strict: 'Finish within this time',
  };
  private choice(key: ChoiceKey, label: string, values: readonly string[]): Choice {
    return { key, label, options: values.map(value => ({ value, label: this.labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ') })) };
  }
  readonly sportOptions = DAY_WORKOUT_SPORTS.map(sport => ({ value: sport, label: sport, activityType: sport }))
    .sort((a, b) => a.label.localeCompare(b.label));
  readonly selectedSports = computed(() => [this.controls().sport]);
  readonly mainChoices = computed<Choice[]>(() => [
    this.choice('purpose', 'Purpose', dayWorkoutPurposes(this.controls().sport)),
    ...(this.data.mode === 'preferences' ? [] : [{ key: 'destinationPlanId' as const, label: 'Add to', options: [{ value: null, label: 'Standalone' },
      ...this.planOptions().map(plan => ({ value: plan.id, label: `${plan.name}${plan.lifecycle === 'paused' ? ' (paused)' : ''}` }))] }]),
    ...(this.strength() ? [this.choice('equipment', 'Available equipment', DAY_WORKOUT_EQUIPMENT)] : [])]);
  readonly moreChoices = computed<Choice[]>(() => this.strength()
    ? [this.choice('strengthFocus', 'Strength focus', ['full-body', 'upper-body', 'lower-body', 'core'])]
    : [this.choice('timing', 'Timing', ['approximate', 'strict']), this.choice('target', 'Targets', dayWorkoutTargets(this.controls().sport)),
      this.choice('structure', 'Session structure', ['auto', 'simple'])]);
  readonly readinessSourcesEnabled = computed(() => dayWorkoutReadinessSourcesEnabled(this.controls()));
  readonly contextChoices = computed(() => [
    ...DAY_WORKOUT_SIGNAL_OPTIONS,
    { key: 'trainingContext' as const, label: 'Training plans & workouts' },
    { key: 'timelineContext' as const, label: 'Timeline notes' },
    ...(this.strength() ? [{ key: 'usePreviousWeights' as const, label: 'Reuse planned weights' }] : []),
  ].map(choice => {
    const requiredForDailySuggestion = this.data.mode === 'preferences' && ['trainingContext', 'activityContext'].includes(choice.key);
    const disabled = requiredForDailySuggestion || choice.key === 'routineContext' && this.controls().activityContext === false
      || choice.key === 'readinessContext' && !this.readinessSourcesEnabled()
      || choice.key === 'usePreviousWeights' && !this.controls().trainingContext;
    return { ...choice, disabled, checked: (!disabled || requiredForDailySuggestion) && this.controls()[choice.key] !== false };
  }));
  readonly contextSelection = computed(() => {
    const choices = this.contextChoices();
    const count = choices.filter(choice => choice.checked).length;
    return count === choices.length ? 'All selected' : `${count} of ${choices.length} selected`;
  });
  readonly primaryLabel = computed(() => {
    if (this.data.mode === 'preferences') return this.busy() ? 'Saving…' : 'Save preferences';
    if (this.busy()) return this.busy() === 'save' ? 'Adding…' : 'Generating…';
    if (this.result()?.draft) return this.saveUncertain() ? 'Retry Add' : 'Add workout';
    if (this.result()) return this.restDayPlan() ? 'Keep rest day' : 'Try easy session';
    return this.error() ? 'Retry generation' : 'Generate workout';
  });
  async primaryAction(): Promise<void> {
    if (this.savedWorkoutId()) return;
    if (this.data.mode === 'preferences') {
      if (!this.valid() || this.busy() || !this.generation.isOwner(this.data.ownerUid)) return;
      const sequence = ++this.sequence;
      this.busy.set('save'); this.ref.disableClose = true; this.error.set(null);
      try {
        await this.data.savePreferences?.({ ...this.controls(), destinationPlanId: null }, this.followRoutine());
        if (this.current(sequence)) { this.haptics.success(); this.ref.close(); }
      } catch { if (this.current(sequence)) { this.error.set('Daily suggestion preferences could not be saved. Your choices are kept.'); this.haptics.error(); } }
      finally { if (this.current(sequence)) { this.busy.set(null); this.ref.disableClose = false; } }
      return;
    }
    if (this.result()?.kind === 'rest' && this.restDayPlan()) {
      if (this.busy() || !this.generation.isOwner(this.data.ownerUid)) return;
      this.haptics.selection(); this.ref.close(); return;
    }
    if (this.result()?.draft) return this.add();
    if (this.result()) return this.easy();
    return this.generate(!!this.error());
  }
  private request: GenerateDayWorkoutRequest | null = null;
  private command: MutateTrainingScheduleRequestV1 | null = null;
  private reviewedSchedule: CurrentTrainingScheduleV1 | null = null;
  private syncSubscription?: Subscription;
  private syncKey: string | null | undefined;
  private initializedDestination = false;
  private sequence = 0;
  private quotaSequence = 0;
  private scheduleSubscription?: Subscription;

  constructor() {
    authState(inject(Auth)).pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid !== this.data.ownerUid) {
        this.sequence++; this.savedWorkoutId.set(null); this.savedAcknowledgement.set(null); this.ref.close();
      }
    });
    if (this.data.mode !== 'preferences') this.loadSchedule();
    void this.refreshQuota();
    this.destroyRef.onDestroy(() => { this.sequence++; this.scheduleSubscription?.unsubscribe(); this.syncSubscription?.unsubscribe(); });
  }
  private async refreshQuota(): Promise<void> {
    if (this.destroyRef.destroyed || !this.generation.isOwner(this.data.ownerUid)) return;
    const sequence = ++this.quotaSequence;
    this.quotaLoading.set(true); this.quota.set(null);
    const status = await this.quotaService.loadQuotaStatus().catch(() => null);
    if (this.destroyRef.destroyed || sequence !== this.quotaSequence || !this.generation.isOwner(this.data.ownerUid)) return;
    this.quota.set(status); this.quotaLoading.set(false);
  }
  private current(sequence: number): boolean { return !this.destroyRef.destroyed && sequence === this.sequence && this.generation.isOwner(this.data.ownerUid); }
  loadSchedule(): void {
    this.scheduleSubscription?.unsubscribe(); this.scheduleFailed.set(false);
    this.scheduleSubscription = this.plansService.watchSchedule(this.data.ownerUid).subscribe({ next: schedule => {
      if (!this.generation.isOwner(this.data.ownerUid)) return;
      this.schedule.set(schedule);
      if (!this.initializedDestination && !this.data.initialControls) {
        const active = schedule.plans.find(plan => plan.id === schedule.state.activePlanId && plan.lifecycle === 'active'
          && isTrainingLocalDateWithinPlan(this.controls().localDate, plan));
        this.controls.update(value => ({ ...value, destinationPlanId: active?.id ?? null }));
        this.initializedDestination = true;
      }
      if (!this.reviewedSchedule && this.data.initialResult && this.result()) this.reviewedSchedule = schedule;
      if (!this.savedWorkoutId() && this.reviewedSchedule && this.result() && this.reviewedSchedule.state.revision !== schedule.state.revision) this.staleReview.set(true);
      this.watchSync();
    }, error: () => { this.scheduleFailed.set(true); this.schedule.set(null); } });
  }
  selectSport(values: readonly string[]): void {
    const sport = values.length === 1 ? DAY_WORKOUT_SPORTS.find(sport => sport === values[0]) : undefined;
    if (sport) this.set('sport', sport);
  }
  set<K extends keyof DayWorkoutControls>(key: K, value: DayWorkoutControls[K], feedback = true): void {
    if (this.savedWorkoutId() || this.busy() || this.saveUncertain() || JSON.stringify(this.controls()[key]) === JSON.stringify(value)) return;
    this.controls.update(controls => {
      const next = { ...controls, [key]: value };
      if (key === 'sport') {
        next.purpose = 'suggest'; next.target = isStrengthWorkoutSportV1(next.sport) ? 'none' : 'auto'; next.timing = 'approximate';
        if (!next.equipment.length) next.equipment = ['bodyweight'];
      }
      if (!dayWorkoutReadinessSourcesEnabled(next)) next.readinessContext = false;
      return next;
    });
    this.sequence++; this.result.set(null); this.request = null; this.command = null; this.reviewedSchedule = null;
    this.staleReview.set(false); this.error.set(null); this.watchSync();
    if (feedback) this.haptics.selection();
  }
  private watchSync(): void {
    if (this.savedWorkoutId()) { this.syncSubscription?.unsubscribe(); return; }
    const key = this.controls().destinationPlanId;
    if (key === this.syncKey) return;
    this.syncKey = key; this.syncSubscription?.unsubscribe();
    if (!key) { this.syncLabel.set('Standalone: send separately after saving.'); return; }
    this.syncLabel.set('Checking plan sync…');
    this.syncSubscription = this.delivery.watchScope(this.data.ownerUid, 'plan', key, 1, false).subscribe({ next: view => {
      if (!this.generation.isOwner(this.data.ownerUid) || this.syncKey !== key) return;
      const names = view.settings.filter(item => item.enabled && !item.suppressed).map(item => item.provider);
      this.syncLabel.set(names.length ? `Inherits plan sync: ${names.join(', ')}. May send automatically.`
        : 'Plan sync is off; send after saving.');
    }, error: () => this.syncLabel.set('Sync unavailable. Existing plan sync may send automatically.') });
  }
  async generate(retry = false): Promise<void> {
    if (this.savedWorkoutId() || !this.valid() || this.busy() || this.saveUncertain()) return;
    const sequence = ++this.sequence;
    this.ref.disableClose = true; this.busy.set('generate'); this.error.set(null); this.haptics.selection();
    this.result.set(null); this.command = null; this.staleReview.set(false);
    this.reviewedSchedule = this.schedule();
    if (!retry || !this.request) this.request = { requestId: this.plansService.createMutationId('day-workout'), controls: structuredClone(this.controls()) };
    try {
      const result = await this.generation.generate(this.data.ownerUid, this.request, () => this.current(sequence));
      if (!this.current(sequence)) return;
      if (result.requestId !== this.request.requestId) throw new Error('The generation response does not match this request.');
      this.result.set(result); this.showSettings.set(false);
      this.staleReview.set(this.reviewedSchedule?.state.revision !== this.schedule()?.state.revision);
      this.haptics.success();
    } catch (error) { if (this.current(sequence)) {
      const code = String((error as { code?: string }).code).replace('functions/', '');
      this.error.set(code === 'resource-exhausted' ? 'AI allowance reached. Try again after it resets.'
        : code === 'permission-denied' ? 'Assistant access is unavailable. Check your account setup.'
          : 'Generation failed. Retry checks this request; Generate again uses a new AI request.');
      this.haptics.error();
    } }
    finally { if (this.current(sequence)) {
      this.busy.set(null); this.ref.disableClose = false; void this.refreshQuota();
    } }
  }
  async easy(): Promise<void> { this.set('purpose', this.strength() ? 'general-strength' : 'recovery', false); await this.generate(); }
  refreshReview(): void {
    if (this.savedWorkoutId() || !this.schedule() || this.busy() || this.saveUncertain()) return;
    this.reviewedSchedule = this.schedule(); this.command = null; this.staleReview.set(false); this.error.set(null); this.haptics.selection();
  }
  private saveCommand(): MutateTrainingScheduleRequestV1 {
    if (this.command) return this.command;
    const schedule = this.reviewedSchedule; const draft = this.result()?.draft;
    if (!schedule || !draft) throw new Error('Review a complete workout first.');
    const plan = schedule.plans.find(item => item.id === this.controls().destinationPlanId);
    this.command = { mutationId: this.plansService.createMutationId('ai-workout-save'),
      expectedRevisions: [{ scope: 'state', id: 'current', revision: schedule.state.revision },
        ...(plan ? [{ scope: 'plan' as const, id: plan.id, revision: plan.revision }] : [])],
      operation: { kind: 'create-workout', workoutId: this.plansService.createEntityId('workout'),
        planId: this.controls().destinationPlanId, localDate: this.controls().localDate, title: draft.title,
        structure: draft.structure, ...(draft.strength ? { strength: draft.strength } : {}), confirmPlanRangeExtension: false } };
    return this.command;
  }
  edit(): void {
    if (this.savedWorkoutId() || !this.result()?.draft || this.busy() || this.staleReview() || this.saveUncertain()) return;
    this.ref.close({ ownerUid: this.data.ownerUid, controls: structuredClone(this.controls()),
      draft: structuredClone(this.result()!.draft!), saveRequest: this.saveCommand() });
  }
  async add(): Promise<void> {
    if (this.savedWorkoutId() || !this.result()?.draft || this.busy() || (!this.saveUncertain() && (this.staleReview() || !this.valid()))) return;
    const sequence = ++this.sequence;
    this.busy.set('save'); this.ref.disableClose = true; this.error.set(null);
    try {
      let command = this.saveCommand();
      const plan = this.selectedPlan();
      if (!this.saveUncertain() && plan && !isTrainingLocalDateWithinPlan(this.controls().localDate, plan)
        && command.operation.kind === 'create-workout' && !command.operation.confirmPlanRangeExtension) {
        const confirmed = await firstValueFrom(this.dialogs.open(ConfirmationDialogComponent, { data: {
          title: 'Extend plan dates?', message: `Extend ${plan.name} to include ${this.controls().localDate} and add this workout?`, confirmText: 'Extend and add',
        } }).afterClosed());
        if (!confirmed || !this.current(sequence)) return;
        command = this.command = { ...command, operation: { ...command.operation, confirmPlanRangeExtension: true } };
      }
      const response = await this.plansService.mutate(command, () => this.current(sequence));
      if (this.current(sequence) && command.operation.kind === 'create-workout') {
        const id = command.operation.workoutId;
        this.savedAcknowledgement.set(response.workouts?.find(workout => workout.id === id) ?? null);
        this.savedWorkoutId.set(id); this.saveUncertain.set(false); this.staleReview.set(false);
        this.ref.updateSize(undefined, 'auto');
        this.syncSubscription?.unsubscribe();
        this.haptics.success();
        if (this.result()?.requestId === this.data.initialResult?.requestId) this.data.onAdded?.();
      }
    } catch (error) {
      if (!this.current(sequence)) return;
      const code = (error as { code?: string }).code;
      const rejected = ['aborted', 'failed-precondition', 'invalid-argument', 'permission-denied', 'unauthenticated', 'resource-exhausted', 'not-found']
        .some(value => code === value || code === `functions/${value}`);
      this.saveUncertain.set(!rejected);
      if (rejected) { this.staleReview.set(true); this.command = null; }
      this.error.set(rejected ? 'Save rejected. Your draft is kept; review the updated schedule before retrying.'
        : 'Save confirmation lost. Keep this dialog open and Retry Add to check the same workout.');
      this.haptics.error();
    } finally { if (this.current(sequence)) { this.busy.set(null); this.ref.disableClose = this.saveUncertain(); } }
  }
}
