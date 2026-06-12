import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServiceNames, Auth2ServiceTokenInterface, Auth1ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { AppUserServiceMetaInterface } from '../../../models/app-user.interface';
import { buildSuuntoServiceConnectionViewModel } from '../../../helpers/suunto-service-connection.helper';
import {
  buildSuuntoRouteCatchUpSnackbarMessage,
  getSuuntoRouteCatchUpCount,
  getSuuntoRouteCatchUpDateForConnectedProviders,
} from '../../../helpers/suunto-route-catch-up.helper';


@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.suunto.component.css'],
  standalone: false
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective {
  public serviceName = ServiceNames.SuuntoApp;
  clicks = 0;
  isQueueingRoutes = false;

  get suuntoServiceMeta(): (AppUserServiceMetaInterface & {
    uploadedActivitiesCount?: number;
    uploadedRoutesCount?: number;
  }) | undefined {
    return this.serviceMeta;
  }

  get didLastRouteImport(): Date | null {
    return getSuuntoRouteCatchUpDateForConnectedProviders(this.suuntoServiceMeta, this.serviceTokens);
  }

  get queuedRoutesFromLastRouteImportCount(): number {
    return getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.queuedRoutesFromLastRouteImportCount);
  }

  get skippedRoutesFromLastRouteImportCount(): number {
    return getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.skippedRoutesFromLastRouteImportCount);
  }

  get failedRoutesFromLastRouteImportCount(): number {
    return getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.failedRoutesFromLastRouteImportCount);
  }

  get totalRoutesFromLastRouteImportCount(): number {
    return getSuuntoRouteCatchUpCount(this.suuntoServiceMeta?.totalRoutesFromLastRouteImportCount);
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

  get connectionView() {
    return buildSuuntoServiceConnectionViewModel({
      hasToken: (!!this.serviceTokens && !!this.serviceTokens.length),
      forceConnected: this.forceConnected,
      serviceMeta: this.serviceMeta,
    });
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
    return (!!this.serviceTokens && !!this.serviceTokens.length) || this.forceConnected;
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

  get suuntoUserName(): string | undefined {
    return (this.serviceTokens as Auth2ServiceTokenInterface[])?.[0]?.userName;
  }

  getSuuntoUserName(token: Auth1ServiceTokenInterface | Auth2ServiceTokenInterface): string | undefined {
    return (token as Auth2ServiceTokenInterface).userName;
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
}
