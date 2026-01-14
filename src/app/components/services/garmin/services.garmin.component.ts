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
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { GARMIN_REQUIRED_PERMISSIONS } from '../../../../../functions/src/garmin/constants';


@Component({
  selector: 'app-services-garmin',
  templateUrl: './services.garmin.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.garmin.component.css'],
  standalone: false
})
export class ServicesGarminComponent extends ServicesAbstractComponentDirective {

  public serviceName: ServiceNames = ServiceNames.GarminAPI;

  public readonly permissionLabels: { [key: string]: string } = {
    'HISTORICAL_DATA_EXPORT': 'Historical Data Export',
    'ACTIVITY_EXPORT': 'Activity Export',
    'WORKOUT_IMPORT': 'Workout Import',
    'HEALTH_EXPORT': 'Health Export',
    'COURSE_IMPORT': 'Course Import',
    'MCT_EXPORT': 'Menstrual Cycle Tracking Export'
  };

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
      await this.userService.requestAndSetCurrentUserGarminAccessToken(state, code);
    }
  }

  isConnectedToService(): boolean {
    return (!!this.serviceTokens?.length && !!this.serviceTokens[0]?.accessToken) || this.forceConnected;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri;
  }

  get garminUserID(): string | undefined {
    return (this.serviceTokens as any[])?.[0]?.userID;
  }

  get permissionsLastChangedAt(): number | undefined {
    return (this.serviceTokens as any[])?.[0]?.permissionsLastChangedAt;
  }

  get missingPermissions(): string[] {
    const token = (this.serviceTokens as any[])?.[0];
    if (!token || !token.permissions) {
      return [];
    }
    const requiredPermissions = GARMIN_REQUIRED_PERMISSIONS;
    return requiredPermissions.filter(p => !token.permissions.includes(p));
  }

  getPermissionLabel(permission: string): string {
    return this.permissionLabels[permission] || permission;
  }
}
