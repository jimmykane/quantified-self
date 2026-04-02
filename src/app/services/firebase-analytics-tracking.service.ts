import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Analytics } from 'app/firebase/analytics';
import { Auth, user } from 'app/firebase/auth';
import { logEvent, setUserId } from 'firebase/analytics';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class FirebaseAnalyticsTrackingService {
  private analytics = inject(Analytics, { optional: true });
  private auth = inject(Auth, { optional: true });
  private router = inject(Router, { optional: true });
  private logger = inject(LoggerService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    if (!this.analytics) {
      return;
    }

    this.initializeScreenTracking();
    this.initializeUserTracking();
  }

  private initializeScreenTracking(): void {
    if (!this.router || !this.analytics) {
      return;
    }

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        try {
          const screenClass = this.resolveScreenClassName();
          const screenPath = this.sanitizeScreenPath(event.urlAfterRedirects);
          logEvent(this.analytics!, 'screen_view', {
            firebase_screen: screenPath,
            firebase_screen_class: screenClass,
          });
        } catch (error) {
          this.logger.warn('[FirebaseAnalyticsTrackingService] Failed to track screen view', error);
        }
      });
  }

  private sanitizeScreenPath(urlAfterRedirects: string): string {
    if (!urlAfterRedirects) {
      return '/';
    }

    const withoutFragment = urlAfterRedirects.split('#')[0] || '';
    const pathOnly = withoutFragment.split('?')[0] || '';

    return pathOnly || '/';
  }

  private resolveScreenClassName(): string {
    if (!this.router?.routerState?.snapshot?.root) {
      return 'AppComponent';
    }

    const leafRoute = this.getLeafRoute(this.router.routerState.snapshot.root);
    const routeComponent = leafRoute.routeConfig?.component ?? leafRoute.component;
    const resolvedName = this.getComponentName(routeComponent);

    return resolvedName ?? 'AppComponent';
  }

  private getLeafRoute(route: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
    let current = route;
    while (current.firstChild) {
      current = current.firstChild;
    }
    return current;
  }

  private getComponentName(component: unknown): string | null {
    if (!component) {
      return null;
    }

    if (typeof component === 'string') {
      return component;
    }

    if (typeof component === 'function') {
      return component.name || null;
    }

    return null;
  }

  private initializeUserTracking(): void {
    if (!this.auth || !this.analytics) {
      return;
    }

    user(this.auth)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((firebaseUser) => {
        try {
          setUserId(this.analytics!, firebaseUser?.uid ?? null);
        } catch (error) {
          this.logger.warn('[FirebaseAnalyticsTrackingService] Failed to set analytics user id', error);
        }
      });
  }
}
