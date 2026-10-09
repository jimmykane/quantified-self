import { Component, Inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject, Output, EventEmitter, ChangeDetectorRef, signal } from '@angular/core';
import {
  AbstractControl,
  UntypedFormArray,
  UntypedFormControl,
  UntypedFormGroup,
  Validators,
  ValidatorFn,
  ValidationErrors,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../services/app.event.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { User } from '@sports-alliance/sports-lib';

import { AppUserServiceMetaInterface } from '../../models/app-user.interface';
import { Subscription } from 'rxjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS, GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS, GARMIN_HISTORY_IMPORT_LIMIT_YEARS, HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT, HISTORY_IMPORT_DEFAULT_RANGE_YEARS, HISTORY_IMPORT_PROCESSING_CAPACITY_PER_DAY_PER_USER_ESTIMATE } from '@shared/history-import.constants';
import {
  getHealthBackfillStartMs,
  GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS,
  getSleepBackfillCooldownDays,
  SLEEP_BACKFILL_COOLDOWN_DAYS,
  SleepBackfillQueueResponse,
} from '@shared/sleep-backfill';
import { SLEEP_PROVIDERS, SleepProvider, SleepSyncState } from '@shared/sleep';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HistoryImportStateService, HistoryImportRequestState, historyImportCooldownAt } from '../../services/history-import-state.service';

dayjs.extend(relativeTime);

/** Response from COROS/Suunto/Wahoo history import */
export interface HistoryImportResult {
  successCount: number;
  failureCount: number;
  processedBatches: number;
  failedBatches: number;
}

type HealthAvailabilityState = 'idle' | 'loading' | 'available' | 'unavailable' | 'error';


@Component({
  selector: 'app-history-import-form',
  templateUrl: './history-import.form.component.html',
  styleUrls: ['./history-import.form.component.css'],
  providers: [],
  standalone: false
})

export class HistoryImportFormComponent implements OnInit, OnDestroy, OnChanges {
  @Input() serviceName: ServiceNames;
  @Input() userMetaForService: AppUserServiceMetaInterface | undefined;
  @Input() minDate: Date | null = null;
  @Input() missingPermissions: string[] = [];
  @Input() isLoadingParent = false;
  @Input() providerConnected = false;
  @Output() importInitiated = new EventEmitter<void>();


  public formGroup: UntypedFormGroup;
  public isAllowedToDoHistoryImport = false;
  public nextImportAvailableDate: Date;
  public isSubmitting = false;
  public serviceNames = ServiceNames
  public isPro = false;
  public corosHistoryLimitMonths = COROS_HISTORY_IMPORT_LIMIT_MONTHS;
  public activitiesPerDayLimit = HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT;
  public historyImportDefaultRangeYears = HISTORY_IMPORT_DEFAULT_RANGE_YEARS;
  public processingCapacityPerDay = HISTORY_IMPORT_PROCESSING_CAPACITY_PER_DAY_PER_USER_ESTIMATE;
  public garminCooldownDays = GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS;
  public garminHistoryLimitYears = GARMIN_HISTORY_IMPORT_LIMIT_YEARS;
  /** Optimistic UI flag - blocks re-submission immediately after success */
  public isHistoryImportPending = signal(false);
  public isActivityHistoryImportRunning = signal(false);
  public historyImportRunningMessage = '';
  /** Stores the actual backend response for display (COROS/Suunto/Wahoo only). */
  public pendingImportResult = signal<HistoryImportResult | null>(null);
  public isSleepBackfillSubmitting = signal(false);
  public pendingSleepBackfillResult = signal<SleepBackfillQueueResponse | null>(null);
  public sleepBackfillSyncState = signal<SleepSyncState | null>(null);
  public sleepSyncStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  public activityImportFailed = signal(false);
  public isActivityCooldownResponse = signal(false);
  public hasAcceptedActivityImport = signal(false);
  public sleepImportFailed = signal(false);
  public activityRequestRange: { startDate: Date; endDate: Date } | null = null;
  public healthAvailabilityState = signal<HealthAvailabilityState>('idle');
  public isSleepAndHealthBackfill = false;
  public checksHealthBackfillAvailability = false;
  public historyBackfillScopeTitle = 'Sleep history';
  public historyBackfillActionLabel = 'Import Sleep history';
  public historyBackfillAriaLabel = 'Sleep history import';
  public historyBackfillIcon = 'bedtime';
  public historyBackfillResultText = '';
  /** Max date for any import is today (using dayjs for datepicker compatibility) */
  public today = dayjs().endOf('day');
  /** Expose Math for template calculations */
  public Math = Math;
  private eventService = inject(AppEventService);
  private userService = inject(AppUserService);
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private changeDetectorRef = inject(ChangeDetectorRef);
  private authService = inject(AppAuthService);
  private sleepService = inject(AppSleepService);
  private hapticsService = inject(AppHapticsService);
  private importState = inject(HistoryImportStateService);
  private isDestroyed = false;
  private activityHistoryLeaseTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private currentUserID: string | null = null;
  private sleepSyncStateSubscription: Subscription | null = null;
  private sleepSyncStateKey: string | null = null;
  private healthAvailabilityRequestKey: string | null = null;
  private healthAvailabilityRequestGeneration = 0;
  private sharedStateKey: string | null = null;
  private contextGeneration = 0;
  private sharedStateSubscriptions = new Subscription();
  private authSubscription: Subscription | null = null;
  private activityState: HistoryImportRequestState<{ stats?: HistoryImportResult }> = { status: 'idle' };
  private sleepState: HistoryImportRequestState<SleepBackfillQueueResponse> = { status: 'idle' };
  private cooldownTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  async ngOnInit() {
    this.formGroup = new UntypedFormGroup({
      startDate: new UntypedFormControl(this.getDefaultHistoryStartDate(), [
        Validators.required,
      ]),
      endDate: new UntypedFormControl(dayjs().endOf('day'), [
        Validators.required,
      ]),
      accepted: new UntypedFormControl(false, [
        Validators.requiredTrue,
      ]),
    }, { validators: this.dateRangeValidator });

    this.formGroup.disable();

    const user = await this.authService.getUser();
    if (this.isDestroyed) return;
    this.isPro = AppUserUtilities.hasProAccess(user);
    this.currentUserID = this.coerceUserID(user);

    this.processChanges();
    this.authSubscription = this.authService.user$.subscribe(user => {
      const userID = this.coerceUserID(user);
      if (this.isDestroyed || userID === this.currentUserID) return;
      this.currentUserID = userID;
      this.isPro = AppUserUtilities.hasProAccess(user);
      this.processChanges();
      this.changeDetectorRef.markForCheck();
    });
  }

  private getDefaultHistoryStartDate() {
    const requestedStart = this.serviceName === ServiceNames.COROSAPI
      ? dayjs().startOf('day').subtract(this.corosHistoryLimitMonths, 'month')
      : dayjs().startOf('day').subtract(this.historyImportDefaultRangeYears, 'year');
    const providerMinimum = this.minDate ? dayjs(this.minDate).startOf('day') : null;

    return providerMinimum?.isAfter(requestedStart) ? providerMinimum : requestedStart;
  }

  dateRangeValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const startControl = group.get('startDate');
    const endControl = group.get('endDate');
    const start = startControl?.value;
    const end = endControl?.value;

    if (start && end && dayjs(start).isAfter(dayjs(end))) {
      endControl?.setErrors({ dateRangeInvalid: true });
      return { dateRangeInvalid: true };
    }

    // If it was only invalid due to dateRangeInvalid, clear it. 
    // Note: this is a simple check, in a complex form we'd be more careful about other errors.
    if (endControl?.hasError('dateRangeInvalid')) {
      endControl.setErrors(null);
      // Re-trigger required validator if needed
      endControl.updateValueAndValidity({ emitEvent: false });
    }

    return null;
  };

  get isMissingGarminPermissions(): boolean {
    return this.serviceName === ServiceNames.GarminAPI &&
      (this.missingPermissions.includes('HISTORICAL_DATA_EXPORT') || this.missingPermissions.includes('ACTIVITY_EXPORT'));
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.serviceName) {
      throw new Error('Component needs serviceName')
    }
    if (this.formGroup) {
      this.processChanges()
    }
  }

  private processChanges() {
    if (this.isDestroyed) return;
    this.syncSharedImportState();
    this.isSubmitting = this.activityState.status === 'pending';
    this.isHistoryImportPending.set(this.activityState.status === 'success'
      && (this.activityState.nextAllowedAtMs === undefined || this.activityState.nextAllowedAtMs > Date.now()));
    this.nextImportAvailableDate = undefined;
    this.syncActivityHistoryImportRunning();
    this.checksHealthBackfillAvailability = this.serviceName === ServiceNames.SuuntoApp
      || this.serviceName === ServiceNames.GarminAPI;
    this.syncHealthAvailability();
    this.updateSleepAndHealthBackfillAvailability();
    this.syncSleepBackfillStateSubscription();
    this.updateProviderHistoryMinimumDate();

    if (!this.userMetaForService || !this.userMetaForService.didLastHistoryImport) {
      this.isAllowedToDoHistoryImport = true;
      this.applyActivityCooldown();
      this.updateActivityHistoryFormState();
      return;
    }

    switch (this.serviceName) {
      case ServiceNames.SuuntoApp:
      case ServiceNames.COROSAPI:
      case ServiceNames.WahooAPI:
        if (!this.userMetaForService.processedActivitiesFromLastHistoryImportCount) {
          this.isAllowedToDoHistoryImport = true;
          break;
        }
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + ((this.userMetaForService.processedActivitiesFromLastHistoryImportCount / HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
        this.isAllowedToDoHistoryImport =
          this.nextImportAvailableDate < (new Date())
          || this.userMetaForService.processedActivitiesFromLastHistoryImportCount === 0;
        break;
      case ServiceNames.GarminAPI:
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + (GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
        this.isAllowedToDoHistoryImport = this.nextImportAvailableDate < new Date()
        if (this.isMissingGarminPermissions) {
          this.isAllowedToDoHistoryImport = true; // Still allow showing the form
        }
        break;
      default:
        this.logger.error(new Error(`Service name is not available ${this.serviceName} for history import`));
        // this.formGroup.disable();
        // this.isAllowedToDoHistoryImport = false;
        break;
    }
    this.applyActivityCooldown();
    this.updateActivityHistoryFormState();
  }

  private applyActivityCooldown(): void {
    const nextAllowed = this.activityState.nextAllowedAtMs;
    if (nextAllowed !== undefined && nextAllowed > Date.now()) {
      this.isAllowedToDoHistoryImport = false;
      this.nextImportAvailableDate = new Date(Math.max(nextAllowed, this.nextImportAvailableDate?.getTime() || 0));
    }
    this.scheduleCooldownRefresh();
  }

  private syncSharedImportState(): void {
    const key = this.currentUserID ? JSON.stringify([this.currentUserID, this.serviceName]) : null;
    if (this.sharedStateKey === key) return;
    this.sharedStateSubscriptions.unsubscribe();
    this.sharedStateSubscriptions = new Subscription();
    this.sharedStateKey = key;
    this.contextGeneration += 1;
    this.activityState = { status: 'idle' };
    this.sleepState = { status: 'idle' };
    this.pendingImportResult.set(null);
    this.pendingSleepBackfillResult.set(null);
    this.isSleepBackfillSubmitting.set(false);
    this.activityImportFailed.set(false);
    this.isActivityCooldownResponse.set(false);
    this.hasAcceptedActivityImport.set(false);
    this.sleepImportFailed.set(false);
    this.activityRequestRange = null;
    if (!this.currentUserID) return;
    const activityKey = this.importState.key(this.currentUserID, this.serviceName, 'activity');
    const sleepKey = this.importState.key(this.currentUserID, this.serviceName, 'sleep');
    this.sharedStateSubscriptions.add(this.importState.watch$<{ stats?: HistoryImportResult }>(activityKey).subscribe(state => {
      this.activityState = state;
      this.pendingImportResult.set(state.result?.stats ?? null);
      this.activityImportFailed.set(state.status === 'error');
      this.isActivityCooldownResponse.set(state.status === 'cooldown');
      this.hasAcceptedActivityImport.set(state.status === 'success');
      this.activityRequestRange = state.range ?? null;
      this.processChanges();
      this.changeDetectorRef.markForCheck();
    }));
    this.sharedStateSubscriptions.add(this.importState.watch$<SleepBackfillQueueResponse>(sleepKey).subscribe(state => {
      this.sleepState = state;
      this.isSleepBackfillSubmitting.set(state.status === 'pending');
      this.pendingSleepBackfillResult.set(state.result ?? null);
      this.sleepImportFailed.set(state.status === 'error');
      this.updateHistoryBackfillPresentation();
      this.scheduleCooldownRefresh();
      this.changeDetectorRef.markForCheck();
    }));
  }

  private scheduleCooldownRefresh(): void {
    if (this.cooldownTimer !== null) globalThis.clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    const futureDates = [this.activityState.nextAllowedAtMs, this.nextImportAvailableDate?.getTime(), this.sleepBackfillNextAllowedAtMs]
      .filter((value): value is number => typeof value === 'number' && value > Date.now());
    if (!futureDates.length || this.isDestroyed) return;
    this.cooldownTimer = globalThis.setTimeout(() => {
      this.cooldownTimer = null;
      this.processChanges();
      this.updateHistoryBackfillPresentation();
      this.changeDetectorRef.markForCheck();
    }, Math.min(Math.min(...futureDates) - Date.now(), 2_147_483_647));
  }

  private isCurrentView(userID: string, serviceName: ServiceNames, generation: number): boolean {
    return !this.isDestroyed && this.currentUserID === userID && this.serviceName === serviceName
      && this.contextGeneration === generation;
  }

  private updateActivityHistoryFormState(): void {
    if (this.isAllowedToDoHistoryImport && !this.isMissingGarminPermissions
      && !!this.currentUserID && !this.isSubmitting && !this.isHistoryImportPending() && !this.isActivityHistoryImportRunning()) {
      this.formGroup.enable();
    } else {
      this.formGroup.disable();
    }
  }

  private syncActivityHistoryImportRunning(): void {
    this.clearActivityHistoryLeaseTimer();
    const providerName = this.serviceName === ServiceNames.GarminAPI ? 'Garmin'
      : this.serviceName === ServiceNames.WahooAPI ? 'Wahoo' : null;
    this.historyImportRunningMessage = providerName
      ? `A ${providerName} history import is already running. Please wait for it to finish.`
      : '';
    const expiresAt = providerName
      ? this.userMetaForService?.historyImportLeaseExpiresAt
      : undefined;
    const remainingMs = typeof expiresAt === 'number' && Number.isFinite(expiresAt)
      ? expiresAt - Date.now()
      : 0;
    this.isActivityHistoryImportRunning.set(remainingMs > 0);
    if (remainingMs <= 0 || this.isDestroyed) return;
    this.activityHistoryLeaseTimer = globalThis.setTimeout(() => {
      this.activityHistoryLeaseTimer = null;
      if (!this.isDestroyed) this.processChanges();
    }, Math.min(remainingMs, 2_147_483_647));
  }

  private clearActivityHistoryLeaseTimer(): void {
    if (this.activityHistoryLeaseTimer !== null) {
      globalThis.clearTimeout(this.activityHistoryLeaseTimer);
      this.activityHistoryLeaseTimer = null;
    }
  }

  private updateProviderHistoryMinimumDate(): void {
    const limitDate = new Date();
    limitDate.setHours(0, 0, 0, 0);

    if (this.serviceName === ServiceNames.COROSAPI) {
      limitDate.setMonth(limitDate.getMonth() - this.corosHistoryLimitMonths);
      this.minDate = limitDate;
      return;
    }

    if (this.serviceName === ServiceNames.GarminAPI) {
      limitDate.setFullYear(limitDate.getFullYear() - this.garminHistoryLimitYears);
      this.minDate = limitDate;
    }
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (this.isDestroyed || !this.formGroup) return;
    this.syncActivityHistoryImportRunning();
    if (!this.currentUserID || this.isLoadingParent || this.isSubmitting || this.formGroup.disabled || this.isHistoryImportPending() || this.isActivityHistoryImportRunning()) return;
    if (!this.formGroup.valid) {
      this.validateAllFormFields(this.formGroup);
      return;
    }

    const userID = this.currentUserID;
    const serviceName = this.serviceName;
    const generation = this.contextGeneration;
    const key = this.importState.key(userID, serviceName, 'activity');
    const operation = this.importState.begin(key);
    if (!operation) return;
    const startDate = dayjs(this.formGroup.get('startDate')?.value).startOf('day').toDate();
    const endDate = dayjs(this.formGroup.get('endDate')?.value).endOf('day').toDate();
    let dispatched = false;
    this.hapticsService.selection();

    try {
      this.analyticsService.logEvent('imported_history', { method: this.serviceName });
    } catch (e) {
      this.logger.error(e);
    }

    // Explicitly disable the form to force UI state update
    this.formGroup.disable({ emitEvent: false });
    this.changeDetectorRef.detectChanges();

    // Force UI render cycle
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      if (!this.isCurrentView(userID, serviceName, generation)) return;
      this.syncActivityHistoryImportRunning();
      if (this.isActivityHistoryImportRunning()) return;

      dispatched = true;
      const result = await this.userService.importServiceHistoryForCurrentUser(
        serviceName,
        startDate,
        endDate,
        userID
      );
      const cooldownMs = serviceName === ServiceNames.GarminAPI
        ? GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS * 86_400_000
        : typeof result?.stats?.successCount === 'number'
          ? result.stats.successCount / HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT * 86_400_000
          : null;
      this.importState.finish(key, operation, {
        status: 'success', result, range: { startDate, endDate },
        ...(cooldownMs !== null ? { nextAllowedAtMs: Date.now() + cooldownMs } : {}),
      });
      if (!this.isCurrentView(userID, serviceName, generation)) return;
      this.importInitiated.emit(result);

      // Store result for display (COROS/Suunto return stats, Garmin doesn't)
      if (result?.stats) {
        if (result.stats.successCount === 0) {
          this.snackBar.open('No new activities found to import.', undefined, {
            duration: 3000,
          });
        } else {
          this.snackBar.open(`History import queued: ${result.stats.successCount} activities found.`, undefined, {
            duration: 3000,
          });
        }
      } else {
        this.snackBar.open('History import has been queued', undefined, {
          duration: 2000,
        });
      }
      this.hapticsService.success();
    } catch (e: any) {
      if (this.isCancelledHistoryRequest(e)) {
        this.importState.finish(key, operation, { status: 'idle' });
        return;
      }
      const nextAllowedAtMs = historyImportCooldownAt(e, 'activity');
      if (nextAllowedAtMs !== null) {
        this.importState.finish(key, operation, { status: 'cooldown', nextAllowedAtMs });
        if (this.isCurrentView(userID, serviceName, generation)) {
          this.snackBar.open(`Next history import available ${new Date(nextAllowedAtMs).toLocaleString()}.`, undefined, { duration: 4000 });
        }
        return;
      }
      if ((serviceName === ServiceNames.WahooAPI || serviceName === ServiceNames.GarminAPI)
        && (e?.code === 'functions/already-exists' || e?.code === 'already-exists')) {
        this.importState.finish(key, operation, { status: 'idle' });
        if (!this.isCurrentView(userID, serviceName, generation)) return;
        this.snackBar.open(this.historyImportRunningMessage, undefined, {
          duration: 4000,
        });
        return;
      }
      this.importState.finish(key, operation, { status: 'error' });
      this.logger.error(e);
      if (!this.isCurrentView(userID, serviceName, generation)) return;

      this.snackBar.open(`Could not import history for ${this.serviceName} due to ${e.message}`, undefined, {
        duration: 2000,
      });
      this.hapticsService.error();
    } finally {
      if (!dispatched) this.importState.finish(key, operation, { status: 'idle' });
      if (this.isCurrentView(userID, serviceName, generation)) {
        this.isSubmitting = false;
        // Re-evaluate form state
        this.processChanges();
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.clearActivityHistoryLeaseTimer();
    this.sleepSyncStateSubscription?.unsubscribe();
    this.sharedStateSubscriptions.unsubscribe();
    this.authSubscription?.unsubscribe();
    if (this.cooldownTimer !== null) globalThis.clearTimeout(this.cooldownTimer);
    this.healthAvailabilityRequestGeneration += 1;
  }

  get cooldownDays(): number {
    if (!this.userMetaForService?.processedActivitiesFromLastHistoryImportCount) {
      return 0;
    }
    return Math.ceil(this.userMetaForService.processedActivitiesFromLastHistoryImportCount / this.activitiesPerDayLimit);
  }

  get userMeta(): any {
    return this.userMetaForService;
  }

  get estimatedCompletionVerbal(): string {
    const stats = this.pendingImportResult();
    if (!stats || stats.successCount === 0) {
      return '';
    }

    const count = stats.successCount;
    // Calculate total days (decimals allowed)
    // e.g. 500 / 24000 = 0.02 days
    const totalDays = count / this.processingCapacityPerDay;
    const totalHours = totalDays * 24;

    if (totalHours < 1) {
      return 'Should be done very soon! 🚀';
    }

    if (totalHours < 24) {
      // "Estimated to finish by 4:00 PM today/tomorrow"
      const completionDate = dayjs().add(totalHours, 'hour');
      return `Estimated to finish by ${completionDate.format('h:mm A')} ${completionDate.fromNow()}.`;
    }

    // > 1 day
    const completionDate = dayjs().add(totalDays, 'day');
    return `Estimated to finish ${completionDate.fromNow()} (${completionDate.format('dddd')}).`;
  }

  get sleepBackfillProvider(): SleepProvider | null {
    if (this.serviceName === ServiceNames.SuuntoApp) {
      return SLEEP_PROVIDERS.SuuntoApp;
    }
    if (this.serviceName === ServiceNames.GarminAPI) {
      return SLEEP_PROVIDERS.GarminAPI;
    }
    if (this.serviceName === ServiceNames.COROSAPI) {
      return SLEEP_PROVIDERS.COROSAPI;
    }
    return null;
  }

  get sleepBackfillProviderLabel(): string {
    switch (this.serviceName) {
      case ServiceNames.GarminAPI:
        return 'Garmin';
      case ServiceNames.COROSAPI:
        return 'COROS';
      default:
        return 'Suunto';
    }
  }

  get sleepBackfillStartDate(): Date | null {
    const provider = this.sleepBackfillProvider;
    return provider ? new Date(getHealthBackfillStartMs(provider)) : null;
  }

  get sleepBackfillCooldownDays(): number {
    const provider = this.sleepBackfillProvider;
    return provider ? getSleepBackfillCooldownDays(provider) || SLEEP_BACKFILL_COOLDOWN_DAYS : SLEEP_BACKFILL_COOLDOWN_DAYS;
  }

  get isSleepBackfillVisible(): boolean {
    return !!this.sleepBackfillProvider
      && this.isPro
      && this.providerConnected;
  }

  get sleepBackfillResultVerb(): string {
    return this.serviceName === ServiceNames.GarminAPI ? 'Requested' : 'Queued';
  }

  private updateHistoryBackfillPresentation(): void {
    const healthAvailabilityState = this.healthAvailabilityState();
    const providerLabel = this.sleepBackfillProviderLabel;
    if (this.checksHealthBackfillAvailability && healthAvailabilityState === 'loading') {
      this.historyBackfillScopeTitle = `Checking ${providerLabel} import scope`;
    } else if (this.checksHealthBackfillAvailability && healthAvailabilityState === 'error') {
      this.historyBackfillScopeTitle = `${providerLabel} import scope unavailable`;
    } else if (!this.isSleepAndHealthBackfill) {
      this.historyBackfillScopeTitle = 'Sleep history';
    } else {
      switch (this.serviceName) {
        case ServiceNames.COROSAPI:
          this.historyBackfillScopeTitle = 'Sleep & daily Health history';
          break;
        case ServiceNames.SuuntoApp:
          this.historyBackfillScopeTitle = 'Sleep & 24/7 Health history';
          break;
        case ServiceNames.GarminAPI:
          this.historyBackfillScopeTitle = 'Sleep & available Health history';
          break;
        default:
          this.historyBackfillScopeTitle = 'Sleep & Health history';
      }
    }

    this.historyBackfillAriaLabel = this.checksHealthBackfillAvailability
      && (healthAvailabilityState === 'loading' || healthAvailabilityState === 'error')
      ? this.historyBackfillScopeTitle
      : `${providerLabel} ${this.historyBackfillScopeTitle} import`;
    this.historyBackfillIcon = this.isSleepAndHealthBackfill ? 'monitor_heart' : 'bedtime';
    this.historyBackfillActionLabel = this.isSleepBackfillSubmitting()
      ? 'Starting import...'
      : this.sleepSyncStatus() === 'loading'
        ? 'Checking import status...'
        : this.sleepSyncStatus() === 'error'
          ? 'Import status unavailable'
      : this.checksHealthBackfillAvailability && healthAvailabilityState === 'loading'
        ? 'Checking Health availability...'
        : this.checksHealthBackfillAvailability && healthAvailabilityState === 'error'
          ? 'Health availability unavailable'
          : `Import ${this.historyBackfillScopeTitle}`;

    const result = this.pendingSleepBackfillResult();
    if (!result) {
      this.historyBackfillResultText = '';
      return;
    }
    const sleepQueued = result.sleepQueued ?? result.queued;
    const healthQueued = result.healthQueued;
    this.historyBackfillResultText = this.isSleepAndHealthBackfill
      && typeof healthQueued === 'number' && healthQueued > 0
      ? healthQueued === sleepQueued
        ? `${this.historyBackfillScopeTitle} import started for ${sleepQueued} date ranges`
        : `${this.historyBackfillScopeTitle} import started for ${sleepQueued} Sleep date ranges and ${healthQueued} Health requests`
      : `Sleep history import started for ${sleepQueued} date ranges`;
  }

  get isMissingGarminSleepBackfillPermissions(): boolean {
    return this.serviceName === ServiceNames.GarminAPI
      && GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS.some(permission => this.missingPermissions.includes(permission));
  }

  get sleepBackfillNextAllowedAtMs(): number | null {
    const candidates = [this.sleepState.nextAllowedAtMs, this.pendingSleepBackfillResult()?.nextAllowedAtMs,
      this.sleepBackfillSyncState()?.nextBackfillAllowedAtMs]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return candidates.length ? Math.max(...candidates) : null;
  }

  get isSleepBackfillCooldownActive(): boolean {
    const nextAllowedAtMs = this.sleepBackfillNextAllowedAtMs;
    return nextAllowedAtMs !== null && nextAllowedAtMs > Date.now();
  }

  get canSubmitSleepBackfill(): boolean {
    const healthAvailabilityResolved = !this.checksHealthBackfillAvailability
      || this.healthAvailabilityState() === 'available'
      || this.healthAvailabilityState() === 'unavailable';
    return this.isSleepBackfillVisible
      && !!this.currentUserID
      && this.sleepSyncStatus() === 'ready'
      && !this.isSubmitting
      && !this.isLoadingParent
      && !this.isSleepBackfillSubmitting()
      && !this.isSleepBackfillCooldownActive
      && !this.isMissingGarminSleepBackfillPermissions
      && healthAvailabilityResolved;
  }

  async onSleepBackfill(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const provider = this.sleepBackfillProvider;
    if (this.isDestroyed || !this.currentUserID || !provider || !this.canSubmitSleepBackfill) {
      return;
    }
    const historyName = this.historyBackfillScopeTitle;
    const userID = this.currentUserID;
    const serviceName = this.serviceName;
    const generation = this.contextGeneration;
    const key = this.importState.key(userID, serviceName, 'sleep');
    const operation = this.importState.begin(key);
    if (!operation) return;
    this.hapticsService.selection();
    this.updateHistoryBackfillPresentation();
    this.changeDetectorRef.detectChanges();

    try {
      this.analyticsService.logEvent('backfilled_sleep_history', {
        method: this.serviceName,
        source: 'history_import',
      });
    } catch (e) {
      this.logger.error(e);
    }

    try {
      const result = provider === SLEEP_PROVIDERS.GarminAPI
        ? await this.userService.backfillGarminHealthForCurrentUser(userID)
        : provider === SLEEP_PROVIDERS.COROSAPI
          ? await this.userService.backfillCorosSleepForCurrentUser(userID)
          : await this.userService.backfillSuuntoSleepForCurrentUser(userID);
      this.importState.finish(key, operation, { status: 'success', result, nextAllowedAtMs: result.nextAllowedAtMs });
      if (!this.isCurrentView(userID, serviceName, generation)) return;
      this.updateHistoryBackfillPresentation();
      const startedHistoryName = typeof result.healthQueued === 'number'
        ? (result.healthQueued > 0 ? this.historyBackfillScopeTitle : 'Sleep history')
        : historyName;
      const sleepQueued = result.sleepQueued ?? result.queued;
      this.snackBar.open(`${this.sleepBackfillProviderLabel} ${startedHistoryName} import started for ${sleepQueued} date ranges.`, undefined, {
        duration: 3000,
      });
      this.hapticsService.success();
    } catch (e: any) {
      if (this.isCancelledHistoryRequest(e)) {
        this.importState.finish(key, operation, { status: 'idle' });
        return;
      }
      const nextAllowedAtMs = historyImportCooldownAt(e, 'sleep');
      if (nextAllowedAtMs !== null) {
        this.importState.finish(key, operation, { status: 'cooldown', nextAllowedAtMs });
        if (this.isCurrentView(userID, serviceName, generation)) {
          this.snackBar.open(`Next ${historyName} import available ${new Date(nextAllowedAtMs).toLocaleString()}.`, undefined, { duration: 4000 });
        }
        return;
      }
      this.importState.finish(key, operation, { status: 'error' });
      this.logger.error(e);
      if (!this.isCurrentView(userID, serviceName, generation)) return;
      this.snackBar.open(`Could not start the ${historyName} import: ${e.message}`, undefined, {
        duration: 3000,
      });
      this.hapticsService.error();
    } finally {
      if (this.isCurrentView(userID, serviceName, generation)) {
        this.updateHistoryBackfillPresentation();
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  private isCancelledHistoryRequest(error: unknown): boolean {
    const candidate = error as { code?: unknown; message?: unknown } | null;
    return candidate?.code === undefined
      && candidate?.message === 'Operation cancelled because its account or view changed.';
  }

  private syncSleepBackfillStateSubscription(retainKnownState = false): void {
    const provider = this.sleepBackfillProvider;
    const key = provider && this.currentUserID
      ? `${this.currentUserID}:${provider}`
      : null;
    if (this.sleepSyncStateKey === key) {
      return;
    }

    this.sleepSyncStateSubscription?.unsubscribe();
    this.sleepSyncStateSubscription = null;
    this.sleepSyncStateKey = key;
    if (!retainKnownState) this.sleepBackfillSyncState.set(null);
    this.sleepSyncStatus.set(key ? 'loading' : 'idle');
    this.updateHistoryBackfillPresentation();

    if (!key || !this.currentUserID || !provider) {
      return;
    }

    this.sleepSyncStateSubscription = this.sleepService
      .watchSyncState(this.currentUserID, provider)
      .subscribe({
        next: (state) => {
          if (this.isDestroyed || this.sleepSyncStateKey !== key) return;
          this.sleepBackfillSyncState.set(state);
          this.sleepSyncStatus.set('ready');
          this.updateHistoryBackfillPresentation();
          this.scheduleCooldownRefresh();
          this.changeDetectorRef.markForCheck();
        },
        error: (error) => {
          if (this.isDestroyed || this.sleepSyncStateKey !== key) return;
          this.logger.error(error);
          this.sleepSyncStatus.set('error');
          this.updateHistoryBackfillPresentation();
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  public retrySleepSyncState(): void {
    if (this.isDestroyed || !this.currentUserID || this.sleepSyncStatus() !== 'error') return;
    this.hapticsService.selection();
    this.sleepSyncStateKey = null;
    this.syncSleepBackfillStateSubscription(true);
  }

  private syncHealthAvailability(): void {
    const key = this.checksHealthBackfillAvailability && this.currentUserID
      ? `${this.currentUserID}:${this.serviceName}`
      : null;
    if (this.healthAvailabilityRequestKey === key) {
      return;
    }

    this.healthAvailabilityRequestKey = key;
    const requestGeneration = ++this.healthAvailabilityRequestGeneration;
    this.healthAvailabilityState.set(key ? 'loading' : 'idle');
    this.updateSleepAndHealthBackfillAvailability();

    if (!key) {
      return;
    }

    const availabilityRequest = this.serviceName === ServiceNames.GarminAPI
      ? this.userService.getGarminHealthSyncAvailabilityForCurrentUser()
      : this.userService.getSuuntoHealthSyncAvailabilityForCurrentUser();
    void availabilityRequest
      .then((available) => {
        if (this.healthAvailabilityRequestGeneration !== requestGeneration
          || this.healthAvailabilityRequestKey !== key) return;
        this.healthAvailabilityState.set(available ? 'available' : 'unavailable');
        this.updateSleepAndHealthBackfillAvailability();
        this.changeDetectorRef.markForCheck();
      })
      .catch((error) => {
        if (this.healthAvailabilityRequestGeneration !== requestGeneration
          || this.healthAvailabilityRequestKey !== key) return;
        this.logger.error(error);
        this.healthAvailabilityState.set('error');
        this.updateSleepAndHealthBackfillAvailability();
        this.changeDetectorRef.markForCheck();
      });
  }

  public retryHealthAvailability(): void {
    if (this.isDestroyed || !this.checksHealthBackfillAvailability
      || !this.currentUserID
      || this.healthAvailabilityState() === 'loading') return;
    this.hapticsService.selection();
    this.healthAvailabilityRequestKey = null;
    this.syncHealthAvailability();
  }

  private updateSleepAndHealthBackfillAvailability(): void {
    this.isSleepAndHealthBackfill = this.serviceName === ServiceNames.COROSAPI
      || (this.checksHealthBackfillAvailability
        && this.healthAvailabilityState() === 'available');
    this.updateHistoryBackfillPresentation();
  }

  private coerceUserID(user: User | null | undefined): string | null {
    const uid = `${(user as { uid?: unknown } | null | undefined)?.uid || ''}`.trim();
    return uid || null;
  }
}
