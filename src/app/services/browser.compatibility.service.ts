import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BrowserUpgradeDialogComponent } from '../components/browser-upgrade-dialog/browser-upgrade-dialog.component';

@Injectable({
    providedIn: 'root'
})
export class BrowserCompatibilityService {
    private dialog = inject(MatDialog);

    /**
     * Checks if the browser supports CompressionStream and DecompressionStream.
     * If not supported, it can optionally show a dialog to the user.
     * @param showDialog Whether to show the upgrade dialog if unsupported.
     * @returns true if supported, false otherwise.
     */
    public checkCompressionSupport(showDialog: boolean = true): boolean {
        const isSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

        if (!isSupported && showDialog) {
            this.dialog.open(BrowserUpgradeDialogComponent, {
                width: '400px',
                maxWidth: '90vw'
            });
        }

        return isSupported;
    }
}
