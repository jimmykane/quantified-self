import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { Subscription, combineLatest, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { getActivitySyncRouteId, ActivitySyncRouteId } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import { isDisconnectPendingServiceConnection, isReconnectRequiredServiceConnection } from '@shared/service-connection';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { AppUserInterface } from '../../../models/app-user.interface';
import { ActivitySyncBackfillSummary, AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-activity-sync-route-control',
  templateUrl: './activity-sync-route-control.component.html',
  styleUrls: ['./activity-sync-route-control.component.css'],
  standalone: false,
})
export class ActivitySyncRouteControlComponent implements OnChanges, OnDestroy {
  @Input() user: AppUserInterface | null | undefined;
  @Input() hasProAccess = false;
  @Input() sourceServiceName!: ServiceNames;
  @Input() destinationServiceName!: ServiceNames;
  @Input() sourceConnected = false;
  @Input() sourceReconnectRequired = false;

  public routeId: ActivitySyncRouteId | null = null;
  public destinationConnected = false;
  public destinationReconnectRequired = false;
  public destinationDisconnectPending = false;
  public isSaving = false;
  public isBackfilling = false;
  public backfillStartDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  public backfillEndDate = new Date();
  public backfillSummary: ActivitySyncBackfillSummary | null = null;

  private destinationConnectionSubscription: Subscription | null = null;

  constructor(
    private userService: AppUserService,
    private analyticsService: AppAnalyticsService,
    private logger: LoggerService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnChanges(): void {
    this.routeId = getActivitySyncRouteId(this.sourceServiceName, this.destinationServiceName);
    this.watchDestinationConnection();
  }

  ngOnDestroy(): void {
    this.destinationConnectionSubscription?.unsubscribe();
  }

  get sourceName(): string {
    return getProviderDisplayName(this.sourceServiceName, 'source');
  }

  get destinationName(): string {
    return getProviderDisplayName(this.destinationServiceName, 'destination');
  }

  get routeAvailableForUser(): boolean {
    return !!this.routeId && isActivitySyncRouteUIDAllowlisted(this.routeId, `${this.user?.uid || ''}`);
  }

  get routeEnabled(): boolean {
    return !!this.routeId
      && this.user?.settings?.serviceSyncSettings?.activitySyncRoutes?.[this.routeId]?.enabled === true;
  }

  get isBackfillDateRangeInvalid(): boolean {
    return this.backfillStartDate > this.backfillEndDate;
  }

  get canUseRoute(): boolean {
    return this.sourceConnected
      && !this.sourceReconnectRequired
      && this.destinationConnected
      && !this.destinationReconnectRequired
      && !this.destinationDisconnectPending;
  }

  async onRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || !this.routeId || this.isSaving) return;
    if (!this.routeAvailableForUser) {
      this.snackBar.open('Activity sync is not available for this account.', undefined, { duration: 4000 });
      return;
    }
    if (enabled && !this.canUseRoute) {
      this.snackBar.open(`Connect ${this.sourceName} and ${this.destinationName} before turning on automatic activity sync.`, undefined, { duration: 4500 });
      return;
    }

    this.isSaving = true;
    try {
      await this.userService.updateActivitySyncRouteSettings(this.user, { [this.routeId]: enabled });
      this.analyticsService.logActivitySyncRouteToggle(this.routeId, enabled);
      this.snackBar.open(
        enabled
          ? `New ${this.sourceName} activities will be sent to ${this.destinationName} automatically.`
          : `Automatic ${this.sourceName} activity sync to ${this.destinationName} is off.`,
        undefined,
        { duration: 3500 },
      );
    } catch (error) {
      this.logger.error(error);
      this.snackBar.open('Could not update automatic activity sync.', undefined, { duration: 5000 });
    } finally {
      this.isSaving = false;
    }
  }

  async runBackfill(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.user || !this.routeId || this.isBackfilling) return;
    if (!this.routeAvailableForUser) {
      this.snackBar.open('Activity sync is not available for this account.', undefined, { duration: 4000 });
      return;
    }
    if (!this.canUseRoute) {
      this.snackBar.open(`Connect ${this.sourceName} and ${this.destinationName} before syncing past activities.`, undefined, { duration: 4500 });
      return;
    }
    if (this.isBackfillDateRangeInvalid) {
      this.snackBar.open('The start date must be before the end date.', undefined, { duration: 3500 });
      return;
    }

    this.isBackfilling = true;
    try {
      const summary = await this.userService.backfillActivitySyncRouteForCurrentUser(
        this.sourceServiceName,
        this.destinationServiceName,
        this.backfillStartDate,
        this.backfillEndDate,
      );
      this.backfillSummary = summary;
      this.analyticsService.logActivitySyncRouteBackfill(this.routeId, {
        scanned: summary.scanned,
        queued: summary.queued,
        failedCount: summary.failedCount,
      });
      const failureSuffix = summary.failedCount > 0 ? ` Could not schedule: ${summary.failedCount}.` : '';
      this.snackBar.open(`Activity sync started for ${summary.queued} ${summary.queued === 1 ? 'activity' : 'activities'}.${failureSuffix}`, undefined, { duration: 4500 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start activity sync: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isBackfilling = false;
    }
  }

  private watchDestinationConnection(): void {
    this.destinationConnectionSubscription?.unsubscribe();
    this.destinationConnectionSubscription = null;
    if (!this.user || !this.destinationServiceName) {
      this.destinationConnected = false;
      this.destinationReconnectRequired = false;
      this.destinationDisconnectPending = false;
      return;
    }

    this.destinationConnectionSubscription = combineLatest([
      this.userService.watchActivityServiceConnectionState(this.user).pipe(
        map((state) => state[this.destinationServiceName as keyof typeof state] === true),
        catchError(() => of(false)),
      ),
      this.userService.getUserMetaForService(this.user, this.destinationServiceName).pipe(
        catchError(() => of(undefined)),
      ),
    ]).subscribe(([connected, serviceMeta]) => {
      this.destinationConnected = connected;
      this.destinationReconnectRequired = isReconnectRequiredServiceConnection(serviceMeta);
      this.destinationDisconnectPending = isDisconnectPendingServiceConnection(serviceMeta);
    });
  }
}
