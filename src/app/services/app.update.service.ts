import { ApplicationRef, Injectable } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { concat, interval } from 'rxjs';
import { first } from 'rxjs/operators';


@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  constructor(appRef: ApplicationRef, updates: SwUpdate, private snackbar: MatSnackBar) {
    // Allow the app to stabilize first, before starting polling for updates with `interval()`.
    const appIsStable = appRef.isStable.pipe(first(isStable => isStable === true));
    const everySixMinutes = interval(6 * 60 * 1000);
    const everySixHoursOnceAppIsStable$ = concat(appIsStable, everySixMinutes);

    everySixHoursOnceAppIsStable$.subscribe(() => updates.checkForUpdate());
    updates.available.subscribe(evt => {
      const snack = this.snackbar.open('There is a new version available', 'Reload');
      snack
        .onAction()
        .subscribe(() => {
          window.location.reload();
        });
    });
  }

}
