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
import { LoggerService } from '../../services/logger.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { combineLatest, of, Subscription } from 'rxjs';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
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


@Directive()
export abstract class ServicesAbstractComponentDirective implements OnInit, OnDestroy, OnChanges {
  public abstract serviceName: ServiceNames;

  @Input() user: User;
  @Input() isGuest: boolean;
  @Input() hasProAccess: boolean;
  @Input() isAdmin: boolean = false;
  public isLoading = false;
  public serviceTokens: Auth2ServiceTokenInterface[] | Auth1ServiceTokenInterface[];
  public serviceMeta: UserServiceMetaInterface
  public selectedTabIndex = 0;
  public serviceNames = ServiceNames;
  public isConnecting = false;
  public isDisconnecting = false;
  public forceConnected = false;
  public isConnected = false;


  protected serviceDataSubscription: Subscription;

  protected router = inject(Router);
  protected changeDetectorRef = inject(ChangeDetectorRef);
  protected analyticsService = inject(AppAnalyticsService);
  protected logger = inject(LoggerService);

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
    if (!this.user || this.isGuest) {
      return;
    }
    this.isLoading = true;
    this.serviceDataSubscription = combineLatest([
      this.userService.getServiceToken(this.user, this.serviceName),
      this.userService
        .getUserMetaForService(this.user, this.serviceName),
    ]).pipe(tap((results) => {
      if (!results) {
        this.serviceTokens = null;
        this.serviceMeta = null;
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
      if (!shouldConnect || this.isConnecting) {
        this.isLoading = false;
        if (this.route.snapshot.queryParamMap.get('connect')) {
          this.logger.log(`[ServicesAbstractComponent] connect param found for ${this.serviceName}, showing success`);
          this.analyticsService.logEvent('service_connected', { service_name: this.serviceName });
          // If we just connected, triggering sync automatically might be nice
          // But usually we just show connected state.
          this.snackBar.open(`Successfully connected to ${this.serviceName}`, null, {
            duration: 10000,
          });
        }
        return;
      }
      this.isConnecting = true;
      try {
        await this.requestAndSetToken(this.route.snapshot.queryParamMap)
        this.analyticsService.logEvent('connected_to_service', { serviceName: this.serviceName });
        this.forceConnected = true;
        this.snackBar.open(`Successfully connected to ${this.serviceName}`, null, {
          duration: 10000,
        });
      } catch (e) {
        this.logger.error(e);
        this.snackBar.open(`Could not connect due to ${e.message}`, null, {
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
    } catch (e) {
      this.isConnecting = false;
      this.logger.error(e);
      this.snackBar.open(`Could not connect to ${this.serviceName} due to ${e.message}`, null, {
        duration: 5000,
      });
    }
  }

  async deauthorizeService(event) {
    if (!this.hasProAccess) {
      this.triggerUpsell();
      return;
    }
    this.isDisconnecting = true;
    try {
      await this.userService.deauthorizeService(this.serviceName);
      this.snackBar.open(`Disconnected successfully`, null, {
        duration: 2000,
      });
      this.analyticsService.logEvent('disconnected_from_service', { serviceName: this.serviceName });
    } catch (e) {
      this.logger.error(e);
      this.snackBar.open(`Could not disconnect due to ${e.message}`, null, {
        duration: 2000,
      });
    }
    this.isDisconnecting = false;
    this.forceConnected = false;
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

  ngOnDestroy(): void {
    if (this.serviceDataSubscription) {
      this.serviceDataSubscription.unsubscribe();
    }
  }

  abstract isConnectedToService(): boolean;

  abstract buildRedirectURIFromServiceToken(redirectUri: { redirect_uri: string } | { redirect_uri: string, state: string, oauthToken: string }): string

  abstract requestAndSetToken(params: ParamMap)
}
