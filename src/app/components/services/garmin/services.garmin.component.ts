import { Component } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { ActivitySyncBackfillSummary } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { AppDeepLinkService } from '../../../services/app.deeplink.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { GARMIN_REQUIRED_PERMISSIONS } from '../../../../../functions/src/garmin/constants';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import { Subscription } from 'rxjs';


@Component({
  selector: 'app-services-garmin',
  templateUrl: './services.garmin.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.garmin.component.css'],
  standalone: false
})
export class ServicesGarminComponent extends ServicesAbstractComponentDirective {

  public serviceName: ServiceNames = ServiceNames.GarminAPI;

  public readonly permissionLabels: { [key: string]: string } = {
    'HISTORICAL_DATA_EXPORT': 'History Importer',
    'ACTIVITY_EXPORT': 'Activity Sync',
    'WORKOUT_IMPORT': 'Workout Import',
    'HEALTH_EXPORT': 'Health Export',
    'COURSE_IMPORT': 'Course Import',
    'MCT_EXPORT': 'Menstrual Cycle Tracking Export'
  };

  public readonly permissionExplanations: { [key: string]: string } = {
    'HISTORICAL_DATA_EXPORT': 'Without this, you cannot import your past activities from Garmin Connect.',
    'ACTIVITY_EXPORT': 'Without this, your new activities will not automatically sync to Quantified Self.',
    'WORKOUT_IMPORT': 'Coming soon: This will be used to sync training plans to your device.',
    'HEALTH_EXPORT': 'Coming soon: This will be used for daily health statistics.',
    'COURSE_IMPORT': 'Coming soon: This will be used for route synchronization.',
    'MCT_EXPORT': 'Coming soon: This will be used for health tracking data.'
  };

  public readonly garminToSuuntoRouteID = ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp;
  public isSavingSyncRoute = false;
  public isBackfillingSync = false;
  public backfillStartDate: Date = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  public backfillEndDate: Date = new Date();
  public backfillSummary: ActivitySyncBackfillSummary | null = null;

  private suuntoTokensSubscription: Subscription | null = null;
  private suuntoTokens: Auth2ServiceTokenInterface[] | undefined;

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected deepLinkService: AppDeepLinkService,
    protected snackBar: MatSnackBar) {
    super(http, fileService, eventService, authService, userService, route, windowService, snackBar);
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserGarminAPIAccessToken(state, code);
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

  get hasPermissionsLoaded(): boolean {
    const token = (this.serviceTokens as any[])?.[0];
    return !!token && Array.isArray(token.permissions);
  }

  getPermissionLabel(permission: string): string {
    return this.permissionLabels[permission] || permission;
  }

  getPermissionExplanation(permission: string): string {
    return this.permissionExplanations[permission] || '';
  }

  /**
   * Attempts to open Garmin Connect mobile app, falls back to web
   */
  openGarminConnectApp(): void {
    this.deepLinkService.openGarminConnectApp();
  }

  override async ngOnChanges() {
    await super.ngOnChanges();
    this.watchSuuntoConnectionState();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.suuntoTokensSubscription?.unsubscribe();
    this.suuntoTokensSubscription = null;
  }

  private watchSuuntoConnectionState(): void {
    this.suuntoTokensSubscription?.unsubscribe();
    this.suuntoTokensSubscription = null;

    if (!this.user) {
      this.suuntoTokens = undefined;
      return;
    }

    this.suuntoTokensSubscription = this.userService.getServiceToken(this.user, ServiceNames.SuuntoApp).subscribe((tokens) => {
      this.suuntoTokens = tokens as Auth2ServiceTokenInterface[];
    });
  }

  get isSuuntoConnected(): boolean {
    return !!this.suuntoTokens?.length && !!this.suuntoTokens?.[0]?.accessToken;
  }

  get isGarminToSuuntoRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.activitySyncRoutes?.[this.garminToSuuntoRouteID]?.enabled === true;
  }

  get isGarminToSuuntoRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isActivitySyncRouteUIDAllowlisted(this.garminToSuuntoRouteID, userID);
  }

  get isBackfillDateRangeInvalid(): boolean {
    return this.backfillStartDate > this.backfillEndDate;
  }

  async onGarminToSuuntoRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingSyncRoute) {
      return;
    }

    if (!this.isGarminToSuuntoRouteAvailableForUser) {
      this.snackBar.open('This activity sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && (!this.isConnectedToService() || !this.isSuuntoConnected)) {
      this.snackBar.open('Connect both Garmin and Suunto accounts before enabling sync.', undefined, { duration: 4000 });
      return;
    }

    this.isSavingSyncRoute = true;
    try {
      await this.userService.updateUserProperties(this.user as any, {
        settings: {
          serviceSyncSettings: {
            activitySyncRoutes: {
              [this.garminToSuuntoRouteID]: {
                enabled,
              },
            },
          },
        },
      });

      const settings: any = this.user.settings || {};
      settings.serviceSyncSettings = settings.serviceSyncSettings || {};
      settings.serviceSyncSettings.activitySyncRoutes = settings.serviceSyncSettings.activitySyncRoutes || {};
      settings.serviceSyncSettings.activitySyncRoutes[this.garminToSuuntoRouteID] = { enabled };
      this.user.settings = settings;

      this.analyticsService.logActivitySyncRouteToggle(this.garminToSuuntoRouteID, enabled);
      this.snackBar.open(enabled ? 'Garmin to Suunto auto-sync enabled.' : 'Garmin to Suunto auto-sync disabled.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open(`Could not update sync setting: ${error?.message || 'Unknown error'}`, undefined, { duration: 5000 });
    } finally {
      this.isSavingSyncRoute = false;
    }
  }

  async runGarminToSuuntoBackfill(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.user || this.isBackfillingSync) {
      return;
    }

    if (!this.isGarminToSuuntoRouteAvailableForUser) {
      this.snackBar.open('This activity sync route is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (this.isBackfillDateRangeInvalid) {
      this.snackBar.open('Backfill start date must be before end date.', undefined, { duration: 3500 });
      return;
    }

    this.isBackfillingSync = true;
    try {
      const summary = await this.userService.backfillActivitySyncRouteForCurrentUser(
        ServiceNames.GarminAPI,
        ServiceNames.SuuntoApp,
        this.backfillStartDate,
        this.backfillEndDate,
      );

      this.backfillSummary = summary;
      this.analyticsService.logActivitySyncRouteBackfill(this.garminToSuuntoRouteID, {
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
