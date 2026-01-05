import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent as firebaseLogEvent, setAnalyticsCollectionEnabled } from '@angular/fire/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AppAnalyticsService {
    private analytics = inject(Analytics, { optional: true });
    private authService = inject(AppAuthService);
    private hasConsent = false;

    constructor() {
        this.authService.user$.pipe(takeUntilDestroyed()).subscribe(user => {
            if (user) {
                this.hasConsent = user.acceptedTrackingPolicy === true;
                if (this.analytics) {
                    try {
                        setAnalyticsCollectionEnabled(this.analytics, this.hasConsent);
                    } catch (error) {
                        console.warn('Analytics error:', error);
                    }
                }
            } else {
                this.hasConsent = false;
                if (this.analytics) {
                    try {
                        setAnalyticsCollectionEnabled(this.analytics, false);
                    } catch (error) {
                        console.warn('Analytics error:', error);
                    }
                }
            }
        });
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
