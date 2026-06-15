import { Component, DoCheck } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
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

function isDateValue(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.suunto.component.css'],
  standalone: false
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective implements DoCheck {
  public serviceName = ServiceNames.SuuntoApp;
  clicks = 0;
  isQueueingRoutes = false;
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
  private lastServiceTokensRef: Auth2ServiceTokenInterface[] | Auth1ServiceTokenInterface[] | undefined;
  private lastServiceMetaRef: AppUserServiceMetaInterface | undefined;
  private lastForceConnected = false;

  override async ngOnChanges() {
    await super.ngOnChanges();
    this.syncDerivedState();
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

  get connectionDescription(): string {
    return this.connectionView.description;
  }

  get reconnectFailureMessage(): string | null {
    return this.connectionView.failureMessage;
  }

  get connectButtonLabel(): string {
    return this.connectionView.connectButtonLabel;
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
    this.isServiceConnected = this.hasConnectedSuuntoAccount || this.forceConnected;
    this.connectionView = buildSuuntoServiceConnectionViewModel({
      hasToken: this.hasConnectedSuuntoAccount,
      forceConnected: this.forceConnected,
      serviceMeta: this.serviceMeta,
    });
    this.didLastRouteImport = getSuuntoRouteCatchUpDateForConnectedProviders(this.suuntoServiceMeta, connectedTokens);
    this.queuedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.queuedRoutesFromLastRouteImportCount);
    this.skippedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.skippedRoutesFromLastRouteImportCount);
    this.failedRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.failedRoutesFromLastRouteImportCount);
    this.totalRoutesFromLastRouteImportCount = getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.totalRoutesFromLastRouteImportCount);
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
