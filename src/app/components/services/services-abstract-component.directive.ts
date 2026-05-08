import {
  ChangeDetectorRef,
  Component,
  Directive,
  HostListener,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewEncapsulation
} from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { LoggerService } from '../../services/logger.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { combineLatest, firstValueFrom, of, Subscription } from 'rxjs';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { switchMap, take, tap } from 'rxjs/operators';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { Auth1ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AppFileService } from '../../services/app.file.service';
import { AppWindowService } from '../../services/app.window.service';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRoute } from '@shared/activity-sync-routes';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';


@Directive()
export abstract class ServicesAbstractComponentDirective implements OnInit, OnDestroy, OnChanges {
  public abstract serviceName: ServiceNames;

  @Input() user!: AppUserInterface;

  @Input() hasProAccess!: boolean;
  @Input() isAdmin: boolean = false;
  public isLoading = false;
  public serviceTokens: Auth2ServiceTokenInterface[] | Auth1ServiceTokenInterface[] | undefined;
  public serviceMeta: UserServiceMetaInterface | undefined;
  public selectedTabIndex = 0;
  public activeProviderTool = 'history';
  public serviceNames = ServiceNames;
  public isConnecting = false;
  public isDisconnecting = false;
  public forceConnected = false;
  public isConnected = false;


  protected serviceDataSubscription!: Subscription;

  protected router = inject(Router);
  protected changeDetectorRef = inject(ChangeDetectorRef);
  protected analyticsService = inject(AppAnalyticsService);
  protected logger = inject(LoggerService);
  protected dialog = inject(MatDialog, { optional: true });

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar) {
  }

  async ngOnChanges() {
    this.isLoading = false;

    // Only user can change
    if (this.serviceDataSubscription) {
      this.serviceDataSubscription.unsubscribe()
    }
    // Noop if no user
    if (!this.user) {
      return;
    }
    this.isLoading = true;
    this.serviceDataSubscription = combineLatest([
      this.userService.getServiceToken(this.user, this.serviceName),
      this.userService
        .getUserMetaForService(this.user, this.serviceName),
    ]).pipe(tap((results) => {
      if (!results) {
        this.serviceTokens = undefined;
        this.serviceMeta = undefined;
        return;
      }
      this.serviceTokens = results[0];
      this.serviceMeta = results[1];
    })).subscribe(async (results) => {
      const serviceName = this.route.snapshot.queryParamMap.get('serviceName');
      const shouldConnect = this.route.snapshot.queryParamMap.get('connect');
      if (!serviceName || serviceName !== this.serviceName) {
        this.isLoading = false;
        return;
      }
      if (!shouldConnect) {
        this.isLoading = false;
        return;
      }
      if (this.isConnecting) {
        return;
      }
      this.isConnecting = true;
      try {
        await this.requestAndSetToken(this.route.snapshot.queryParamMap)
        this.analyticsService.logEvent('connected_to_service', { serviceName: this.serviceName });
        this.forceConnected = true;
        this.snackBar.open(`Successfully connected to ${this.serviceName}`, undefined, {
          duration: 10000,
        });
      } catch (e: any) {
        this.logger.error(e);
        const status = e?.status;
        let message: string;

        if (status === 502) {
          const partnerName = this.getPartnerDisplayName();
          message = `${partnerName} is temporarily unavailable. Please try again later.`;
        } else if (status === 403 && e?.error?.includes?.('Pro')) {
          message = 'This feature requires a Pro subscription.';
        } else {
          message = `Could not connect due to ${e.message || 'Unknown error'}`;
        }

        this.snackBar.open(message, undefined, {
          duration: 10000,
        });
      } finally {
        this.isLoading = false;
        this.isConnecting = false;
        await this.router.navigate(['services'], { queryParams: { serviceName: serviceName }, queryParamsHandling: '' });
      }
    });
  }

  async ngOnInit() {
  }

  selectProviderTool(tool: string): void {
    this.activeProviderTool = tool;
  }

  async connectWithService(event) {
    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }
    this.isConnecting = true;
    try {
      this.analyticsService.logEvent('service_connect_start', { service_name: this.serviceName });
      const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(this.serviceName);
      // Get the redirect url for the unsigned token created with the post
      this.windowService.windowRef.location.href = this.buildRedirectURIFromServiceToken(tokenAndURI);
    } catch (e: any) {
      this.isConnecting = false;
      this.logger.error(e);
      const status = e?.status;
      let message: string;

      if (status === 502) {
        const partnerName = this.getPartnerDisplayName();
        message = `${partnerName} is temporarily unavailable. Please try again later.`;
      } else {
        message = `Could not connect to ${this.getPartnerDisplayName()} due to ${e.message || 'Unknown error'}`;
      }

      this.snackBar.open(message, undefined, {
        duration: 5000,
      });
    }
  }

  async deauthorizeService(event) {
    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }
    const shouldContinue = await this.confirmDisconnectWithRouteImpact();
    if (!shouldContinue) {
      return;
    }
    this.isDisconnecting = true;
    try {
      await this.userService.deauthorizeService(this.serviceName);
      this.snackBar.open(`Disconnected successfully`, undefined, {
        duration: 2000,
      });
      this.analyticsService.logEvent('disconnected_from_service', { serviceName: this.serviceName });
    } catch (e: any) {
      this.logger.error(e);
      const status = e?.status;
      let message: string;

      if (status === 502) {
        const partnerName = this.getPartnerDisplayName();
        message = `${partnerName} is temporarily unavailable. Please try again later.`;
      } else {
        message = `Could not disconnect due to ${e.message || 'Unknown error'}`;
      }

      this.snackBar.open(message, undefined, {
        duration: 2000,
      });
    }
    this.isDisconnecting = false;
    this.forceConnected = false;
  }

  get hasActiveSyncRoutesUsingService(): boolean {
    return this.activeSyncRoutesUsingService.length > 0;
  }

  get activeSyncRouteWarningLabel(): string {
    const activeRouteCount = this.activeSyncRoutesUsingService.length;
    return activeRouteCount === 1
      ? 'Used by active auto-sync route'
      : `Used by ${activeRouteCount} active auto-sync routes`;
  }

  triggerUpsell() {
    this.analyticsService.logEvent('upsell_triggered', { serviceName: this.serviceName, source: 'locked_card' });
    const snackBarRef = this.snackBar.open('This feature is available for Pro users.', 'UPGRADE', {
      duration: 5000,
    });
    snackBarRef.onAction().subscribe(() => {
      this.router.navigate(['/settings']);
    });
  }

  protected getPartnerDisplayName(): string {
    return this.getServiceDisplayName(this.serviceName);
  }

  private getServiceDisplayName(serviceName: ServiceNames): string {
    switch (serviceName) {
      case ServiceNames.GarminAPI:
        return 'Garmin';
      case ServiceNames.SuuntoApp:
        return 'Suunto';
      case ServiceNames.COROSAPI:
        return 'COROS';
      default:
        return 'Partner service';
    }
  }

  private get activeSyncRoutesUsingService(): ActivitySyncRoute[] {
    const routeSettings = this.user?.settings?.serviceSyncSettings?.activitySyncRoutes;
    if (!routeSettings) {
      return [];
    }

    return Object.values(ACTIVITY_SYNC_ROUTES).filter((route) => {
      const routeUsesCurrentService = (
        route.sourceServiceName === this.serviceName ||
        route.destinationServiceName === this.serviceName
      );
      return routeUsesCurrentService && routeSettings[route.id]?.enabled === true;
    });
  }

  private formatRouteLabel(route: ActivitySyncRoute): string {
    return `${this.getServiceDisplayName(route.sourceServiceName)} -> ${this.getServiceDisplayName(route.destinationServiceName)}`;
  }

  private buildDisconnectImpactMessageHtml(routes: ActivitySyncRoute[]): string {
    const isSingleRoute = routes.length === 1;
    const heading = isSingleRoute
      ? 'Disconnecting now will disable this active auto-sync route:'
      : `Disconnecting now will disable ${routes.length} active auto-sync routes:`;
    const routeListHtml = routes.map((route) => `<li><strong>${this.formatRouteLabel(route)}</strong></li>`).join('');
    return `${heading}<ul>${routeListHtml}</ul>Automatic sync will stop until you reconnect and re-enable the route${isSingleRoute ? '' : 's'}.`;
  }

  private async confirmDisconnectWithRouteImpact(): Promise<boolean> {
    const impactedRoutes = this.activeSyncRoutesUsingService;
    if (impactedRoutes.length === 0 || !this.dialog) {
      return true;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: `Disconnect ${this.getPartnerDisplayName()}?`,
        message: this.buildDisconnectImpactMessageHtml(impactedRoutes),
        confirmLabel: 'Disconnect and disable sync',
        cancelLabel: 'Keep connected',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    return confirmed === true;
  }

  ngOnDestroy(): void {
    if (this.serviceDataSubscription) {
      this.serviceDataSubscription.unsubscribe();
    }
  }

  abstract isConnectedToService(): boolean;

  abstract buildRedirectURIFromServiceToken(redirectUri: { redirect_uri: string } | { redirect_uri: string, state: string, oauthToken: string }): string

  abstract requestAndSetToken(params: ParamMap)

  onHistoryImportInitiated(stats?: any) {
    this.serviceMeta = {
      ...this.serviceMeta,
      didLastHistoryImport: new Date().getTime(),
      processedActivitiesFromLastHistoryImportCount: stats?.stats?.successCount || 0
    };
    this.changeDetectorRef.detectChanges();
  }
}
