import { Injectable, Signal, signal } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Observable, of } from 'rxjs';
import { AppAuthService } from './authentication/app.auth.service';
import { AppThemePreference, SYSTEM_THEME_PREFERENCE } from './models/app-theme-preference.type';
import { AppUserInterface } from './models/app-user.interface';
import { AppAnalyticsService } from './services/app.analytics.service';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { AppThemeService } from './services/app.theme.service';
import { AppUserService } from './services/app.user.service';
import { AppWhatsNewService, type ChangelogPost } from './services/app.whats-new.service';
import { AppPaymentService, type StripeProduct, type StripeSubscription } from './services/app.payment.service';

@Injectable()
class ServerAuthService {
  readonly user$: Observable<AppUserInterface | null> = of(null);
  readonly authState$ = of(null);
  redirectUrl = '';

  get currentUser(): null {
    return null;
  }

  async getUser(): Promise<null> {
    return null;
  }
}

@Injectable()
class ServerUserService {
  readonly user$: Observable<AppUserInterface | null> = of(null);
  readonly user = signal<AppUserInterface | null>(null).asReadonly();
  readonly stripeRoleSignal = signal(null).asReadonly();
  readonly isAdminSignal = signal(false).asReadonly();
  readonly isProSignal = signal(false).asReadonly();
  readonly isBasicSignal = signal(false).asReadonly();
  readonly isGracePeriodActiveSignal = signal(false).asReadonly();
  readonly hasPaidAccessSignal = signal(false).asReadonly();
  readonly hasProAccessSignal = signal(false).asReadonly();
  readonly gracePeriodUntil = signal<Date | null>(null).asReadonly();

  async isAdmin(): Promise<boolean> {
    return false;
  }

  async getSubscriptionRole(): Promise<null> {
    return null;
  }

  hasIncompleteProfileReads(): boolean {
    return false;
  }

  async updateUserProperties(): Promise<void> {
    return undefined;
  }
}

@Injectable()
class ServerRemoteConfigService {
  private readonly configLoadedSignal = signal(true);
  private readonly maintenanceModeSignal = signal(false);
  private readonly maintenanceMessageSignal = signal('');
  private readonly isLoadingSignal = signal(false);

  readonly configLoaded: Signal<boolean> = this.configLoadedSignal.asReadonly();
  readonly maintenanceMode: Signal<boolean> = this.maintenanceModeSignal.asReadonly();
  readonly maintenanceMessage: Signal<string> = this.maintenanceMessageSignal.asReadonly();
  readonly isLoading: Signal<boolean> = this.isLoadingSignal.asReadonly();
}

@Injectable()
class ServerThemeService {
  readonly appTheme = signal(AppThemes.Normal).asReadonly();
  readonly themeChange$ = of(null);

  getAppTheme(): Observable<AppThemes> {
    return of(AppThemes.Normal);
  }

  getThemePreference(): Observable<AppThemePreference> {
    return of(SYSTEM_THEME_PREFERENCE);
  }

  async setPreferredTheme(): Promise<void> {
    return undefined;
  }

  async toggleTheme(): Promise<void> {
    return undefined;
  }

  setAppTheme(): void {
    return undefined;
  }
}

@Injectable()
class ServerWhatsNewService {
  readonly changelogs$ = of<ChangelogPost[]>([]);
  readonly changelogs = signal<ChangelogPost[]>([]).asReadonly();
  readonly unreadCount = signal(0).asReadonly();

  isUnread(): boolean {
    return false;
  }

  async markAsRead(): Promise<void> {
    return undefined;
  }

  setAdminMode(): void {
    return undefined;
  }
}

@Injectable()
class ServerPaymentService {
  getProducts(): Observable<StripeProduct[]> {
    return of([]);
  }

  getUserSubscriptions(): Observable<StripeSubscription[]> {
    return of([]);
  }

  async hasPaidSubscriptionHistory(): Promise<boolean> {
    return false;
  }

  async getUpcomingRenewalAmount(): Promise<{ status: 'unavailable' }> {
    return { status: 'unavailable' };
  }
}

@Injectable()
class ServerAnalyticsService {
  logEvent(): void {
    return undefined;
  }

  logBeginCheckout(): void {
    return undefined;
  }

  logManageSubscription(): void {
    return undefined;
  }

  logSelectFreeTier(): void {
    return undefined;
  }

  logRestorePurchases(): void {
    return undefined;
  }

  logActivitySyncRouteToggle(): void {
    return undefined;
  }

  logActivitySyncRouteBackfill(): void {
    return undefined;
  }
}

export const SERVER_APP_PROVIDERS = [
  { provide: AppAuthService, useClass: ServerAuthService },
  { provide: AppUserService, useClass: ServerUserService },
  { provide: AppAnalyticsService, useClass: ServerAnalyticsService },
  { provide: AppRemoteConfigService, useClass: ServerRemoteConfigService },
  { provide: AppThemeService, useClass: ServerThemeService },
  { provide: AppWhatsNewService, useClass: ServerWhatsNewService },
  { provide: AppPaymentService, useClass: ServerPaymentService },
];
