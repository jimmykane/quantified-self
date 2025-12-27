import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn, Router, RouterStateSnapshot } from '@angular/router';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { EventInterface, User, ActivityTypes, DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { map, switchMap, take } from 'rxjs/operators';
import { of, EMPTY, Observable, firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../authentication/app.auth.service';
import { WhereFilterOp } from 'firebase/firestore';
import { getDatesForDateRange } from '../helpers/date-range-helper';

export interface DashboardResolverData {
    events: EventInterface[];
    user: User | null;
    targetUser?: User | null;
}

export const dashboardResolver: ResolveFn<DashboardResolverData> = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const eventService = inject(AppEventService);
    const userService = inject(AppUserService);
    const authService = inject(AppAuthService);
    const router = inject(Router);
    const snackBar = inject(MatSnackBar);

    // Get optional target user ID from route
    const targetUserID = route.paramMap.get('userID');

    return authService.user$.pipe(
        take(1),
        switchMap(async (user: User | null) => {
            if (!user) {
                // Not authenticated or user not ready - let the component or guard handle redirect, 
                // but for resolver we need to return something or navigate.
                // Usually AuthGuard handles the "not logged in" case. 
                // If we get here, likely user is null briefly or we are in a weird state.
                return { events: [], user: null, targetUser: null };
            }

            let targetUser: User | undefined = undefined;
            if (targetUserID) {
                try {
                    // We need to convert the Observable to a Promise or handle it in RxJS chain
                    // Converting to promise inside async switchMap is okay for clarity 
                    // provided we handle concurrency correct, but better to use RxJS
                    targetUser = await userService.getUserByID(targetUserID).pipe(take(1)).toPromise();
                } catch (e) {
                    snackBar.open('Page not found');
                    router.navigate(['dashboard']);
                    return { events: [], user: user, targetUser: null };
                }
            }

            // Determine search parameters based on USER settings (viewing user), 
            // OR if it's a targetUser dashboard, usually we still use the *viewer's* settings 
            // for date range? Or the dashboard default?
            // The original component used `this.user`(current logged in user) for settings like `dashboardSettings`.
            // So we use `user.settings`.

            if (!user.settings?.dashboardSettings) {
                return { events: [], user: user, targetUser };
            }

            let searchStartDate: Date | null = null;
            let searchEndDate: Date | null = null;

            if (user.settings.dashboardSettings.dateRange === DateRanges.custom && user.settings.dashboardSettings.startDate && user.settings.dashboardSettings.endDate) {
                searchStartDate = new Date(user.settings.dashboardSettings.startDate);
                searchEndDate = new Date(user.settings.dashboardSettings.endDate);
            } else if (user.settings.unitSettings?.startOfTheWeek !== undefined) {
                const range = getDatesForDateRange(user.settings.dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek);
                searchStartDate = range.startDate;
                searchEndDate = range.endDate;
            }

            const where: any[] = [];

            if ((!searchStartDate || !searchEndDate) && user.settings.dashboardSettings.dateRange === DateRanges.custom) {
                return { events: [], user: user, targetUser };
            }

            if (user.settings.dashboardSettings.dateRange !== DateRanges.all && searchStartDate && searchEndDate) {
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

            // Fetch events
            // We use targetUser if present, otherwise user
            const userContext = targetUser ? targetUser : user;
            const limit = 0;

            const events = await firstValueFrom(eventService.getEventsOnceBy(userContext, where, 'startDate', false, limit));

            // Filter by Activity Types
            if (!user.settings.dashboardSettings.activityTypes || !user.settings.dashboardSettings.activityTypes.length) {
                return { events: events || [], user: user, targetUser };
            }

            const filteredEvents = (events || []).filter(event => {
                return event.getActivityTypesAsArray().some(activityType => user.settings!.dashboardSettings!.activityTypes!.indexOf(ActivityTypes[activityType as unknown as keyof typeof ActivityTypes]) >= 0)
            });

            return { events: filteredEvents, user: user, targetUser };
        }),
        map((result) => {
            return result as DashboardResolverData;
        })
    );
};
