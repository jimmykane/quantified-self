import { Component } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, ActivatedRoute } from '@angular/router';
import { Analytics } from '@angular/fire/analytics';
import { LoggerService } from '../../../services/logger.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';


@Component({
  selector: 'app-services-garmin',
  templateUrl: './services.garmin.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.garmin.component.css'],
  standalone: false
})
export class ServicesGarminComponent extends ServicesAbstractComponentDirective {

  public serviceName = ServiceNames.GarminHealthAPI;

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected analytics: Analytics,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected router: Router,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar,
    protected logger: LoggerService) {
    super(http, fileService, analytics, eventService, authService, userService, router, route, windowService, snackBar, logger);
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const oauthToken = this.route.snapshot.queryParamMap.get('oauth_token');
    const oauthVerifier = this.route.snapshot.queryParamMap.get('oauth_verifier');
    if (state && oauthToken && oauthVerifier) {
      await this.userService.requestAndSetCurrentUserGarminAccessToken(state, oauthVerifier);
    }
  }

  isConnectedToService(): boolean {
    return !!this.serviceTokens && !!this.serviceTokens.length && !!this.serviceTokens[0] && !!this.serviceTokens[0].accessToken
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string, state: string, oauthToken: string }): string {
    return `${token.redirect_uri}?oauth_token=${token.oauthToken}&oauth_callback=${encodeURIComponent(`${this.windowService.currentDomain}/services?state=${token.state}&serviceName=${this.serviceName}&connect=1`)}`
  }
}
