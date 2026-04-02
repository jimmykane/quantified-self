import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn, Router, RouterStateSnapshot } from '@angular/router';
import { AppEventService, type EventsOnceSource } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { EventInterface, ActivityTypes, DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { map, switchMap, take } from 'rxjs/operators';
import { of, EMPTY, Observable, firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../authentication/app.auth.service';
import { WhereFilterOp } from 'firebase/firestore';
import { getDatesForDateRange } from '../helpers/date-range-helper';
import { LoggerService } from '../services/logger.service';

export interface DashboardResolverData {
    events: EventInterface[];
    user: AppUserInterface | null;
    targetUser?: AppUserInterface | null;
    hasMergedEvents?: boolean;
    eventsSource?: EventsOnceSource;
    // True when resolver intentionally skips one-shot event prefetch and relies on live stream hydration.
    eventsPrefetchSkipped?: boolean;
}

let dashboardResolverRunCounter = 0;

export const dashboardResolver: ResolveFn<DashboardResolverData> = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const eventService = inject(AppEventService);
    const userService = inject(AppUserService);
    const authService = inject(AppAuthService);
    const router = inject(Router);
    const snackBar = inject(MatSnackBar);
    const logger = inject(LoggerService);
    const runId = ++dashboardResolverRunCounter;
    const resolverStart = performance.now();

    // Get optional target user ID from route
    const targetUserID = route.paramMap.get('userID');
    logger.info('[perf] dashboard_resolver_start', {
        runId,
        url: state?.url || null,
        targetUserID: targetUserID || null,
    });

    return authService.user$.pipe(
        take(1),
        switchMap(async (user: AppUserInterface | null) => {
            if (!user) {
                // If user is not authenticated, redirect to login and return empty data
                router.navigate(['login']);
                logger.info('[perf] dashboard_resolver_unauthenticated', {
                    runId,
                    durationMs: Number((performance.now() - resolverStart).toFixed(2)),
                });
                return { events: [], user: null, targetUser: null, hasMergedEvents: false };
            }

            let targetUser: AppUserInterface | undefined = undefined;
            if (targetUserID) {
                const targetUserFetchStart = performance.now();
                try {
                    // We need to convert the Observable to a Promise or handle it in RxJS chain
                    // Converting to promise inside async switchMap is okay for clarity 
                    // provided we handle concurrency correct, but better to use RxJS
                    targetUser = await userService.getUserByID(targetUserID).pipe(take(1)).toPromise();
                    logger.info('[perf] dashboard_resolver_target_user_fetch', {
                        runId,
                        durationMs: Number((performance.now() - targetUserFetchStart).toFixed(2)),
                        targetUserID,
                    });
                } catch (e) {
                    snackBar.open('Page not found');
                    router.navigate(['dashboard']);
                    logger.warn('[perf] dashboard_resolver_target_user_fetch_failed', {
                        runId,
                        durationMs: Number((performance.now() - targetUserFetchStart).toFixed(2)),
                        targetUserID,
                    });
                    return { events: [], user: user, targetUser: null, hasMergedEvents: false };
                }
            }

            // Determine search parameters based on USER settings (viewing user), 
            // OR if it's a targetUser dashboard, usually we still use the *viewer's* settings 
            // for date range? Or the dashboard default?
            // The original component used `this.user`(current logged in user) for settings like `dashboardSettings`.
            // So we use `user.settings`.

            const dashboardSettings = user.settings?.dashboardSettings;
            if (!dashboardSettings) {
                logger.info('[perf] dashboard_resolver_missing_settings', {
                    runId,
                    durationMs: Number((performance.now() - resolverStart).toFixed(2)),
                });
                return { events: [], user: user, targetUser, hasMergedEvents: false };
            }

            let searchStartDate: Date | null = null;
            let searchEndDate: Date | null = null;

            if (dashboardSettings.dateRange === DateRanges.custom && dashboardSettings.startDate && dashboardSettings.endDate) {
                searchStartDate = new Date(dashboardSettings.startDate);
                searchEndDate = new Date(dashboardSettings.endDate);
            } else if (user.settings.unitSettings?.startOfTheWeek !== undefined) {
                const range = getDatesForDateRange(dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek);
                searchStartDate = range.startDate;
                searchEndDate = range.endDate;
            }

            const where: any[] = [];
            const includeMergedEvents = dashboardSettings.includeMergedEvents !== false;

            if ((!searchStartDate || !searchEndDate) && dashboardSettings.dateRange === DateRanges.custom) {
                return { events: [], user: user, targetUser, hasMergedEvents: false };
            }

            if (dashboardSettings.dateRange !== DateRanges.all && searchStartDate && searchEndDate) {
                where.push({
                    fieldPath: 'startDate',
                    opStr: <WhereFilterOp>'>=',
                    value: searchStartDate.getTime()
                });
                where.push({
                    fieldPath: 'startDate',
                    opStr: <WhereFilterOp>'<=',
                    value: searchEndDate.getTime()
                });
            }

            // For all-time dashboards, one-shot prefetch can spend tens of seconds deserializing thousands
            // of events before first paint. Skip this read and let the live listener hydrate initial data.
            const shouldSkipEventsPrefetch = dashboardSettings.dateRange === DateRanges.all;
            if (shouldSkipEventsPrefetch) {
                logger.info('[perf] dashboard_resolver_skip_events_prefetch', {
                    runId,
                    durationMs: Number((performance.now() - resolverStart).toFixed(2)),
                    reason: 'date_range_all',
                    whereClauses: where.length,
                    userContextUID: (targetUser ? targetUser : user)?.uid || null,
                });
                return {
                    events: [],
                    user: user,
                    targetUser,
                    hasMergedEvents: false,
                    eventsPrefetchSkipped: true,
                };
            }

            // Fetch events
            // We use targetUser if present, otherwise user
            const userContext = targetUser ? targetUser : user;
            const limit = 0;

            const eventsFetchStart = performance.now();
            const eventsResult = await firstValueFrom(eventService.getEventsOnceByWithMeta(
                userContext,
                where,
                'startDate',
                false,
                limit,
                {
                    preferCache: true,
                    warmServer: false,
                    seedLiveQuery: true,
                }
            ));
            logger.info('[perf] dashboard_resolver_events_fetch', {
                runId,
                durationMs: Number((performance.now() - eventsFetchStart).toFixed(2)),
                whereClauses: where.length,
                events: eventsResult?.events?.length || 0,
                source: eventsResult?.source || null,
                userContextUID: userContext?.uid || null,
            });
            const rawEvents = eventsResult?.events || [];
            const hasMergedEvents = rawEvents.some(event => event.isMerge);
            const filteredByMerge = includeMergedEvents ? rawEvents : rawEvents.filter(event => !event.isMerge);

            // Filter by Activity Types
            const dashboardActivityTypes = dashboardSettings.activityTypes ?? [];
            if (!dashboardActivityTypes.length) {
                logger.info('[perf] dashboard_resolver_complete', {
                    runId,
                    durationMs: Number((performance.now() - resolverStart).toFixed(2)),
                    returnedEvents: filteredByMerge?.length || 0,
                });
                return {
                    events: filteredByMerge || [],
                    user: user,
                    targetUser,
                    hasMergedEvents,
                    eventsSource: eventsResult?.source
                };
            }

            const filteredEvents = (filteredByMerge || []).filter(event => {
                return event.getActivityTypesAsArray().some(activityType => (
                    dashboardActivityTypes.includes(ActivityTypes[activityType as unknown as keyof typeof ActivityTypes])
                ));
            });

            logger.info('[perf] dashboard_resolver_complete', {
                runId,
                durationMs: Number((performance.now() - resolverStart).toFixed(2)),
                returnedEvents: filteredEvents.length,
            });
            return {
                events: filteredEvents,
                user: user,
                targetUser,
                hasMergedEvents,
                eventsSource: eventsResult?.source
            };
        }),
        map((result) => {
            return result as DashboardResolverData;
        })
    );
};
