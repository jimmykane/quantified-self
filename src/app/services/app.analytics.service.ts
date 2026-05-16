import { Injectable, inject } from '@angular/core';
import { Analytics } from 'app/firebase/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoggerService } from './logger.service';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '@shared/activity-sync-routes';

import { environment } from '../../environments/environment';

type PurchaseMode = 'payment' | 'subscription';

export interface PurchaseAnalyticsParams {
    transactionId: string;
    role?: string | null;
    mode?: PurchaseMode;
    priceId?: string;
    currency?: string;
    value?: number;
}

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

    logPurchase(params: PurchaseAnalyticsParams): void {
        const transactionId = params.transactionId.trim();
        if (!transactionId) {
            return;
        }

        const eventParams: Record<string, any> = {
            transaction_id: transactionId,
            items: [this.buildPurchaseItem(params)]
        };

        if (params.currency) {
            eventParams.currency = params.currency.toUpperCase();
        }

        if (this.isFiniteNumber(params.value)) {
            eventParams.value = params.value;
        }

        this.logEvent('purchase', eventParams);
    }

    private buildPurchaseItem(params: PurchaseAnalyticsParams): Record<string, any> {
        const role = typeof params.role === 'string' && params.role.trim() ? params.role.trim() : null;
        const item: Record<string, any> = {
            item_id: params.priceId || role || params.transactionId,
            item_name: role ? `${role} subscription` : 'Subscription',
            item_category: params.mode || 'subscription',
            quantity: 1
        };

        if (role) {
            item.item_variant = role;
        }

        if (this.isFiniteNumber(params.value)) {
            item.price = params.value;
        }

        return item;
    }

    private isFiniteNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value);
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

    // ─────────────────────────────────────────────────────────────────────────────
    // What's New Events
    // ─────────────────────────────────────────────────────────────────────────────

    logViewWhatsNewBadge(): void {
        this.logEvent('view_whats_new_badge');
    }

    logClickWhatsNew(): void {
        this.logEvent('click_whats_new');
    }

    logDismissWhatsNew(): void {
        this.logEvent('dismiss_whats_new');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Activity Sync Route Events
    // ─────────────────────────────────────────────────────────────────────────────

    private getActivitySyncRouteParams(routeId: ActivitySyncRouteId): Record<string, string> {
        const route = ACTIVITY_SYNC_ROUTES[routeId];
        return {
            route_id: route.id,
            source_service: `${route.sourceServiceName}`,
            destination_service: `${route.destinationServiceName}`,
        };
    }

    logActivitySyncRouteToggle(routeId: ActivitySyncRouteId, enabled: boolean): void {
        this.logEvent('activity_sync_route_toggle', {
            ...this.getActivitySyncRouteParams(routeId),
            enabled,
            action: enabled ? 'enable' : 'disable',
        });
    }

    logActivitySyncRouteBackfill(routeId: ActivitySyncRouteId, summary: {
        scanned: number;
        queued: number;
        failedCount: number;
    }): void {
        this.logEvent('activity_sync_route_backfill', {
            ...this.getActivitySyncRouteParams(routeId),
            scanned_count: summary.scanned,
            queued_count: summary.queued,
            failed_count: summary.failedCount,
        });
    }
}
