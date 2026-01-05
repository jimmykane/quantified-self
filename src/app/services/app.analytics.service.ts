import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent as firebaseLogEvent, setAnalyticsCollectionEnabled } from '@angular/fire/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AppAnalyticsService {
    private analytics = inject(Analytics, { optional: true });
    private authService = inject(AppAuthService);
    private hasConsent = false;

    constructor() {
        this.authService.user$.pipe(takeUntilDestroyed()).subscribe(user => {
            if (environment.forceAnalyticsCollection) {
                this.hasConsent = true;
                this.setCollectionEnabled(true);
            } else if (user) {
                this.hasConsent = user.acceptedTrackingPolicy === true;
                this.setCollectionEnabled(this.hasConsent);
            } else {
                this.hasConsent = false;
                this.setCollectionEnabled(false);
            }
        });
    }

    private setCollectionEnabled(enabled: boolean) {
        if (this.analytics) {
            try {
                setAnalyticsCollectionEnabled(this.analytics, enabled);
            } catch (error) {
                console.warn('Analytics error:', error);
            }
        }
    }

    logEvent(eventName: string, params?: Record<string, any>) {
        if (this.hasConsent && this.analytics) {
            try {
                // Defer to the Firebase SDK
                firebaseLogEvent(this.analytics, eventName, params);
            } catch (error) {
                console.warn('Analytics logEvent error:', error);
            }
        }
    }
}
