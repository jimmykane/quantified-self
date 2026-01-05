import { ApplicationRef, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { concat, interval } from 'rxjs';
import { filter, first } from 'rxjs/operators';
import { LoggerService } from './logger.service';
import { AppWindowService } from './app.window.service';


@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  constructor(appRef: ApplicationRef, updates: SwUpdate, private snackbar: MatSnackBar, private logger: LoggerService, private windowService: AppWindowService) {
    if (!updates.isEnabled) {
      return;
    }
    // Allow the app to stabilize first, before starting polling for updates with `interval()`.
    const appIsStable = appRef.isStable.pipe(first(isStable => isStable === true));
    const everyTenMinutes = interval(10 * 60 * 1000);
    const everyTenMinutesOnceAppIsStable$ = concat(appIsStable, everyTenMinutes);

    everyTenMinutesOnceAppIsStable$.subscribe(() => updates.checkForUpdate());
    updates.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        const snack = this.snackbar.open('There is a new version available', 'Reload', {
          duration: 0,
        });

        snack
          .onAction()
          .subscribe(() => {
            updates.activateUpdate().then(() => this.windowService.windowRef.location.reload());
          });
      });

    updates.unrecoverable.subscribe(event => {
      this.logger.error(
        `An error occurred that we cannot recover from:\n${event.reason}\n\n` +
        'Please reload the page.'
      );
      this.windowService.windowRef.location.reload();
    });
  }

}
