import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { combineLatest, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { getRouteDeliverySyncRouteId, RouteDeliverySyncRouteId } from '@shared/route-delivery-sync-routes';
import { isRouteDeliverySyncRouteUIDAllowlisted } from '@shared/route-delivery-sync-rollout';
import { isDisconnectPendingServiceConnection, isReconnectRequiredServiceConnection } from '@shared/service-connection';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { AppUserInterface } from '../../../models/app-user.interface';
import { AppUserService, RouteDeliverySyncBackfillSummary } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-route-delivery-sync-route-control',
  templateUrl: './route-delivery-sync-route-control.component.html',
  styleUrls: [
    '../activity-sync-route-control/activity-sync-route-control.component.css',
    './route-delivery-sync-route-control.component.css',
  ],
  standalone: false,
})
export class RouteDeliverySyncRouteControlComponent implements OnChanges, OnDestroy {
  @Input() user: AppUserInterface | null | undefined;
  @Input() hasProAccess = false;
  @Input() sourceServiceName!: ServiceNames;
  @Input() destinationServiceName!: ServiceNames;
  @Input() sourceConnected = false;
  @Input() sourceReconnectRequired = false;
  @Input() showTopDivider = false;

  public routeId: RouteDeliverySyncRouteId | null = null;
  public destinationConnected = false;
  public destinationReconnectRequired = false;
  public destinationDisconnectPending = false;
  public isSaving = false;
  public isBackfilling = false;
  public backfillSummary: RouteDeliverySyncBackfillSummary | null = null;

  private destinationConnectionSubscription: Subscription | null = null;

  constructor(
    private userService: AppUserService,
    private analyticsService: AppAnalyticsService,
    private logger: LoggerService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnChanges(): void {
    this.routeId = getRouteDeliverySyncRouteId(this.sourceServiceName, this.destinationServiceName);
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
    return !!this.routeId && isRouteDeliverySyncRouteUIDAllowlisted(this.routeId, `${this.user?.uid || ''}`);
  }

  get routeEnabled(): boolean {
    return !!this.routeId
      && this.user?.settings?.serviceSyncSettings?.routeDeliverySyncRoutes?.[this.routeId]?.enabled === true;
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
      this.snackBar.open('Automatic route sending is not available for this account.', undefined, { duration: 4000 });
      return;
    }
    if (enabled && !this.canUseRoute) {
      this.snackBar.open(`Connect ${this.sourceName} and ${this.destinationName} before turning on automatic route sending.`, undefined, { duration: 4500 });
      return;
    }

    this.isSaving = true;
    try {
      await this.userService.updateRouteDeliverySyncRouteSettings(this.user, { [this.routeId]: enabled });
      this.analyticsService.logEvent('route_delivery_sync_route_toggle', {
        route_id: this.routeId,
        enabled,
      });
      this.snackBar.open(
        enabled
          ? `New and updated ${this.sourceName} routes will be sent to ${this.destinationName} automatically.`
          : `Automatic ${this.sourceName} route sending to ${this.destinationName} is off.`,
        undefined,
        { duration: 3500 },
      );
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update automatic route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isSaving = false;
    }
  }

  async runBackfill(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.user || !this.routeId || this.isBackfilling) return;
    if (!this.routeAvailableForUser) {
      this.snackBar.open('Route sending is not available for this account.', undefined, { duration: 4000 });
      return;
    }
    if (!this.canUseRoute) {
      this.snackBar.open(`Connect ${this.sourceName} and ${this.destinationName} before sending saved routes.`, undefined, { duration: 4500 });
      return;
    }

    this.isBackfilling = true;
    try {
      const summary = await this.userService.backfillRouteDeliverySyncRouteForCurrentUser(
        this.sourceServiceName,
        this.destinationServiceName,
      );
      this.backfillSummary = summary;
      this.analyticsService.logEvent('route_delivery_sync_backfill', {
        route_id: this.routeId,
        scanned: summary.scanned,
        queued: summary.queued,
        failed_count: summary.failedCount,
      });
      const failureSuffix = summary.failedCount > 0 ? ` Could not schedule: ${summary.failedCount}.` : '';
      this.snackBar.open(
        `${summary.queued} ${summary.queued === 1 ? 'route' : 'routes'} scheduled for ${this.destinationName}.${failureSuffix}`,
        undefined,
        { duration: 4500 },
      );
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
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
        map(state => state[this.destinationServiceName as keyof typeof state] === true),
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
