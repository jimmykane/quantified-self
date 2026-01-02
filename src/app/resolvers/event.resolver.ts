import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn, Router, RouterStateSnapshot } from '@angular/router';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { EventInterface, User } from '@sports-alliance/sports-lib';
import {
    DataLatitudeDegrees,
    DataLongitudeDegrees,
    DataSpeed,
    DataGradeAdjustedSpeed,
    DataDistance,
    DynamicDataLoader
} from '@sports-alliance/sports-lib';
import { map, switchMap, catchError, take } from 'rxjs/operators';
import { of, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../authentication/app.auth.service';
import { LoggerService } from '../services/logger.service';

export interface EventResolverData {
    event: EventInterface;
    user: User | null;
}

export const eventResolver: ResolveFn<EventResolverData> = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const eventService = inject(AppEventService);
    const userService = inject(AppUserService);
    const authService = inject(AppAuthService);
    const router = inject(Router);
    const snackBar = inject(MatSnackBar);
    const logger = inject(LoggerService);

    const eventID = route.paramMap.get('eventID');
    const targetUserID = route.paramMap.get('userID');

    if (!eventID || !targetUserID) {
        router.navigate(['/dashboard']);
        return EMPTY;
    }

    return authService.user$.pipe(
        take(1),
        switchMap((user: User | null) => {
            const dataTypes = [
                DataLatitudeDegrees.type,
                DataLongitudeDegrees.type,
                DataSpeed.type,
                DataGradeAdjustedSpeed.type,
                DataDistance.type
            ];

            if (user) {
                const userChartDataTypes = userService.getUserChartDataTypesToUse(user);
                const nonUnitBasedDataTypes = DynamicDataLoader.getNonUnitBasedDataTypes(user.settings.chartSettings.showAllData, userChartDataTypes);
                nonUnitBasedDataTypes.forEach(t => {
                    if (!dataTypes.includes(t)) {
                        dataTypes.push(t);
                    }
                })
            }

            return eventService.getEventActivitiesAndSomeStreams(
                new User(targetUserID),
                eventID,
                dataTypes
            ).pipe(
                take(1),
                map(event => ({ event, user }))
            );
        }),
        map(({ event, user }) => {
            if (event) {
                return { event, user };
            } else {
                snackBar.open('Event not found', 'Close', { duration: 3000 });
                router.navigate(['/dashboard']);
                // We must return something that matches the signature or throw, but since we navigated, EMPTY is safe logic-wise, 
                // but typescript might want the return type. 
                // In a resolver, returning EMPTY keeps the navigation hanging or cancels it.
                return null;
            }
        }),
        catchError((error) => {
            logger.error('Error resolving event:', error);
            let message = 'Error loading event';
            if (error?.message?.includes('Missing or insufficient permissions') || error?.code === 'permission-denied') {
                message = 'Event data unavailable: Original file missing and legacy access denied.';
            }
            snackBar.open(message, 'Close', { duration: 5000 });
            router.navigate(['/dashboard']);
            return EMPTY;
        }),
        // Cast the final output to ensure it matches ResolveFn<EventResolverData>
        map(result => result as EventResolverData)
    );
};
