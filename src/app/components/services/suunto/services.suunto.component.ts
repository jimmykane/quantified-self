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
    didLastRouteImport?: unknown;
    queuedRoutesFromLastRouteImportCount?: number;
    skippedRoutesFromLastRouteImportCount?: number;
    failedRoutesFromLastRouteImportCount?: number;
    totalRoutesFromLastRouteImportCount?: number;
  }) | undefined {
    return this.serviceMeta;
  }

  get didLastRouteImport(): Date | null {
    const rawValue = this.suuntoServiceMeta?.didLastRouteImport;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return new Date(rawValue);
    }
    if (rawValue instanceof Date) {
      return rawValue;
    }
    if (typeof (rawValue as { toDate?: unknown } | null)?.toDate === 'function') {
      return (rawValue as { toDate: () => Date }).toDate();
    }
    return null;
  }

  get queuedRoutesFromLastRouteImportCount(): number {
    const value = this.suuntoServiceMeta?.queuedRoutesFromLastRouteImportCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  get skippedRoutesFromLastRouteImportCount(): number {
    const value = this.suuntoServiceMeta?.skippedRoutesFromLastRouteImportCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  get failedRoutesFromLastRouteImportCount(): number {
    const value = this.suuntoServiceMeta?.failedRoutesFromLastRouteImportCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  get totalRoutesFromLastRouteImportCount(): number {
    const value = this.suuntoServiceMeta?.totalRoutesFromLastRouteImportCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
      if (summary.totalCount === 0) {
        this.snackBar.open('No Suunto routes were found to queue.', undefined, { duration: 3500 });
        return;
      }

      const messageParts = [`Queued ${summary.queuedCount} ${summary.queuedCount === 1 ? 'route' : 'routes'}.`];
      if (summary.skippedCount > 0) {
        messageParts.push(`Skipped ${summary.skippedCount}.`);
      }
      if (summary.failureCount > 0) {
        messageParts.push(`Failed ${summary.failureCount}.`);
      }
      this.snackBar.open(messageParts.join(' '), undefined, { duration: summary.failureCount > 0 ? 4500 : 3500 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not queue Suunto routes: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isQueueingRoutes = false;
    }
  }
}
