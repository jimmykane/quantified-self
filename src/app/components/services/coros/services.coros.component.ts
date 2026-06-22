import { Component } from '@angular/core';
import { ServiceNames, Auth2ServiceTokenInterface, Auth1ServiceTokenInterface, UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { ActivitySyncBackfillSummary, AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../../../constants/coros';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import dayjs from 'dayjs';
import { Subscription } from 'rxjs';
import {
  buildSuuntoServiceConnectionViewModel,
  SuuntoServiceConnectionViewModel,
} from '../../../helpers/suunto-service-connection.helper';
import { isDisconnectPendingServiceConnection } from '@shared/service-connection';


@Component({
  selector: 'app-services-coros',
  templateUrl: './services.coros.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.coros.component.css'],
  standalone: false
})
export class ServicesCorosComponent extends ServicesAbstractComponentDirective {

  public serviceName = ServiceNames.COROSAPI;
  public showCorosUploadActivityCard = false;
  public minDate = dayjs().subtract(COROS_HISTORY_IMPORT_LIMIT_MONTHS, 'month').toDate();
  public readonly corosToSuuntoRouteID = ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp;
  public isSavingSyncRoute = false;
  public isBackfillingSync = false;
  public backfillStartDate: Date = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  public backfillEndDate: Date = new Date();
  public backfillSummary: ActivitySyncBackfillSummary | null = null;

  private suuntoConnectionSubscription: Subscription | null = null;
  public suuntoConnectionView: SuuntoServiceConnectionViewModel = buildSuuntoServiceConnectionViewModel({
    hasToken: false,
    serviceMeta: null,
  });

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar) {
    super(http, fileService, eventService, authService, userService, route, windowService, snackBar);
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserCOROSAPIAccessToken(state, code);
    }
  }

  get corosServiceMeta(): UserServiceMetaInterface & { uploadedActivitiesCount?: number } | undefined {
    return this.serviceMeta;
  }

  override async ngOnChanges() {
    await super.ngOnChanges();
    this.watchSuuntoConnectionState();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;
  }

  isConnectedToService = () => !this.isDisconnectPending && ((!!this.serviceTokens && !!this.serviceTokens.length) || this.forceConnected);

  get isDisconnectPending(): boolean {
    return isDisconnectPendingServiceConnection(this.serviceMeta);
  }

  get isDisconnectManualReviewRequired(): boolean {
    return this.isDisconnectPending && this.serviceMeta?.disconnectManualReviewRequired === true;
  }

  protected override get canConnectWithoutProAccess(): boolean {
    return this.isDisconnectManualReviewRequired;
  }

  get shouldShowConnectAction(): boolean {
    return !this.isConnectedToService()
      && (!this.isDisconnectPending || this.isDisconnectManualReviewRequired);
  }

  get connectButtonLabel(): string {
    return this.isDisconnectManualReviewRequired ? 'Reconnect' : 'Connect';
  }

  get connectionDescription(): string {
    return this.isDisconnectManualReviewRequired
      ? 'COROS disconnect retries have stopped. Reconnect COROS to refresh this connection, or contact support if the old connection still appears in COROS.'
      : this.isDisconnectPending
      ? 'Disconnect is pending while COROS finishes deauthorization. Sync and imports are paused for this connection.'
      : 'Required for history imports, uploads, and COROS to Suunto auto-sync.';
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }

  get corosOpenId(): string | undefined {
    return (this.serviceTokens as Auth2ServiceTokenInterface[])?.[0]?.openId;
  }

  getCorosOpenId(token: Auth2ServiceTokenInterface | Auth1ServiceTokenInterface): string | undefined {
    return (token as Auth2ServiceTokenInterface).openId;
  }

  private watchSuuntoConnectionState(): void {
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;

    if (!this.user) {
      this.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
        hasToken: false,
        serviceMeta: null,
      });
      return;
    }

    this.suuntoConnectionSubscription = this.userService.watchSuuntoServiceConnectionView(this.user).subscribe((connectionView) => {
      this.suuntoConnectionView = connectionView;
    });
  }

  get isSuuntoConnected(): boolean {
    return this.suuntoConnectionView.connected && !this.suuntoConnectionView.reconnectRequired;
  }

  get isSuuntoReconnectRequired(): boolean {
    return this.suuntoConnectionView.reconnectRequired;
  }

  get isCorosToSuuntoRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.activitySyncRoutes?.[this.corosToSuuntoRouteID]?.enabled === true;
  }

  get isCorosToSuuntoRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isActivitySyncRouteUIDAllowlisted(this.corosToSuuntoRouteID, userID);
  }

  get isBackfillDateRangeInvalid(): boolean {
    return this.backfillStartDate > this.backfillEndDate;
  }

  async onCorosToSuuntoRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingSyncRoute) {
      return;
    }

    if (!this.isCorosToSuuntoRouteAvailableForUser) {
      this.snackBar.open('This activity sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before enabling sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && (!this.isConnectedToService() || !this.isSuuntoConnected)) {
      this.snackBar.open('Connect both COROS and Suunto accounts before enabling sync.', undefined, { duration: 4000 });
      return;
    }

    this.isSavingSyncRoute = true;
    try {
      await this.userService.updateActivitySyncRouteSettings(this.user, {
        [this.corosToSuuntoRouteID]: enabled,
      });

      this.analyticsService.logActivitySyncRouteToggle(this.corosToSuuntoRouteID, enabled);
      this.snackBar.open(enabled ? 'COROS to Suunto auto-sync enabled.' : 'COROS to Suunto auto-sync disabled.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update sync setting: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isSavingSyncRoute = false;
    }
  }

  async runCorosToSuuntoBackfill(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.user || this.isBackfillingSync) {
      return;
    }

    if (!this.isCorosToSuuntoRouteAvailableForUser) {
      this.snackBar.open('This activity sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before running COROS to Suunto catch-up.', undefined, { duration: 4000 });
      return;
    }

    if (!this.isConnectedToService() || !this.isSuuntoConnected) {
      this.snackBar.open('Connect both COROS and Suunto accounts before running catch-up.', undefined, { duration: 4000 });
      return;
    }

    if (this.isBackfillDateRangeInvalid) {
      this.snackBar.open('Backfill start date must be before end date.', undefined, { duration: 3500 });
      return;
    }

    this.isBackfillingSync = true;
    try {
      const summary = await this.userService.backfillActivitySyncRouteForCurrentUser(
        ServiceNames.COROSAPI,
        ServiceNames.SuuntoApp,
        this.backfillStartDate,
        this.backfillEndDate,
      );

      this.backfillSummary = summary;
      this.analyticsService.logActivitySyncRouteBackfill(this.corosToSuuntoRouteID, {
        scanned: summary.scanned,
        queued: summary.queued,
        failedCount: summary.failedCount,
      });
      const failureSuffix = summary.failedCount > 0 ? ` Failed: ${summary.failedCount}.` : '';
      this.snackBar.open(`Backfill complete. Queued ${summary.queued} sync job(s).${failureSuffix}`, undefined, { duration: 4000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Backfill failed: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isBackfillingSync = false;
    }
  }
}
