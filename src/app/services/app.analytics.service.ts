import { Injectable, inject } from '@angular/core';
import { Analytics } from 'app/firebase/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoggerService } from './logger.service';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '@shared/activity-sync-routes';
import { AppWindowService } from './app.window.service';

import { environment } from '../../environments/environment';

type PurchaseMode = 'payment' | 'subscription';

export interface PurchaseAnalyticsContext {
    priceId: string;
    mode: PurchaseMode;
    currency?: string;
    value?: number;
    isTrialCheckout?: boolean;
}

export interface PurchaseAnalyticsParams extends Partial<PurchaseAnalyticsContext> {
    transactionId: string;
    role?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AppAnalyticsService {
    private analytics = inject(Analytics, { optional: true });
    private authService = inject(AppAuthService);
    private logger = inject(LoggerService);
    private windowService = inject(AppWindowService);
    private hasConsent = false;
    private readonly pendingPurchaseStorageKey = 'app.analytics.pending_purchase';
    private readonly loggedPurchaseStorageKeyPrefix = 'app.analytics.purchase_logged.';

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

    storePendingPurchaseContext(context: PurchaseAnalyticsContext): void {
        const normalizedContext: PurchaseAnalyticsContext & { createdAt: number } = {
            priceId: context.priceId,
            mode: context.mode,
            createdAt: Date.now(),
        };

        if (context.currency) {
            normalizedContext.currency = context.currency.toUpperCase();
        }

        if (this.isFiniteNumber(context.value)) {
            normalizedContext.value = context.value;
        }

        if (context.isTrialCheckout === true) {
            normalizedContext.isTrialCheckout = true;
        }

        this.setStorageItem(this.pendingPurchaseStorageKey, JSON.stringify(normalizedContext));
    }

    logPurchaseOnce(params: Pick<PurchaseAnalyticsParams, 'transactionId' | 'role'>): void {
        const transactionId = params.transactionId.trim();
        if (!transactionId) {
            return;
        }

        const loggedStorageKey = `${this.loggedPurchaseStorageKeyPrefix}${transactionId}`;
        if (this.getStorageItem(loggedStorageKey)) {
            return;
        }

        const pendingContext = this.getPendingPurchaseContext();
        if (!pendingContext) {
            return;
        }

        if (pendingContext.isTrialCheckout) {
            this.removeStorageItem(this.pendingPurchaseStorageKey);
            return;
        }

        this.logPurchase({
            ...pendingContext,
            transactionId,
            role: params.role,
        });
        this.setStorageItem(loggedStorageKey, new Date().toISOString());
        this.removeStorageItem(this.pendingPurchaseStorageKey);
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

    private getPendingPurchaseContext(): PurchaseAnalyticsContext | null {
        const rawContext = this.getStorageItem(this.pendingPurchaseStorageKey);
        if (!rawContext) {
            return null;
        }

        try {
            const parsed = JSON.parse(rawContext) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            const priceId = parsed['priceId'];
            const mode = parsed['mode'];
            if (typeof priceId !== 'string' || !priceId.trim() || (mode !== 'payment' && mode !== 'subscription')) {
                return null;
            }

            const context: PurchaseAnalyticsContext = {
                priceId: priceId.trim(),
                mode,
            };

            const currency = parsed['currency'];
            if (typeof currency === 'string' && currency.trim()) {
                context.currency = currency.trim().toUpperCase();
            }

            const value = parsed['value'];
            if (this.isFiniteNumber(value)) {
                context.value = value;
            }

            if (parsed['isTrialCheckout'] === true) {
                context.isTrialCheckout = true;
            }

            return context;
        } catch (error) {
            this.logger.warn('Analytics pending purchase context parse error:', error);
            return null;
        }
    }

    private getStorageItem(key: string): string | null {
        const storage = this.getStorage();
        if (!storage) {
            return null;
        }

        try {
            return storage.getItem(key);
        } catch (error) {
            this.logger.warn('Analytics storage read error:', error);
            return null;
        }
    }

    private setStorageItem(key: string, value: string): void {
        const storage = this.getStorage();
        if (!storage) {
            return;
        }

        try {
            storage.setItem(key, value);
        } catch (error) {
            this.logger.warn('Analytics storage write error:', error);
        }
    }

    private removeStorageItem(key: string): void {
        const storage = this.getStorage();
        if (!storage) {
            return;
        }

        try {
            storage.removeItem(key);
        } catch (error) {
            this.logger.warn('Analytics storage remove error:', error);
        }
    }

    private getStorage(): Storage | null {
        try {
            return this.windowService.windowRef.localStorage ?? null;
        } catch (error) {
            this.logger.warn('Analytics storage unavailable:', error);
            return null;
        }
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
