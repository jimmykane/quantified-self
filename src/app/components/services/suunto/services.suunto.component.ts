import { Component, DoCheck, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService, GarminRouteSendContext, RouteDeliverySyncBackfillSummary } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServiceNames, Auth2ServiceTokenInterface, Auth1ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { getSuuntoProviderUserIdFromTokenLike } from '@shared/suunto-route-import-state';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { AppUserServiceMetaInterface } from '../../../models/app-user.interface';
import {
  buildSuuntoServiceConnectionViewModel,
  SuuntoServiceConnectionViewModel,
} from '../../../helpers/suunto-service-connection.helper';
import {
  buildSuuntoRouteCatchUpSnackbarMessage,
  getSuuntoRouteCatchUpCount,
  getSuuntoRouteCatchUpDateForConnectedProviders,
} from '../../../helpers/suunto-route-catch-up.helper';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';
import { isRouteDeliverySyncRouteUIDAllowlisted } from '@shared/route-delivery-sync-rollout';
import { Subscription } from 'rxjs';

function isDateValue(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.suunto.component.css'],
  standalone: false
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective implements DoCheck, OnDestroy {
  public serviceName = ServiceNames.SuuntoApp;
  public readonly suuntoToGarminRouteID = ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI;
  public readonly suuntoToWahooRouteID = ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI;
  clicks = 0;
  isQueueingRoutes = false;
  isSavingRouteDeliverySyncRoute = false;
  isQueueingRouteDeliverySyncBackfill = false;
  routeDeliveryBackfillSummary: RouteDeliverySyncBackfillSummary | null = null;
  isQueueingWahooRouteDeliverySyncBackfill = false;
  wahooRouteDeliveryBackfillSummary: RouteDeliverySyncBackfillSummary | null = null;
  public isServiceConnected = false;
  public connectedSuuntoServiceTokens: Array<Auth1ServiceTokenInterface | Auth2ServiceTokenInterface> = [];
  public connectedSuuntoAccounts: Array<{
    serviceToken: Auth1ServiceTokenInterface | Auth2ServiceTokenInterface;
    trackKey: string;
    userName?: string;
  }> = [];
  public hasConnectedSuuntoAccount = false;
  public connectionView: SuuntoServiceConnectionViewModel = buildSuuntoServiceConnectionViewModel({
    hasToken: false,
    serviceMeta: null,
  });
  public didLastRouteImport: Date | null = null;
  public queuedRoutesFromLastRouteImportCount = 0;
  public skippedRoutesFromLastRouteImportCount = 0;
  public failedRoutesFromLastRouteImportCount = 0;
  public totalRoutesFromLastRouteImportCount = 0;
  public isWahooRouteDeliveryConnected = false;
  public garminRouteSendContext: GarminRouteSendContext = {
    connected: false,
    reconnectRequired: false,
    missingPermissions: [],
    providerUserId: null,
    providerStates: [],
    serviceMeta: null,
    permissionPromptSource: null,
  };
  private lastServiceTokensRef: Auth2ServiceTokenInterface[] | Auth1ServiceTokenInterface[] | undefined;
  private lastServiceMetaRef: AppUserServiceMetaInterface | undefined;
  private lastForceConnected = false;
  private garminRouteSendSubscription: Subscription | null = null;
  private wahooRouteDeliverySubscription: Subscription | null = null;

  override async ngOnChanges() {
    await super.ngOnChanges();
    this.syncDerivedState();
    this.watchGarminRouteSendState();
    this.watchWahooRouteDeliveryState();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.garminRouteSendSubscription?.unsubscribe();
    this.garminRouteSendSubscription = null;
    this.wahooRouteDeliverySubscription?.unsubscribe();
    this.wahooRouteDeliverySubscription = null;
  }

  ngDoCheck(): void {
    if (
      this.serviceTokens !== this.lastServiceTokensRef
      || this.serviceMeta !== this.lastServiceMetaRef
      || this.forceConnected !== this.lastForceConnected
    ) {
      this.syncDerivedState();
    }
  }

  protected override onServiceDataChanged(): void {
    this.syncDerivedState();
  }

  get suuntoServiceMeta(): (AppUserServiceMetaInterface & {
    uploadedActivitiesCount?: number;
    uploadedRoutesCount?: number;
  }) | undefined {
    return this.serviceMeta;
  }

  get isReconnectRequired(): boolean {
    return this.connectionView.reconnectRequired;
  }

  get isDisconnectPending(): boolean {
    return this.connectionView.disconnectPending;
  }

  get isDisconnectManualReviewRequired(): boolean {
    return this.connectionView.disconnectManualReviewRequired;
  }

  protected override get canConnectWithoutProAccess(): boolean {
    return this.isDisconnectManualReviewRequired;
  }

  get shouldShowConnectAction(): boolean {
    return (!this.isServiceConnected || this.isReconnectRequired || this.isDisconnectManualReviewRequired || this.clicks > 10)
      && (!this.isDisconnectPending || this.isDisconnectManualReviewRequired);
  }

  get connectionDescription(): string {
    return this.connectionView.description;
  }

  get reconnectFailureMessage(): string | null {
    return this.connectionView.failureMessage;
  }

  get connectButtonLabel(): string {
    return this.connectionView.connectButtonLabel;
  }

  get isSuuntoToGarminRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isRouteDeliverySyncRouteUIDAllowlisted(this.suuntoToGarminRouteID, userID);
  }

  get isSuuntoToGarminRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.routeDeliverySyncRoutes?.[this.suuntoToGarminRouteID]?.enabled === true;
  }

  get isSuuntoToWahooRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isRouteDeliverySyncRouteUIDAllowlisted(this.suuntoToWahooRouteID, userID);
  }

  get isSuuntoToWahooRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.routeDeliverySyncRoutes?.[this.suuntoToWahooRouteID]?.enabled === true;
  }

  get isGarminRouteDeliveryReady(): boolean {
    return this.garminRouteSendContext.connected
      && !this.garminRouteSendContext.reconnectRequired
      && this.garminRouteSendContext.missingPermissions.length === 0;
  }

  get canEnableSuuntoToGarminRoute(): boolean {
    return this.hasProAccess
      && this.isSuuntoToGarminRouteAvailableForUser
      && this.hasConnectedSuuntoAccount
      && !this.isReconnectRequired
      && this.isGarminRouteDeliveryReady;
  }

  get canQueueSuuntoToGarminRouteBackfill(): boolean {
    return this.canEnableSuuntoToGarminRoute;
  }

  get canEnableSuuntoToWahooRoute(): boolean {
    return this.hasProAccess
      && this.isSuuntoToWahooRouteAvailableForUser
      && this.hasConnectedSuuntoAccount
      && !this.isReconnectRequired
      && this.isWahooRouteDeliveryConnected;
  }

  get canQueueSuuntoToWahooRouteBackfill(): boolean {
    return this.canEnableSuuntoToWahooRoute;
  }

  get suuntoToGarminRouteStatusTitle(): string {
    if (!this.garminRouteSendContext.connected) {
      return 'Connect Garmin to send routes';
    }
    if (this.garminRouteSendContext.reconnectRequired) {
      return 'Reconnect Garmin to send routes';
    }
    if (this.garminRouteSendContext.missingPermissions.length > 0) {
      return 'Garmin Course Import permission needed';
    }
    return 'Routes are ready to send to Garmin';
  }

  get suuntoToGarminRouteStatusType(): 'success' | 'warning' | 'info' {
    if (this.garminRouteSendContext.missingPermissions.length > 0) {
      return 'warning';
    }
    return this.isGarminRouteDeliveryReady ? 'success' : 'info';
  }

  get suuntoToGarminRouteStatusMessage(): string {
    const garminAccount = this.garminRouteSendContext.providerUserId;
    if (!this.garminRouteSendContext.connected) {
      return 'Connect Garmin before automatically sending Suunto routes to Garmin.';
    }
    if (this.garminRouteSendContext.reconnectRequired) {
      return 'Reconnect Garmin before automatically sending Suunto routes to Garmin.';
    }
    if (this.garminRouteSendContext.missingPermissions.length > 0) {
      return 'Allow Course Import in Garmin Connect, then reconnect Garmin.';
    }
    return garminAccount
      ? `Suunto routes saved in Quantified Self can be sent to Garmin account ${garminAccount}.`
      : 'Suunto routes saved in Quantified Self can be sent to Garmin.';
  }

  get suuntoToWahooRouteStatusTitle(): string {
    return this.isWahooRouteDeliveryConnected
      ? 'Wahoo connection detected'
      : 'Connect Wahoo to send routes';
  }

  get suuntoToWahooRouteStatusType(): 'info' {
    return 'info';
  }

  get suuntoToWahooRouteStatusMessage(): string {
    if (!this.isWahooRouteDeliveryConnected) {
      return 'Connect Wahoo before automatically sending Suunto routes to Wahoo.';
    }

    return 'Suunto routes saved in Quantified Self can be sent to Wahoo. Route access is checked when sending begins; if Wahoo was connected before route sending was available, reconnect it once to grant route access.';
  }

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

  isConnectedToService(): boolean {
    return this.isServiceConnected;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserSuuntoAppAccessToken(state, code);
    }
  }

  async queueRoutesFromSuunto(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }

    if (this.isQueueingRoutes) {
      return;
    }

    if (this.isReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before importing existing routes.', undefined, { duration: 4000 });
      return;
    }

    if (!this.isConnectedToService()) {
      this.snackBar.open('Connect Suunto before importing existing routes.', undefined, { duration: 4000 });
      return;
    }

    this.isQueueingRoutes = true;
    try {
      const summary = await this.userService.addSuuntoRoutesToQueueForCurrentUser();
      const feedback = buildSuuntoRouteCatchUpSnackbarMessage(summary);
      this.snackBar.open(feedback.message, undefined, { duration: feedback.duration });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start the route import: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingRoutes = false;
    }
  }

  async onSuuntoToGarminRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingRouteDeliverySyncRoute) {
      return;
    }

    if (!this.isSuuntoToGarminRouteAvailableForUser) {
      this.snackBar.open('Automatic route sending is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && !this.canEnableSuuntoToGarminRoute) {
      this.snackBar.open('Connect Suunto and Garmin, and allow Course Import in Garmin Connect.', undefined, { duration: 4500 });
      return;
    }

    this.isSavingRouteDeliverySyncRoute = true;
    try {
      await this.userService.updateRouteDeliverySyncRouteSettings(this.user, {
        [this.suuntoToGarminRouteID]: enabled,
      });
      this.analyticsService.logEvent('route_delivery_sync_route_toggle', {
        route_id: this.suuntoToGarminRouteID,
        enabled,
      });
      this.snackBar.open(enabled ? 'New Suunto routes will be sent to Garmin automatically.' : 'Automatic Suunto route sending to Garmin is off.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update automatic route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isSavingRouteDeliverySyncRoute = false;
    }
  }

  async queueSuuntoToGarminRouteDelivery(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }

    if (this.isQueueingRouteDeliverySyncBackfill) {
      return;
    }

    if (!this.isSuuntoToGarminRouteAvailableForUser) {
      this.snackBar.open('Sending Suunto routes to Garmin is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (!this.canQueueSuuntoToGarminRouteBackfill) {
      this.snackBar.open('Connect Suunto and Garmin, and allow Course Import in Garmin Connect.', undefined, { duration: 4500 });
      return;
    }

    this.isQueueingRouteDeliverySyncBackfill = true;
    try {
      const summary = await this.userService.backfillRouteDeliverySyncRouteForCurrentUser(
        ServiceNames.SuuntoApp,
        ServiceNames.GarminAPI,
      );
      this.routeDeliveryBackfillSummary = summary;
      this.analyticsService.logEvent('route_delivery_sync_backfill', {
        route_id: this.suuntoToGarminRouteID,
        scanned: summary.scanned,
        queued: summary.queued,
        failed_count: summary.failedCount,
      });
      const failureSuffix = summary.failedCount > 0 ? ` Could not schedule: ${summary.failedCount}.` : '';
      this.snackBar.open(`Route sending started for ${summary.queued} ${summary.queued === 1 ? 'route' : 'routes'}.${failureSuffix}`, undefined, { duration: 4000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingRouteDeliverySyncBackfill = false;
    }
  }

  async onSuuntoToWahooRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingRouteDeliverySyncRoute) {
      return;
    }

    if (!this.isSuuntoToWahooRouteAvailableForUser) {
      this.snackBar.open('Automatic route sending is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && !this.canEnableSuuntoToWahooRoute) {
      this.snackBar.open('Connect Suunto and Wahoo before sending routes.', undefined, { duration: 4500 });
      return;
    }

    this.isSavingRouteDeliverySyncRoute = true;
    try {
      await this.userService.updateRouteDeliverySyncRouteSettings(this.user, {
        [this.suuntoToWahooRouteID]: enabled,
      });
      this.analyticsService.logEvent('route_delivery_sync_route_toggle', {
        route_id: this.suuntoToWahooRouteID,
        enabled,
      });
      this.snackBar.open(enabled ? 'New Suunto routes will be sent to Wahoo automatically.' : 'Automatic Suunto route sending to Wahoo is off.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update automatic route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isSavingRouteDeliverySyncRoute = false;
    }
  }

  async queueSuuntoToWahooRouteDelivery(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }

    if (this.isQueueingWahooRouteDeliverySyncBackfill) {
      return;
    }

    if (!this.isSuuntoToWahooRouteAvailableForUser) {
      this.snackBar.open('Sending Suunto routes to Wahoo is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (!this.canQueueSuuntoToWahooRouteBackfill) {
      this.snackBar.open('Connect Suunto and Wahoo before sending routes.', undefined, { duration: 4500 });
      return;
    }

    this.isQueueingWahooRouteDeliverySyncBackfill = true;
    try {
      const summary = await this.userService.backfillRouteDeliverySyncRouteForCurrentUser(
        ServiceNames.SuuntoApp,
        ServiceNames.WahooAPI,
      );
      this.wahooRouteDeliveryBackfillSummary = summary;
      this.analyticsService.logEvent('route_delivery_sync_backfill', {
        route_id: this.suuntoToWahooRouteID,
        scanned: summary.scanned,
        queued: summary.queued,
        failed_count: summary.failedCount,
      });
      const failureSuffix = summary.failedCount > 0 ? ` Could not schedule: ${summary.failedCount}.` : '';
      this.snackBar.open(`Route sending started for ${summary.queued} ${summary.queued === 1 ? 'route' : 'routes'}.${failureSuffix}`, undefined, { duration: 4000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not start route sending: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingWahooRouteDeliverySyncBackfill = false;
    }
  }

  private syncDerivedState(): void {
    this.lastServiceTokensRef = this.serviceTokens;
    this.lastServiceMetaRef = this.serviceMeta;
    this.lastForceConnected = this.forceConnected;

    const connectedTokens = (this.serviceTokens || [])
      .filter(serviceToken => !!getSuuntoProviderUserIdFromTokenLike(serviceToken))
      .sort((left, right) => {
        const leftProviderUserId = getSuuntoProviderUserIdFromTokenLike(left) || '';
        const rightProviderUserId = getSuuntoProviderUserIdFromTokenLike(right) || '';
        return leftProviderUserId.localeCompare(rightProviderUserId);
      }) as Array<Auth1ServiceTokenInterface | Auth2ServiceTokenInterface>;

    this.connectedSuuntoServiceTokens = connectedTokens;
    this.connectedSuuntoAccounts = connectedTokens.map(serviceToken => ({
      serviceToken,
      trackKey: this.buildConnectedSuuntoAccountTrackKey(serviceToken),
      userName: (serviceToken as Auth2ServiceTokenInterface).userName,
    }));
    this.hasConnectedSuuntoAccount = connectedTokens.length > 0;
    this.connectionView = buildSuuntoServiceConnectionViewModel({
      hasToken: this.hasConnectedSuuntoAccount,
      forceConnected: this.forceConnected,
      serviceMeta: this.serviceMeta,
    });
    this.isServiceConnected = this.connectionView.connected;
    this.didLastRouteImport = getSuuntoRouteCatchUpDateForConnectedProviders(this.suuntoServiceMeta, connectedTokens);
    this.queuedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.queuedRoutesFromLastRouteImportCount);
    this.skippedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.skippedRoutesFromLastRouteImportCount);
    this.failedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.failedRoutesFromLastRouteImportCount);
    this.totalRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.totalRoutesFromLastRouteImportCount);
  }

  private watchGarminRouteSendState(): void {
    this.garminRouteSendSubscription?.unsubscribe();
    this.garminRouteSendSubscription = null;

    if (!this.user) {
      this.garminRouteSendContext = {
        connected: false,
        reconnectRequired: false,
        missingPermissions: [],
        providerUserId: null,
        providerStates: [],
        serviceMeta: null,
        permissionPromptSource: null,
      };
      return;
    }

    this.garminRouteSendSubscription = this.userService.watchGarminRouteSendContext(this.user).subscribe(context => {
      this.garminRouteSendContext = context;
    });
  }

  private watchWahooRouteDeliveryState(): void {
    this.wahooRouteDeliverySubscription?.unsubscribe();
    this.wahooRouteDeliverySubscription = null;

    if (!this.user) {
      this.isWahooRouteDeliveryConnected = false;
      return;
    }

    this.wahooRouteDeliverySubscription = this.userService.watchActivityServiceConnectionState(this.user).subscribe(connectionState => {
      this.isWahooRouteDeliveryConnected = connectionState[ServiceNames.WahooAPI] === true;
    });
  }

  private buildConnectedSuuntoAccountTrackKey(token: Auth1ServiceTokenInterface | Auth2ServiceTokenInterface): string {
    const providerUserId = getSuuntoProviderUserIdFromTokenLike(token) || 'unknown-user';
    const rawDateCreated = token?.dateCreated;
    const createdAt = isDateValue(rawDateCreated)
      ? rawDateCreated.getTime()
      : typeof rawDateCreated === 'number'
        ? rawDateCreated
        : typeof rawDateCreated === 'string'
          ? rawDateCreated
          : 'unknown-created';
    return `${providerUserId}:${createdAt}`;
  }
}
