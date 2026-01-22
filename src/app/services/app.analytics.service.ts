import { Injectable, inject } from '@angular/core';
import { Analytics } from '@angular/fire/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoggerService } from './logger.service';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AppAnalyticsService {
    private analytics = inject(Analytics, { optional: true });
    private authService = inject(AppAuthService);
    private logger = inject(LoggerService);
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
                this.logger.warn('Analytics error:', error);
            }
        }
    }

    logEvent(eventName: string, params?: Record<string, any>) {
        if (this.hasConsent && this.analytics) {
            try {
                // Defer to the Firebase SDK
                logEvent(this.analytics, eventName, params);
            } catch (error) {
                this.logger.warn('Analytics logEvent error:', error);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Subscription / Pricing Events
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Log when user initiates a checkout flow for a paid subscription.
     */
    logBeginCheckout(priceId: string, currency?: string, value?: number): void {
        this.logEvent('begin_checkout', {
            price_id: priceId,
            currency,
            value
        });
    }

    /**
     * Log when user opens the subscription management portal.
     */
    logManageSubscription(): void {
        this.logEvent('manage_subscription');
    }

    /**
     * Log when user selects the free tier.
     */
    logSelectFreeTier(): void {
        this.logEvent('select_freetier');
    }

    /**
     * Log restore purchases lifecycle.
     */
    logRestorePurchases(status: 'initiated' | 'success' | 'failure', role?: string, error?: string): void {
        this.logEvent('restore_purchases', { status, role, error });
    }
}
