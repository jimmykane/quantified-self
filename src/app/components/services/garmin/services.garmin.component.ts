import { Component } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { ActivitySyncBackfillSummary } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { AppDeepLinkService } from '../../../services/app.deeplink.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { GARMIN_REQUIRED_PERMISSIONS } from '../../../../../functions/src/garmin/constants';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import { Subscription } from 'rxjs';
import {
  buildSuuntoServiceConnectionViewModel,
  SuuntoServiceConnectionViewModel,
} from '../../../helpers/suunto-service-connection.helper';
import { GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS } from '@shared/sleep-backfill';

const GARMIN_ACTIVITY_HISTORY_REQUIRED_PERMISSIONS = ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'] as const;

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
    'HEALTH_EXPORT': 'Required for Garmin sleep sync and sleep history backfill.',
    'COURSE_IMPORT': 'Coming soon: This will be used for route synchronization.',
    'MCT_EXPORT': 'Coming soon: This will be used for health tracking data.'
  };

  public readonly garminToSuuntoRouteID = ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp;
  public isSavingSyncRoute = false;
  public isBackfillingSync = false;
  public backfillStartDate: Date = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  public backfillEndDate: Date = new Date();
  public backfillSummary: ActivitySyncBackfillSummary | null = null;

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
    return this.garminTokens.some(token => `${token.accessToken || ''}`.trim().length > 0) || this.forceConnected;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri;
  }

  get garminUserID(): string | undefined {
    const token = this.preferredGarminToken;
    const userID = `${token?.userID || ''}`.trim();
    return userID || undefined;
  }

  get connectedAt(): string | number | Date | null {
    const value = this.preferredGarminToken?.dateCreated;
    return typeof value === 'string' || typeof value === 'number' || value instanceof Date ? value : null;
  }

  get permissionsLastChangedAt(): number | undefined {
    const timestamps = this.permissionLoadedTokens
      .map(token => Number(token.permissionsLastChangedAt))
      .filter(timestamp => Number.isFinite(timestamp));
    return timestamps.length ? Math.max(...timestamps) : undefined;
  }

  get missingPermissions(): string[] {
    const tokens = this.permissionLoadedTokens;
    if (!tokens.length) {
      return [];
    }
    const missingPermissions = new Set<string>();
    if (!this.hasTokenWithPermissions(GARMIN_ACTIVITY_HISTORY_REQUIRED_PERMISSIONS)) {
      this.bestMissingPermissionsFor(GARMIN_ACTIVITY_HISTORY_REQUIRED_PERMISSIONS)
        .forEach(permission => missingPermissions.add(permission));
    }
    if (!this.hasTokenWithPermissions(GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS)) {
      this.bestMissingPermissionsFor(GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS)
        .forEach(permission => missingPermissions.add(permission));
    }
    return GARMIN_REQUIRED_PERMISSIONS.filter(permission => missingPermissions.has(permission));
  }

  get hasPermissionsLoaded(): boolean {
    return this.permissionLoadedTokens.length > 0;
  }

  get isHistoryImportLoading(): boolean {
    return this.isLoading || !this.hasPermissionsLoaded;
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
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;
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

  get isGarminToSuuntoRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.activitySyncRoutes?.[this.garminToSuuntoRouteID]?.enabled === true;
  }

  get isGarminToSuuntoRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isActivitySyncRouteUIDAllowlisted(this.garminToSuuntoRouteID, userID);
  }

  private get garminTokens(): Array<Record<string, unknown>> {
    return Array.isArray(this.serviceTokens)
      ? this.serviceTokens as unknown as Array<Record<string, unknown>>
      : [];
  }

  private get permissionLoadedTokens(): Array<Record<string, unknown> & { permissions: unknown[] }> {
    return this.garminTokens
      .filter((token): token is Record<string, unknown> & { permissions: unknown[] } => Array.isArray(token.permissions));
  }

  private get preferredGarminToken(): Record<string, unknown> | null {
    return this.bestPermissionLoadedToken
      || this.garminTokens.find(token => `${token.userID || ''}`.trim().length > 0)
      || this.garminTokens.find(token => `${token.accessToken || ''}`.trim().length > 0)
      || null;
  }

  private get bestPermissionLoadedToken(): Record<string, unknown> | null {
    return [...this.permissionLoadedTokens]
      .sort((left, right) => this.missingPermissionsForToken(left, GARMIN_REQUIRED_PERMISSIONS).length - this.missingPermissionsForToken(right, GARMIN_REQUIRED_PERMISSIONS).length)[0]
      || null;
  }

  private hasTokenWithPermissions(requiredPermissions: readonly string[]): boolean {
    return this.permissionLoadedTokens
      .some(token => this.missingPermissionsForToken(token, requiredPermissions).length === 0);
  }

  private bestMissingPermissionsFor(requiredPermissions: readonly string[]): string[] {
    return this.permissionLoadedTokens
      .map(token => this.missingPermissionsForToken(token, requiredPermissions))
      .sort((left, right) => left.length - right.length)[0] || [...requiredPermissions];
  }

  private missingPermissionsForToken(token: { permissions: unknown[] }, requiredPermissions: readonly string[]): string[] {
    const permissionSet = new Set(token.permissions.map(permission => `${permission}`));
    return requiredPermissions.filter(permission => !permissionSet.has(permission));
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

    if (enabled && this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before enabling sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && (!this.isConnectedToService() || !this.isSuuntoConnected)) {
      this.snackBar.open('Connect both Garmin and Suunto accounts before enabling sync.', undefined, { duration: 4000 });
      return;
    }

    this.isSavingSyncRoute = true;
    try {
      await this.userService.updateActivitySyncRouteSettings(this.user, {
        [this.garminToSuuntoRouteID]: enabled,
      });

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

    if (this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before running Garmin to Suunto catch-up.', undefined, { duration: 4000 });
      return;
    }

    if (!this.isConnectedToService() || !this.isSuuntoConnected) {
      this.snackBar.open('Connect both Garmin and Suunto accounts before running catch-up.', undefined, { duration: 4000 });
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
