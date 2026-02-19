import { ApplicationRef, Injectable, signal } from '@angular/core';
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
  public isUpdateAvailable = signal(false);
  private readonly seenVersionHashes = new Set<string>();
  private readonly seenVersionHashesStorageKey = 'app.update.seen-version-hashes';

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
      .subscribe((event) => {
        this.isUpdateAvailable.set(true);
        const versionHash = this.getVersionHash(event);
        if (this.hasSeenVersionHash(versionHash)) {
          return;
        }
        this.markVersionHashAsSeen(versionHash);

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

  public activateUpdate() {
    this.windowService.windowRef.location.reload();
  }

  private getVersionHash(event: VersionReadyEvent): string {
    return event.latestVersion.hash || event.currentVersion.hash || 'unknown-version-hash';
  }

  private hasSeenVersionHash(hash: string): boolean {
    if (this.seenVersionHashes.has(hash)) {
      return true;
    }

    const persistedHashes = this.getPersistedSeenHashes();
    if (persistedHashes.has(hash)) {
      this.seenVersionHashes.add(hash);
      return true;
    }

    return false;
  }

  private markVersionHashAsSeen(hash: string): void {
    this.seenVersionHashes.add(hash);
    this.persistSeenHashes();
  }

  private getPersistedSeenHashes(): Set<string> {
    try {
      const raw = this.windowService.windowRef.localStorage?.getItem(this.seenVersionHashesStorageKey);
      if (!raw) {
        return new Set<string>();
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return new Set<string>();
      }

      return new Set<string>(parsed.filter(item => typeof item === 'string'));
    } catch {
      return new Set<string>();
    }
  }

  private persistSeenHashes(): void {
    try {
      this.windowService.windowRef.localStorage?.setItem(
        this.seenVersionHashesStorageKey,
        JSON.stringify(Array.from(this.seenVersionHashes))
      );
    } catch {
      // Ignore storage failures; in-memory deduplication still works in this tab.
    }
  }

}
