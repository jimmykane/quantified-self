import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AccountLinkingData {
    email: string;
    existingProviders: string[]; // Changed from single provider
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
        this.dialogRef.close(null); // Return null for cancel
    }

    onSelectProvider(providerId: string): void {
        this.dialogRef.close(providerId); // Return the selected provider ID
    }

    getProviderName(providerId: string): string {
        if (!providerId) return 'Email/Password';
        if (providerId === 'password') return 'Email & Password';
        // Simplified provider name (e.g.,google.com -> Google)
        const name = providerId.split('.')[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    isEmailLink(providerId: string): boolean {
        // We treat 'password' as potentially needing email link flow if that's what we want 
        // But typically 'emailLink' flow is for when the user wants to login via link.
        // However, fetchSignInMethods returns 'password' for both password and email link accounts usually? 
        // Actually, 'emailLink' is not a provider ID returned by fetchSignInMethods, it returns 'password' or 'email'. 
        // Wait, fetchSignInMethods returns 'password' for password accounts. 
        // If we want to support "Send Magic Link", we can offer it for 'password' provider too as an alternative?
        // Or if the user strictly has no password set? 
        // For now, let's assume 'password' provider means we can offer Email Link logic if we want.
        // BUT, the requirement is "login with google and email link". 
        // If the data.existingProviders includes 'password', we can offer "Send Magic Link".
        return false;
    }

    // Helper to show specific icon or label
    getProviderIcon(providerId: string): string {
        if (providerId.includes('google')) return 'google_logo_light'; // mapped in mat-icon registry usually
        if (providerId.includes('github')) return 'github_logo';
        return 'email';
    }
}
