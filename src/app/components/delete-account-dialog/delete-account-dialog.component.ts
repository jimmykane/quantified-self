import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { AppHapticsService } from '../../services/app.haptics.service';

export interface DeleteAccountDialogData {
    displayName: string;
    hasActiveSubscription?: boolean;
}

@Component({
    selector: 'app-delete-account-dialog',
    standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatCheckboxModule,
        FormsModule
    ],
    templateUrl: './delete-account-dialog.component.html',
    styleUrls: ['./delete-account-dialog.component.scss']
})
export class DeleteAccountDialogComponent {
    confirmChecked = false;
    private readonly hapticsService = inject(AppHapticsService);

    constructor(
        public dialogRef: MatDialogRef<DeleteAccountDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: DeleteAccountDialogData
    ) { }

    onConfirm(): void {
        this.hapticsService.warning();
        this.dialogRef.close(true);
    }

    onCancel(): void {
        this.dialogRef.close(false);
    }
}
