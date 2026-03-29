import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
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
          logEvent(this.analytics!, 'screen_view', {
            firebase_screen: event.urlAfterRedirects,
            firebase_screen_class: 'AppComponent',
          });
        } catch (error) {
          this.logger.warn('[FirebaseAnalyticsTrackingService] Failed to track screen view', error);
        }
      });
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
