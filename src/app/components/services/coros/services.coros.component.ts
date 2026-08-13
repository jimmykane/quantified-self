import { Component, Input } from '@angular/core';
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
import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
} from '@shared/service-connection';
import { isCOROSRouteUploadUIDAllowlisted } from '@shared/coros-rollout';


@Component({
  selector: 'app-services-coros',
  templateUrl: './services.coros.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.coros.component.css'],
  standalone: false
})
export class ServicesCorosComponent extends ServicesAbstractComponentDirective {

  public serviceName = ServiceNames.COROSAPI;
  public showCorosUploadActivityCard = true;
  public minDate = dayjs().subtract(COROS_HISTORY_IMPORT_LIMIT_MONTHS, 'month').toDate();
  public readonly corosToSuuntoRouteID = ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp;
  public isSavingSyncRoute = false;
  public isBackfillingSync = false;
  public backfillStartDate: Date = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  public backfillEndDate: Date = new Date();
  public backfillSummary: ActivitySyncBackfillSummary | null = null;
  public activeActivitySyncDestination: 'suunto' | 'wahoo' | 'coros' = 'suunto';
  @Input() initialActivitySyncDestination: 'suunto' | 'wahoo' | 'coros' | null = null;

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

  get corosServiceMeta(): UserServiceMetaInterface & {
    uploadedActivitiesCount?: number;
    providerUserId?: string;
  } | undefined {
    return this.serviceMeta;
  }

  override async ngOnChanges() {
    if (this.initialActivitySyncDestination) {
      this.activeActivitySyncDestination = this.initialActivitySyncDestination;
    }
    await super.ngOnChanges();
    this.watchSuuntoConnectionState();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;
  }

  isConnectedToService = () => !this.isDisconnectPending && (!!this.activeCorosServiceToken || this.forceConnected);

  get isReconnectRequired(): boolean {
    return isReconnectRequiredServiceConnection(this.serviceMeta);
  }

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
    return (!this.isConnectedToService() || this.isReconnectRequired || this.isDisconnectManualReviewRequired)
      && (!this.isDisconnectPending || this.isDisconnectManualReviewRequired);
  }

  get connectButtonLabel(): string {
    return this.isReconnectRequired || this.isDisconnectManualReviewRequired ? 'Reconnect' : 'Connect';
  }

  get connectionDescription(): string {
    const uploadScope = this.isCOROSRouteUploadAvailableForUser
      ? 'activity and route uploads'
      : 'activity uploads';
    return this.isDisconnectManualReviewRequired
      ? 'COROS disconnect retries have stopped. Reconnect COROS to refresh this connection, or contact support if the old connection still appears in COROS.'
      : this.isDisconnectPending
      ? 'Disconnect is pending while COROS finishes deauthorization. Sync and imports are paused for this connection.'
      : this.isReconnectRequired
      ? `Reconnect COROS to resume history imports, ${uploadScope}, and automatic sync.`
      : `Required for history imports, direct ${uploadScope}, and automatic sync involving COROS.`;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }

  get corosOpenId(): string | undefined {
    return this.activeCorosServiceToken?.openId;
  }

  /**
   * COROS deliveries use exactly one account. New connections are pinned in
   * service metadata; legacy connections use the same deterministic fallback
   * as the backend until their first delivery persists that pin.
   */
  get activeCorosServiceToken(): Auth2ServiceTokenInterface | undefined {
    const tokens = ((this.serviceTokens || []) as Auth2ServiceTokenInterface[])
      .filter(token => `${token?.openId || ''}`.trim().length > 0);
    const pinnedOpenId = `${this.corosServiceMeta?.providerUserId || ''}`.trim();
    if (pinnedOpenId) {
      return tokens.find(token => `${token.openId || ''}`.trim() === pinnedOpenId);
    }

    return [...tokens].sort((left, right) => (
      this.getTokenTimestamp(right.dateRefreshed) - this.getTokenTimestamp(left.dateRefreshed)
      || this.getTokenTimestamp(right.dateCreated) - this.getTokenTimestamp(left.dateCreated)
      || `${right.openId || ''}`.localeCompare(`${left.openId || ''}`)
    ))[0];
  }

  getCorosOpenId(token: Auth2ServiceTokenInterface | Auth1ServiceTokenInterface): string | undefined {
    return (token as Auth2ServiceTokenInterface).openId;
  }

  private getTokenTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
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

  get isCOROSRouteUploadAvailableForUser(): boolean {
    return isCOROSRouteUploadUIDAllowlisted(`${this.user?.uid || ''}`);
  }

  get isBackfillDateRangeInvalid(): boolean {
    return this.backfillStartDate > this.backfillEndDate;
  }

  async onCorosToSuuntoRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingSyncRoute) {
      return;
    }

    if (!this.isCorosToSuuntoRouteAvailableForUser) {
      this.snackBar.open('Activity sync is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && this.isReconnectRequired) {
      this.snackBar.open('Reconnect COROS before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && (!this.isConnectedToService() || !this.isSuuntoConnected)) {
      this.snackBar.open('Connect COROS and Suunto before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    this.isSavingSyncRoute = true;
    try {
      await this.userService.updateActivitySyncRouteSettings(this.user, {
        [this.corosToSuuntoRouteID]: enabled,
      });

      this.analyticsService.logActivitySyncRouteToggle(this.corosToSuuntoRouteID, enabled);
      this.snackBar.open(enabled ? 'New COROS activities will be sent to Suunto automatically.' : 'Automatic COROS activity sync to Suunto is off.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open('Could not update automatic activity sync.', undefined, { duration: 5000 });
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
      this.snackBar.open('Activity sync is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before syncing past COROS activities.', undefined, { duration: 4000 });
      return;
    }

    if (this.isReconnectRequired) {
      this.snackBar.open('Reconnect COROS before syncing past activities.', undefined, { duration: 4000 });
      return;
    }

    if (!this.isConnectedToService() || !this.isSuuntoConnected) {
      this.snackBar.open('Connect COROS and Suunto before syncing past activities.', undefined, { duration: 4000 });
      return;
    }

    if (this.isBackfillDateRangeInvalid) {
      this.snackBar.open('The start date must be before the end date.', undefined, { duration: 3500 });
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
      const failureSuffix = summary.failedCount > 0 ? ` Could not schedule: ${summary.failedCount}.` : '';
      this.snackBar.open(`Activity sync started for ${summary.queued} ${summary.queued === 1 ? 'activity' : 'activities'}.${failureSuffix}`, undefined, { duration: 4000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start activity sync: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isBackfillingSync = false;
    }
  }
}
