import { Component, DestroyRef, Injector, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSideNavService } from '../../services/side-nav/app-side-nav.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { environment } from '../../../environments/environment';
import { AppThemePreference, SYSTEM_THEME_PREFERENCE } from '../../models/app-theme-preference.type';
import { getAssistantRequestLimitForRole } from '@shared/limits';

@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.scss'],
  standalone: false
})
export class SideNavComponent {

  public events: EventInterface[] = [];
  public appVersion = environment.appVersion;
  public readonly supportMailtoHref = `mailto:${environment.supportEmail}`;

  private themeService = inject(AppThemeService);
  public appThemes = AppThemes;
  public readonly systemThemePreference = SYSTEM_THEME_PREFERENCE;
  public themePreference = toSignal(this.themeService.getThemePreference(), { initialValue: SYSTEM_THEME_PREFERENCE });
  private analyticsService = inject(AppAnalyticsService);
  private hapticsService = inject(AppHapticsService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(MatDialog);
  private readonly navigationUrl = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(event => event.urlAfterRedirects),
  ), { initialValue: this.router.url });
  readonly timelineNotesOpening = signal(false);
  readonly timelineNotesOpen = signal(false);
  readonly timelineNotesActive = computed(() => this.timelineNotesOpen()
    || this.navigationUrl().split(/[?#]/)[0].startsWith('/health/compare/'));
  public readonly hasTrainingPlanningNavigationAccess = computed(() => !!this.userService.user()?.uid);

  constructor(
    public authService: AppAuthService,
    public userService: AppUserService,
    public sideNav: AppSideNavService,
    public whatsNewService: AppWhatsNewService,
    private snackBar: MatSnackBar) {
  }


  get isProUser(): boolean {
    return this.userService.isProSignal();
  }

  get isBasicUser(): boolean {
    return this.userService.isBasicSignal();
  }

  get hasPaidAccess(): boolean {
    return this.userService.hasPaidAccessSignal();
  }

  get assistantRoute(): string {
    return this.hasAssistantAccess ? '/ai-insights' : '/subscriptions';
  }

  get hasAssistantAccess(): boolean {
    const currentUser = this.user;
    if (!currentUser) {
      return false;
    }

    if ((currentUser as any).admin === true) {
      return true;
    }

    const stripeRole = `${(currentUser as any).stripeRole || 'free'}`;
    try {
      return getAssistantRequestLimitForRole(stripeRole) > 0;
    } catch {
      return this.hasPaidAccess;
    }
  }

  get user(): User | null {
    return this.userService.user();
  }

  async donate() {
    this.analyticsService.logEvent('donate_click', { method: 'PayPal' });
    this.hapticsService.selection();
    window.open('https://paypal.me/DKanellopoulos');
  }





  async gitHubStar() {
    this.analyticsService.logEvent('github_star');
    this.hapticsService.selection();
    window.open('https://github.com/jimmykane/quantified-self/');
  }

  async facebookGroup() {
    this.analyticsService.logEvent('facebook_group_click');
    this.hapticsService.selection();
    window.open('https://www.facebook.com/groups/quantifiedself.io');
  }

  reportBug(): void {
    window.open('https://github.com/jimmykane/quantified-self/issues');
  }

  async logout() {
    this.analyticsService.logEvent('logout', {});
    this.hapticsService.selection();
    try {
      await this.authService.signOut();
    } catch {
      this.snackBar.open('Could not sign out', undefined, {
        duration: 2000,
      });
    }
  }

  public async setTheme(theme: AppThemePreference, event?: MouseEvent) {
    this.hapticsService.selection();
    await this.themeService.setPreferredTheme(theme, event);
  }

  public closeSideNav(): void {
    this.hapticsService.selection();
    this.sideNav.close();
  }

  public openCompareFilesFromNav(): void {
    this.analyticsService.logToolCompareEntry('side_nav', !!this.user);
    this.closeSideNav();
  }

  async openTimelineNotesFromNav(): Promise<void> {
    const uid = this.user?.uid;
    if (!uid || this.timelineNotesOpening() || this.timelineNotesOpen()) return;
    this.timelineNotesOpening.set(true);
    this.hapticsService.selection();
    try {
      // Let the drawer restore focus before Material captures the dialog's return target.
      await this.sideNav.close();
      const [{ TimelineNotesDialogComponent }, { AppTimelineNotesService }] = await Promise.all([
        import('../timeline-notes/timeline-notes-dialog.component'),
        import('../../services/app.timeline-notes.service'),
      ]);
      if (this.destroyRef.destroyed || this.user?.uid !== uid) return;
      const notes = this.injector.get(AppTimelineNotesService);
      if (!notes.isOwner(uid)) return;
      if (this.dialogs.openDialogs.some(dialog => dialog.componentInstance instanceof TimelineNotesDialogComponent)) return;
      const dialog = this.dialogs.open(TimelineNotesDialogComponent, {
        width: '560px', maxWidth: 'calc(100vw - 32px)', data: { uid },
      });
      this.timelineNotesOpen.set(true);
      dialog.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.timelineNotesOpen.set(false));
    } catch {
      if (!this.destroyRef.destroyed && this.user?.uid === uid) {
        this.hapticsService.error();
        this.snackBar.open('Timeline notes could not open. Please try again.', undefined, { duration: 3000 });
      }
    } finally {
      this.timelineNotesOpening.set(false);
    }
  }

}
