import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AccountLinkingData {
    email: string;
    existingProvider: string;
    pendingProvider: string;
}

@Component({
    selector: 'app-account-linking-dialog',
    templateUrl: './account-linking-dialog.component.html',
    styleUrls: ['./account-linking-dialog.component.css'],
    standalone: false
})
export class AccountLinkingDialogComponent {
    constructor(
        public dialogRef: MatDialogRef<AccountLinkingDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: AccountLinkingData
    ) { }

    onCancel(): void {
        this.dialogRef.close(false);
    }

    onLink(): void {
        this.dialogRef.close(true);
    }

    getProviderName(providerId: string): string {
        if (!providerId) return 'Another account';
        // Simplified provider name (e.g.,google.com -> Google)
        const name = providerId.split('.')[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
}
