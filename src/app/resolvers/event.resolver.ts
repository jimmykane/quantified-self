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

export const eventResolver: ResolveFn<EventInterface> = (
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
            ).pipe(take(1));
        }),
        map(event => {
            if (event) {
                return event;
            } else {
                snackBar.open('Event not found', 'Close', { duration: 3000 });
                router.navigate(['/dashboard']);
                return null; // Or throw error to be caught
            }
        }),
        catchError((error) => {
            logger.error('Error resolving event:', error);
            snackBar.open('Error loading event', 'Close', { duration: 3000 });
            router.navigate(['/dashboard']);
            return EMPTY;
        })
    );
};
