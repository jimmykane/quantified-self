import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent as firebaseLogEvent, setAnalyticsCollectionEnabled } from '@angular/fire/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AppAnalyticsService {
    private analytics = inject(Analytics);
    private authService = inject(AppAuthService);
    private hasConsent = false;

    constructor() {
        this.authService.user$.pipe(takeUntilDestroyed()).subscribe(user => {
            if (user) {
                this.hasConsent = user.acceptedTrackingPolicy === true;
                setAnalyticsCollectionEnabled(this.analytics, this.hasConsent);
            } else {
                this.hasConsent = false;
                setAnalyticsCollectionEnabled(this.analytics, false);
            }
        });
    }

    logEvent(eventName: string, params?: Record<string, any>) {
        if (this.hasConsent) {
            // Defer to the Firebase SDK
            firebaseLogEvent(this.analytics, eventName, params);
        }
    }
}
