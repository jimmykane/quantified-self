import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AppWindowService } from './app.window.service';

@Injectable({
    providedIn: 'root'
})
export class BrowserCompatibilityService {
    private dialog = inject(MatDialog);
    private windowService = inject(AppWindowService);

    /**
     * Checks if the browser supports CompressionStream and DecompressionStream.
     * If not supported, it can optionally show a dialog to the user.
     * @param showDialog Whether to show the upgrade dialog if unsupported.
     * @returns true if supported, false otherwise.
     */
    public checkCompressionSupport(showDialog: boolean = true): boolean {
        const isSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

        if (!isSupported && showDialog) {
            this.openBrowserUpgradeDialog();
        }

        return isSupported;
    }

    public checkVibrationSupport(): boolean {
        try {
            return typeof this.windowService.windowRef.navigator?.vibrate === 'function';
        } catch {
            return false;
        }
    }

    public checkClipboardImageWriteSupport(): boolean {
        try {
            return typeof ClipboardItem !== 'undefined'
                && typeof this.windowService.windowRef.navigator?.clipboard?.write === 'function';
        } catch {
            return false;
        }
    }

    public createRandomUUID(): string | null {
        try {
            return typeof globalThis.crypto?.randomUUID === 'function'
                ? globalThis.crypto.randomUUID()
                : null;
        } catch {
            return null;
        }
    }

    private openBrowserUpgradeDialog(): void {
        void import('../components/browser-upgrade-dialog/browser-upgrade-dialog.component')
            .then(({ BrowserUpgradeDialogComponent }) => {
                this.dialog.open(BrowserUpgradeDialogComponent, {
                    width: '400px',
                    maxWidth: '90vw'
                });
            })
            .catch((error: unknown) => {
                console.error('Failed to load the browser upgrade dialog.', error);
            });
    }
}
