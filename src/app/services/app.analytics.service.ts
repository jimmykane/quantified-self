import { Injectable, inject } from '@angular/core';
import { Analytics } from 'app/firebase/analytics';
import { logEvent, setAnalyticsCollectionEnabled } from 'firebase/analytics';
import { AppAuthService } from '../authentication/app.auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoggerService } from './logger.service';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '@shared/activity-sync-routes';

import { environment } from '../../environments/environment';

export type ToolCompareEntrySource = 'side_nav' | 'tools_hub_hero' | 'tools_hub_card';
export type ToolCompareDestination = 'compare' | 'saved';
export type ToolCompareSignInSource = 'guest_cta' | 'guest_create' | 'saved_action';
export type ToolCompareCreateStatus = 'validation_failure' | 'start' | 'success' | 'failure';
export type ToolCompareErrorCategory =
    | 'app_check'
    | 'auth'
    | 'duplicate_source'
    | 'empty_file'
    | 'file_size'
    | 'network'
    | 'quota'
    | 'too_few_files'
    | 'too_many_files'
    | 'unknown'
    | 'unsupported_format';
export type ToolCompareFileType = 'fit' | 'gpx' | 'tcx';
export type ToolCompareSavedAction =
    | 'filter'
    | 'sort'
    | 'page'
    | 'open_details'
    | 'open_report'
    | 'run_report'
    | 'rerun_report'
    | 'description_edit'
    | 'description_save'
    | 'tags_edit'
    | 'tags_save'
    | 'delete';
export type ToolCompareSavedActionStatus = 'applied' | 'cleared' | 'confirmed' | 'failure' | 'success';
export type ToolCompareSavedSortColumn =
    | 'activityType'
    | 'altitude'
    | 'ascent'
    | 'date'
    | 'description'
    | 'descent'
    | 'devices'
    | 'distance'
    | 'gnss'
    | 'heartRate'
    | 'reports'
    | 'sourceFiles'
    | 'status'
    | 'tags'
    | 'title';

export interface ToolCompareFileSelectionAnalytics {
    selectedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    fileCountAfterSelection: number;
    fileTypes: ToolCompareFileType[];
    compressedCount: number;
    limitReached: boolean;
}

export interface ToolCompareCreateAnalytics {
    fileCount: number;
    hasCustomTitle: boolean;
    alreadyExists?: boolean;
    errorCategory?: ToolCompareErrorCategory;
}

export interface ToolCompareSavedActionAnalytics {
    status?: ToolCompareSavedActionStatus;
    sortColumn?: ToolCompareSavedSortColumn;
    sortDirection?: 'asc' | 'desc';
    pageIndex?: number;
    pageSize?: number;
    filterActive?: boolean;
    resultCount?: number;
    hasReport?: boolean;
    reportCount?: number;
    hadDescription?: boolean;
    tagCount?: number;
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

    // ─────────────────────────────────────────────────────────────────────────────
    // Tools / Compare Events
    // ─────────────────────────────────────────────────────────────────────────────

    logToolCompareEntry(source: ToolCompareEntrySource, signedIn?: boolean): void {
        this.logEvent('tool_compare_entry', this.compactParams({
            source,
            signed_in: signedIn,
        }));
    }

    logToolCompareSignIn(source: ToolCompareSignInSource, destination: ToolCompareDestination): void {
        this.logEvent('tool_compare_sign_in', {
            source,
            destination,
        });
    }

    logToolCompareFileSelection(summary: ToolCompareFileSelectionAnalytics): void {
        this.logEvent('tool_compare_file_selection', {
            selected_count: summary.selectedCount,
            accepted_count: summary.acceptedCount,
            rejected_count: summary.rejectedCount,
            file_count_after_selection: summary.fileCountAfterSelection,
            file_types: this.formatAnalyticsList(summary.fileTypes),
            compressed_count: summary.compressedCount,
            limit_reached: summary.limitReached,
        });
    }

    logToolCompareCreate(status: ToolCompareCreateStatus, summary: ToolCompareCreateAnalytics): void {
        this.logEvent('tool_compare_create', this.compactParams({
            status,
            file_count: summary.fileCount,
            has_custom_title: summary.hasCustomTitle,
            already_exists: summary.alreadyExists,
            error_category: summary.errorCategory,
        }));
    }

    logToolCompareSavedAction(action: ToolCompareSavedAction, params: ToolCompareSavedActionAnalytics = {}): void {
        this.logEvent('tool_compare_saved_action', this.compactParams({
            action,
            status: params.status,
            sort_column: params.sortColumn,
            sort_direction: params.sortDirection,
            page_index: params.pageIndex,
            page_size: params.pageSize,
            filter_active: params.filterActive,
            result_count: params.resultCount,
            has_report: params.hasReport,
            report_count: params.reportCount,
            had_description: params.hadDescription,
            tag_count: params.tagCount,
        }));
    }

    private formatAnalyticsList(values: readonly string[]): string {
        const normalizedValues = values
            .map(value => value.trim().toLowerCase())
            .filter(Boolean);
        return normalizedValues.length > 0 ? [...new Set(normalizedValues)].sort().join('|') : 'none';
    }

    private compactParams(params: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean> {
        const compactedParams: Record<string, string | number | boolean> = {};
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                compactedParams[key] = value;
            }
        });
        return compactedParams;
    }
}
