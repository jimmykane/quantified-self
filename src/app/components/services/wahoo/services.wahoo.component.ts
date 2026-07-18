import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SERVICE_CONNECTION_STATES, isDisconnectPendingServiceConnection } from '@shared/service-connection';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';

@Component({
  selector: 'app-services-wahoo',
  templateUrl: './services.wahoo.component.html',
  styleUrls: ['../services-abstract-component.directive.scss'],
  standalone: false,
})
export class ServicesWahooComponent extends ServicesAbstractComponentDirective {
  public serviceName = ServiceNames.WahooAPI;

  constructor(
    protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar,
  ) {
    super(http, fileService, eventService, authService, userService, route, windowService, snackBar);
  }

  isConnectedToService(): boolean {
    return !this.isDisconnectPending
      && (this.forceConnected || this.serviceMeta?.connectionState === SERVICE_CONNECTION_STATES.Connected);
  }

  get isDisconnectPending(): boolean {
    return isDisconnectPendingServiceConnection(this.serviceMeta);
  }

  get connectionDescription(): string {
    return this.isDisconnectPending
      ? 'Disconnect is pending while Wahoo finishes deauthorization. Imports are paused.'
      : 'Imports Wahoo-recorded activities and FIT-backed workout history.';
  }

  protected override get canDisconnectWithoutProAccess(): boolean {
    return true;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri;
  }

  async requestAndSetToken(): Promise<void> {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserWahooAPIAccessToken(state, code);
    }
  }
}
