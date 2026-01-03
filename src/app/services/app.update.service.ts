import { ApplicationRef, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { concat, interval } from 'rxjs';
import { filter, first } from 'rxjs/operators';


@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  constructor(appRef: ApplicationRef, updates: SwUpdate, private snackbar: MatSnackBar) {
    if (!updates.isEnabled) {
      return;
    }
    // Allow the app to stabilize first, before starting polling for updates with `interval()`.
    const appIsStable = appRef.isStable.pipe(first(isStable => isStable === true));
    const everySixMinutes = interval(10 * 60 * 1000);
    const everySixHoursOnceAppIsStable$ = concat(appIsStable, everySixMinutes);

    everySixHoursOnceAppIsStable$.subscribe(() => updates.checkForUpdate());
    updates.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        const snack = this.snackbar.open('There is a new version available', 'Reload');
        snack
          .onAction()
          .subscribe(() => {
            window.location.reload();
          });
      });
  }

}
