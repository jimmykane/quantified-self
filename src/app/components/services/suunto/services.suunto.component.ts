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
  clicks = 0;
  isQueueingRoutes = false;
  isSavingRouteDeliverySyncRoute = false;
  isQueueingRouteDeliverySyncBackfill = false;
  routeDeliveryBackfillSummary: RouteDeliverySyncBackfillSummary | null = null;
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

  override async ngOnChanges() {
    await super.ngOnChanges();
    this.syncDerivedState();
    this.watchGarminRouteSendState();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.garminRouteSendSubscription?.unsubscribe();
    this.garminRouteSendSubscription = null;
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

  get suuntoToGarminRouteStatusTitle(): string {
    if (!this.garminRouteSendContext.connected) {
      return 'Connect Garmin for course delivery';
    }
    if (this.garminRouteSendContext.reconnectRequired) {
      return 'Reconnect Garmin for course delivery';
    }
    if (this.garminRouteSendContext.missingPermissions.length > 0) {
      return 'Garmin Course Import permission needed';
    }
    return 'Garmin course delivery ready';
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
      return 'Connect Garmin before enabling automatic Suunto route delivery to Garmin courses.';
    }
    if (this.garminRouteSendContext.reconnectRequired) {
      return 'Reconnect Garmin before enabling automatic Suunto route delivery to Garmin courses.';
    }
    if (this.garminRouteSendContext.missingPermissions.length > 0) {
      return 'Grant Garmin COURSE_IMPORT permission in Garmin Connect, then reconnect Garmin before enabling automatic route delivery.';
    }
    return garminAccount
      ? `Suunto routes saved in Quantified Self can be delivered to Garmin courses using Garmin account ${garminAccount}.`
      : 'Suunto routes saved in Quantified Self can be delivered to Garmin courses.';
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
      this.snackBar.open('Reconnect Suunto before queuing route catch-up.', undefined, { duration: 4000 });
      return;
    }

    if (!this.isConnectedToService()) {
      this.snackBar.open('Connect your Suunto account before queuing routes.', undefined, { duration: 4000 });
      return;
    }

    this.isQueueingRoutes = true;
    try {
      const summary = await this.userService.addSuuntoRoutesToQueueForCurrentUser();
      const feedback = buildSuuntoRouteCatchUpSnackbarMessage(summary);
      this.snackBar.open(feedback.message, undefined, { duration: feedback.duration });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not queue Suunto routes: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingRoutes = false;
    }
  }

  async onSuuntoToGarminRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingRouteDeliverySyncRoute) {
      return;
    }

    if (!this.isSuuntoToGarminRouteAvailableForUser) {
      this.snackBar.open('This route delivery sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && !this.canEnableSuuntoToGarminRoute) {
      this.snackBar.open('Connect Suunto and Garmin with Garmin Course Import permission before enabling route delivery.', undefined, { duration: 4500 });
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
      this.snackBar.open(enabled ? 'Suunto to Garmin route delivery enabled.' : 'Suunto to Garmin route delivery disabled.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update route delivery setting: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
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
      this.snackBar.open('This route delivery sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (!this.canQueueSuuntoToGarminRouteBackfill) {
      this.snackBar.open('Connect Suunto and Garmin with Garmin Course Import permission before queueing route delivery.', undefined, { duration: 4500 });
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
      const failureSuffix = summary.failedCount > 0 ? ` Failed: ${summary.failedCount}.` : '';
      this.snackBar.open(`Queued ${summary.queued} route delivery job(s).${failureSuffix}`, undefined, { duration: 4000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not queue route delivery: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingRouteDeliverySyncBackfill = false;
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
