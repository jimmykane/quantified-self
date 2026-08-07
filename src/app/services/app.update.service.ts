import { ApplicationRef, Injectable, signal } from '@angular/core';
import { SwUpdate, VersionInstallationFailedEvent, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { concat, interval } from 'rxjs';
import { filter, first } from 'rxjs/operators';
import { LoggerService } from './logger.service';
import { AppWindowService } from './app.window.service';


@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  public isUpdateAvailable = signal(false);
  private readonly promptedVersionHashes = new Set<string>();
  private readonly failedVersionHashes = new Set<string>();
  private updateCheckInFlight = false;
  private recoveryCheckScheduled = false;

  private static readonly recoveryCheckDelayMs = 30_000;

  constructor(appRef: ApplicationRef, updates: SwUpdate, private snackbar: MatSnackBar, private logger: LoggerService, private windowService: AppWindowService) {
    if (!updates.isEnabled) {
      return;
    }
    // Allow the app to stabilize first, before starting polling for updates with `interval()`.
    const appIsStable = appRef.isStable.pipe(first(isStable => isStable === true));
    const everyTenMinutes = interval(10 * 60 * 1000);
    const everyTenMinutesOnceAppIsStable$ = concat(appIsStable, everyTenMinutes);

    everyTenMinutesOnceAppIsStable$.subscribe(() => {
      this.checkForUpdates(updates, true);
    });

    this.windowService.windowRef.addEventListener('online', () => {
      this.checkForUpdates(updates);
    });
    this.windowService.windowRef.document.addEventListener('visibilitychange', () => {
      if (this.windowService.windowRef.document.visibilityState === 'visible') {
        this.checkForUpdates(updates);
      }
    });

    updates.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe((event) => {
        this.isUpdateAvailable.set(true);
        const versionHash = this.getVersionHash(event);
        if (this.promptedVersionHashes.has(versionHash)) {
          return;
        }
        this.promptedVersionHashes.add(versionHash);

        const snack = this.snackbar.open('There is a new version available', 'Reload', {
          duration: 0,
        });

        snack
          .onAction()
          .subscribe(() => {
            void updates.activateUpdate()
              .then(() => this.windowService.windowRef.location.reload())
              .catch((error) => {
                this.promptedVersionHashes.delete(versionHash);
                this.logger.error('[AppUpdateService] Failed to activate update', error);
              });
          });
      });

    updates.versionUpdates
      .pipe(filter((evt): evt is VersionInstallationFailedEvent => evt.type === 'VERSION_INSTALLATION_FAILED'))
      .subscribe((event) => {
        const versionHash = event.version.hash || 'unknown-version-hash';
        if (this.failedVersionHashes.has(versionHash)) {
          return;
        }
        this.failedVersionHashes.add(versionHash);

        this.logger.error('[AppUpdateService] Failed to install app update', {
          error: event.error,
          versionHash,
        });
        this.scheduleRecoveryCheck(updates);
      });

    updates.unrecoverable.subscribe(event => {
      this.logger.error(
        `An error occurred that we cannot recover from:\n${event.reason}\n\n` +
        'Please reload the page.'
      );
      this.windowService.windowRef.location.reload();
    });
  }

  public activateUpdate() {
    this.windowService.windowRef.location.reload();
  }

  private checkForUpdates(updates: SwUpdate): void {
    if (this.updateCheckInFlight) {
      return;
    }

    this.updateCheckInFlight = true;
    void Promise.resolve(updates.checkForUpdate())
      .then(() => undefined)
      .catch((error) => {
        this.logger.error('[AppUpdateService] Failed to check for updates', error);
      })
      .finally(() => {
        this.updateCheckInFlight = false;
      });
  }

  private scheduleRecoveryCheck(updates: SwUpdate): void {
    if (this.recoveryCheckScheduled) {
      return;
    }

    this.recoveryCheckScheduled = true;
    setTimeout(() => {
      this.recoveryCheckScheduled = false;
      this.checkForUpdates(updates);
    }, AppUpdateService.recoveryCheckDelayMs);
  }

  private getVersionHash(event: VersionReadyEvent): string {
    return event.latestVersion.hash || event.currentVersion.hash || 'unknown-version-hash';
  }

}
